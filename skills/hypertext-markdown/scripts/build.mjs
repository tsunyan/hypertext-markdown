#!/usr/bin/env node
// Markdown を空のテンプレートに流し込み、1 つの HTML ファイルにする。依存パッケージなし（Node.js 18 以上）。
//
// 使い方: node build.mjs <入力.md> [-o 出力.html] [--template テンプレート.html] [--keep-versions]
//        node build.mjs --extract <入力.html> [-o 出力.md]
//   -o               出力先。省くと入力と同じ場所に、拡張子を替えて書き出す
//   --template       流し込む先のテンプレート。省くと、このスキルの assets/template.html
//                    自社のロゴや色を入れたテンプレートや、直したい既存の HTML を指定する
//   --keep-versions  テンプレートに入っている確定した版を残す（既存の HTML を直すとき）
//   --extract        HTML から作業中の Markdown を取り出す
//   --logo           既定のロゴ画像。--logo-dark を省くとライト・ダーク共通
//   --logo-dark      ダーク用のロゴ画像
//   --favicon        favicon の画像（SVG・PNG・ICO）。複数回指定できる
//                    画像のパスはコマンドを実行するフォルダからの相対パス、または絶対パス
//
// 流し込むときに、次のことをする。
// - 手元の画像（![説明](./fig.png) や [名前]: ./fig.png）を base64 の data: URL にして、Markdown の末尾に置く
// - 本文の </script> と <script を <\/script> と <\script に書き換える（テンプレートが読むときに元に戻す）
// - <title> を文書名（フロントマターの title、無ければ先頭の # 見出し）にする
// - テンプレートに入っている描画済みの本文と、確定した版（--keep-versions が無ければ）を外す
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, extname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = join(HERE, '..', 'assets', 'template.html');
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};
const LARGE = 1024 * 1024; // これより大きい画像は、縮小を勧める

function usage(message) {
  if (message) console.error('エラー: ' + message);
  console.error('使い方: node build.mjs <入力.md> [-o 出力.html] [--template テンプレート.html] [--keep-versions]');
  console.error('        node build.mjs --extract <入力.html> [-o 出力.md]');
  console.error('画像の差し替え: --logo ロゴ画像 [--logo-dark ダーク用画像] [--favicon アイコン画像 ...]');
  console.error('画像のパスは実行フォルダ基準。--favicon は複数回指定できる（SVG・PNG・ICO）');
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const opts = { input: '', output: '', template: DEFAULT_TEMPLATE, keepVersions: false, extract: false, favicons: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') usage();
    else if (a === '-o' || a === '--output') opts.output = argv[++i] || usage(a + ' の後ろに出力先を書く');
    else if (a === '--template') opts.template = argv[++i] || usage(a + ' の後ろにテンプレートを書く');
    else if (a === '--keep-versions') opts.keepVersions = true;
    else if (a === '--extract') opts.extract = true;
    else if (['--logo', '--logo-dark', '--favicon'].includes(a)) {
      const path = argv[++i];
      if (!path || path.startsWith('--')) usage(a + ' の後ろに画像ファイルを書く');
      if (a === '--favicon') opts.favicons.push(path);
      else opts[a === '--logo' ? 'logo' : 'logoDark'] = path;
    }
    else if (a.startsWith('-')) usage('知らないオプション: ' + a);
    else if (!opts.input) opts.input = a;
    else usage('入力は 1 つだけ指定する');
  }
  if (!opts.input) usage(opts.extract ? '入力の .html を指定する' : '入力の .md を指定する');
  if (opts.extract && (opts.logo || opts.logoDark || opts.favicons.length)) usage('--extract と画像の差し替えは同時に指定できない');
  if (!opts.output) {
    opts.output = opts.extract
      ? opts.input.replace(/\.html?$/i, '') + '.md'
      : opts.input.replace(/\.(md|markdown|txt)$/i, '') + '.html';
  }
  return opts;
}

const SLOT = /(<script type="text\/markdown" id="md-source">)([\s\S]*?)(<\/script>)/;

/* コードブロック（``` と ~~~）の中かどうかを、行ごとに返す */
function fenceFlags(lines) {
  let fence = null;
  return lines.map(line => {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m.index + m[1].length).trim()) fence = null;
      return true;
    }
    if (m) { fence = m[1]; return true; }
    return false;
  });
}

const isLocal = url => url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);

