"""E0 environment smoke: LLM endpoint, ffmpeg, three.js vendor, MuJoCo offscreen, WSR readability."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from ha import llm, runlog

REPO = runlog.REPO


def check(name, fn, results):
    t = time.time()
    try:
        detail = fn()
        results[name] = {"ok": True, "detail": detail}
    except Exception as e:  # record every failure, do not abort
        results[name] = {"ok": False, "detail": f"{type(e).__name__}: {str(e)[:300]}"}
    results[name]["seconds"] = round(time.time() - t, 2)
    print(f"[{'PASS' if results[name]['ok'] else 'FAIL'}] {name}: {results[name]['detail']}")


def llm_check(model):
    def fn():
        r = llm.complete("Reply with the single word OK.", model=model, max_tokens=8)
        return {"model": r["model"], "text": r["text"].strip(), "usage": r["usage"]}
    return fn


def ffmpeg_check(run_dir):
    import imageio.v2 as iio
    import numpy as np
    out = run_dir / "ffmpeg_smoke.mp4"
    with iio.get_writer(out, fps=10, codec="libx264", quality=7, macro_block_size=1) as w:
        for i in range(20):
            frame = np.zeros((90, 160, 3), np.uint8)
            frame[:, i * 8:(i + 1) * 8] = 255
            w.append_data(frame)
    return {"file": out.name, "bytes": out.stat().st_size}


def three_check():
    root = REPO / "prototypes/js/vendor/three-r128"
    need = ["build/three.min.js", "controls/OrbitControls.js", "libs/fflate.min.js"] + [
        f"loaders/{n}.js" for n in ("OBJLoader", "MTLLoader", "TDSLoader", "GLTFLoader", "FBXLoader", "ColladaLoader")]
    missing = [p for p in need if not (root / p).is_file()]
    if missing:
        raise FileNotFoundError(missing)
    return {"files": len(need)}


def mujoco_check(backend, run_dir):
    code = (
        "import mujoco, imageio.v2 as iio, sys\n"
        "m=mujoco.MjModel.from_xml_string('<mujoco><worldbody><light pos=\"0 0 3\"/>"
        "<geom type=\"plane\" size=\"2 2 .1\"/><geom type=\"box\" pos=\"0 0 .2\" size=\".2 .2 .2\" rgba=\"1 0 0 1\"/>"
        "</worldbody></mujoco>')\n"
        "d=mujoco.MjData(m); mujoco.mj_forward(m,d)\n"
        "r=mujoco.Renderer(m,240,320); r.update_scene(d); px=r.render()\n"
        "iio.imwrite(sys.argv[1], px); print(px.shape, int(px.mean()))\n")
    env = {**os.environ, "MUJOCO_GL": backend, "PYOPENGL_PLATFORM": backend}
    out = run_dir / f"mujoco_{backend}.png"
    p = subprocess.run([sys.executable, "-c", code, str(out)], env=env, capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.strip().splitlines()[-1] if p.stderr.strip() else f"exit {p.returncode}")
    return {"render": p.stdout.strip(), "file": out.name}


def wsr_check():
    from pxr import Usd
    scene = Path(os.environ["HA_DATA"]) / "World-SimReady-Home/raw/full/scene/scene000000/scene000000.usdz"
    t = time.time()
    stage = Usd.Stage.Open(str(scene))
    n = sum(1 for _ in stage.Traverse())
    return {"scene": scene.parent.name, "prims": n, "open_s": round(time.time() - t, 2)}


def main():
    run_dir = runlog.new_run("E0")
    results = {}
    check("llm_haiku_4_5", llm_check("claude-haiku-4-5-20251001"), results)
    check("llm_sonnet_4_6", llm_check("claude-sonnet-4-6"), results)
    check("ffmpeg_imageio", lambda: ffmpeg_check(run_dir), results)
    check("three_r128_vendor", three_check, results)
    check("mujoco_egl", lambda: mujoco_check("egl", run_dir), results)
    check("mujoco_osmesa", lambda: mujoco_check("osmesa", run_dir), results)
    check("wsr_usd_open", wsr_check, results)
    (run_dir / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    runlog.write_manifest(run_dir, experiment="E0", params={"checks": list(results)},
                          models={"llm_default": llm.DEFAULT_MODEL})
    print(run_dir)


if __name__ == "__main__":
    main()
