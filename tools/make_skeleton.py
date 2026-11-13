"""圧縮版のテンプレートから、本文も版も入っていない空のテンプレートを作る。

使い方: python -I tools/make_skeleton.py [入力.min.html] [出力.html]
省くと template-guide.min.html から skills/hypertext-markdown/assets/template.html を作る。

スキルの scripts/build.mjs が、この空のテンプレートに .md を流し込む。
テンプレートの CSS・JavaScript を直したら、tools/minify_html.py で圧縮版を作り直してから、これを実行する。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "template-guide.min.html"
OUTPUT = ROOT / "skills" / "hypertext-markdown" / "assets" / "template.html"

WORK = re.compile(r'(<script type="text/markdown" id="md-source">).*?(</script>)', re.DOTALL)
VERSION = re.compile(r'\n?<script type="text/markdown" class="md-version"[^>]*>.*?</script>', re.DOTALL)
BAKED = re.compile(r'(<article class="doc" id="ui-doc"[^>]*>).*?(</article>)', re.DOTALL)


def make(text):
    text, n = WORK.subn(r"\1\n\2", text)
    if n != 1:
        raise ValueError(f'id="md-source" の script 要素がちょうど 1 つではない（{n} 個）')
    text = VERSION.sub("", text)
    # 保存した HTML から作ったときに備えて、描画済みの本文も空にする
    return BAKED.sub(r"\1\2", text)


def main(source=SOURCE, output=OUTPUT):
    source, output = Path(source), Path(output)
    text = source.read_bytes().decode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(make(text).encode("utf-8"))
    return output


if __name__ == "__main__":
    out = main(*sys.argv[1:3])
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"{out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}: {out.stat().st_size:,} bytes")
