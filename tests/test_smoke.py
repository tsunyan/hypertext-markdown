"""ブラウザでテンプレートと見本を開き、表示・スライド・版の比較・保存が壊れていないかを確かめる。

使い方: python -m pytest -q（事前に pip install -r requirements-dev.txt と python -m playwright install chromium）
図（Mermaid）は CDN から読むので、ネットワークにつながっている必要がある。
"""
import base64
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "template-guide.src.html"
SAMPLE = ROOT / "samples" / "sample-versioned.src.html"
SKILL = ROOT / "skills" / "hypertext-markdown"
SKELETON = SKILL / "assets" / "template.html"
BUILD = SKILL / "scripts" / "build.mjs"
MIN_SCALE = 80  # CONFIG.slideMinScale
# 外から読んでよい唯一の URL（CONFIG.mermaidSrc）。部分一致ではなく、この URL と完全に一致するものだけを許す
MERMAID_SRC = re.search(r"mermaidSrc: '([^']+)'", (ROOT / "src" / "engine.js").read_text(encoding="utf-8")).group(1)
# デザインの見本（samples/design/designs.json のキーごとに 1 つ）
DESIGNS = [
    ROOT / "samples" / f"template-guide-{key}.src.html"
    for key in json.loads((ROOT / "samples" / "design" / "designs.json").read_text(encoding="utf-8"))
]
DESIGNS += [
    ROOT / "samples" / f"template-guide-{key}.src.html"
    for key in json.loads((ROOT / "samples" / "brand" / "brands.json").read_text(encoding="utf-8"))
]

MERMAID_SETTLED = """() => [...document.querySelectorAll('.mermaid-block')]
  .every(b => b.dataset.state === 'done' || b.dataset.state === 'error' || b.querySelector('.mermaid-note'))"""


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


class Opened:
    """ページを開き、スクリプトの例外とコンソールのエラーを集める。"""

    def __init__(self, browser, **ctx):
        self.context = browser.new_context(viewport={"width": 1366, "height": 900}, accept_downloads=True, **ctx)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        self.page.on("console", lambda m: m.type == "error" and self.errors.append(f"console: {m.text}"))

    def goto(self, path, hash_=""):
        self.page.goto(path.as_uri() + (("#" + hash_) if hash_ else ""))
        return self.page

    def wait_mermaid(self):
        self.page.wait_for_function(MERMAID_SETTLED, timeout=60_000)
        states = self.page.eval_on_selector_all(".mermaid-block", "bs => bs.map(b => b.dataset.state || 'none')")
        assert all(s == "done" for s in states), f"描けなかった図がある: {states}"


@pytest.fixture
def opened(browser):
    made = []

    def make(**ctx):
        o = Opened(browser, **ctx)
        made.append(o)
        return o

    yield make
    for o in made:
        o.context.close()


def doc_facts(page):
    return page.evaluate(
        """() => ({
          toc: document.querySelectorAll('#ui-toc a').length,
          h2: document.querySelectorAll('#ui-doc h2').length,
          examples: [...document.querySelectorAll('.c-example')].map(e => ({
            tabs: e.querySelectorAll(':scope > .tab-list [role=tab]').length,
            empty: [...e.querySelectorAll(':scope > [role=tabpanel]')].filter(p => !p.textContent.trim()).length,
          })),
        })"""
    )


@pytest.mark.parametrize("path", [TEMPLATE, SAMPLE, *DESIGNS], ids=lambda p: p.name)
def test_renders_without_errors(opened, path):
    o = opened()
    page = o.goto(path)
    o.wait_mermaid()
    facts = doc_facts(page)
    assert facts["toc"] >= 5, "目次ができていない"
    assert facts["h2"] >= 3  # 利用ガイドは入門・実践・リファレンスの3部
    for k, ex in enumerate(facts["examples"]):
        assert ex["tabs"] == 2 and ex["empty"] == 0, f"{k + 1} 番目の :::example のタブがおかしい: {ex}"
    assert not o.errors, "\n".join(o.errors)


