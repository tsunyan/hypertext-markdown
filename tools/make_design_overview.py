"""デザインの見本の表紙を撮り、組ごとに並べた画像を作る（README 用）。

使い方: python tools/make_design_overview.py（playwright と chromium が必要。requirements-dev.txt を参照）
出力: samples/design/overview-{light,dark}.png と overview-<組>-{light,dark}.png
（GitHub のライトとダークの表示に合わせて 2 枚ずつ）

samples/design/designs.json の順に、samples/template-guide-<キー>.src.html を開いて表紙を撮って並べる。
designs.json で "group" を持つデザインは、その組の画像（overview-<組>-…）に入る。
すき間は透明にする。デザインの見た目を変えたら作り直す。
"""
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DESIGN_DIR = ROOT / "samples" / "design"
VIEW = {"width": 1366, "height": 900}  # 見本を撮る大きさ
SCALE = 1  # 保存する PNG は、CSS ピクセルの SCALE 倍
GAP = 12
# 組（"group" の値。無いものは ""）ごとの、列の数と 1 枚の大きさ（CSS ピクセル）
LAYOUT = {"": (2, (683, 450)), "cc": (4, (456, 300))}


def main():
    designs = json.loads((DESIGN_DIR / "designs.json").read_text(encoding="utf-8"))
    groups = {}
    for key, design in designs.items():
        groups.setdefault(design.get("group", ""), []).append(key)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for group, keys in groups.items():
            for theme in ("light", "dark"):
                make_sheet(browser, group, keys, theme)
        browser.close()


def make_sheet(browser, group, keys, theme):
    cols, tile = LAYOUT[group]
    shots = []
    for key in keys:
        context = browser.new_context(viewport=VIEW, color_scheme=theme, device_scale_factor=SCALE * tile[0] / VIEW["width"] * 2)
        page = context.new_page()
        page.goto((ROOT / "samples" / f"template-guide-{key}.src.html").as_uri())
        page.wait_for_selector("#ui-doc .doc-header")
        page.wait_for_timeout(6000)  # 開いたときの動きが終わるのを待つ
        shots.append(base64.b64encode(page.screenshot()).decode("ascii"))
        context.close()
    # 撮った画面を 1 枚のページに並べ、背景を透明にして撮り直す
    width = cols * tile[0] + (cols - 1) * GAP
    imgs = "".join(f'<img src="data:image/png;base64,{s}" width="{tile[0]}" height="{tile[1]}">' for s in shots)
    context = browser.new_context(viewport={"width": width, "height": 600}, device_scale_factor=SCALE)
    page = context.new_page()
    page.set_content(
        f'<body style="margin:0"><div id="sheet" style="display:grid;grid-template-columns:repeat({cols},{tile[0]}px);gap:{GAP}px">'
        f"{imgs}</div></body>"
    )
    out = DESIGN_DIR / ("overview-" + (group + "-" if group else "") + theme + ".png")
    page.locator("#sheet").screenshot(path=str(out), omit_background=True)
    context.close()
    print("wrote", out.relative_to(ROOT), out.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
