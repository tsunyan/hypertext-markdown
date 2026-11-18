"""素材から HTML と見本をまとめて生成する。--watch で保存時に自動生成する。

使い方: python -I tools/build.py [--check | --watch] [--images]
Python と Node.js・npm が必要。--images には開発用の Playwright と Chromium も必要。
"""
import argparse
import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_tool(name, root=ROOT):
    spec = importlib.util.spec_from_file_location(name, root / "tools" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    # 同じ秒・同じサイズで保存されても、古い .pyc を使わず素材を読み直す。
    exec(compile(Path(spec.origin).read_bytes(), spec.origin, "exec"), module.__dict__)  # noqa: S102 -- ローカルの生成ツールだけを読む
    return module


def outputs(root=ROOT):
    """全出力を先に作る。素材の誤りや圧縮失敗で、既存の HTML を半端に更新しない。"""
    template_tool = load_tool("make_template", root)
    template = template_tool.assemble(root / "src")
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise ValueError("Node.js と npm が必要")
    compressed = load_tool("minify_html", root).minify_html(template, npm)
    result = {
        root / "template-guide.src.html": template,
        root / "template-guide.min.html": compressed,
        root / "samples" / "sample-versioned.src.html": load_tool("make_sample", root).make(template),
        root / "skills" / "hypertext-markdown" / "assets" / "template.html":
            load_tool("make_skeleton", root).make(compressed),
    }
    design = load_tool("make_design", root)
    for key in design.designs():
        result[design.dest_path(key)] = design.build(template, key)
    brand = load_tool("make_brand", root)
    for key, info in brand.brands().items():
        path = root / "samples" / f"template-guide-{key}.src.html"
        if path in result:
            raise ValueError(f"見本のキーが重複している: {key}")
        result[path] = brand.make(template, root / "samples" / "brand", key, info)
    result[root / "samples" / "index.html"] = load_tool("make_index", root).make(design.designs(), brand.brands())
    return {path: text.encode("utf-8") for path, text in result.items()}


def changed_files(generated):
    return [path for path, data in generated.items() if not path.exists() or path.read_bytes() != data]


def write_changed(generated):
    changed = changed_files(generated)
    for path in changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        # ブラウザが読み込み直す途中で、書きかけの HTML を開かないようにする。
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as f:
            temporary = Path(f.name)
            f.write(generated[path])
        try:
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    return changed


def snapshot(root=ROOT):
    """生成物を除いた素材だけを見る。追加・削除と、同じサイズの編集も検出する。"""
    paths = [*(root / "src").rglob("*"), *(root / "tools").glob("*.py")]
    for directory in ("design", "brand"):
        paths += [p for p in (root / "samples" / directory).glob("**/*")
                  if p.suffix in {".css", ".svg", ".json", ".png"} and not p.name.startswith("overview")]
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).digest() for p in paths if p.is_file()}


def watch(images=False, root=ROOT, interval=0.5, debounce=0.5):
    command = [sys.executable, "-I", str(root / "tools" / "build.py")]
    if images:
        command.append("--images")

    def rebuild():
        # 別プロセスで読み直し、生成ツール自体の修正も次の生成に反映する。
        result = subprocess.run(command, check=False)
        if result.returncode:
            print("生成に失敗。素材を直して保存すると再試行する。", flush=True)

    previous = snapshot(root)
    rebuild()
    print("変更を監視中（終了: Ctrl+C）。生成後はブラウザを再読み込みする。", flush=True)
    pending = None
    while True:
        time.sleep(interval)
        try:
            current = snapshot(root)
        except OSError:
            continue  # エディタが保存時にファイルを入れ替えている間は待つ
        if current != previous:
            previous = current
            pending = time.monotonic()
        if pending is not None and time.monotonic() - pending >= debounce:
            rebuild()
            pending = None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="書き込まずに生成物との一致を検査する")
    mode.add_argument("--watch", action="store_true", help="素材の変更を監視して自動生成する")
    parser.add_argument("--images", action="store_true", help="README とデザイン一覧の画像も生成する")
    args = parser.parse_args()
    if args.check and args.images:
        parser.error("--check は HTML の一致を調べる。--images とは同時に使えない")
    try:
        if args.watch:
            watch(args.images)
            return 0
        generated = outputs()
        if args.check:
            changed = changed_files(generated)
            if changed:
                for path in changed:
                    print(f"NG 生成物が未更新: {path.relative_to(ROOT)}")
                print("python -I tools/build.py で作り直す")
                return 1
            print(f"OK: 全 {len(generated)} HTML が素材からの生成結果と一致")
        else:
            changed = write_changed(generated)
            print(f"生成完了: {len(changed)} / {len(generated)} HTML を更新", flush=True)
        if args.images:
            for tool in ("make_readme_images.py", "make_design_overview.py"):
                subprocess.run([sys.executable, str(ROOT / "tools" / tool)], check=True)
        return 0
    except KeyboardInterrupt:
        print("\n監視を終了")
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"NG {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