@pytest.mark.parametrize(
    "path,view",
    [(TEMPLATE, ""), (TEMPLATE, "compare=1.0..1.1"), (SAMPLE, ""), (SAMPLE, "compare=1.0..work"), *[(d, "") for d in DESIGNS]],
    ids=["template", "template-compare", "sample", "sample-compare", *[d.name for d in DESIGNS]],
)
def test_every_slide_fits(opened, path, view):
    o = opened()
    page = o.goto(path, view)
    o.wait_mermaid()
    page.keyboard.press("S")  # 先頭からスライド
    page.wait_for_selector("#ui-stage .slide-body")
    total = int(re.search(r"/\s*(\d+)", page.inner_text("#ui-stage .slide-num")).group(1))
    assert total >= 5
    bad = []
    for i in range(total):
        s = page.evaluate(
            """() => {
              const b = document.querySelector('#ui-stage .slide-body');
              const h = b.querySelector('h1, h2, h3');
              return {
                num: document.querySelector('#ui-stage .slide-num').textContent,
                size: parseInt(b.style.fontSize, 10) || 100,
                // テンプレートの overflows() と同じ判定。最後の要素の下の余白が 2px まで食い込むのは、見た目に影響しない
                over: b.classList.contains('is-overflow') || b.scrollHeight > b.clientHeight + 2,
                head: h ? h.textContent.trim().slice(0, 40) : '',
              };
            }"""
        )
        assert s["num"].startswith(f"{i + 1} /"), f"スライド {i + 1} に進めていない: {s['num']}"
        if s["over"] or s["size"] < MIN_SCALE:
            bad.append(s)
        page.keyboard.press("ArrowRight")
    assert not bad, f"収まっていないスライド（全 {total} 枚）: {bad}"
    assert not o.errors, "\n".join(o.errors)


def test_compare_marks_changes(opened):
    o = opened()
    page = o.goto(SAMPLE, "compare=1.0..1.2")
    page.wait_for_selector(".vd-changed")
    counts = page.evaluate(
        "() => Object.fromEntries(['vd-changed', 'vd-ins', 'vd-del', 'vd-added', 'vd-removed']"
        ".map(c => [c, document.querySelectorAll('#ui-doc .' + c).length]))"
    )
    assert counts["vd-changed"] > 0 and counts["vd-ins"] > 0 and counts["vd-del"] > 0, counts
    assert counts["vd-added"] > 0, counts  # 1.1 で足した「障害対策」の章
    assert not o.errors, "\n".join(o.errors)


def md_blocks(html):
    """作業中の Markdown と、確定した版の数。"""
    work = re.search(r'<script type="text/markdown" id="md-source">(.*?)</script>', html, re.DOTALL).group(1)
    return work.strip(), len(re.findall(r'<script type="text/markdown" class="md-version"', html))


@pytest.mark.parametrize("path", [TEMPLATE, SAMPLE, *DESIGNS], ids=lambda p: p.name)
def test_save_round_trip(opened, path, tmp_path):
    o = opened()
    page = o.goto(path)
    o.wait_mermaid()
    before = doc_facts(page)
    with page.expect_download() as dl:
        page.keyboard.press("Control+s")
    saved = tmp_path / "saved.html"
    dl.value.save_as(saved)
    html = saved.read_text(encoding="utf-8")
    assert html.startswith("<!doctype html>")
    assert md_blocks(html) == md_blocks(path.read_text(encoding="utf-8")), "保存で Markdown か版が変わった"

    # 保存した HTML を開き直しても、同じように描ける
    again = opened()
    again.goto(saved)
    again.wait_mermaid()
    assert doc_facts(again.page) == before
    assert not again.errors, "\n".join(again.errors)

    # JavaScript が動かない環境でも、描画済みの本文が読める
    nojs = opened(java_script_enabled=False)
    nojs.goto(saved)
    assert nojs.page.locator("#ui-doc h2").count() == before["h2"]
    assert not o.errors, "\n".join(o.errors)


