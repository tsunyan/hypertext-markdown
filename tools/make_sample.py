"""版管理の見本を、共通テンプレートと src/samples/versioned/ の Markdown から作る。

使い方: python -I tools/make_sample.py <template-guide.src.html> <出力先.html>
"""
import html
import re
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src" / "samples" / "versioned"


def make(src, source=SOURCE):
    helpers = runpy.run_path(str(ROOT / "tools/make_template.py"))
    escape = helpers["escape_markdown"]
    src = re.sub(r'\n?<script type="text/markdown" class="md-version"[^>]*>.*?</script>', "", src, flags=re.DOTALL)
    blocks = ['<script type="text/markdown" id="md-source">\n'
              + escape((source / "working.md").read_text(encoding="utf-8")) + "</script>"]
    for entry in helpers["versions"](source, latest=None):
        attrs = " ".join(f'data-{key}="{html.escape(entry[key], quote=True)}"'
                         for key in ("version", "date", "author", "note"))
        md = escape((source / entry["source"]).read_text(encoding="utf-8"))
        blocks.append(f'<script type="text/markdown" class="md-version" {attrs}>\n{md}</script>')
    result, count = re.subn(r'<script type="text/markdown" id="md-source">.*?</script>',
                            lambda m: "\n".join(blocks), src, flags=re.DOTALL)
    if count != 1:
        raise ValueError("テンプレートに md-source がちょうど 1 つではない")
    return result


def main(src_path, out_path):
    out = make(Path(src_path).read_text(encoding="utf-8"))
    Path(out_path).write_bytes(out.encode("utf-8"))
    print("wrote", out_path)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
