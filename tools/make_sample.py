"""テンプレートから、版付きの見本ファイルを作る。

使い方: python -I tools/make_sample.py <report-template.html> <出力先.html>
"""
import re
import sys

HEAD = """---
title: 受注管理システム 基本設計書
docid: DD-2026-014
version: {version}
date: 2026-10-15
author: 山田
status: {status}
classification: 社外秘
numbering: true
---

:::note 版管理の見本
この文書は、テンプレートの版管理を試すための見本です。V キーで「版の管理」を開き、版どうしを比較したり、過去の版を表示したりしてみてください。
:::

## 改版履歴 {{-}}

:::history
:::
"""

V10 = HEAD.format(version="1.0", status="draft") + """
## システム概要

受注の登録・照会と、物流部への出荷指示を行う社内システムです。利用者は営業部と物流部の約 200 名です。

## 性能要件

- 画面の応答は 3 秒以内とする
- 同時接続数は 500 とする

## 運用設計

- バックアップは毎日 1 回取得する
- 障害の連絡は、運用担当者が電話で行う
"""

V11 = HEAD.format(version="1.1", status="review") + """
## システム概要

受注の登録・照会と、物流部への出荷指示を行う社内システムです。利用者は営業部と物流部の約 200 名です。

## 性能要件

- 画面の応答は 3 秒以内とする
- 同時接続数は 500 とする
- 夜間バッチは 4 時間以内に終える

## 障害対策

- 障害時は 30 分以内に待機系へ切り替える
- 切り替えの手順は、運用手順書に定める

## 運用設計

- バックアップは毎日 1 回取得する
- 障害の連絡は、運用担当者が電話で行う
"""

V12 = HEAD.format(version="1.2", status="review") + """
## システム概要

受注の登録・照会と、物流部への出荷指示を行う社内システムです。利用者は営業部・物流部・経理部の約 250 名です。

:::table 環境ごとの台数
| 環境 | Web | AP | DB |
|---|---:|---:|---:|
| 本番 | 2 | 2 | 2 |
| 検証 | 1 | 1 | 1 |
:::

## 性能要件

- 画面の応答は 2 秒以内とする
- 夜間バッチは 4 時間以内に終える

## 障害対策

- 障害時は 15 分以内に待機系へ切り替える
- 切り替えの手順は、運用手順書に定める

## 運用設計

- バックアップは毎日 2 回（12 時と 0 時）取得する
- 障害の連絡は、監視システムからメールで自動送信する
"""

# 版 1.2 を確定したあとに直した、まだ確定していない作業中の内容
WORKING = V12.replace(
    "- 障害の連絡は、監視システムからメールで自動送信する\n",
    "- 障害の連絡は、監視システムからメールで自動送信する\n- 監視は 5 分間隔で行う\n",
)

VERSIONS = [  # 新しい順
    ("1.2", "2026-11-10", "佐藤", "性能要件と運用設計の見直し", V12),
    ("1.1", "2026-11-01", "山田", "性能要件と障害対策を追加", V11),
    ("1.0", "2026-10-15", "山田", "初版", V10),
]


def esc_attr(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def main(src_path, out_path):
    with open(src_path, encoding="utf-8") as f:
        src = f.read()
    # テンプレートに入っている見本の版（利用ガイドの版）は持ち込まない
    src = re.sub(r'\n?<script type="text/markdown" class="md-version"[^>]*>.*?</script>', "", src, flags=re.DOTALL)
    tag = '<script type="text/markdown" id="md-source">'
    a = src.index(tag)
    b = src.index("</script>", a) + len("</script>")
    if re.search(r"(?i)<script|</script", WORKING + "".join(v[4] for v in VERSIONS)):
        raise SystemExit("見本の Markdown に script タグが含まれています")
    blocks = [tag + "\n" + WORKING + "</script>"]
    for version, date, author, note, md in VERSIONS:
        blocks.append(
            f'<script type="text/markdown" class="md-version" data-version="{esc_attr(version)}" data-date="{esc_attr(date)}" data-author="{esc_attr(author)}" data-note="{esc_attr(note)}">\n{md}</script>'
        )
    out = src[:a] + "\n".join(blocks) + src[b:]
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(out)
    print("wrote", out_path, len(out.encode("utf-8")) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
