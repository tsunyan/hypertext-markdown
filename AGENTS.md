# AGENTS.md

このリポジトリで開発する AI エージェント向けの説明。機能と使い方は [README.md](README.md) にあるので、ここには、コードを読んでも分かりにくい約束と手順だけを書く。

## 何のリポジトリか

Markdown を内包した、1 つの HTML ファイルで配れる文書のテンプレート。CSS・JavaScript・Markdown のパーサーまで、全部が 1 つの HTML に入っている。AI エージェントがこのテンプレートで文書を作るためのスキル（`skills/hypertext-markdown/`）も、ここで配る。

## 文書の役割分担

読む人と使う場面に合わせて、説明の置き場所を決める。

| 文書 | 読者・役割 | 載せる内容 |
|---|---|---|
| `README.md` | 初めて訪れた人の入口 | 特徴、見本、始め方、詳しい説明へのリンク |
| `template-guide.src.html` 内の利用ガイド | 文書を作り、使う人向けの説明 | 入門・実践・完全なリファレンス。表示例を見ながら学ぶ・選ぶ・調べる |
| `skills/hypertext-markdown/SKILL.md` | 文書を作成・修正する AI 向けの手順 | 参照する資料、作成・修正・確認・受け渡しの手順 |
| `skills/hypertext-markdown/references/authoring.md` | AI が執筆中に引くリファレンス | 構文、設定、最小例、制約、雛形を簡潔にまとめる |
| `AGENTS.md` | このリポジトリを開発・保守するエージェント向け | 全体の構成、正本と生成物、設計上の約束、変更・検証の手順 |

利用ガイドは次の3部で構成する。

1. **最初の文書を作る。** 書く・表示する・保存する・渡すまでを、ひとつの短い文書で通す。
2. **文書を育てる。** 同じ文書に表現や設定を加え、発表・配布・改版へ進む。選び方と、その場で必要な最小例を示す。
3. **目的から引くリファレンス。** 用途別に全書式・設定・操作をまとめる。部品名や設定名からも探せる索引と、表示・書き方の見本を用意する。

- README に詳しい仕様や作業記録を積み重ねず、利用ガイドや開発手順へ案内する。
- 利用ガイドに AI 向けの作業指示を入れない。AI の通常の執筆は `SKILL.md` と `authoring.md` だけで進められる状態を保つ。
- 人向けと AI 向けで構文の情報は重なるが、文章は共用しない。利用ガイドは理解と選択を助け、`authoring.md` は必要な仕様を短く伝える。
- 詳しい仕様は利用ガイドの第3部に集約する。第1・2部では説明を繰り返さず、該当項目へリンクする。
- 書式・設定・挙動を変えた場合や説明の欠落を見つけた場合は、利用ガイドと `authoring.md` を合わせる。章立てや説明の順序だけの変更は、同じ構成を AI 向け文書へ持ち込まない。
- 見本の版は操作を説明するためのデータであり、開発の変更履歴として扱わない。

## ファイルの役割

手で直すのは「正本」だけ。「生成物」は道具で作り直す。

| ファイル | 種類 | 作り方・役割 |
|---|---|---|
| `template-guide.src.html` | 正本 | テンプレート本体。CSS・JavaScript と、利用ガイドの Markdown と、見本の版（1.0・1.1）が入っている |
| `template-guide.min.html` | 生成物 | `python -I tools/minify_html.py`（esbuild で CSS と JavaScript だけを圧縮。Node.js と npm が必要） |
| `samples/sample-versioned.src.html` | 生成物 | `python -I tools/make_sample.py template-guide.src.html samples/sample-versioned.src.html` |
| `skills/hypertext-markdown/assets/template.html` | 生成物 | `python -I tools/make_skeleton.py`（圧縮版から Markdown と版を抜いた空のテンプレート） |
| `skills/hypertext-markdown/` のほかのファイル | 正本 | `SKILL.md`・`references/authoring.md`・`scripts/build.mjs` |
| `samples/template-guide-<デザイン>.src.html` | 生成物 | `python -I tools/make_design.py`（デザインの見本。`cyber`・`cute`・`pop`・`natural` の 4 つと、配色の見本 `cc-1`〜`cc-7` の 7 つ。テンプレートに `samples/design/` の CSS・ロゴ・favicon を重ねる） |
| `samples/design/` | 正本 | デザインの素材。`designs.json`（一覧。`group` は一覧画像の組）、`<デザイン>.css`、`<デザイン>-logo.svg`・`-logo-dark.svg`・`-favicon.svg` |
| `samples/design/overview-*.png` | 生成物 | `python tools/make_design_overview.py`（デザインの見本の表紙を並べた README 用の画像。`designs.json` の `group` ごとに 1 組で、`group` が無いものは `overview-{light,dark}.png`、`cc` は `overview-cc-{light,dark}.png`。デザインの見た目を変えたら作り直す） |
| `samples/template-guide-<キー>.src.html`（`c1`〜`c5`・`f1`・`h1`〜`h3`） | ブランド見本 | 旧テンプレートで作った見本。利用ガイドの変更は `md-source` と見本の版 1.1 の本文だけを正本から同期し、CSS・JavaScript・ロゴ・配色・過去の版を保持する。`tools/make_brand.py` はロゴ・配色が空の入力を想定しているため、現行テンプレートからの全体再生成には調整が必要 |
| `samples/brand/` | 素材 | ブランド見本のロゴと色 |
| `docs/images/readme-*.png` | 生成物 | `python tools/make_readme_images.py`（見本の画面を Playwright で撮り、README の先頭の画像をライトとダークの 2 枚ずつ作る。見た目を変えたら作り直す） |
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
- **デザインの見本は CSS だけで作る。** `samples/design/<デザイン>.css` は、テンプレートの `<style>` の後ろに重ねるだけで、Markdown と JavaScript は変えない。部品の HTML の作りやクラス名を変えたら、4 つの CSS も合わせる

