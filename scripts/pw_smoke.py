"""E0 smoke: can headless Chromium (Playwright) render WebGL here? Writes a screenshot and a JSON record.

  PLAYWRIGHT_BROWSERS_PATH=$HA_RUNTIME/cache/ms-playwright python scripts/pw_smoke.py
Output: $HA_OUTPUTS/runs/E0/<stamp>-playwright-<host>/{shot.png, result.json, manifest.json}.
"""
from __future__ import annotations

import json
import platform
import socket

from playwright.sync_api import sync_playwright

from ha import runlog

PAGE = """<html><body style="margin:0"><canvas id=c width=640 height=360></canvas><script>
const gl = document.getElementById('c').getContext('webgl2') || document.getElementById('c').getContext('webgl');
let info = {webgl: !!gl};
if (gl) {
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  info.renderer = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  info.version = gl.getParameter(gl.VERSION);
  gl.clearColor(0.2, 0.5, 0.8, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const px = new Uint8Array(4); gl.readPixels(320, 180, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  info.pixel = Array.from(px);
}
window.INFO = info;
</script></body></html>"""


def main() -> None:
    run_dir = runlog.new_run("E0", tag=f"playwright-{socket.gethostname()[:20]}")
    res = {"host": socket.gethostname(), "python": platform.python_version()}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
            res["chromium"] = b.version
            pg = b.new_page(viewport={"width": 640, "height": 360})
            pg.set_content(PAGE)
            res["info"] = pg.evaluate("window.INFO")
            pg.screenshot(path=str(run_dir / "shot.png"))
            b.close()
        res["ok"] = bool(res["info"].get("webgl")) and res["info"].get("pixel", [0])[:3] == [51, 128, 204]
    except Exception as e:  # noqa: BLE001 - the failure is the result
        res["ok"], res["error"] = False, repr(e)[:2000]
    (run_dir / "result.json").write_text(json.dumps(res, indent=1))
    runlog.write_manifest(run_dir, experiment="E0", params={"probe": "playwright webgl"},
                          status="COMPLETED" if res["ok"] else "FAILED", notes=json.dumps(res)[:1500])
    print(json.dumps(res), run_dir)


if __name__ == "__main__":
    main()
