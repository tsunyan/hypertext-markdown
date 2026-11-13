"""ブラウザを使わずにできる検査をまとめて行う。

使い方: python -I tools/check.py

1. script 要素が途中で終わったり、閉じずに後ろを飲み込んだりしない
2. 埋め込んだ JavaScript に構文の誤りがない（node --check。node が無ければ失敗する）
3. 見本（samples/sample-versioned.src.html）が、いまのテンプレートから作り直したものと同じ
4. テンプレートの作業中の Markdown が、いちばん新しい見本の版と同じ（開いたときに「未確定の変更あり」を出さない）
5. スキルの空のテンプレートが、いまの圧縮版から作り直したものと同じ
6. スキルの authoring.md に、利用ガイドで使っている囲みの名前と、フロントマターのキーがすべて出てくる
7. スキルの scripts/build.mjs に構文の誤りがない
"""
import importlib.util
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "template-guide.src.html"
TEMPLATE_MIN = ROOT / "template-guide.min.html"
SAMPLE = ROOT / "samples" / "sample-versioned.src.html"
SKILL = ROOT / "skills" / "hypertext-markdown"
SKELETON = SKILL / "assets" / "template.html"
AUTHORING = SKILL / "references" / "authoring.md"
BUILD = SKILL / "scripts" / "build.mjs"
HTML_FILES = [TEMPLATE, SAMPLE, SKELETON]
# 利用ガイドの見本にだけ出てくる、自作のデザインの名前
CUSTOM_BLOCKS = {"my-box"}

# HTML の構文では、script の中身は最初の </script で終わる
SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.DOTALL | re.IGNORECASE)


def scripts(text):
    return [(m.group(1), m.group(2)) for m in SCRIPT_RE.finditer(text)]


def check_script_blocks(path, text, errors):
    opened = len(re.findall(r"<script\b", text, re.IGNORECASE))
    blocks = scripts(text)
    if opened != len(blocks):
        errors.append(f"{path.name}: <script の数（{opened}）と閉じた script 要素の数（{len(blocks)}）が合わない")
    for attrs, body in blocks:
        # <!-- の後に <script が来ると、ブラウザは次の </script> で閉じなくなり、後ろを飲み込む
        for m in re.finditer(r"<!--", body):
            rest = body[m.end():]
            end = rest.find("-->")
            seg = rest if end < 0 else rest[:end]
            if re.search(r"<script", seg, re.IGNORECASE):
                line = text.count("\n", 0, text.find(body)) + body.count("\n", 0, m.start()) + 1
                errors.append(f"{path.name}:{line}: script の中で <!-- の後に <script がある（script 要素が閉じなくなる）")
    if len([a for a, _ in blocks if 'id="md-source"' in a]) != 1:
        errors.append(f"{path.name}: id=\"md-source\" の script 要素がちょうど 1 つではない")


def check_js_syntax(path, text, errors, workdir):
    node = shutil.which("node")
    if not node:
        errors.append("node が見つからないため、JavaScript の構文を確かめられない")
        return
    for k, (attrs, body) in enumerate(scripts(text)):
        m = re.search(r'\btype\s*=\s*"([^"]*)"', attrs)
        if m and m.group(1).lower() not in ("", "text/javascript", "module"):
            continue
        js = Path(workdir) / f"{path.stem}.{k}.{'mjs' if m and m.group(1) == 'module' else 'js'}"
        js.write_text(body, encoding="utf-8")
        r = subprocess.run([node, "--check", str(js)], capture_output=True, text=True, encoding="utf-8", check=False)
        if r.returncode != 0:
            line = text.count("\n", 0, text.find(body)) + 1
            errors.append(f"{path.name}: {line} 行目からの script に構文の誤りがある\n{r.stderr.strip()}")


