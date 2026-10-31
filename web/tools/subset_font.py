"""Subset Smiley Sans (得意黑) to the characters the web page uses.

Usage: python web/tools/subset_font.py SmileySans-Oblique.ttf
Needs fonttools and brotli. Reads every .html/.js/.json under web/ and writes web/fonts/LFHeading.woff2.

Smiley Sans is OFL with Reserved Font Names "Smiley" and "得意黑". A subset is a Modified Version under the OFL,
so the output is renamed to "LF Heading". The original license is in web/fonts/OFL-SmileySans.txt.
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

WEB = Path(__file__).resolve().parents[1]
NAME = "LF Heading"
EXTRA = "清先住试住实验室素材库首页户型住户体检改造对比白天夜间起火实景诊断录制导出俯视跟随第一人称步入图层通行余量风险点门扫掠判定外形" \
        "０１２３４５６７８９，。、：；！？（）《》“”‘’—…·¥%"


def chars():
    text = EXTRA + "".join(chr(c) for c in range(0x20, 0x7F))
    for p in WEB.rglob("*"):
        if p.suffix in {".html", ".js", ".json"} and "vendor" not in p.parts:
            text += p.read_text(encoding="utf-8", errors="ignore")
    return sorted({c for c in text if c.isprintable()})


def main(src):
    font = TTFont(src)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(chars()))
    sub.subset(font)
    for rec in font["name"].names:
        if rec.nameID in (1, 3, 4, 16):
            rec.string = NAME
        elif rec.nameID == 6:
            rec.string = NAME.replace(" ", "")
    out = WEB / "fonts" / "LFHeading.woff2"
    font.flavor = "woff2"
    font.save(out)
    print(out, out.stat().st_size, "bytes", len(font.getGlyphOrder()), "glyphs")


if __name__ == "__main__":
    main(sys.argv[1])