def test_raw_html_is_sanitized(opened, tmp_path):
    """生 HTML は見た目に必要なものだけを残し、保存後も危険な内容を復活させない。"""
    markdown = r"""# 生 HTML の安全性

文中の <kbd id="safe-kbd" title="A &amp; B" onclick="window.__rawHtmlXss=1">Ctrl</kbd> は残す。

インライン前<script>window.__rawHtmlXss=12</script>中<style>.inline{background:url(https://example.invalid/inline.png)}</style>後<!-- slide --><!-- pagebreak -->末尾

<a id="safe-link" href="https://example.com/" target="_blank">安全なリンク</a>
<a id="bad-link" href="java&#x73;cript&colon;window.__rawHtmlXss=2" target="_blank" data-action="html">危険なリンク</a>

<div id="safe-box" class="c-sample slide-viewport search-bar copy-btn c-tabs tbl-copy" data-action="html" onclick="window.__rawHtmlXss=3" style="--c:#246; padding: 4px; border-left: 4px solid var(--accent); position: fixed; z-index: 9999; background-image: url(https://example.invalid/tracker.png)">
表示用の div
</div>

<div id="escaped-css" style="--remote:u\72l(https://example.invalid/escaped.png); background:var(--remote)">CSS エスケープ</div>
<div id="entity-css" style="color:red; background:u&#114;l(https://example.invalid/entity.png)">CSS 文字参照</div>

<img id="safe-image" alt="安全な画像" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" onerror="window.__rawHtmlXss=4">
<img id="bad-image" alt="危険な画像" src="data:text/html,&lt;script&gt;window.__rawHtmlXss=5&lt;/script&gt;">
<img id="unc-image" alt="UNC 画像" src="//example.invalid/tracker.png">

<script>window.__rawHtmlXss=6</script>

<style>#ui-doc { display:none } .sample { background:url(https://example.invalid/style.png) }</style>

<iframe srcdoc="<script>parent.__rawHtmlXss=7</script>"></iframe>

<form action="javascript:window.__rawHtmlXss=8"><button data-action="html" formaction="javascript:window.__rawHtmlXss=9">実行</button></form>

<div id="ui-doc">予約 ID</div>

<svg id="safe-svg" width="120" height="40" viewBox="0 0 120 40" role="img" aria-label="安全な図" onload="window.__rawHtmlXss=10">
  <defs><linearGradient id="safe-gradient"><stop offset="0" stop-color="#246"/></linearGradient></defs>
  <rect id="safe-rect" x="1" y="1" width="118" height="38" fill="url(#safe-gradient)"/>
  <rect id="escaped-svg" x="1" y="1" width="10" height="10" fill="u\72l(https://example.invalid/svg.png)"/>
  <foreignObject x="0" y="0" width="120" height="40"><div onclick="window.__rawHtmlXss=11">危険</div></foreignObject>
</svg>
"""
    facts_js = """() => {
      const root = document.querySelector('#ui-content');
      const box = root.querySelector('#safe-box');
      const link = root.querySelector('#safe-link');
      const badLink = root.querySelector('#bad-link');
      const badImage = root.querySelector('#bad-image');
      const uncImage = root.querySelector('#unc-image');
      const escapedCss = root.querySelector('#escaped-css');
      const entityCss = root.querySelector('#entity-css');
      const escapedSvg = root.querySelector('#escaped-svg');
      return {
        xss: window.__rawHtmlXss || 0,
        dangerousTags: root.querySelectorAll('script, style, iframe, object, embed, form, button, input, textarea, foreignObject').length,
        eventAttrs: [...root.querySelectorAll('*')].flatMap(e => [...e.attributes]).filter(a => /^on/i.test(a.name)).length,
        dataAttrs: [...root.querySelectorAll('*')].flatMap(e => [...e.attributes]).filter(a => /^data-/i.test(a.name)).length,
        uiDocIds: document.querySelectorAll('#ui-doc').length,
        safeKbd: root.querySelector('kbd#safe-kbd')?.title || '',
        safeBox: !!box,
        safeBoxClass: box?.className || '',
        boxStyle: box ? { padding: box.style.padding, css: box.style.cssText, custom: box.style.getPropertyValue('--c'), position: box.style.position, z: box.style.zIndex, image: box.style.backgroundImage } : null,
        safeLink: link ? { href: link.getAttribute('href'), target: link.target, rel: link.rel } : null,
        badLink: badLink ? { href: badLink.getAttribute('href'), target: badLink.getAttribute('target') } : null,
        badImageSrc: badImage ? badImage.getAttribute('src') : null,
        uncImageSrc: uncImage ? uncImage.getAttribute('src') : null,
        escapedCss: escapedCss ? { style: escapedCss.getAttribute('style'), image: getComputedStyle(escapedCss).backgroundImage } : null,
        entityCss: entityCss ? { style: entityCss.getAttribute('style'), image: getComputedStyle(entityCss).backgroundImage } : null,
        escapedSvgFill: escapedSvg ? escapedSvg.getAttribute('fill') : null,
        svg: !!root.querySelector('svg#safe-svg rect#safe-rect'),
        scriptText: root.textContent.includes('window.__rawHtmlXss=6'),
        styleText: root.textContent.includes('example.invalid/style.png'),
        inlineText: root.textContent.includes('インライン前中後末尾'),
        inlineScriptText: root.textContent.includes('window.__rawHtmlXss=12'),
        inlineStyleText: root.textContent.includes('example.invalid/inline.png'),
        inlineBreaks: root.querySelectorAll('.pagebreak').length,
      };
    }"""

    def facts(page):
        return page.evaluate(facts_js)

    def assert_safe(got):
        assert got["xss"] == 0
        assert got["dangerousTags"] == 0
        assert got["eventAttrs"] == 0
        assert got["dataAttrs"] == 0
        assert got["uiDocIds"] == 1
        assert got["safeKbd"] == "A & B" and got["safeBox"] and got["svg"]
        assert got["safeBoxClass"] == "c-sample"
        assert got["boxStyle"]["padding"] == "4px"
        assert got["boxStyle"]["custom"] == "#246"
        assert "border-left: 4px solid var(--accent)" in got["boxStyle"]["css"]
        assert got["boxStyle"]["position"] == ""
        assert got["boxStyle"]["z"] == ""
        assert got["boxStyle"]["image"] == ""
        assert got["safeLink"] == {
            "href": "https://example.com/",
            "target": "_blank",
            "rel": "noopener noreferrer",
        }
        assert got["badLink"] == {"href": None, "target": None}
        assert got["badImageSrc"] is None
        assert got["uncImageSrc"] is None
        assert not got["escapedCss"]["style"] or "--remote" not in got["escapedCss"]["style"]
        assert got["escapedCss"]["image"] == "none"
        assert got["entityCss"]["style"] is None
        assert got["entityCss"]["image"] == "none"
        assert got["escapedSvgFill"] is None
        assert not got["scriptText"] and not got["styleText"]
        assert got["inlineText"]
        assert not got["inlineScriptText"] and not got["inlineStyleText"]
        assert got["inlineBreaks"] == 0

    o = opened()
    page = o.goto(SKELETON)
    page.keyboard.press("E")
    page.fill("#ui-textarea", markdown)
    page.wait_for_selector("#ui-content #safe-box")
    page.wait_for_timeout(300)
    assert_safe(facts(page))

    with page.expect_download() as dl:
        page.keyboard.press("Control+s")
    saved = tmp_path / "sanitized.html"
    dl.value.save_as(saved)

    again = opened()
    again.goto(saved)
    again.page.wait_for_selector("#ui-content #safe-box")
    assert_safe(facts(again.page))

    nojs = opened(java_script_enabled=False)
    nojs.goto(saved)
    nojs.page.wait_for_selector("#ui-content #safe-box")
    assert_safe(facts(nojs.page))
    assert not o.errors and not again.errors, "\n".join(o.errors + again.errors)