## 変更の種類ごとの手順

**CSS・JavaScript を直す**

1. `template-guide.src.html` を直す（描画結果が変わるなら `ENGINE` も上げる）
2. `python -I tools/make_sample.py template-guide.src.html samples/sample-versioned.src.html`
3. `python -I tools/minify_html.py`
4. `python -I tools/make_skeleton.py`（3 の圧縮版から作るので、必ず 3 の後）
5. `python -I tools/make_design.py`（デザインの見本）
6. 見た目が変わったら `python tools/make_readme_images.py`（README の画像）

**利用ガイド（Markdown）を直す**

1. `md-source` を直し、同じ内容を、いちばん新しい見本の版（`class="md-version"` の 1.1）にも入れる。食い違うと `tools/check.py` が知らせる
2. 上の 2〜5 を実行する

ブランド見本（`c1`〜`c5`・`f1`・`h1`〜`h3`）にも、正本の `md-source` と見本の版 1.1 の本文を同期する。script 要素の属性と、それ以外の HTML は変更しない。全体を再生成するツールの制約を、ガイド本文の同期を省く理由にしない。

利用者が正本での内容確認を先に指定した場合は、1 の段階でガイドの表示・リンク・スライド・保存を確かめる。生成物との同期は内容確定後にまとめて行い、確認中は同期の検査が未完了であることを伝える。ガイドだけの変更では空のテンプレートに本文を入れない。

**部品（`:::名前`）や書式を足す**

1. パーサーと CSS を足し、上の「CSS・JavaScript を直す」を行う
2. 利用ガイドに節と `example` の見本を足す（見本は 1 か所に書けば表示と書き方がずれない）
3. `skills/hypertext-markdown/references/authoring.md` に、構文と最小の例を足す。利用ガイドにある囲みの名前とフロントマターのキーが authoring.md に無いと、`tools/check.py` が知らせる
4. README の部品の表を直す

**デザインの見本を直す・足す**

1. `samples/design/<デザイン>.css` を直す。足すときは、`designs.json` にキーを足し、CSS・ロゴ（ライト用とダーク用）・favicon を置き、`samples/index.html` にリンクを足す
2. `python -I tools/make_design.py` で見本を作り直す（キーを付けると、そのデザインだけ）
3. 見た目が変わったら `python tools/make_design_overview.py`（README の画像）

CSS の約束は次のとおり。

- 色の変数は `:root:root` に、`light-dark(ライト用, ダーク用)` で 1 回だけ書く。テンプレートのダーク用の指定より強く、文書のフロントマターの `palette`・`accent` よりは弱い。印刷はテンプレートが `color-scheme: light` にするので、ライト用の色になる
- 外から読むものを足さない（書体は、利用者の PC にあるものを順に並べる。絵は `data:` の SVG で持つ）
- スライドの高さを増やす指定（余白・枠・行間）は、読み物だけに効くよう `#ui-content` を付ける。変えたら、全スライドが 80% 以上で収まることをテストで確かめる
- フォーカスの枠が切れるので、ボタンやリンクに `clip-path` を使わない
- 配色の見本（`cc-<番号>`）は、色のデザインの見本として作る。固有名詞、既存のロゴやそれに似た形、専用の書体を、CSS・ロゴ・`designs.json`・文書のどこにも入れない（ロゴの印は `#` にする）

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

- `tools/check.py`: script 要素の壊れ、JavaScript の構文、生成物（見本・デザインの見本・スキルのテンプレート）が正本から作り直したものと同じこと、authoring.md の網羅
- `tests/test_smoke.py`: Chromium で開いてエラーが無いこと、全スライドが収まること（デザインの見本も）、版の比較、保存と開き直し、スキルの空のテンプレートと `build.mjs` の往復
- 見た目の変更は、ライトとダーク、1366px 幅と 375px 幅で画面を見て確かめる。Firefox と Safari は確かめていない

## 書き方の慣習

- 変更はブランチからプルリクエストで main に入れる。CI（lint・tests・secrets・analyze）が全部通らないとマージできない
- プルリクエストは merge commit でマージする（`gh pr merge --merge`）。利用者が明示した場合を除き、squash merge と rebase merge は使わない
- コミットメッセージは `type(scope): 日本語の要約`（`feat` `fix` `refactor` `docs` `chore`）。本文は「- 〜する」の箇条書き
- 画面の文言、コメント、文書は、README と同じ平易な日本語で書く。「です・ます」は利用ガイドの本文だけで、ほかは「する・である」で短く書く
