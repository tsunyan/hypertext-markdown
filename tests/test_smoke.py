"""ブラウザでテンプレートと見本を開き、表示・スライド・版の比較・保存が壊れていないかを確かめる。

使い方: python -m pytest -q（事前に pip install -r requirements-dev.txt と python -m playwright install chromium）
図（Mermaid）は CDN から読むので、ネットワークにつながっている必要がある。
"""
import re
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "template-guide.src.html"
SAMPLE = ROOT / "samples" / "sample-versioned.src.html"
MIN_SCALE = 80  # CONFIG.slideMinScale

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


@pytest.mark.parametrize("path", [TEMPLATE, SAMPLE], ids=lambda p: p.name)
def test_renders_without_errors(opened, path):
    o = opened()
    page = o.goto(path)
    o.wait_mermaid()
    facts = doc_facts(page)
    assert facts["toc"] >= 5, "目次ができていない"
    assert facts["h2"] >= 5
    for k, ex in enumerate(facts["examples"]):
        assert ex["tabs"] == 2 and ex["empty"] == 0, f"{k + 1} 番目の :::example のタブがおかしい: {ex}"
    assert not o.errors, "\n".join(o.errors)


@pytest.mark.parametrize(
    "path,view",
    [(TEMPLATE, ""), (TEMPLATE, "compare=1.0..1.1"), (SAMPLE, ""), (SAMPLE, "compare=1.0..work")],
    ids=["template", "template-compare", "sample", "sample-compare"],
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


@pytest.mark.parametrize("path", [TEMPLATE, SAMPLE], ids=lambda p: p.name)
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