function splitUrl(url) {
  const i = url.indexOf('#');
  return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i)];
}

function loadImage(url, baseDir, problems) {
  const [path, hash] = splitUrl(url);
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* そのまま使う */ }
  const file = resolve(baseDir, decoded);
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) { problems.push(`画像として扱えない拡張子: ${url}`); return null; }
  if (!existsSync(file) || !statSync(file).isFile()) { problems.push(`画像が見つからない: ${url}（${file}）`); return null; }
  const data = readFileSync(file);
  if (data.length > LARGE) console.warn(`注意: ${url} は ${(data.length / 1024 / 1024).toFixed(1)} MB ある。縮小してから入れると、HTML が軽くなる`);
  return { dataUrl: `data:${mime};base64,${data.toString('base64')}${hash}`, stem: basename(file, extname(file)) };
}

/* 手元の画像を data: URL にする。本文には名前だけを書き、定義は末尾にまとめる（参照形式） */
function embedImages(md, baseDir) {
  const lines = md.split('\n');
  const inFence = fenceFlags(lines);
  const used = new Set();
  for (const [k, line] of lines.entries()) {
    const d = !inFence[k] && line.match(/^ {0,3}\[([^\]]+)\]:/);
    if (d) used.add(d[1].toLowerCase());
  }
  const defs = [];
  const problems = [];
  const byUrl = new Map();
  const nameFor = (url, stem) => {
    // ./fig.png と fig.png のように書き方が違っても、同じファイルなら 1 回だけ埋め込む
    const [path, hash] = splitUrl(url);
    let decoded = path;
    try { decoded = decodeURIComponent(path); } catch { /* そのまま使う */ }
    const key = resolve(baseDir, decoded) + hash;
    if (byUrl.has(key)) return byUrl.get(key);
    const img = loadImage(url, baseDir, problems);
    if (!img) return null;
    const base = (stem || 'img').replace(/[\[\]\s]+/g, '-') || 'img';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}`;
    used.add(name.toLowerCase());
    defs.push(`[${name}]: ${img.dataUrl}`);
    byUrl.set(key, name);
    return name;
  };

  const out = lines.map((line, k) => {
    if (inFence[k]) return line;
    // [名前]: ./fig.png の定義は、その場で data: URL に置き換える。脚注（[^1]:）と、画像でないファイルへの定義は触らない
    const def = line.match(/^( {0,3}\[(?!\^)[^\]]+\]:[ \t]*)(<[^>]*>|\S+)(.*)$/);
    if (def) {
      const url = def[2].replace(/^<(.*)>$/, '$1');
      if (!isLocal(url) || !MIME[extname(splitUrl(url)[0]).toLowerCase()]) return line;
      const img = loadImage(url, baseDir, problems);
      return img ? def[1] + img.dataUrl + def[3] : line;
    }
    // ![説明](./fig.png "表題") を ![説明][名前] にする。インラインコードの中は触らない
    return line.split(/(`+[^`]*`+)/).map((part, j) => (j % 2 ? part : part.replace(
      /!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
      (all, alt, raw) => {
        const url = raw.replace(/^<(.*)>$/, '$1');
        if (!isLocal(url)) return all;
        const name = nameFor(url, basename(splitUrl(url)[0], extname(splitUrl(url)[0])));
        return name ? `![${alt}][${name}]` : all;
      },
    ))).join('');
  });
  if (problems.length) {
    console.error(problems.map(p => 'エラー: ' + p).join('\n'));
    process.exit(1);
  }
  let text = out.join('\n').replace(/\s+$/, '');
  if (defs.length) text += '\n\n' + defs.join('\n');
  return { text: text + '\n', count: defs.length };
}

