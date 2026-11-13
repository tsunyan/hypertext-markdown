"""README の先頭に載せる画像を、見本の実際の画面から作る。

使い方: python tools/make_readme_images.py（playwright と chromium が必要。requirements-dev.txt を参照）
出力: docs/images/readme-{title,views,versions}-{light,dark}.png（GitHub のライトとダークの表示に合わせて 2 枚ずつ）

1. title: ロゴと一行の説明
2. views: Markdown と、HTML・スライドのライトとダークの 5 つの姿を扇状に重ねる
3. versions: 版の管理と、版どうしの比較

背景は透明にし、文字と影の色だけをライトとダークで変える。テンプレートの見た目を変えたら作り直す。
"""
import base64
import html
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "samples" / "sample-versioned.src.html"
BRAND = ROOT / "samples" / "brand"
OUT = ROOT / "docs" / "images"
WIDTH = 1280  # 画像の幅（CSS ピクセル）。保存する PNG は SCALE 倍
SCALE = 2
DOC_VIEW = (960, 640)  # 文書の画面を撮る大きさ。狭くして文字を大きく見せる
# 画像に入れる文言。TAGLINE・SUB は README の冒頭の説明と、VER_HEAD・VER_SUB は版の画像の alt とそろえている
TAGLINE = "Markdown を内包した、1 つの HTML ファイルで配れる文書のテンプレート"
SUB = "目次・スライド・ライトとダーク・版の管理まで、ファイル 1 つで"
VER_HEAD = "版を確定して、ファイルの中に残す"
VER_SUB = "確定した版は全文でファイルに入る。どの 2 つの版でも、<br>変わったところを文書の上で見比べられる"

THEMES = {
    "light": {"fg": "#182134", "muted": "#5b6577", "frame": "#e6e9ef", "frame_fg": "#4a5466",
              "line": "rgb(24 33 52 / .12)", "shadow": "0 18px 40px rgb(24 33 52 / .16), 0 3px 10px rgb(24 33 52 / .10)",
              "accent": "#2b4c8c"},
    "dark": {"fg": "#f1f4f9", "muted": "#9aa6ba", "frame": "#262c38", "frame_fg": "#c3cad6",
             "line": "rgb(255 255 255 / .14)", "shadow": "0 18px 40px rgb(0 0 0 / .55), 0 3px 10px rgb(0 0 0 / .35)",
             "accent": "#93b2ec"},
}


def data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode()


def markdown_source() -> str:
    """見本の作業中の Markdown（script 要素の中の書き換えを戻す）。"""
    text = SAMPLE.read_text(encoding="utf-8")
    md = re.search(r'<script type="text/markdown" id="md-source">\n?(.*?)</script>', text, re.DOTALL).group(1)
    return md.replace("<\\/script", "</script").replace("<\\script", "<script")


def highlight_md(md: str, lines: int) -> str:
    """Markdown の行を、エディタ風に色分けした HTML にする。"""
    out, in_front = [], False
    for i, line in enumerate(md.splitlines()[:lines]):
        line = line[:44]  # カードの幅を超える分は捨てる
        e = html.escape(line)
        if line == "---" and (i == 0 or in_front):
            in_front, cls = i == 0, "mk"
        elif in_front and ":" in line:
            k, v = e.split(":", 1)
            e, cls = f'<span class="ky">{k}</span>:<span class="vl">{v}</span>', ""
        elif line.startswith("#"):
            cls = "hd"
        elif line.startswith(":::"):
            cls = "bl"
        elif line.startswith("|"):
            cls = "tb"
        elif line.startswith("- "):
            e, cls = '<span class="mk">-</span>' + e[1:], ""
        else:
            cls = ""
        out.append(f'<div class="{cls}">{e or "&nbsp;"}</div>')
    return "".join(out)


