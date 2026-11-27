# AGENTS.md

このリポジトリで開発する AI エージェント向けの説明。機能と使い方は [README.md](README.md) にあるので、ここには、コードを読んでも分かりにくい約束と手順だけを書く。

## 何のリポジトリか

Markdown を内包した、1 つの HTML ファイルで配れる文書のテンプレート。CSS・JavaScript・Markdown のパーサーまで、全部が 1 つの HTML に入っている。AI エージェントがこのテンプレートで文書を作るためのスキル（`skills/hypertext-markdown/`）も、ここで配る。

## 文書の役割分担

読む人と使う場面に合わせて、説明の置き場所を決める。

| 文書 | 読者・役割 | 載せる内容 |
|---|---|---|
| `README.md` | 初めて訪れた人の入口 | 特徴、見本、始め方、詳しい説明へのリンク |
| `src/guide.md`（生成した HTML 内の利用ガイド） | 文書を作り、使う人向けの説明 | 入門・実践・完全なリファレンス。表示例を見ながら学ぶ・選ぶ・調べる |
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
| `src/shell.html` | 正本 | HTML の外枠と素材の差し込み口 |
| `src/styles.css` | 正本 | 画面・スライド・印刷の CSS |
| `src/bootstrap.js`・`src/engine.js` | 正本 | 初期表示の設定と、パーサー・描画・保存などの JavaScript |
| `src/vendor/` | 配布元の写し | DOMPurify 3.4.18 とライセンス。HTML に埋め込み、実行時には取得しない |
| `src/guide.md` | 正本 | 利用ガイドの Markdown。作業中の本文と最新の見本の版で共用する |
| `src/versions/` | 正本 | 過去版の Markdown と、版の一覧 `manifest.json` |
| `src/assets/`・`src/theme.json` | 正本 | 既定の favicon・ロゴと参照先。生成時に data URL にして埋め込む |
| `src/samples/versioned/` | 正本 | 版管理の見本の作業中・過去版の Markdown と版の一覧 |
| `src/samples/index.html`・`index.css` | 正本 | 見本一覧の外枠と CSS。リンクはカタログから生成する |
| `samples/index.html` | 生成物 | デザイン・ブランドのカタログから作る見本一覧 |
| `template-guide.src.html` | 生成物 | `python -I tools/build.py`（素材を埋め込んだ、圧縮前の HTML）。名前の `.src` は互換性のために残すが、直接編集しない |
| `template-guide.min.html` | 生成物 | `python -I tools/minify_html.py`（esbuild で CSS と JavaScript だけを圧縮。Node.js と npm が必要） |
| `samples/sample-versioned.src.html` | 生成物 | `python -I tools/make_sample.py template-guide.src.html samples/sample-versioned.src.html` |
| `skills/hypertext-markdown/assets/template.html` | 生成物 | `python -I tools/make_skeleton.py`（圧縮版から Markdown と版を抜いた空のテンプレート） |
| `skills/hypertext-markdown/` のほかのファイル | 正本 | `SKILL.md`・`references/authoring.md`・`scripts/build.mjs` |
| `samples/template-guide-<デザイン>.src.html` | 生成物 | `python -I tools/make_design.py`（デザインの見本。`cyber`・`cute`・`pop`・`natural` の 4 つと、配色の見本 `cc-1`〜`cc-7` の 7 つ。テンプレートに `samples/design/` の CSS・ロゴ・favicon を重ねる） |
| `samples/design/` | 正本 | デザインの素材。`designs.json`（一覧。`group` は一覧画像の組）、`<デザイン>.css`、`<デザイン>-logo.svg`・`-logo-dark.svg`・`-favicon.svg` |
| `samples/design/overview-*.png` | 生成物 | `python tools/make_design_overview.py`（デザインの見本の表紙を並べた README 用の画像。`designs.json` の `group` ごとに 1 組で、`group` が無いものは `overview-{light,dark}.png`、`cc` は `overview-cc-{light,dark}.png`。デザインの見た目を変えたら作り直す） |
| `samples/template-guide-<キー>.src.html`（`c1`〜`c5`・`f1`・`h1`〜`h3`） | 生成物 | 共通テンプレートに `samples/brand/brands.json` の画像・配色・追加 CSS を重ねる。旧版の CSS・JavaScript は保持しない |
| `samples/brand/` | 正本 | ブランド見本のカタログ・ロゴ・favicon。追加 CSS も指定できる |
| `docs/images/readme-*.png` | 生成物 | `python tools/make_readme_images.py`（見本の画面を Playwright で撮り、README の先頭の画像をライトとダークの 2 枚ずつ作る。見た目を変えたら作り直す） |
| `graft/` | 生成物 | コード検索の索引（git では管理しない） |

## 素材の歩き方