function docTitle(md) {
  const fm = md.match(/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
  const t = fm && fm[1].match(/^title[ \t]*:[ \t]*(.*)$/m);
  if (t && t[1].trim()) return t[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  const body = fm ? md.slice(fm[0].length) : md;
  const h = body.match(/^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\n|$)/);
  return h ? h[1].replace(/[*_`~]/g, '') : '';
}

const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// テンプレートの escScript() と同じ書き換え。読むときに readScript() が元に戻す
const escScript = md => md.replace(/<(\/?)(script)/gi, '<\\$1$2');

/* CLI の画像パスは URL として解釈せず、# や % を含むファイル名もそのまま扱う。 */
function themeImage(path, favicon = false) {
  const file = resolve(path), ext = extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime || (favicon && !['.svg', '.png', '.ico'].includes(ext))) usage('画像として扱えない拡張子: ' + path);
  if (!existsSync(file) || !statSync(file).isFile()) usage('画像が見つからない: ' + path);
  return { mime, url: `data:${mime};base64,${readFileSync(file).toString('base64')}` };
}

/* 本文や見本のコードには触れず、実行するエンジンの設定と head のアイコンだけを替える。 */
function replaceTheme(template, opts) {
  if (opts.logo || opts.logoDark) {
    const values = {};
    if (opts.logo) {
      values.logo = themeImage(opts.logo).url;
      values.logoDark = ''; // 古いダーク用ロゴを残さない
    }
    if (opts.logoDark) values.logoDark = themeImage(opts.logoDark).url;
    const scripts = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const engine = scripts.at(-1);
    if (!engine || !engine[1].includes('mermaidIntegrity')) usage('テンプレートのエンジン設定が見つからない');
    let code = engine[1];
    for (const [key, value] of Object.entries(values)) {
      // 圧縮版では変数名が短縮されるため、変わらない設定のプロパティ名を使う。
      const pattern = new RegExp(`(\\b${key}\\s*:\\s*)("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`, 'g');
      let count = 0;
      code = code.replace(pattern, (_, prefix) => { count++; return prefix + JSON.stringify(value); });
      if (count !== 1) usage(`テンプレートの ${key} 設定がちょうど 1 つではない`);
    }
    template = template.slice(0, engine.index) + '<script>' + code + '</script>' + template.slice(engine.index + engine[0].length);
  }
  if (opts.favicons.length) {
    const links = opts.favicons.map(path => {
      const { mime, url } = themeImage(path, true);
      return `<link rel="icon" type="${mime}" href="${url}">`;
    }).join('\n');
    const end = template.indexOf('</head>');
    if (end < 0) usage('テンプレートに head が無い');
    const head = template.slice(0, end).replace(/<link\b[^>]*>/gi, tag => {
      const rel = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      return rel && (rel[1] || rel[2] || rel[3]).toLowerCase().split(/\s+/).includes('icon') ? '' : tag;
    });
    template = head + links + '\n' + template.slice(end);
  }
  return template;
}

/* HTML から作業中の Markdown を取り出す。テンプレートの readScript() と同じく、書き換えた script を元に戻す */
function extract(opts) {
  const m = readFileSync(opts.input, 'utf8').match(SLOT);
  if (!m) usage('<script type="text/markdown" id="md-source"> が無い: ' + opts.input);
  const md = m[2].replace(/\r\n?/g, '\n').replace(/<\\(\/?)(script)/gi, '<$1$2').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
  writeFileSync(opts.output, md + '\n', 'utf8');
  console.log(opts.output);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.input)) usage('入力が見つからない: ' + opts.input);
  if (resolve(opts.input) === resolve(opts.output)) usage('入力と出力が同じファイルになっている');
  if (opts.extract) return extract(opts);
  if (!existsSync(opts.template)) usage('テンプレートが見つからない: ' + opts.template);

  const md = readFileSync(opts.input, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const { text, count } = embedImages(md, dirname(resolve(opts.input)));

  const template = replaceTheme(readFileSync(opts.template, 'utf8'), opts);
  if (!SLOT.test(template)) usage('テンプレートに <script type="text/markdown" id="md-source"> が無い: ' + opts.template);
  let html = template.replace(SLOT, (_, open, _old, close) => open + '\n' + escScript(text) + close)
    // 描画済みの本文は、開いたときに Markdown から描き直す
    .replace(/(<article class="doc" id="ui-doc"[^>]*>)[\s\S]*?(<\/article>)/, '$1$2');
  if (!opts.keepVersions) html = html.replace(/\n?<script type="text\/markdown" class="md-version"[^>]*>[\s\S]*?<\/script>/g, '');
  const versions = (html.match(/<script type="text\/markdown" class="md-version"/g) || []).length;
  const title = docTitle(text);
  if (title) html = html.replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + escHtml(title) + '</title>');

  writeFileSync(opts.output, html, 'utf8');
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  const notes = [`${kb} KB`];
  if (count) notes.push(`画像 ${count} 枚を埋め込み`);
  if (versions) notes.push(`確定した版 ${versions} 個を残した`);
  console.log(`${opts.output}（${notes.join('、')}）`);
}

main();