def shoot(browser, scheme: str, size: tuple[int, int], hash_: str = "", setup=None, clip=None) -> bytes:
    page = browser.new_page(viewport={"width": size[0], "height": size[1]}, color_scheme=scheme)
    page.goto(SAMPLE.as_uri() + (("#" + hash_) if hash_ else ""))
    page.wait_for_load_state("load")
    page.wait_for_timeout(600)
    if setup:
        clip = setup(page) or clip
    page.wait_for_timeout(400)
    png = page.screenshot(clip=clip) if clip else page.screenshot()
    page.close()
    return png


def open_slide(n: int):
    def setup(page):
        page.keyboard.press("Shift+S")
        page.wait_for_timeout(500)
        for _ in range(n):
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(300)
    return setup


def open_versions(page):
    page.keyboard.press("v")
    page.wait_for_selector("#ui-versions .ver-card", state="visible")
    page.wait_for_timeout(500)
    return page.locator("#ui-versions .ver-card").bounding_box()


def hide_toc(page):
    """目次を閉じて、本文を画面いっぱいにする。"""
    page.keyboard.press("b")
    page.wait_for_timeout(400)


def scroll_to_change(page):
    hide_toc(page)
    page.wait_for_selector(".vd-changed")
    page.wait_for_timeout(800)  # 比較を開いたときの自動スクロールが終わるのを待つ
    page.evaluate("""() => {
      const h = [...document.querySelectorAll('#ui-doc h2')].find(e => e.textContent.includes('性能要件'));
      window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 135);
    }""")


def capture(browser) -> dict:
    shots = {}
    for scheme in THEMES:
        shots[f"doc-{scheme}"] = shoot(browser, scheme, DOC_VIEW, setup=hide_toc)
        shots[f"compare-{scheme}"] = shoot(browser, scheme, DOC_VIEW, "compare=1.1..1.2", scroll_to_change)
        shots[f"versions-{scheme}"] = shoot(browser, scheme, (1280, 800), setup=open_versions)
        shots[f"slide-{scheme}"] = shoot(browser, scheme, (1280, 720), setup=open_slide(0))  # 表紙
    return shots


BASE_CSS = """
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body { font-family: "BIZ UDPGothic", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; color: var(--fg); }
#stage { position: relative; width: %(w)dpx; overflow: hidden; }
.win { position: absolute; border-radius: 12px; overflow: hidden; background: var(--frame);
       box-shadow: var(--shadow), 0 0 0 1px var(--line); }
.win .bar { height: 30px; display: flex; align-items: center; gap: 7px; padding: 0 12px; font-size: 13px;
            color: var(--frame_fg); letter-spacing: .02em; }
.win .bar i { width: 10px; height: 10px; border-radius: 50%%; background: var(--line); display: inline-block; }
.win .bar b { margin-left: 8px; font-weight: 600; }
.win img { display: block; width: 100%%; }
"""


def page_html(theme: dict, body: str, css: str = "") -> str:
    vars_ = ";".join(f"--{k}:{v}" for k, v in theme.items())
    return (f'<!doctype html><meta charset="utf-8"><style>:root{{{vars_}}}{BASE_CSS % {"w": WIDTH}}{css}</style>'
            f'<div id="stage">{body}</div>')


def window(label: str, inner: str, style: str) -> str:
    return f'<div class="win" style="{style}"><div class="bar"><i></i><i></i><i></i><b>{label}</b></div>{inner}</div>'


def title_html(scheme: str) -> str:
    logo = (BRAND / ("h1-logo-dark.svg" if scheme == "dark" else "h1-logo.svg")).read_bytes()
    src = "data:image/svg+xml;base64," + base64.b64encode(logo).decode()
    body = f"""<div class="t"><img src="{src}" alt=""><p class="tag">{TAGLINE}</p><p class="sub">{SUB}</p></div>"""
    css = """.t { padding: 44px 0 36px; text-align: center; }
.t img { height: 76px; display: block; margin: 0 auto 22px; }
.t .tag { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: .02em; }
.t .sub { margin: 10px 0 0; font-size: 18px; color: var(--muted); letter-spacing: .03em; }"""
    return page_html(THEMES[scheme], body, css)