- `src/shell.html`: HTML の外枠。`{{BOOTSTRAP}}`・`{{STYLES}}`・`{{GUIDE}}`・`{{VERSIONS}}`・`{{ENGINE}}`・`{{FAVICONS}}` を各 1 つ置く。新しい差し込み口を足すときは `tools/make_template.py` も合わせる
- `src/styles.css`: 画面・スライド・印刷の CSS（`@media print` は末尾）
- `src/bootstrap.js`: CSS を読む前にテーマ・幅を反映する小さなスクリプト。表示のちらつきを避けるため、この順番を保つ
- `src/engine.js`: `/* ===== 名前 ===== */` の目印で、設定・小物・フロントマター・Markdown パーサー・構文の色分け・グラフ・文書全体の HTML・画面・操作・起動に分かれる
- `src/theme.json`: 既定の `logo`・`logoDark`・`favicons` を `src/` からの相対パスで指定する。SVG・PNG の本体は `src/assets/` に置く
- `src/guide.md`: 通常の Markdown で書く。HTML に埋め込むためのエスケープは生成時に行う
- `src/versions/manifest.json`: 新しい順に、版番号・日付・作成者・説明・本文の参照先を並べる。`source` は `src/` からの相対パスで、先頭は `guide.md` を参照する。過去版は独立した `.md` に固定する

ファイルを分けても、CSS のセレクターと JavaScript が作る HTML は連動する。構造やクラス名の変更は両方を確かめる。

graft の索引があるときは、`graft grep "<名前>"` や `graft ask "<知りたいこと>"` で探すと速い。

## まとめて生成する・変更を監視する

```bash
python -I tools/build.py           # HTML と見本をまとめて生成
python -I tools/build.py --watch   # 初回生成のあと、保存時に自動生成
python -I tools/build.py --check   # 書き込まず、生成結果との一致を検査
python -I tools/build.py --images  # README とデザイン一覧の画像も生成
```

Python と Node.js・npm が必要。圧縮には従来どおり固定版の esbuild を使う。監視機能に追加パッケージは不要。

- 生成順は、素材の組み立て → 圧縮 → 空のテンプレート・版付き見本・デザイン見本・ブランド見本・一覧。全 HTML の組み立てに成功してから、内容が変わったファイルだけ更新する
- 監視対象は `src/`、`tools/*.py`、`samples/design/`・`samples/brand/` の CSS・ロゴ・favicon・カタログ。生成した HTML と一覧画像は監視しない。連続した保存はまとめ、生成中の変更は次の生成で拾う
- 素材の誤りや圧縮失敗では既存の HTML を更新しない。監視は続け、修正して保存すると再試行する
- `template-guide.src.html` をブラウザで開き、生成完了後に再読み込みする。監視の終了は Ctrl+C。ブラウザの自動再読み込みやサーバー起動は行わない
- `--watch --images` で画像も自動生成できる。時間がかかるため、通常の監視では画像を生成しない。画像生成には開発用の Playwright と Chromium が必要
- `samples/` 以下の HTML はすべて生成物。出力 HTML を入力に使わず、素材だけから再生成する。共通エンジンの修正は全見本に反映する
- `tools/check.py` は、この生成結果との一致も検査する。CI では再生成して差分を消さず、更新漏れを失敗として知らせる

組み立てた HTML だけ先に見たい場合は `python -I tools/make_template.py` を使う。ほかの生成物との同期は未完了なので、確認後に全生成を行う。

## 壊しやすい約束

- **Markdown が正本。** 表示・ダウンロード・HTML の保存は、同じ Markdown から作る
- **外部依存なし。** 外から読むのは Mermaid だけで、`CONFIG.mermaidSrc` と SRI ハッシュ（`CONFIG.mermaidIntegrity`）で固定している。URL を変えたらハッシュも取り直す
- **保存した HTML は JavaScript なしで読める。** 保存時に描画済みの本文と図を一緒に書き出す。新しい部品は、JavaScript なしでも中身が読める形で描く（タブは全部並べるなど）
- **描画結果を変えたら `ENGINE` を上げる。** 開いたときに、保存済みの描画結果を再利用するかを `ENGINE` と Markdown のハッシュで判定している。上げないと、古い描画のまま表示される
- **script 要素を壊さない。** `src/` の Markdown では `</script>` と `<script` をそのまま書く。組み立て時に `<\/script>`・`<\script` へ変換する（生成した HTML の `escScript()` と `readScript()` と同じ約束）。JavaScript の中では `<!--` の後に `<script` と書かない（`tools/check.py` が調べる）
- **スライドは 80% 以上で収める。** 部品を足したり CSS を変えたりしたら、利用ガイドと見本の全スライドが縮小 80% 以上で収まることをテストで確かめる
- **デザインの見本は CSS だけで作る。** `samples/design/<デザイン>.css` は、生成したテンプレートの `<style>` の後ろに重ねるだけで、Markdown と JavaScript は変えない。部品の HTML の作りやクラス名を変えたら、4 つの CSS も合わせる

