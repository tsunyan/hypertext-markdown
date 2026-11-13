"""esbuild で HTML 内の CSS と JavaScript を圧縮する。Markdown とその他の HTML は保持する。

使い方: python -I tools/minify_html.py [入力.src.html] [出力.min.html]
出力を省くと、入力名の .src.html を .min.html に替えた名前で書き出す。
Node.js と npm が必要。初回実行時に npm が固定バージョンの esbuild を取得する。
"""
import argparse
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ESBUILD = "esbuild@0.28.2"
BLOCKS = re.compile(r"<!--.*?-->|<(script|style)\b([^>]*)>(.*?)</\1\s*>", re.DOTALL | re.IGNORECASE)
SCRIPT_TYPE = re.compile(r"\btype\s*=\s*['\"]([^'\"]*)['\"]", re.IGNORECASE)
JS_TYPES = {"", "text/javascript", "application/javascript", "module"}


def minify_html(html, npm):
    def replace(match):
        if not match[1]:  # HTML コメント内のタグは扱わない
            return match[0]
        tag, attrs, body = match[1].lower(), match[2], match[3]
        script_type = SCRIPT_TYPE.search(attrs)
        if tag == "script" and script_type and script_type[1].lower() not in JS_TYPES:
            return match[0]  # 埋め込み Markdown と版データをそのまま残す
        if not body.strip():
            return match[0]
        loader = "js" if tag == "script" else "css"
        result = subprocess.run(
            [npm, "exec", "--yes", f"--package={ESBUILD}", "--", "esbuild",
             f"--loader={loader}", "--minify", "--legal-comments=none"],
            input=body.encode("utf-8"), stdout=subprocess.PIPE, check=True,
        )
        compressed = result.stdout.decode("utf-8").rstrip("\n")
        if re.search(r"</" + tag + r"\b", compressed, re.IGNORECASE):
            raise ValueError(f"圧縮した {tag} の中に HTML の閉じタグが含まれています")
        return f"<{match[1]}{attrs}>{compressed}</{match[1]}>"

    return BLOCKS.sub(replace, html)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, default=ROOT / "template-guide.src.html")
    parser.add_argument("output", nargs="?", type=Path)
    args = parser.parse_args()
    output = args.output or args.source.with_name(args.source.stem.removesuffix(".src") + ".min" + args.source.suffix)
    if args.source.resolve() == output.resolve():
        parser.error("入力と出力には別のファイルを指定してください")
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        parser.error("Node.js と npm が必要です")
    source = args.source.read_bytes().decode("utf-8")
    compressed = minify_html(source, npm).encode("utf-8")
    output.write_bytes(compressed)
    before, after = args.source.stat().st_size, len(compressed)
    reduction = 100 * (1 - after / before) if before else 0
    print(f"{output.name}: {before:,} -> {after:,} bytes ({reduction:.1f}% smaller)")


if __name__ == "__main__":
    main()