def views_html(scheme: str, shots: dict, md_html: str) -> str:
    w = 480
    def img(key: str) -> str:
        return f'<img src="{data_url(shots[key])}">'

    # 左から右へ、書く → 読む → 発表する の順に重ねる（左, 上, 傾き）
    cards = [
        ("Markdown", f'<div class="md">{md_html}</div>', 18, 92, -8),
        ("HTML・ライト", img("doc-light"), 208, 46, -4),
        ("HTML・ダーク", img("doc-dark"), 400, 28, 0),
        ("スライド・ライト", img("slide-light"), 592, 50, 4),
        ("スライド・ダーク", img("slide-dark"), 782, 100, 8),
    ]
    cards = [window(label, inner, f"width:{w}px; left:{x}px; top:{y}px; transform:rotate({r}deg)")
             for label, inner, x, y, r in cards]
    css = """#stage { height: 530px; }
.md { height: 320px; padding: 14px 18px; background: #1b1f27; color: #d7dce5; overflow: hidden; contain: paint; white-space: nowrap;
      font: 14px/1.7 Consolas, "Cascadia Mono", "BIZ UDGothic", monospace; }
.md .mk { color: #7f8899; } .md .ky { color: #9cc3ff; } .md .vl { color: #e9d49a; }
.md .hd { color: #8fd18c; font-weight: 700; } .md .bl { color: #f0a46b; } .md .tb { color: #b9a6f2; }"""
    return page_html(THEMES[scheme], "".join(cards), css)


def png_ratio(png: bytes) -> float:
    """PNG の高さ÷幅（IHDR から読む）。"""
    return int.from_bytes(png[20:24], "big") / int.from_bytes(png[16:20], "big")


def versions_html(scheme: str, shots: dict) -> str:
    ratio = png_ratio(shots[f"versions-{scheme}"])
    vw = 580
    cards = [
        window("版の比較", f'<img src="{data_url(shots[f"compare-{scheme}"])}">',
               "width:690px; left:560px; top:20px"),
        (f'<div class="dlg" style="width:{vw}px; height:{vw * ratio:.0f}px; left:30px; top:190px">'
         f'<img src="{data_url(shots[f"versions-{scheme}"])}"></div>'),
        f'<div class="cap"><b>{VER_HEAD}</b><span>{VER_SUB}</span></div>',
    ]
    css = """#stage { height: 530px; }
.dlg { position: absolute; border-radius: 12px; overflow: hidden; box-shadow: var(--shadow), 0 0 0 1px var(--line); }
.dlg img { display: block; width: 100%; height: 100%; }
.cap { position: absolute; left: 34px; top: 46px; width: 500px; }
.cap b { display: block; font-size: 26px; font-weight: 600; letter-spacing: .02em; }
.cap span { display: block; margin-top: 10px; font-size: 16px; line-height: 1.7; color: var(--muted); }"""
    return page_html(THEMES[scheme], "".join(cards), css)


def render(browser, doc: str, path: Path) -> None:
    page = browser.new_page(viewport={"width": WIDTH, "height": 800}, device_scale_factor=SCALE)
    page.set_content(doc)
    page.wait_for_load_state("load")
    page.locator("#stage").screenshot(path=str(path), omit_background=True)
    page.close()
    print(path.relative_to(ROOT))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    md_html = highlight_md(markdown_source(), 30)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        shots = capture(browser)
        for scheme in THEMES:
            render(browser, title_html(scheme), OUT / f"readme-title-{scheme}.png")
            render(browser, views_html(scheme, shots, md_html), OUT / f"readme-views-{scheme}.png")
            render(browser, versions_html(scheme, shots), OUT / f"readme-versions-{scheme}.png")
        browser.close()


if __name__ == "__main__":
    main()
