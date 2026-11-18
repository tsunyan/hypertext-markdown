"""src/ の素材を、配布できる 1 枚の HTML に組み立てる。追加パッケージは使わない。

使い方: python -I tools/make_template.py（全生成物の更新は tools/build.py）
"""
import base64
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = {"BOOTSTRAP", "STYLES", "GUIDE", "VERSIONS", "ENGINE", "FAVICONS"}
TOKEN_RE = re.compile(r"\{\{([A-Z_]+)\}\}")
MD_BLOCK = re.compile(r'(<script\b[^>]*\btype="text/markdown"[^>]*>)(.*?)(</script>)', re.DOTALL)
MIME = {".svg": "image/svg+xml", ".png": "image/png"}
PAGE_STYLE = '<style id="ui-page-style"></style>'


def read(path):
    """OS の改行を LF にそろえ、出力を再現できるようにする。"""
    return path.read_text(encoding="utf-8")


def escape_markdown(md):
    """engine.js の escScript() と同じ形で script の開始・終了を逃がす。"""
    return re.sub(r"<(/?)(script)", lambda m: "<\\" + m[1] + m[2], md, flags=re.IGNORECASE)


def asset_path(directory, name):
    path = (directory / name).resolve()
    if not path.is_relative_to(directory.resolve()):
        raise ValueError("素材は指定したフォルダ内のファイルを参照する")
    return path


def data_url(directory, name):
    path = asset_path(directory, name)
    if path.suffix not in MIME:
        raise ValueError(f"画像は SVG または PNG を指定する: {name}")
    return "data:" + MIME[path.suffix] + ";base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def favicon_links(directory, theme):
    links = []
    for name in theme["favicons"]:
        suffix = Path(name).suffix
        uri = data_url(directory, name)
        sizes = ' sizes="32x32"' if suffix == ".png" else ""
        links.append(f'<link rel="icon" type="{MIME[suffix]}"{sizes} href="{uri}">')
    return "\n".join(links)


def set_config(script, key, value):
    """設定値だけを置き換え、行末のコメントを保つ。"""
    if not isinstance(value, str) or any(c in value for c in "'\\\r\n<"):
        raise ValueError(f"CONFIG.{key} に入れられない文字がある")
    result, count = re.subn(r"(?m)^(  " + re.escape(key) + r": )'[^'\n]*'(,)",
                            lambda m: m[1] + "'" + value + "'" + m[2], script)
    if count != 1:
        raise ValueError(f"CONFIG.{key} の行がちょうど 1 つではない")
    return result


def theme_config(engine, directory, theme):
    for key in ("logo", "logoDark"):
        if key in theme:
            engine = set_config(engine, key, data_url(directory, theme[key]) if theme[key] else "")
    if "accent" in theme:
        engine = set_config(engine, "accent", theme["accent"])
    return engine


def apply_theme(template, directory, theme, key):
    """共通の HTML に CSS・画像・配色を重ねる。本文とエンジンの処理は共用する。"""
    # 本文に CONFIG の例が書かれていても、実行するスクリプト以外は変更しない。
    scripts = list(re.finditer(r"(<script>)(.*?)(</script>)", template, re.DOTALL))
    if not scripts:
        raise ValueError("テンプレートにエンジンが無い")
    engine = scripts[-1]
    result = template[:engine.start(2)] + theme_config(engine[2], directory, theme) + template[engine.end(2):]
    head, separator, body = result.partition("</head>")
    if not separator:
        raise ValueError("テンプレートに head が無い")
    if "favicons" in theme:
        head = re.sub(r'(?m)^<link rel="icon"[^>\n]*>\n', "", head)
        head, count = re.subn(r"(<title>[^<]*</title>\n)",
                              lambda m: m[1] + favicon_links(directory, theme) + "\n", head, count=1)
        if count != 1:
            raise ValueError("テンプレートに title が無い")
    if theme.get("css"):
        css = read(asset_path(directory, theme["css"])).strip()
        if re.search(r"</style|<script|</script", css, re.IGNORECASE):
            raise ValueError(f"{key} の CSS に style・script 要素を壊す文字がある")
        if head.count(PAGE_STYLE) != 1:
            raise ValueError("テンプレートに ui-page-style がちょうど 1 つではない")
        style = f'<style id="design-style" data-design="{html.escape(key, quote=True)}">\n{css}\n</style>\n'
        head = head.replace(PAGE_STYLE, style + PAGE_STYLE)
    return head + separator + body


def versions(source, latest="guide.md"):
    entries = json.loads(read(source / "versions" / "manifest.json"))
    if not isinstance(entries, list) or not entries:
        raise ValueError("manifest.json には、新しい順に見本の版を並べる")
    seen = set()
    for entry in entries:
        fields = ("version", "date", "author", "note", "source")
        if not isinstance(entry, dict) or any(not isinstance(entry.get(k), str) for k in fields):
            raise ValueError("見本の版には version・date・author・note・source を文字列で指定する")
        if not entry["version"] or entry["version"] in seen:
            raise ValueError("見本の版番号が空、または重複している")
        seen.add(entry["version"])
        path = (source / entry["source"]).resolve()
        if not path.is_relative_to(source.resolve()) or path.suffix != ".md":
            raise ValueError("見本の本文は src/ 内の Markdown ファイルを指定する")
    if latest is not None and entries[0]["source"] != latest:
        raise ValueError("いちばん新しい見本の版は guide.md を参照する")
    return entries


def assemble(source=ROOT / "src"):
    shell = read(source / "shell.html")
    tokens = TOKEN_RE.findall(shell)
    if set(tokens) != TOKENS or len(tokens) != len(TOKENS):
        raise ValueError("shell.html には " + "・".join(sorted(TOKENS)) + " の差し込み口を各 1 つ置く")
    css = read(source / "styles.css")
    bootstrap, engine = (read(source / name) for name in ("bootstrap.js", "engine.js"))
    theme = json.loads(read(source / "theme.json"))
    if re.search(r"</style", css, re.IGNORECASE):
        raise ValueError("styles.css に style 要素を閉じる文字列がある")
    for name, js in (("bootstrap.js", bootstrap), ("engine.js", engine)):
        if re.search(r"</script", js, re.IGNORECASE):
            raise ValueError(f"{name} に script 要素を閉じる文字列がある")
        for segment in re.findall(r"<!--(.*?)(?:-->|\Z)", js, re.DOTALL):
            if re.search(r"<script", segment, re.IGNORECASE):
                raise ValueError(f"{name} に script 要素の終わりを読み飛ばす文字列がある")
    engine = theme_config(engine, source, theme)
    guide = escape_markdown(read(source / "guide.md"))
    blocks = []
    for entry in versions(source):
        attrs = " ".join(f'data-{key}="{html.escape(entry[key], quote=True)}"'
                         for key in ("version", "date", "author", "note"))
        md = guide if entry["source"] == "guide.md" else escape_markdown(read(source / entry["source"]))
        blocks.append(f'<script type="text/markdown" class="md-version" {attrs}>\n{md}</script>')
    values = {"BOOTSTRAP": bootstrap, "STYLES": css, "GUIDE": guide,
              "VERSIONS": "\n".join(blocks), "ENGINE": engine, "FAVICONS": favicon_links(source, theme)}
    # 1 回で置き換え、本文に書かれた {{ENGINE}} などを差し込み口と取り違えない。
    return TOKEN_RE.sub(lambda m: values[m[1]], shell)


if __name__ == "__main__":
    (ROOT / "template-guide.src.html").write_bytes(assemble().encode("utf-8"))
