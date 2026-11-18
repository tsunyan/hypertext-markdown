"""実際のコマンドで、保存から再生成・失敗からの復旧までを通す。"""
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_watch_cli_rebuilds_recovers_and_checks_without_writing(tmp_path):
    for directory in ("src", "tools", "samples/design", "samples/brand"):
        shutil.copytree(ROOT / directory, tmp_path / directory,
                        ignore=shutil.ignore_patterns("__pycache__", "overview-*.png"))
    assert not list((tmp_path / "samples").glob("*.html"))  # 出力 HTML は入力に使わない
    command = [sys.executable, "-I", str(tmp_path / "tools/build.py")]
    log = tmp_path / "watch.log"

    def output():
        return log.read_text(encoding="utf-8", errors="replace")

    def wait_for(text, count=1):
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if output().count(text) >= count:
                return
            assert process.poll() is None, output()
            time.sleep(0.1)
        raise AssertionError(f"監視の応答が無い: {text}\n{output()}")

    with log.open("wb") as stream:
        process = subprocess.Popen([*command, "--watch"], cwd=tmp_path, stdout=stream, stderr=stream)
        try:
            wait_for("変更を監視中")
            generated = tmp_path / "template-guide.src.html"
            assert generated.read_bytes() == (ROOT / "template-guide.src.html").read_bytes()
            expected = {p.name for p in (ROOT / "samples").glob("*.html")}
            assert {p.name for p in (tmp_path / "samples").glob("*.html")} == expected
            guide = tmp_path / "src/guide.md"
            with guide.open("a", encoding="utf-8", newline="\n") as f:
                f.write('\n<!-- 監視で追加 -->\n<script>例</script>\n{{ENGINE}}\n')
            wait_for("生成完了:", 2)
            html = generated.read_text(encoding="utf-8")
            assert html.count("<!-- 監視で追加 -->") == 2
            assert html.count("<\\script>例<\\/script>") == 2
            assert html.count("{{ENGINE}}") == 2

            # 不正な素材では、圧縮版や見本も含めて既存の出力を保つ。
            preserved = {p: p.read_bytes() for p in tmp_path.rglob("*.html") if "src" not in p.parts}
            engine = tmp_path / "src/engine.js"
            original = engine.read_bytes()
            engine.write_bytes(original + b"\n// </script>\n")
            wait_for("生成に失敗。")
            assert all(p.read_bytes() == data for p, data in preserved.items())
            engine.write_bytes(original)
            wait_for("生成完了:", 3)

            # 監視対象には生成ツールも含む。別プロセスで新しいコードを使う。
            tool = tmp_path / "tools/make_template.py"
            code = tool.read_text(encoding="utf-8")
            code = code.replace('return TOKEN_RE.sub(lambda m: values[m[1]], shell)',
                                'return TOKEN_RE.sub(lambda m: values[m[1]], shell) + "<!-- tool reloaded -->"')
            tool.write_text(code, encoding="utf-8", newline="\n")
            wait_for("生成完了:", 4)
            assert generated.read_bytes().endswith(b"<!-- tool reloaded -->")
            # ブランド素材と既定の favicon の変更も、見本に埋め込まれる。
            logo = tmp_path / "samples/brand/c1-logo.svg"
            logo.write_bytes(logo.read_bytes() + b"\n<!-- watched logo -->\n")
            icon = tmp_path / "src/assets/favicon.svg"
            icon.write_bytes(icon.read_bytes() + b"\n<!-- watched icon -->\n")
            wait_for("生成完了:", 5)
            import base64
            brand = (tmp_path / "samples/template-guide-c1.src.html").read_bytes()
            assert base64.b64encode(logo.read_bytes()) in brand
            assert base64.b64encode(icon.read_bytes()) in generated.read_bytes()
            time.sleep(1.5)
            assert output().count("生成完了:") == 5  # 自分の出力で生成を繰り返さない
        finally:
            process.terminate()
            process.wait(timeout=15)

    result = subprocess.run([*command, "--check"], capture_output=True, timeout=45, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    compressed = tmp_path / "template-guide.min.html"
    compressed.write_bytes(b"stale")
    result = subprocess.run([*command, "--check"], capture_output=True, timeout=45, check=False)
    assert result.returncode == 1
    assert b"template-guide.min.html" in result.stdout
    assert compressed.read_bytes() == b"stale"
