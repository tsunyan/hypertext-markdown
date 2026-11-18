"""共通テンプレートに、ブランドの画像・配色・追加 CSS を重ねる。

使い方: python -I tools/make_brand.py [キー ...]
旧形式の引数（テンプレート、ブランド素材のフォルダ、キー）にも対応する。
"""
import json
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND_DIR = ROOT / "samples" / "brand"


def brands():
    return json.loads((BRAND_DIR / "brands.json").read_text(encoding="utf-8"))


def make(src, brand_dir, key, info):
    return runpy.run_path(str(ROOT / "tools/make_template.py"))["apply_theme"](src, brand_dir, info, key)


def main(template, brand_dir, keys, output_dir=None):
    template, brand_dir = Path(template), Path(brand_dir)
    src = template.read_text(encoding="utf-8")
    known = json.loads((brand_dir / "brands.json").read_text(encoding="utf-8"))
    output_dir = Path(output_dir) if output_dir else template.parent
    for key in keys or known:
        if key not in known:
            raise SystemExit(f"brands.json に {key} が無い")
        stem = template.stem.removesuffix(".src")
        dest = output_dir / f"{stem}-{key}.src.html"
        dest.write_bytes(make(src, brand_dir, key, known[key]).encode("utf-8"))
        print("wrote", dest.name)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if args and args[0].endswith(".html"):
        main(args[0], args[1], args[2:])
    else:
        main(ROOT / "template-guide.src.html", BRAND_DIR, args, ROOT / "samples")
