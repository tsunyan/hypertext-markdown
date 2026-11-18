"""見本の一覧を、カタログと専用の外枠・CSS から生成する。"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def make(designs, brands, source=ROOT / "src" / "samples"):
    groups = [
        ("Sample", ["sample-versioned.src.html"]),
        ("Brand templates", [f"template-guide-{k}.src.html" for k, v in sorted(brands.items()) if v.get("group") != "other"]),
        ("Design templates", [f"template-guide-{k}.src.html" for k, v in sorted(designs.items()) if v.get("group") != "cc"]),
        ("Color templates", [f"template-guide-{k}.src.html" for k, v in sorted(designs.items()) if v.get("group") == "cc"]),
        ("Other templates", [f"template-guide-{k}.src.html" for k, v in sorted(brands.items()) if v.get("group") == "other"]),
    ]
    sections = []
    for title, names in groups:
        links = "\n".join(f'        <li><a href="./{html.escape(name, quote=True)}">{html.escape(name)} '
                          '<span aria-hidden="true">↗</span></a></li>' for name in names)
        sections.append(f"    <section>\n      <h2>{title}</h2>\n      <ul>\n{links}\n      </ul>\n    </section>")
    css = (source / "index.css").read_text(encoding="utf-8")
    if re.search(r"</style", css, re.IGNORECASE):
        raise ValueError("一覧の CSS に style 要素を閉じる文字列がある")
    values = {"STYLES": css, "SECTIONS": "\n".join(sections), "COUNT": str(sum(len(names) for _, names in groups))}
    shell = (source / "index.html").read_text(encoding="utf-8")
    tokens = re.findall(r"\{\{([A-Z_]+)\}\}", shell)
    if set(tokens) != set(values) or len(tokens) != len(values):
        raise ValueError("一覧の外枠に STYLES・SECTIONS・COUNT の差し込み口を各 1 つ置く")
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: values[m[1]], shell)
