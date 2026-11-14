"""テンプレートに、デザイン（CSS・ロゴ・favicon）を重ねた見本を作る。Markdown と JavaScript は変えない。

使い方: python -I tools/make_design.py [キー ...]

samples/design/designs.json にあるキー（cyber、cute など）ごとに、samples/template-guide-<キー>.src.html を書き出す。
キーを省くと全部を作る。テンプレート（template-guide.src.html）を直したら、作り直す。

デザインの素材は samples/design/ に置く。

- <キー>.css: テンプレートの <style> の後ろに、<style id="design-style"> として入れる。
  後ろに置くので、同じ強さのセレクターならデザインの指定が勝つ。色の変数は :root:root に書く
  （テンプレートのダーク用の指定より強く、文書のフロントマターの palette・accent よりは弱い）
- <キー>-logo.svg と <キー>-logo-dark.svg: CONFIG.logo と CONFIG.logoDark にする
- <キー>-favicon.svg（あれば <キー>-favicon.png も）: <head> の <link rel="icon"> にする
"""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "template-guide.src.html"
DESIGN_DIR = ROOT / "samples" / "design"
MIME = {".svg": "image/svg+xml", ".png": "image/png"}
PAGE_STYLE = '<style id="ui-page-style"></style>'


def data_url(path):
    return "data:" + MIME[path.suffix] + ";base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def designs():
    return json.loads((DESIGN_DIR / "designs.json").read_text(encoding="utf-8"))


def dest_path(key):
    return ROOT / "samples" / f"template-guide-{key}.src.html"


def set_config(src, key, value):
    """CONFIG の「key: '…',」の行の値を入れ替える。"""
    if "'" in value or "\\" in value or "\n" in value:
        raise SystemExit(f"CONFIG.{key} に入れられない文字がある")
    out, n = re.subn(r"(?m)^(  " + key + r": )'[^'\n]*'(,)", lambda m: m.group(1) + "'" + value + "'" + m.group(2), src)
    if n != 1:
        raise SystemExit(f"テンプレートに CONFIG.{key} の行が見つからない")
    return out


def build(src, key):
    """テンプレートの中身（src）に、デザイン key を重ねた HTML を返す。"""
    css = (DESIGN_DIR / f"{key}.css").read_text(encoding="utf-8").strip()
    if re.search(r"(?i)</style|<script|</script", css):
        raise SystemExit(f"{key}.css に、style 要素や script 要素を壊す文字がある")

    # favicon: テンプレートのものを外し、デザインのものを <title> の後ろに入れる
    links = []
    png, svg = DESIGN_DIR / f"{key}-favicon.png", DESIGN_DIR / f"{key}-favicon.svg"
    if png.exists():  # SVG を読めないブラウザは PNG を使う
        links.append(f'<link rel="icon" type="image/png" sizes="32x32" href="{data_url(png)}">')
    links.append(f'<link rel="icon" type="image/svg+xml" href="{data_url(svg)}">')
    out = re.sub(r'(?m)^<link rel="icon"[^>\n]*>\n', "", src)
    out, n = re.subn(r"(<title>[^<]*</title>\n)", lambda m: m.group(1) + "\n".join(links) + "\n", out, count=1)
    if n != 1:
        raise SystemExit("テンプレートに <title> が見つからない")

    out = set_config(out, "logo", data_url(DESIGN_DIR / f"{key}-logo.svg"))
    out = set_config(out, "logoDark", data_url(DESIGN_DIR / f"{key}-logo-dark.svg"))

    if out.count(PAGE_STYLE) != 1:
        raise SystemExit("テンプレートに " + PAGE_STYLE + " がちょうど 1 つではない")
    return out.replace(PAGE_STYLE, f'<style id="design-style" data-design="{key}">\n{css}\n</style>\n{PAGE_STYLE}')


def main(keys):
    src = TEMPLATE.read_text(encoding="utf-8")
    known = designs()
    for key in keys or known:
        if key not in known:
            raise SystemExit(f"designs.json に {key} が無い")
        out = build(src, key)
        dest = dest_path(key)
        with open(dest, "w", encoding="utf-8", newline="\n") as f:
            f.write(out)
        print("wrote", dest.name, len(out.encode("utf-8")) // 1024, "KB")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