def test_import_html_extracts_only_markdown_without_loading_page(opened, tmp_path):
    payload = '''<!doctype html><html><body>
<img src="https://example.invalid/import-tracker.png" onerror="window.__importXss=1">
<script>window.__importXss=2</script>
<!-- <script type="text/markdown" class="md-version" data-version="fake"># 偽の版</script> -->
<SCRIPT TYPE="text/markdown" CLASS="md-version" data-version="9.0" data-note="A > B &amp; C">
# 取り込んだ版

## 本文
文字参照は &lt;script&gt; のまま。
<img src="bad:" onerror="window.__importXss=3">
</SCRIPT></body></html>'''
    source = tmp_path / "import.html"
    source.write_text(payload, encoding="utf-8")
    o = opened()
    page = o.goto(SKELETON)
    requests = []
    page.on("request", lambda request: requests.append(request.url))
    page.keyboard.press("V")
    page.set_input_files("#ui-ver-file", source)
    page.wait_for_selector('#ui-versions-body [data-action="ver-view"][data-i="0"]')
    assert page.locator(".ver-table").inner_text().count("9.0") == 1
    assert "A > B & C" in page.locator(".ver-table").inner_text()
    assert "fake" not in page.locator(".ver-table").inner_text()
    page.click('[data-action="ver-view"][data-i="0"]')
    page.wait_for_selector("#ui-content h2")
    assert "文字参照は <script> のまま。" in page.locator("#ui-content").inner_text()
    assert page.evaluate("window.__importXss || 0") == 0
    assert page.locator('#ui-content [onerror], #ui-content script').count() == 0
    assert not any("example.invalid" in url for url in requests)
    assert not o.errors, "\n".join(o.errors)