## 変更の種類ごとの手順

**CSS・JavaScript を直す**

1. `src/styles.css`・`src/engine.js`・`src/bootstrap.js` の該当箇所を直す（描画結果が変わるなら `engine.js` の `ENGINE` も上げる）
2. `python -I tools/build.py`（監視中なら自動生成の完了を待つ）
3. 見た目が変わったら `python -I tools/build.py --images`

**利用ガイド（Markdown）を直す**

1. `src/guide.md` を直す。作業中の本文と最新の見本の版に同じファイルを使うので、二重に編集しない
2. `python -I tools/build.py`（監視中なら自動生成の完了を待つ）

ブランド見本も共通テンプレートから全体を生成する。ガイドの本文・見本の版・CSS・JavaScript を見本ごとに複製して管理しない。ブランド固有の見た目は CSS・画像・配色の設定に集約する。

利用者が正本での内容確認を先に指定した場合は、素材の編集後に `tools/make_template.py` だけ実行し、ガイドの表示・リンク・スライド・保存を確かめる。全生成は内容確定後にまとめて行い、確認中は同期の検査が未完了であることを伝える。ガイドだけの変更では空のテンプレートに本文を入れない。

**部品（`:::名前`）や書式を足す**

1. パーサーと CSS を足し、上の「CSS・JavaScript を直す」を行う
2. 利用ガイドに節と `example` の見本を足す（見本は 1 か所に書けば表示と書き方がずれない）
3. `skills/hypertext-markdown/references/authoring.md` に、構文と最小の例を足す。利用ガイドにある囲みの名前とフロントマターのキーが authoring.md に無いと、`tools/check.py` が知らせる
4. README の部品の表を直す

**デザインの見本を直す・足す**

1. `samples/design/<デザイン>.css` を直す。足すときは、`designs.json` にキーと素材の参照先を足す。一覧のリンクは自動生成する。ブランド見本は `samples/brand/brands.json` で同じ形式を使う
2. `python -I tools/build.py` で見本を作り直す（監視中なら自動生成の完了を待つ）
3. 見た目が変わったら `python tools/make_design_overview.py`（README の画像）

カタログの `css`・`logo`・`logoDark`・`favicons` は、それぞれのカタログがあるフォルダからの相対パスで指定する。`css` は省略でき、`accent` は既定の配色を上書きする。`favicons` は画像の配列で、PNG は 32px、SVG はサイズ可変として埋め込む。

```json
{
  "example": {
    "name": "見本",
    "kind": "説明",
    "css": "example.css",
    "logo": "example-logo.svg",
    "logoDark": "example-logo-dark.svg",
    "favicons": ["example-favicon.svg"],
    "accent": "#1d4fd7 / #93b4ff"
  }
}
```

デザインの `group: "cc"` は配色の一覧・画像に、ブランドの `group: "other"` は一覧の Other templates に分類する。キーは両カタログを通して重複させない。

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

- `tools/check.py`: script 要素の壊れ、JavaScript の構文、全 HTML（圧縮版・見本・スキルのテンプレートを含む）が素材から作り直したものと同じこと、authoring.md の網羅、スキル（`skills/hypertext-markdown/`）に GitHub Pages の URL が無いこと（スキルで作る HTML は手元で使うので、公開サイトへ案内しない）
- `tests/test_build.py`: 素材の組み立て、エスケープ、テーマの素材と共通エンジンの一致、生成失敗時の保護、変更監視
- `tests/test_build_cli.py`: 出力 HTML が無い状態からの全生成、実際の監視コマンドでの素材保存時の再生成、失敗からの復旧、ツール修正の反映、検査時に書き込まないことを確かめる
- `tests/test_smoke.py`: Chromium で開いてエラーが無いこと、全スライドが収まること（デザインの見本も）、版の比較、保存と開き直し、スキルの空のテンプレートと `build.mjs` の往復、外への通信が図（Mermaid）のある文書に限られること
- 見た目の変更は、ライトとダーク、1366px 幅と 375px 幅で画面を見て確かめる。Firefox と Safari は確かめていない

## 書き方の慣習

- 変更はブランチからプルリクエストで main に入れる。CI（lint・tests・secrets・analyze）が全部通らないとマージできない
- プルリクエストは merge commit でマージする（`gh pr merge --merge`）。利用者が明示した場合を除き、squash merge と rebase merge は使わない
- コミットメッセージは `type(scope): 日本語の要約`（`feat` `fix` `refactor` `docs` `chore`）。本文は「- 〜する」の箇条書き
- 画面の文言、コメント、文書は、README と同じ平易な日本語で書く。「です・ます」は利用ガイドの本文だけで、ほかは「する・である」で短く書く
