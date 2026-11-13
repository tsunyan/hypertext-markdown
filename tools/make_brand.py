"""テンプレートに、ロゴ・favicon・色を入れた版を作る。Markdown は変えない。

今回のブランド見本を作成するための補助ツール。入力は CONFIG.accent・logo・logoDark が空で、favicon が未設定のテンプレートを想定する。
ロゴ埋め込み済みの現在の template-guide.src.html から、そのまま再生成する用途には対応していない。

使い方: python -I tools/make_brand.py <template-guide.src.html> <brand フォルダ> [キー ...]

brand フォルダの brands.json にあるキー（c1、h1 など）ごとに、テンプレートと同じ場所へ template-guide-<キー>.src.html を書き出す。
キーを省くと全部を作る。入れるのは次の 3 つ。

- favicon: <キー>-favicon.png と <キー>-favicon.svg を、<head> の <link rel="icon"> にする
- ロゴ: <キー>-logo.svg と <キー>-logo-dark.svg を、CONFIG.logo と CONFIG.logoDark にする
- 色: brands.json の accent を、CONFIG.accent にする
"""
import base64
import json
import re
import sys
from pathlib import Path

MIME = {".svg": "image/svg+xml", ".png": "image/png"}


def data_url(path):
    return "data:" + MIME[path.suffix] + ";base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def set_config(src, key, value):
    """CONFIG の「key: '',」の行に値を入れる（行末のコメントは残す）。"""
    if "'" in value or "\\" in value or "\n" in value:
        raise SystemExit(f"CONFIG.{key} に入れられない文字がある")
    out, n = re.subn(r"(?m)^(  " + key + r": )''(,)", lambda m: m.group(1) + "'" + value + "'" + m.group(2), src)
    if n != 1:
        raise SystemExit(f"テンプレートに CONFIG.{key} の行が見つからない")
    return out


def make(src, brand_dir, key, info):
    links = []
    png, svg = brand_dir / f"{key}-favicon.png", brand_dir / f"{key}-favicon.svg"
    # SVG を読めないブラウザは PNG を使う
    if png.exists():
        links.append(f'<link rel="icon" type="image/png" sizes="32x32" href="{data_url(png)}">')
    links.append(f'<link rel="icon" type="image/svg+xml" href="{data_url(svg)}">')
    out, n = re.subn(r"(<title>[^<]*</title>\n)", lambda m: m.group(1) + "\n".join(links) + "\n", src, count=1)
    if n != 1:
        raise SystemExit("テンプレートに <title> が見つからない")
    out = set_config(out, "logo", data_url(brand_dir / f"{key}-logo.svg"))
    dark = brand_dir / f"{key}-logo-dark.svg"
    if dark.exists():
        out = set_config(out, "logoDark", data_url(dark))
    if info.get("accent"):
        out = set_config(out, "accent", info["accent"])
    return out


def main(template, brand_dir, keys):
    template, brand_dir = Path(template), Path(brand_dir)
    src = template.read_text(encoding="utf-8")
    brands = json.loads((brand_dir / "brands.json").read_text(encoding="utf-8"))
    for key in keys or brands:
        if key not in brands:
            raise SystemExit(f"brands.json に {key} が無い")
        stem = template.stem.removesuffix(".src")
        dest = template.with_name(f"{stem}-{key}.src{template.suffix}")
        out = make(src, brand_dir, key, brands[key])
        with open(dest, "w", encoding="utf-8", newline="\n") as f:
            f.write(out)
        print("wrote", dest.name, len(out.encode("utf-8")) // 1024, "KB")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
