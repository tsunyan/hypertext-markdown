"""デザインの見本の表紙を撮り、4 つを並べた画像を作る（README 用）。

使い方: python tools/make_design_overview.py（playwright と chromium が必要。requirements-dev.txt を参照）
出力: samples/design/overview-{light,dark}.png（GitHub のライトとダークの表示に合わせて 2 枚）

samples/design/designs.json の順に、samples/template-guide-<キー>.src.html を開いて表紙を撮り、2 列に並べる。
すき間は透明にする。デザインの見た目を変えたら作り直す。
"""
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DESIGN_DIR = ROOT / "samples" / "design"
VIEW = {"width": 1366, "height": 900}  # 見本を撮る大きさ
TILE = (683, 450)  # 並べるときの 1 枚の大きさ（CSS ピクセル）。保存する PNG は SCALE 倍
SCALE = 1
GAP = 12
COLS = 2


def main():
    keys = list(json.loads((DESIGN_DIR / "designs.json").read_text(encoding="utf-8")))
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ("light", "dark"):
            shots = []
            for key in keys:
                context = browser.new_context(viewport=VIEW, color_scheme=theme, device_scale_factor=SCALE * TILE[0] / VIEW["width"] * 2)
                page = context.new_page()
                page.goto((ROOT / "samples" / f"template-guide-{key}.src.html").as_uri())
                page.wait_for_selector("#ui-doc .doc-header")
                page.wait_for_timeout(6000)  # 開いたときの動きが終わるのを待つ
                shots.append(base64.b64encode(page.screenshot()).decode("ascii"))
                context.close()
            # 撮った画面を 1 枚のページに並べ、背景を透明にして撮り直す
            width = COLS * TILE[0] + (COLS - 1) * GAP
            imgs = "".join(f'<img src="data:image/png;base64,{s}" width="{TILE[0]}" height="{TILE[1]}">' for s in shots)
            context = browser.new_context(viewport={"width": width, "height": 600}, device_scale_factor=SCALE)
            page = context.new_page()
            page.set_content(
                f'<body style="margin:0"><div id="sheet" style="display:grid;grid-template-columns:repeat({COLS},{TILE[0]}px);gap:{GAP}px">'
                f"{imgs}</div></body>"
            )
            out = DESIGN_DIR / f"overview-{theme}.png"
            page.locator("#sheet").screenshot(path=str(out), omit_background=True)
            context.close()
            print("wrote", out.relative_to(ROOT), out.stat().st_size // 1024, "KB")
        browser.close()


if __name__ == "__main__":
    main()
