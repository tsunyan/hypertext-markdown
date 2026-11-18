"""共通テンプレートに、カタログで指定した CSS・ロゴ・favicon を重ねる。

使い方: python -I tools/make_design.py [キー ...]
通常は tools/build.py で、ほかの HTML とまとめて生成する。
"""
import json
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "template-guide.src.html"
DESIGN_DIR = ROOT / "samples" / "design"


def designs():
    return json.loads((DESIGN_DIR / "designs.json").read_text(encoding="utf-8"))


def dest_path(key):
    return ROOT / "samples" / f"template-guide-{key}.src.html"


def build(src, key):
    return runpy.run_path(str(ROOT / "tools/make_template.py"))["apply_theme"](src, DESIGN_DIR, designs()[key], key)


def main(keys):
    src = TEMPLATE.read_text(encoding="utf-8")
    known = designs()
    for key in keys or known:
        if key not in known:
            raise SystemExit(f"designs.json に {key} が無い")
        out = build(src, key)
        dest_path(key).write_bytes(out.encode("utf-8"))
        print("wrote", dest_path(key).name)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