def test_skill_empty_template(opened):
    o = opened()
    page = o.goto(SKELETON)
    page.wait_for_selector("#ui-doc .doc-empty")
    page.click("#ui-doc .doc-empty [data-action=edit]")
    page.wait_for_selector("#ui-textarea", state="visible")
    assert not o.errors, "\n".join(o.errors)


def test_skill_build_round_trip(opened, tmp_path):
    """利用ガイドの Markdown を取り出し、スキルの build.mjs で空のテンプレートに流し込むと、元と同じように描ける。"""
    node = shutil.which("node")
    if not node:
        pytest.skip("node が無い")
    md, built = tmp_path / "guide.md", tmp_path / "guide.html"
    subprocess.run([node, str(BUILD), "--extract", str(TEMPLATE), "-o", str(md)], check=True)
    subprocess.run([node, str(BUILD), str(md), "-o", str(built)], check=True)
    assert md_blocks(built.read_text(encoding="utf-8")) == (md_blocks(TEMPLATE.read_text(encoding="utf-8"))[0], 0)

    o = opened()
    page = o.goto(TEMPLATE)
    o.wait_mermaid()
    expected = doc_facts(page)
    again = opened()
    page = again.goto(built)
    again.wait_mermaid()
    assert doc_facts(page) == expected
    assert page.title() == "hypertext-markdown 利用ガイド"
    assert not again.errors, "\n".join(again.errors)


def test_external_requests_only_for_mermaid(opened, tmp_path):
    """外から読むのは Mermaid だけで、本文に図があり、描画済みの図が無いときに限る。"""
    node = shutil.which("node")
    if not node:
        pytest.skip("node が無い")

    def external(o):
        found = []
        o.context.on("request", lambda r: r.url.startswith(("http:", "https:")) and found.append(r.url))
        return found

    plain, chart = tmp_path / "plain.md", tmp_path / "chart.md"
    plain.write_text("---\ntitle: 図なし\n---\n\n# 見出し\n\n本文。\n\n| A | B |\n|---|---|\n| 1 | 2 |\n", encoding="utf-8")
    chart.write_text("---\ntitle: 図あり\n---\n\n# 見出し\n\n```mermaid\ngraph LR\n  A --> B\n```\n", encoding="utf-8")
    for md in (plain, chart):
        subprocess.run([node, str(BUILD), str(md), "-o", str(md.with_suffix(".html"))], check=True)

    # 図が無ければ、スキルの空のテンプレートも、それで作った HTML も外へ通信しない
    for path in (SKELETON, plain.with_suffix(".html")):
        o = opened()
        requests = external(o)
        o.goto(path).wait_for_selector("#ui-doc")
        o.page.wait_for_timeout(1000)
        assert requests == [], f"{path.name}: 図が無いのに外へ通信した: {requests}"
        assert not o.errors, "\n".join(o.errors)

    # 図があるときだけ Mermaid を読む
    o = opened()
    requests = external(o)
    page = o.goto(chart.with_suffix(".html"))
    o.wait_mermaid()
    assert requests and set(requests) == {MERMAID_SRC}, f"{MERMAID_SRC} 以外を読んだ: {requests}"
    with page.expect_download() as dl:
        page.keyboard.press("Control+s")
    saved = tmp_path / "saved.html"
    dl.value.save_as(saved)

    # 保存した HTML は描画済みの図を使い、開き直しても Mermaid を読まない
    again = opened()
    requests = external(again)
    again.goto(saved).wait_for_selector(".mermaid-block[data-state=done]")
    again.page.wait_for_timeout(1000)
    assert requests == [], f"描画済みの図があるのに外へ通信した: {requests}"
    assert not again.errors, "\n".join(again.errors)


