"""Print door analysis for a few WSR scenes (E1 sanity check)."""
from __future__ import annotations

import os
import sys
import time

from ha.ir.doors import analyze_door
from ha.ir.usd_mesh import Geometry, open_stage


def main(scenes):
    root = os.path.join(os.environ["HA_DATA"], "World-SimReady-Home/raw/full/scene")
    for sc in scenes:
        st = open_stage(os.path.join(root, sc, sc + ".usdz"))
        g = Geometry(st)
        for c in st.GetPrimAtPath("/root/door").GetChildren():
            t = time.time()
            r = analyze_door(g, c)
            leaves = [(lf["id"], lf["width"], lf["thickness"], lf.get("open_angle_deg", lf.get("travel")))
                      for lf in r["leaves"]]
            print(sc, r["id"][:44], r["kind"], "opening", r.get("opening_width"), "clear", r.get("clear_width"),
                  "open", r.get("open_leaves"), leaves, r["notes"], f"{time.time() - t:.2f}s")


if __name__ == "__main__":
    main(sys.argv[1:] or ["scene000000", "scene000003"])
