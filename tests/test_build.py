"""素材の組み立て、生成物の保護、変更監視を確かめる。"""
import importlib.util
import json
import os
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent


def load_tool(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


template = load_tool("make_template")
build = load_tool("build")


@pytest.fixture
def source(tmp_path):
    return Path(shutil.copytree(ROOT / "src", tmp_path / "src"))


def test_assembled_html_matches_distribution():
    assert template.assemble().encode("utf-8") == (ROOT / "template-guide.src.html").read_bytes()


def test_markdown_is_escaped_once_and_shared_with_latest_version(source):
    md = '# 見本\n<script>alert("例")</script>\n<ScRiPt>例</sCrIpT>\n{{ENGINE}}\n'
    (source / "guide.md").write_bytes(md.encode("utf-8"))
    result = template.assemble(source)
    bodies = [m[2] for m in template.MD_BLOCK.finditer(result)]
    expected = '\n# 見本\n<\\script>alert("例")<\\/script>\n<\\ScRiPt>例<\\/sCrIpT>\n{{ENGINE}}\n'
    assert bodies[:2] == [expected, expected]
    assert bodies[2] != expected


def test_crlf_sources_produce_same_html(source):
    before = template.assemble(source)
    for path in source.rglob("*"):
        if path.suffix in {".css", ".js", ".html", ".md", ".json"}:
            path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
    assert template.assemble(source) == before


@pytest.mark.parametrize("replacement", ["", "{{ENGINE}}{{ENGINE}}", "{{UNKNOWN}}"])
def test_missing_duplicate_or_unknown_slot_fails(source, replacement):
    shell = source / "shell.html"
    shell.write_text(shell.read_text(encoding="utf-8").replace("{{ENGINE}}", replacement), encoding="utf-8")
    with pytest.raises(ValueError, match="差し込み口"):
        template.assemble(source)


@pytest.mark.parametrize("name,text", [
    ("styles.css", "/* </STYLE> */"),
    ("engine.js", "// </script>"),
    ("bootstrap.js", "// <!-- <ScRiPt>"),
])
def test_unsafe_inline_code_fails(source, name, text):
    (source / name).write_text(text, encoding="utf-8")
    with pytest.raises(ValueError, match="要素"):
        template.assemble(source)


@pytest.mark.parametrize("change", ["outside", "duplicate", "latest", "missing", "type"])
def test_invalid_version_manifest_fails(source, change):
    manifest = source / "versions" / "manifest.json"
    entries = json.loads(manifest.read_text(encoding="utf-8"))
    if change == "outside":
        entries[1]["source"] = "../outside.md"
    elif change == "duplicate":
        entries[1]["version"] = entries[0]["version"]
    elif change == "latest":
        entries[0]["source"] = "versions/1.0.md"
    elif change == "missing":
        del entries[0]["date"]
    else:
        entries[0]["note"] = None
    manifest.write_text(json.dumps(entries), encoding="utf-8")
    with pytest.raises(ValueError):
        template.assemble(source)


def test_version_attributes_are_escaped(source):
    manifest = source / "versions" / "manifest.json"
    entries = json.loads(manifest.read_text(encoding="utf-8"))
    entries[0]["note"] = '例 "引用" & <タグ>'
    manifest.write_text(json.dumps(entries), encoding="utf-8")
    assert 'data-note="例 &quot;引用&quot; &amp; &lt;タグ&gt;"' in template.assemble(source)


THEMES = [(folder, key) for folder, manifest in (("design", "designs.json"), ("brand", "brands.json"))
          for key in json.loads((ROOT / "samples" / folder / manifest).read_text(encoding="utf-8"))]


@pytest.mark.parametrize("folder,key", THEMES)
def test_theme_reuses_content_and_engine(folder, key):
    import re
    directory = ROOT / "samples" / folder
    catalog = json.loads((directory / ("designs.json" if folder == "design" else "brands.json")).read_text(encoding="utf-8"))
    base = template.assemble()
    themed = template.apply_theme(base, directory, catalog[key], key)
    assert [m[0] for m in template.MD_BLOCK.finditer(themed)] == [m[0] for m in template.MD_BLOCK.finditer(base)]
    # 設定値を除き、実行される JavaScript はすべて共通にする。
    def scripts(text):
        code = re.findall(r"<script>(.*?)</script>", text, re.DOTALL)
        return [re.sub(r"(?m)^  (logo|logoDark|accent):.*", "CONFIG ASSET", c) for c in code]
    assert scripts(themed) == scripts(base)
    for name in catalog[key]["favicons"]:
        assert template.data_url(directory, name) in themed
    assert template.data_url(directory, catalog[key]["logo"]) in themed
    assert template.data_url(directory, catalog[key]["logoDark"]) in themed


def test_default_assets_are_external_sources():
    source = ROOT / "src"
    assert "data:image/" not in (source / "shell.html").read_text(encoding="utf-8")
    assert "data:image/" not in (source / "engine.js").read_text(encoding="utf-8")
    theme = json.loads((source / "theme.json").read_text(encoding="utf-8"))
    result = template.assemble()
    for name in [theme["logo"], theme["logoDark"], *theme["favicons"]]:
        assert template.data_url(source, name) in result


def test_theme_does_not_rewrite_config_examples_in_markdown(source):
    md = ('# 見本\n  logo: \'example\',\n<link rel="icon" href="example">\n'
          '<style id="ui-page-style"></style>\n')
    (source / "guide.md").write_text(md, encoding="utf-8")
    (source / "theme.css").write_text("body { color: red; }", encoding="utf-8")
    base = template.assemble(source)
    result = template.apply_theme(base, source, {"accent": "red", "favicons": [], "css": "theme.css"}, "test")
    assert result.count(md) == 2


def test_theme_rejects_outside_assets_and_unsafe_css(tmp_path):
    with pytest.raises(ValueError, match="フォルダ内"):
        template.data_url(tmp_path, "../outside.svg")
    (tmp_path / "bad.css").write_text("</style><script>", encoding="utf-8")
    with pytest.raises(ValueError, match="壊す"):
        template.apply_theme(template.assemble(), tmp_path, {"css": "bad.css"}, "bad")


def test_write_and_check_do_not_touch_unchanged_outputs(tmp_path):
    path = tmp_path / "out" / "example.html"
    assert build.write_changed({path: b"original"}) == [path]
    stamp = path.stat().st_mtime_ns
    assert build.write_changed({path: b"original"}) == []
    assert path.stat().st_mtime_ns == stamp
    assert build.changed_files({path: b"changed"}) == [path]
    assert path.read_bytes() == b"original"  # 検査は書き込まない
    assert build.write_changed({path: b"changed"}) == [path]
    assert path.read_bytes() == b"changed"
    assert list(path.parent.iterdir()) == [path]  # 一時ファイルを残さない


def test_failed_generation_keeps_existing_outputs(source, tmp_path, monkeypatch):
    path = tmp_path / "template-guide.src.html"
    path.write_bytes(b"previous output")
    monkeypatch.setattr(build, "load_tool", lambda name, root: template)
    (source / "engine.js").write_text("// </script>", encoding="utf-8")
    with pytest.raises(ValueError):
        build.write_changed(build.outputs(tmp_path))
    assert path.read_bytes() == b"previous output"


def test_snapshot_tracks_sources_and_ignores_generated_files(tmp_path):
    for directory in ("src", "tools", "samples/design"):
        (tmp_path / directory).mkdir(parents=True)
    guide = tmp_path / "src/guide.md"
    guide.write_bytes(b"one")
    before = build.snapshot(tmp_path)
    (tmp_path / "template-guide.src.html").write_bytes(b"output")
    (tmp_path / "samples/design/overview-light.png").write_bytes(b"image")
    assert build.snapshot(tmp_path) == before
    guide.write_bytes(b"two")  # 同じサイズの変更
    assert build.snapshot(tmp_path) != before
    guide.unlink()
    assert build.snapshot(tmp_path) == {}
    (tmp_path / "tools/make_template.py").write_bytes(b"tool")
    (tmp_path / "samples/design/new.css").write_bytes(b"style")
    assert len(build.snapshot(tmp_path)) == 2


def test_tool_reload_ignores_stale_bytecode(tmp_path):
    tools = tmp_path / "tools"
    tools.mkdir()
    tool = tools / "example.py"
    tool.write_bytes(b'VALUE = "one"\n')
    stamp = tool.stat()
    spec = importlib.util.spec_from_file_location("example", tool)
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)  # 通常の import と同じキャッシュを作る
    tool.write_bytes(b'VALUE = "two"\n')
    os.utime(tool, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    assert build.load_tool("example", tmp_path).VALUE == "two"


def test_watch_debounces_and_recovers_from_failure(monkeypatch):
    states = iter([{"guide": b"a"}, {"guide": b"b"}, {"guide": b"c"}] + [{"guide": b"c"}] * 5)
    ticks, runs = [], []

    def sleep(_):
        ticks.append(len(ticks) + 1)
        if len(ticks) == 7:
            raise KeyboardInterrupt

    def run(command, check):
        runs.append(command)
        return SimpleNamespace(returncode=1 if len(runs) == 1 else 0)

    monkeypatch.setattr(build, "snapshot", lambda root: next(states))
    monkeypatch.setattr(build.time, "sleep", sleep)
    monkeypatch.setattr(build.time, "monotonic", lambda: len(ticks))
    monkeypatch.setattr(build.subprocess, "run", run)
    with pytest.raises(KeyboardInterrupt):
        build.watch(interval=1, debounce=1)
    assert len(runs) == 2  # 初回失敗のあと、連続した保存をまとめて 1 回だけ再生成する


def test_watch_notices_edits_during_generation(monkeypatch):
    state, ticks, runs = {"guide": b"a"}, [], []

    def sleep(_):
        ticks.append(1)
        if len(ticks) == 8:
            raise KeyboardInterrupt

    def run(command, check):
        runs.append(command)
        if len(runs) <= 2:
            state["guide"] += b"x"
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(build, "snapshot", lambda root: state.copy())
    monkeypatch.setattr(build.time, "sleep", sleep)
    monkeypatch.setattr(build.time, "monotonic", lambda: len(ticks))
    monkeypatch.setattr(build.subprocess, "run", run)
    with pytest.raises(KeyboardInterrupt):
        build.watch(interval=1, debounce=1)
    assert len(runs) == 3
