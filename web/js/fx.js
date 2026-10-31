/* Realtime post-processing (PRD 5.10.12): N8AO, Bloom, AgX, SMAA; the diagnostic style adds ink outlines.
   Ink lines come from the Laplacian of 1/z: it is zero on any plane, so it marks silhouettes and creases only. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};

  const INK_FRAG = /* glsl */`
    uniform vec3 inkColor;
    uniform float strength;
    uniform float thickness;
    float invZ(const in vec2 uv) { return -1.0 / getViewZ(readDepth(uv)); }
    void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
      vec2 dx = vec2(texelSize.x * thickness, 0.0), dy = vec2(0.0, texelSize.y * thickness);
      float c = invZ(uv);
      float lap = abs(invZ(uv - dx) + invZ(uv + dx) - 2.0 * c) + abs(invZ(uv - dy) + invZ(uv + dy) - 2.0 * c);
      float e = depth >= 1.0 ? 0.0 : smoothstep(0.0015, 0.006, lap / max(c, 1e-5));
      outputColor = vec4(mix(inputColor.rgb, inkColor, e * strength), inputColor.a);
    }`;

  function inkEffect(PP, THREE) {
    const ink = new THREE.Color('#24212A');
    return new PP.Effect('InkEffect', INK_FRAG, {
      attributes: PP.EffectAttribute.DEPTH,
      uniforms: new Map([
        ['inkColor', new THREE.Uniform(new THREE.Vector3(ink.r, ink.g, ink.b))],
        ['strength', new THREE.Uniform(0.85)],
        ['thickness', new THREE.Uniform(1.0)],
      ]),
    });
  }

  const AO = {
    real: { aoRadius: 0.6, distanceFalloff: 0.5, intensity: 2.0 },
    diag: { aoRadius: 0.9, distanceFalloff: 0.6, intensity: 3.5 },
  };

  function create(renderer, scene, camera) {
    const { PP, N8AOPostPass } = HA.lib, THREE = window.THREE;
    const composer = new PP.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    composer.addPass(new PP.RenderPass(scene, camera));
    const size = renderer.getSize(new THREE.Vector2());
    const ao = new N8AOPostPass(scene, camera, size.x, size.y);
    ao.configuration.gammaCorrection = false;
    ao.setQualityMode(HA.config.quality === 'high' ? 'High' : 'Medium');
    composer.addPass(ao);
    const ink = inkEffect(PP, THREE);
    const passes = {
      real: new PP.EffectPass(camera,
        new PP.BloomEffect({ intensity: 0.35, luminanceThreshold: 0.85, mipmapBlur: true }),
        new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.AGX }),
        new PP.SMAAEffect()),
      diag: new PP.EffectPass(camera,
        new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.AGX }),
        ink,
        new PP.SMAAEffect()),
    };
    composer.addPass(passes.real); composer.addPass(passes.diag);

    const fx = { composer, ao, ink, style: 'real' };
    fx.setStyle = name => {
      fx.style = name;
      // The composer only marks the last added pass for screen output, so move that flag with the style.
      for (const [k, p] of Object.entries(passes)) p.enabled = p.renderToScreen = k === name;
      Object.assign(ao.configuration, AO[name]);
    };
    fx.setSize = (w, h) => {
      composer.setSize(w, h, false);
      ink.uniforms.get('thickness').value = Math.max(1, renderer.getPixelRatio() * 0.75);
    };
    fx.render = dt => composer.render(dt);
    fx.setStyle('real');
    return fx;
  }

  HA.fx = { create };
})();
