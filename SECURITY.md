# セキュリティポリシー

## 対象

`main` の最新状態を対象に修正する。古い版を使っている場合は、最新版でも再現するかを確かめる。

## 脆弱性を報告する

公開 Issue には、再現用の文書や攻撃コードを書かない。GitHub の [Private vulnerability reporting](https://github.com/tsunyan/hypertext-markdown/security/advisories/new) から非公開で報告する。

報告には次を含める。

- 影響を受けるファイルまたは版
- 再現に必要な最小の Markdown / HTML
- 文書を開いたとき、保存したとき、保存後に開き直したときのどこで起きるか
- 想定する影響と、確認したブラウザ
- 分かる範囲の回避策

## 脆弱性として扱う例

- 生 HTML の許可リストを回避して、スクリプト、イベント属性、埋め込みコンテンツ、フォームを実行できる
- `javascript:` などの危険な URL や、外部通信を行う CSS を残せる
- `ui-` で始まる予約 ID、重複 ID、`data-action` などを使って画面の操作を乗っ取れる
- 保存した HTML を JavaScript 有効または無効で開き直すと、除去したはずの危険な内容が復活する
- SVG のイベント、外部参照、`foreignObject` などを使って許可リストを回避できる

許可された表示用 HTML・`style` 属性、通常のリンクと画像、設定済みの Mermaid CDN への通信は仕様である。外部通信を避ける場合は、画像を `data:` URL で埋め込み、`CONFIG.mermaidSrc` を空にする。
