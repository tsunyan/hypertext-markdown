# AGENTS.md

このリポジトリで開発する AI エージェント向けの説明。機能と使い方は [README.md](README.md) にあるので、ここには、コードを読んでも分かりにくい約束と手順だけを書く。

## 何のリポジトリか

Markdown を内包した、1 つの HTML ファイルで配れる文書のテンプレート。CSS・JavaScript・Markdown のパーサーまで、全部が 1 つの HTML に入っている。AI エージェントがこのテンプレートで文書を作るためのスキル（`skills/hypertext-markdown/`）も、ここで配る。

## ファイルの役割

手で直すのは「正本」だけ。「生成物」は道具で作り直す。

| ファイル | 種類 | 作り方・役割 |
|---|---|---|
| `template-guide.src.html` | 正本 | テンプレート本体。CSS・JavaScript と、利用ガイドの Markdown と、見本の版（1.0・1.1）が入っている |
| `template-guide.min.html` | 生成物 | `python -I tools/minify_html.py`（esbuild で CSS と JavaScript だけを圧縮。Node.js と npm が必要） |
| `samples/sample-versioned.src.html` | 生成物 | `python -I tools/make_sample.py template-guide.src.html samples/sample-versioned.src.html` |
| `skills/hypertext-markdown/assets/template.html` | 生成物 | `python -I tools/make_skeleton.py`（圧縮版から Markdown と版を抜いた空のテンプレート） |
| `skills/hypertext-markdown/` のほかのファイル | 正本 | `SKILL.md`・`references/authoring.md`・`scripts/build.mjs` |
| `samples/template-guide-<キー>.src.html` | 生成物（作り直せない） | `tools/make_brand.py` で作ったブランド見本。いまのテンプレートからは作り直せない（ツールの説明を参照）。テンプレートを直しても更新しない |
| `samples/brand/` | 素材 | ブランド見本のロゴと色 |
| `graft/` | 生成物 | コード検索の索引（git では管理しない） |

## 大きなファイルの歩き方

`template-guide.src.html` は 7000 行を超える。行番号はすぐずれるので頼らず、次の目印で探す。

- 先頭の `<style>`: 画面・スライド・印刷の CSS（`@media print` は末尾）
- `<script type="text/markdown" id="md-source">`: 利用ガイドの Markdown（作業中の版）。その後ろの `class="md-version"` が見本の版
- 本文の後ろの `<script>`: JavaScript。`/* ===== 名前 ===== */` の目印で、設定・小物・フロントマター・Markdown パーサー・構文の色分け・グラフ・文書全体の HTML・画面・操作・起動に分かれている

graft の索引があるときは、`graft grep "<名前>"` や `graft ask "<知りたいこと>"` で探すと速い。

## 壊しやすい約束

- **Markdown が正本。** 表示・ダウンロード・HTML の保存は、同じ Markdown から作る
- **外部依存なし。** 外から読むのは Mermaid だけで、`CONFIG.mermaidSrc` と SRI ハッシュ（`CONFIG.mermaidIntegrity`）で固定している。URL を変えたらハッシュも取り直す
- **保存した HTML は JavaScript なしで読める。** 保存時に描画済みの本文と図を一緒に書き出す。新しい部品は、JavaScript なしでも中身が読める形で描く（タブは全部並べるなど）
- **描画結果を変えたら `ENGINE` を上げる。** 開いたときに、保存済みの描画結果を再利用するかを `ENGINE` と Markdown のハッシュで判定している。上げないと、古い描画のまま表示される
- **script 要素を壊さない。** Markdown の中の `</script>` と `<script` は `<\/script>`・`<\script` で持つ（`escScript()` と `readScript()`）。JavaScript の中では `<!--` の後に `<script` と書かない（`tools/check.py` が調べる）
- **スライドは 80% 以上で収める。** 部品を足したり CSS を変えたりしたら、利用ガイドと見本の全スライドが縮小 80% 以上で収まることをテストで確かめる

## 変更の種類ごとの手順

**CSS・JavaScript を直す**

1. `template-guide.src.html` を直す（描画結果が変わるなら `ENGINE` も上げる）
2. `python -I tools/make_sample.py template-guide.src.html samples/sample-versioned.src.html`
3. `python -I tools/minify_html.py`
4. `python -I tools/make_skeleton.py`（3 の圧縮版から作るので、必ず 3 の後）

**利用ガイド（Markdown）を直す**

1. `md-source` を直し、同じ内容を、いちばん新しい見本の版（`class="md-version"` の 1.1）にも入れる。食い違うと `tools/check.py` が知らせる
2. 上の 2〜4 を実行する

**部品（`:::名前`）や書式を足す**

1. パーサーと CSS を足し、上の「CSS・JavaScript を直す」を行う
2. 利用ガイドに節と `example` の見本を足す（見本は 1 か所に書けば表示と書き方がずれない）
3. `skills/hypertext-markdown/references/authoring.md` に、構文と最小の例を足す。利用ガイドにある囲みの名前とフロントマターのキーが authoring.md に無いと、`tools/check.py` が知らせる
4. README の部品の表を直す

**スキルを直す**

- `SKILL.md` は手順だけ、書式の説明は `references/authoring.md` に書く
- `scripts/build.mjs` は Node.js 18 以上で、依存パッケージを使わない（利用者の環境で `npm install` をさせない）
- テンプレートの `readScript()`・`escScript()` を変えたら、`build.mjs` の同じ処理も合わせる

## 確かめ方

```bash
pip install -r requirements-dev.txt
python -m playwright install chromium
ruff check tools tests
python -I tools/check.py
python -m pytest -q
```

- `tools/check.py`: script 要素の壊れ、JavaScript の構文、生成物が正本から作り直したものと同じこと、authoring.md の網羅
- `tests/test_smoke.py`: Chromium で開いてエラーが無いこと、全スライドが収まること、版の比較、保存と開き直し、スキルの空のテンプレートと `build.mjs` の往復
- 見た目の変更は、ライトとダーク、1366px 幅と 375px 幅で画面を見て確かめる。Firefox と Safari は確かめていない

## 書き方の慣習

- 変更はブランチからプルリクエストで main に入れる。CI（lint・tests・secrets・analyze）が全部通らないとマージできない
- コミットメッセージは `type(scope): 日本語の要約`（`feat` `fix` `refactor` `docs` `chore`）。本文は「- 〜する」の箇条書き
- 画面の文言、コメント、文書は、README と同じ平易な日本語で書く。「です・ます」は利用ガイドの本文だけで、ほかは「する・である」で短く書く