def load_tool(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def check_sample(errors, workdir):
    out = Path(workdir) / "sample.html"
    make_sample = load_tool("make_sample")
    make_sample.main(str(TEMPLATE), str(out))
    if out.read_bytes() != SAMPLE.read_bytes():
        errors.append(
            "samples/sample-versioned.src.html が、いまのテンプレートから作った見本と違う。"
            "python -I tools/make_sample.py template-guide.src.html samples/sample-versioned.src.html で作り直す"
        )


def normalize_md(body):
    """テンプレートの readScript() と同じ正規化（先頭の空行と末尾の空白を除き、共通の字下げを取る）。"""
    raw = re.sub(r"\r\n?", "\n", body)
    raw = re.sub(r"^(?:[ \t]*\n)+", "", raw).rstrip()
    lines = raw.split("\n")
    widths = [len(re.match(r"[ \t]*", ln).group(0)) for ln in lines if ln.strip()]
    ind = min(widths) if widths else 0
    return "\n".join(ln[ind:] for ln in lines) if ind else raw


def check_template_versions(text, errors):
    blocks = scripts(text)
    work = [b for a, b in blocks if 'id="md-source"' in a]
    versions = [(a, b) for a, b in blocks if 'class="md-version"' in a]
    if not work or not versions:
        return
    newest_attrs, newest = versions[0]
    if normalize_md(work[0]) != normalize_md(newest):
        ver = re.search(r'data-version="([^"]*)"', newest_attrs)
        errors.append(
            f"template-guide.src.html: 作業中の Markdown が見本の版 {ver.group(1) if ver else '?'} と違う。"
            "利用ガイドを直したら、同じ内容を見本の版にも入れる"
        )


def check_skeleton(errors):
    made = load_tool("make_skeleton").make(TEMPLATE_MIN.read_bytes().decode("utf-8"))
    if made.encode("utf-8") != SKELETON.read_bytes():
        errors.append(
            "skills/hypertext-markdown/assets/template.html が、いまの圧縮版から作ったものと違う。"
            "python -I tools/minify_html.py のあと python -I tools/make_skeleton.py で作り直す"
        )


def check_authoring(text, errors):
    work = normalize_md(next(b for a, b in scripts(text) if 'id="md-source"' in a))
    authoring = AUTHORING.read_text(encoding="utf-8")
    blocks = set(re.findall(r"^:{3,}([a-z][\w-]*)", work, re.MULTILINE)) - CUSTOM_BLOCKS
    missing = sorted(b for b in blocks if not re.search(rf":::{re.escape(b)}(?![\w-])", authoring))
    # 利用ガイドの「## フロントマター」の表の 1 列目に並ぶキー
    section = re.search(r"^## フロントマター\n(.*?)^## ", work, re.MULTILINE | re.DOTALL)
    keys = set(re.findall(r"`([a-z_]+)`", "\n".join(
        row.split("|")[1] for row in (section.group(1) if section else "").splitlines() if row.startswith("| `")
    )))
    missing += sorted(f"フロントマターの {k}" for k in keys if f"`{k}`" not in authoring)
    if not section:
        errors.append("template-guide.src.html: 利用ガイドに「## フロントマター」の章が見つからない")
    if missing:
        errors.append(
            "skills/hypertext-markdown/references/authoring.md に、利用ガイドにある書式の説明が無い: " + "、".join(missing)
        )


def check_build_script(errors):
    node = shutil.which("node")
    if not node:
        return  # check_js_syntax が node の不足を知らせる
    r = subprocess.run([node, "--check", str(BUILD)], capture_output=True, text=True, encoding="utf-8", check=False)
    if r.returncode != 0:
        errors.append(f"{BUILD.relative_to(ROOT)} に構文の誤りがある\n{r.stderr.strip()}")


def main():
    # -I では PYTHONUTF8 が効かないので、Windows でパイプに出しても化けないように固定する
    sys.stdout.reconfigure(encoding="utf-8")
    errors = []
    with tempfile.TemporaryDirectory() as workdir:
        for path in HTML_FILES:
            text = path.read_text(encoding="utf-8")
            check_script_blocks(path, text, errors)
            check_js_syntax(path, text, errors, workdir)
        check_sample(errors, workdir)
        template = TEMPLATE.read_text(encoding="utf-8")
        check_template_versions(template, errors)
        check_skeleton(errors)
        check_authoring(template, errors)
        check_build_script(errors)
    if errors:
        print("\n".join("NG " + e for e in errors))
        sys.exit(1)
    print("OK: script 要素、JavaScript の構文、見本の同期、テンプレートの見本の版、スキルのテンプレート・書式の説明・build.mjs")


if __name__ == "__main__":
    main()
