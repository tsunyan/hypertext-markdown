"""スキルの CLI で、画像の差し替え・版の保持・失敗時の出力保護を確かめる。"""
import base64
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "skills/hypertext-markdown/scripts/build.mjs"


@pytest.fixture
def cli(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node が無い")
    (tmp_path / "input.md").write_text('# 文書\n\n```js\nlogo: "本文の例"\n```\n', encoding="utf-8")
    for name in ("logo #%.svg", "dark.svg", "icon.svg"):
        (tmp_path / name).write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><title>{name}</title></svg>',
            encoding="utf-8",
        )
    shutil.copy(ROOT / "src/assets/favicon.png", tmp_path / "icon.png")

    def run(*args):
        return subprocess.run([node, str(BUILD), *map(str, args)], cwd=tmp_path, check=False,
                              capture_output=True, encoding="utf-8")
    return run


@pytest.mark.parametrize("template", [
    "skills/hypertext-markdown/assets/template.html", "template-guide.src.html",
    "template-guide.min.html", "samples/template-guide-c1.src.html",
])
def test_theme_assets_and_rebuild(cli, tmp_path, template):
    output = tmp_path / "out.html"
    args = ["input.md", "--template", ROOT / template, "--keep-versions", "-o", output]
    result = cli(*args, "--logo", "logo #%.svg", "--logo-dark", "dark.svg",
                 "--favicon", "icon.png", "--favicon", "icon.svg")
    assert result.returncode == 0, result.stderr
    text = output.read_text(encoding="utf-8")
    original = (ROOT / template).read_text(encoding="utf-8")
    versions = r'<script type="text/markdown" class="md-version"[\s\S]*?</script>'
    assert re.findall(versions, text) == re.findall(versions, original)
    assert 'logo: "本文の例"' in text
    for name in ("logo #%.svg", "dark.svg", "icon.png", "icon.svg"):
        assert base64.b64encode((tmp_path / name).read_bytes()).decode() in text
    head = text.split("</head>")[0]
    assert len(re.findall(r'rel="icon"', head)) == 2
    assert 'type="image/png"' in head and 'type="image/svg+xml"' in head
    assert "data:image" not in result.stdout

    # 同じ HTML を入出力にして再編集でき、指定しなければ画像を保持する。
    result = cli("input.md", "--template", output, "--keep-versions", "-o", output)
    assert result.returncode == 0, result.stderr
    assert output.read_text(encoding="utf-8") == text
    result = cli("input.md", "--template", output, "--keep-versions", "-o", output,
                 "--logo", "logo #%.svg", "--favicon", "icon.svg")
    assert result.returncode == 0, result.stderr
    updated = output.read_text(encoding="utf-8")
    assert base64.b64encode((tmp_path / "dark.svg").read_bytes()).decode() not in updated
    assert len(re.findall(r'rel="icon"', updated.split("</head>")[0])) == 1
    assert re.findall(versions, updated) == re.findall(versions, original)


@pytest.mark.parametrize("opening,closing", [("<SCRIPT>", "</SCRIPT>"), ("<ScRiPt>", "</sCrIpT>")])
def test_theme_matches_script_tag_case(cli, tmp_path, opening, closing):
    text = (ROOT / "template-guide.src.html").read_text(encoding="utf-8")
    text = re.sub(r"<script>(.*?)</script>", lambda m: opening + m[1] + closing,
                  text, flags=re.DOTALL | re.IGNORECASE)
    source = tmp_path / "template.html"
    source.write_text(text, encoding="utf-8")
    output = tmp_path / "out.html"
    result = cli("input.md", "--template", source, "-o", output, "--logo", "logo #%.svg")
    assert result.returncode == 0, result.stderr
    generated = output.read_text(encoding="utf-8")
    assert base64.b64encode((tmp_path / "logo #%.svg").read_bytes()).decode() in generated
    assert 'logo: "本文の例"' in generated


@pytest.mark.parametrize("options", [
    ["--logo", "missing.svg"], ["--logo-dark", "missing.svg"],
    ["--favicon", "input.md"], ["--logo"], ["--favicon", "--logo", "dark.svg"],
    ["--extract", "--logo", "dark.svg"],
])
def test_bad_theme_options_preserve_output(cli, tmp_path, options):
    output = tmp_path / "out.html"
    output.write_text("existing", encoding="utf-8")
    result = cli("input.md", "-o", output, *options)
    assert result.returncode != 0
    assert "エラー:" in result.stderr
    assert output.read_text(encoding="utf-8") == "existing"