@pytest.mark.parametrize("template", [SKELETON, TEMPLATE])
def test_skill_theme_images_survive_save(opened, tmp_path, template):
    node = shutil.which("node")
    if not node:
        pytest.skip("node が無い")
    md, built = tmp_path / "report.md", tmp_path / "report.html"
    md.write_text("# ロゴ確認\n\n## 本文\n確認用の文書。\n", encoding="utf-8")
    assets = ROOT / "samples/design"
    subprocess.run([
        node, str(BUILD), str(md), "--template", str(template), "-o", str(built),
        "--logo", str(assets / "cyber-logo.svg"), "--logo-dark", str(assets / "cyber-logo-dark.svg"),
        "--favicon", str(assets / "cyber-favicon.svg"),
    ], check=True)
    o = opened()
    page = o.goto(built)
    page.wait_for_selector(".doc-logo.img-light", state="attached")
    logos = page.locator(".doc-logo").evaluate_all("xs => xs.map(x => x.src)")
    assert logos == [
        "data:image/svg+xml;base64," + base64.b64encode((assets / name).read_bytes()).decode()
        for name in ("cyber-logo.svg", "cyber-logo-dark.svg")
    ]
    assert page.locator('head link[rel="icon"]').count() == 1
    icon = page.locator('head link[rel="icon"]').get_attribute("href")
    assert icon.startswith("data:image/svg+xml;base64,")
    page.wait_for_function("() => [...document.querySelectorAll('.doc-logo')].every(x => x.complete && x.naturalWidth > 0)")
    for theme in ("light", "dark"):
        page.evaluate("t => document.documentElement.dataset.theme = t", theme)
        assert page.locator(f".doc-logo.img-{theme}").is_visible()
        other = "dark" if theme == "light" else "light"
        assert not page.locator(f".doc-logo.img-{other}").is_visible()
    with page.expect_download() as dl:
        page.keyboard.press("Control+s")
    saved = tmp_path / "saved.html"
    dl.value.save_as(saved)
    for enabled in (True, False):
        again = opened(java_script_enabled=enabled)
        again.goto(saved)
        assert again.page.locator(".doc-logo").evaluate_all("xs => xs.map(x => x.src)") == logos
        assert again.page.locator('head link[rel="icon"]').get_attribute("href") == icon
        assert not again.errors
    # 保存済みの HTML に対してもロゴを再指定できる。
    subprocess.run([node, str(BUILD), str(md), "--template", str(saved), "-o", str(built),
                    "--logo", str(assets / "cute-logo.svg")], check=True)
    page = o.goto(built)
    page.wait_for_selector(".doc-logo")
    assert page.locator(".doc-logo").count() == 1
    assert page.locator(".doc-logo").get_attribute("src") not in logos
    light_logo = page.locator(".doc-logo").get_attribute("src")
    subprocess.run([node, str(BUILD), str(md), "--template", str(built), "-o", str(built),
                    "--logo-dark", str(assets / "cute-logo-dark.svg")], check=True)
    page = o.goto(built)
    page.wait_for_selector(".doc-logo.img-light", state="attached")
    assert page.locator(".doc-logo.img-light").get_attribute("src") == light_logo
    assert page.locator(".doc-logo.img-dark").get_attribute("src") == (
        "data:image/svg+xml;base64," + base64.b64encode((assets / "cute-logo-dark.svg").read_bytes()).decode()
    )
    md.write_text(f"---\nlogo: {logos[0]}\n---\n# 本文の設定を優先\n", encoding="utf-8")
    subprocess.run([node, str(BUILD), str(md), "--template", str(built), "-o", str(built),
                    "--logo", str(assets / "cute-logo.svg")], check=True)
    page = o.goto(built)
    page.wait_for_selector(".doc-logo")
    assert page.locator(".doc-logo").count() == 1
    assert page.locator(".doc-logo").get_attribute("src") == logos[0]
    assert not o.errors
