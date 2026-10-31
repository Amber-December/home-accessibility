"""Subset the two Chinese web fonts to the characters the page needs.

Usage:
  python web/tools/subset_font.py heading SmileySans-Oblique.ttf   -> web/fonts/LFHeading.woff2
  python web/tools/subset_font.py body "NotoSansSC[wght].ttf"      -> web/fonts/LFSans.woff2
Needs fonttools and brotli.

heading: Smiley Sans (得意黑), only the characters in web/ (.html/.js/.json, vendor excluded).
body:    Noto Sans SC, weights 400-600, the characters in web/ plus GB2312 level 1 (3755 common hanzi),
         so chat input and scene data render in the same 黑体.
Both are OFL. A subset is a Modified Version, so the outputs are renamed ("LF Heading", "LF Sans");
the original licenses are in web/fonts/OFL-*.txt.
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEB = Path(__file__).resolve().parents[1]
EXTRA = "清先住试住实验室素材库首页户型住户体检改造对比白天夜间停电起火地震积水情景实景诊断录制导出俯视跟随第一人称步入图层通行余量风险点门扫掠判定外形" \
        "０１２３４５６７８９，。、：；！？（）《》“”‘’—…·¥%"
TARGETS = {"heading": ("LF Heading", "LFHeading.woff2"), "body": ("LF Sans", "LFSans.woff2")}


def page_chars():
    text = EXTRA + "".join(chr(c) for c in range(0x20, 0x7F))
    for p in WEB.rglob("*"):
        if p.suffix in {".html", ".js", ".json"} and "vendor" not in p.parts:
            text += p.read_text(encoding="utf-8", errors="ignore")
    return {c for c in text if c.isprintable()}


def gb2312_level1():
    out = set()
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return out


def main(kind, src):
    name, fname = TARGETS[kind]
    font = TTFont(src)
    chars = page_chars()
    if kind == "body":
        chars |= gb2312_level1()
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(sorted(chars)))
    sub.subset(font)
    if kind == "body" and "fvar" in font:
        font = instancer.instantiateVariableFont(font, {"wght": (400, 600)})
    for rec in font["name"].names:
        if rec.nameID in (1, 3, 4, 16):
            rec.string = name
        elif rec.nameID == 6:
            rec.string = name.replace(" ", "")
    out = WEB / "fonts" / fname
    font.flavor = "woff2"
    font.save(out)
    print(out, out.stat().st_size, "bytes", len(font.getGlyphOrder()), "glyphs")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
