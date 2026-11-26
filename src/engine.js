(() => {
'use strict';

/* 保存（Ctrl+S）用に、描画する前のページ全体を控えておく。この行は必ず先頭に置く */
const PRISTINE = '<!doctype html>\n' + document.documentElement.outerHTML;

/* ===== 設定 ===== */
const CONFIG = {
  // Mermaid（図）の描画ライブラリ。外部と通信させたくないときは '' にする（図はソースのまま表示）
  mermaidSrc: 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js',
  // 上のファイルの SRI ハッシュ。CDN 側で中身が変わっていたら読み込まない。URL を変えたら空にするか取り直す
  mermaidIntegrity: 'sha384-rbtjAdnIQE/aQJGEgXrVUlMibdfTSa4PQju4HDhN3sR2PmaKFzhEafuePsl9H/9I',
  // スライドを分ける見出しの深さ（フロントマターの slide_level で文書ごとに上書きできる）
  slideLevel: 2,
  // スライドで文字を縮める下限（%）。これより縮めないと入らない分は、次のスライドに送る
  slideMinScale: 80,
  // このテンプレートの既定の色とロゴ（社内用のテンプレートを作るときに書く）。文書のフロントマターに palette・accent・logo があれば、そちらが優先
  accent: '',    // palette の名前（'teal' など）か、色（'#0f6e6e' または '#ライト用 / #ダーク用'）
  logo: '',      // 表紙の左上とスライドの下に出すロゴ（URL か data: URL）
  logoDark: '',  // ダーク表示のときのロゴ（空なら logo をそのまま使う）
};
const ENGINE = 'hypertext-markdown-10';
const KEY_THEME = 'hypertext-markdown:theme';
const KEY_TOC = 'hypertext-markdown:toc';
const KEY_DIFF = 'hypertext-markdown:diffview';

/* ===== 小物 ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できない環境では何もしない */ } },
};
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => escHtml(s).replace(/"/g, '&quot;');
/* 独自パーサーの処理に加え、DOM に渡す直前にも HTML を検査する。 */
const safeRenderedHtml = html => DOMPurify.sanitize(html, { FORCE_BODY: true, ADD_ATTR: ['target'] });
const escText = s => String(s).replace(/&(?!#?[A-Za-z0-9]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* タグを除いて文字にする。<scr<b>ipt> のように、除いたあとにタグが残る形があるので、変わらなくなるまで繰り返す */
const stripTags = s => {
  let t = String(s), prev;
  do { prev = t; t = t.replace(/<[^>]*>/g, ''); } while (t !== prev);
  return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
};
const truthy = v => /^(true|yes|on|1)$/i.test(String(v == null ? '' : v).trim());
const cssString = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ').replace(/[\r\n]+/g, ' ') + '"';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const setHash = h => { try { history.replaceState(null, '', location.href.split('#')[0] + h); } catch (e) { /* 変更できない環境では無視 */ } };

function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* ===== フロントマター ===== */
const META_LABELS = {
  docid: '文書番号', version: '版', date: '作成日', updated: '更新日',
  author: '作成', reviewer: 'レビュー', approver: '承認',
  customer: '顧客', project: '案件', org: '組織', dept: '部署',
};
const META_HIDDEN = new Set(['title', 'subtitle', 'status', 'classification', 'numbering', 'slide_level', 'h2_pagebreak', 'filename', 'breaks', 'lang', 'palette', 'accent', 'font', 'mono', 'logo']);
const STATUS = {
  draft: ['下書き', 'draft'], wip: ['作成中', 'draft'], review: ['レビュー中', 'review'],
  approved: ['承認済', 'final'], final: ['確定', 'final'], obsolete: ['廃止', 'obsolete'],
};

function parseFrontMatter(md) {
  const m = md.match(/^\uFEFF?---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { meta, body: md.slice(m[0].length) };
}

/* ===== Markdown パーサー（GFM の主要な書式 + 注記・脚注・Mermaid） ===== */
const CJK = '\\u2e80-\\u2fff\\u3000-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef';
const RE_CJK_JOIN = new RegExp('([' + CJK + '])((?:<[^>]+>)*)\\n((?:<[^>]+>)*)(?=[' + CJK + '])', 'g');
const ALERTS = {
  note: ['補足', 'note'], info: ['補足', 'note'],
  tip: ['ヒント', 'tip'], hint: ['ヒント', 'tip'], success: ['完了', 'tip'],
  important: ['重要', 'important'],
  warning: ['注意', 'warning'], attention: ['注意', 'warning'],
  caution: ['警告', 'caution'], danger: ['危険', 'caution'], error: ['エラー', 'caution'],
};
const icon = d => '<svg viewBox="0 0 16 16" aria-hidden="true">' + d + '</svg>';
const ALERT_ICONS = {
  note: icon('<circle cx="8" cy="8" r="6.3"/><path d="M8 7.2v4M8 4.9v.1"/>'),
  tip: icon('<path d="M6 12.4h4M6.7 14.4h2.6M8 1.7a4.3 4.3 0 0 0-2.5 7.8c.4.3.6.8.6 1.3v.1h3.8v-.1c0-.5.2-1 .6-1.3A4.3 4.3 0 0 0 8 1.7z"/>'),
  important: icon('<path d="M2.5 2.5h11V11H8.5L5 13.8V11H2.5z"/><path d="M8 4.8v3.3M8 9.6v.1"/>'),
  warning: icon('<path d="M8 1.9l6.6 11.6H1.4z"/><path d="M8 6.4v3.4M8 11.6v.1"/>'),
  caution: icon('<path d="M5.4 1.5h5.2l3.9 3.9v5.2l-3.9 3.9H5.4l-3.9-3.9V5.4z"/><path d="M8 4.8v3.8M8 11v.1"/>'),
};
const RX = {
  blank: /^[ \t]*$/,
  fence: /^( {0,3})(`{3,}|~{3,})(.*)$/,
  heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  quote: /^ {0,3}> ?/,
  list: /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|[ \t]*$)/,
  html: /^ {0,3}<(?:[!]--|\/?(?:address|article|aside|audio|blockquote|br|canvas|center|dd|details|dialog|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|iframe|img|li|main|nav|ol|p|picture|pre|section|style|[s]cript|summary|svg|table|tbody|td|tfoot|th|thead|tr|ul|video)(?=[\s/>]|$))/i,
  fnDef: /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/,
  container: /^ {0,3}(:{3,})[ \t]*(.*?)[ \t]*$/,
  // [名前]: URL "タイトル"（参照形式の画像・リンクの定義）。URL らしいもの（スキーム付き・パス・ファイル名）だけを定義とみなし、
  // 「[注意]: 本文」のような文は普通の段落のままにする
  linkDef: /^ {0,3}\[(?!\^)([^\]]+)\]:[ \t]*(<[^>\n]*>|(?:data:|[A-Za-z][\w+.-]*:\/\/|mailto:|\.{0,2}\/|#)\S*|[\w.~%-]+(?:\/[\w.~%-]+)*\.[A-Za-z0-9]{1,5}(?:[?#]\S*)?)(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/,
  // *[略語]: 意味（PHP Markdown Extra と同じ書き方）。本文には出さず、本文中の略語に意味を添える
  abbrDef: /^ {0,3}\*\[([^\]\n]+)\]:[ \t]*(.*)$/,
};
/* 生 HTML は、表示に必要なタグと属性だけをタグ単位で組み直す。断片全体を DOM にすると、
   空行を挟んだ div などがブラウザに自動で閉じられ、HTML 内 Markdown の区切りが変わるため使わない */
const RAW_HTML_TOKEN = /<[!]--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:@][\w:.@-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g;
const RAW_ATTR_TOKEN = /([A-Za-z_:@][\w:.@-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
const RAW_HTML_TAGS = new Set(('a abbr address article aside b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark meter nav ol p picture pre progress q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr').split(' '));
const RAW_SVG_TAGS = new Set(('svg g path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop clippath mask title desc').split(' '));
const RAW_VOID_TAGS = new Set(('br col hr img wbr').split(' '));
const RAW_DROP_CONTENT = new Set(('script style iframe object embed textarea template noscript').split(' '));
const RAW_SAFE_CLASSES = new Set(['swatch', 'vd-ins', 'vd-del']);
const RAW_DENIED_C_CLASSES = new Set(['c-tabs', 'c-example', 'c-chart']);
const RAW_GLOBAL_ATTRS = new Set(('class title lang dir role tabindex style').split(' '));
const RAW_TAG_ATTRS = {
  a: new Set(['href', 'target', 'rel']),
  blockquote: new Set(['cite']), q: new Set(['cite']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding']),
  ol: new Set(['start', 'reversed', 'type']), li: new Set(['value']),
  col: new Set(['span']), colgroup: new Set(['span']),
  td: new Set(['colspan', 'rowspan', 'headers']), th: new Set(['colspan', 'rowspan', 'headers', 'scope', 'abbr']),
  time: new Set(['datetime']), meter: new Set(['value', 'min', 'max', 'low', 'high', 'optimum']),
  progress: new Set(['value', 'max']),
};
const RAW_SVG_ATTRS = new Set(('xmlns viewbox preserveaspectratio width height x y x1 y1 x2 y2 cx cy r rx ry d points pathlength transform fill fill-opacity fill-rule stroke stroke-opacity stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset color opacity font-family font-size font-style font-weight text-anchor dominant-baseline dx dy rotate textlength lengthadjust gradientunits gradienttransform spreadmethod offset stop-color stop-opacity clip-path clip-rule mask maskunits maskcontentunits').split(' '));
const RAW_SVG_NAMES = { lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath' };
const RAW_SVG_ATTR_NAMES = { viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', pathlength: 'pathLength', textlength: 'textLength', lengthadjust: 'lengthAdjust', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', spreadmethod: 'spreadMethod', maskunits: 'maskUnits', maskcontentunits: 'maskContentUnits' };
const RAW_CSS_PROPS = new Set(('align-content align-items align-self background background-color border border-color border-style border-width border-top border-top-color border-top-style border-top-width border-right border-right-color border-right-style border-right-width border-bottom border-bottom-color border-bottom-style border-bottom-width border-left border-left-color border-left-style border-left-width border-radius box-shadow color display flex flex-basis flex-direction flex-flow flex-grow flex-shrink flex-wrap font font-family font-size font-style font-variant font-weight gap grid grid-area grid-auto-columns grid-auto-flow grid-auto-rows grid-column grid-row grid-template grid-template-areas grid-template-columns grid-template-rows height justify-content justify-items justify-self letter-spacing line-height margin margin-top margin-right margin-bottom margin-left max-height max-width min-height min-width opacity overflow overflow-wrap overflow-x overflow-y padding padding-top padding-right padding-bottom padding-left text-align text-decoration text-indent text-overflow text-transform transform transform-origin vertical-align white-space width word-break word-spacing').split(' '));
const RAW_CSS_VARS = new Set(('--accent --accent-soft --bg --bg-side --bg-sunken --ink --ink-2 --rule --font --mono --frame --frame-inner --tint --c-note --c-tip --c-important --c-warning --c-caution --add-bg --del-bg --mark --chart-on').split(' '));
/* 参照形式の名前は、大文字と小文字・空白の違いを区別しない */
const refKey = s => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
/* フェンス（``` / ~~~）の中かどうかを 1 行ずつ判定する。中（または開始・終了の行）なら true */
function fenceTracker() {
  let open = null;
  return line => {
    const f = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (open) {
      if (f && f[1][0] === open.ch && f[1].length >= open.len && !f[2].trim()) open = null;
      return true;
    }
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) { open = { ch: f[1][0], len: f[1].length }; return true; }
    return false;
  };
}

/* ===== 構文の色分け（外部ライブラリなし） =====
   言語ごとに「その位置で試す正規表現」を並べ、最初に当たったものを 1 語とする。当たらなければ識別子として
   予約語・型・関数呼び出しを判定する。結果は行ごとの [種類, 文字列] の配列（行をまたぐ色は行ごとに閉じる）*/
const HL = (() => {
  const set = s => new Set(String(s).split(/\s+/).filter(Boolean));
  const y = re => new RegExp(re.source, re.flags.replace('y', '') + 'y');
  const WORD = y(/[A-Za-z_$][\w$]*/);
  const CALL = y(/[ \t]*\(/);
  const SPACE = y(/[ \t]+/);
  const DQ = y(/"(?:[^"\\\n]|\\[\s\S])*"?/);
  const SQ = y(/'(?:[^'\\\n]|\\[\s\S])*'?/);
  const NUM = y(/(?<![\w$.])(?:0[xX][\dA-Fa-f_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[A-Za-z]*/);
  const C_COM = [['com', y(/\/\/[^\n]*/)], ['com', y(/\/\*[\s\S]*?(?:\*\/|$)/)]];
  const DEFS = [
    ['fn', y(/(?<=\b(?:function|def|func|sub|fn)[ \t]+\*?[ \t]*)[A-Za-z_$][\w$]*/)],
    ['type', y(/(?<=\b(?:class|interface|struct|enum|record|trait|namespace|extends|implements|new)[ \t]+)[A-Za-z_$][\w$.]*/)],
  ];
  const L = {};
  const def = (names, spec) => { const o = Object.assign({ word: WORD, call: true, kw: new Set(), rules: [] }, spec); names.split(' ').forEach(n => { L[n] = o; }); return o; };

  function run(lang, code) {
    const out = [];
    let i = 0, plain = '';
    const emit = (c, t) => {
      if (!t) return;
      if (!c) { plain += t; return; }
      if (plain) { out.push(['', plain]); plain = ''; }
      out.push([c, t]);
    };
    const n = code.length;
    outer: while (i < n) {
      SPACE.lastIndex = i;
      const sp = SPACE.exec(code);
      if (sp) { plain += sp[0]; i += sp[0].length; continue; }
      for (const [act, re] of lang.rules) {
        re.lastIndex = i;
        const m = re.exec(code);
        if (!m || !m[0]) continue;
        if (typeof act === 'function') act(m, emit); else emit(act, m[0]);
        i += m[0].length;
        continue outer;
      }
      lang.word.lastIndex = i;
      const w = lang.word.exec(code);
      if (w && w[0]) { emit(classify(lang, w[0], code, i + w[0].length), w[0]); i += w[0].length; continue; }
      plain += code[i++];
    }
    if (plain) out.push(['', plain]);
    return out;
  }
  function classify(lang, w, code, end) {
    if (lang.classify) { const c = lang.classify(w); if (c != null) return c; }
    const k = lang.ci ? w.toLowerCase() : w;
    if (lang.kw.has(k)) return 'kw';
    if (lang.lit && lang.lit.has(k)) return 'lit';
    if (lang.type && lang.type.has(k)) return 'type';
    if (lang.fns && lang.fns.has(k)) return 'fn';
    if (lang.call) { CALL.lastIndex = end; if (CALL.test(code)) return 'fn'; }
    if (lang.capType && /^[A-Z][a-z0-9]\w*$/.test(w)) return 'type';
    return '';
  }

  /* 文字列の中の変数（シェル・PowerShell の "…$x…"）を色分けする */
  const withVars = re => (m, emit) => m[0].split(re).forEach((p, k) => emit(k % 2 ? 'var' : 'str', p));
  /* HTML・XML のタグ（< と > は地の色、タグ名・属性名・値を色分け） */
  const ATTR = y(/(\s+)([^\s"'>\/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/);
  const tagTok = (m, emit) => {
    const t = m[0];
    const h = t.match(/^<\/?([^\s>\/]*)/);
    emit('', h[0].slice(0, h[0].length - h[1].length));
    emit('tag', h[1]);
    let p = h[0].length;
    for (;;) {
      ATTR.lastIndex = p;
      const a = ATTR.exec(t);
      if (!a) break;
      emit('', a[1]); emit('attr', a[2]);
      if (a[3]) { emit('', a[3]); emit('str', a[4]); }
      p += a[0].length;
    }
    emit('', t.slice(p));
  };
  const TAG = y(/<\/?[A-Za-z][\w:.-]*(?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>?/);
  const embed = key => (m, emit) => {
    const t = m[0], close = t.indexOf('>') + 1 || t.length;
    tagTok([t.slice(0, close)], emit);
    if (close < t.length) for (const [c, s] of run(L[key], t.slice(close))) emit(c, s);
  };

  /* --- C / C++ --- */
  def('c cpp c++ cc cxx h hpp hh hxx ino arduino objc', {
    rules: [...C_COM, ['meta', y(/(?<=^[ \t]*)#[ \t]*[A-Za-z]+/m)], ['str', y(/(?<=#[ \t]*include[ \t]*)<[^>\n]*>/)],
      ['str', y(/(?:u8|[uUL])?R"([^()\\\s]{0,16})\([\s\S]*?\)\1"/)], ['str', DQ], ['str', SQ], ['num', NUM], ...DEFS],
    kw: set('alignas alignof and asm auto bool break case catch char char8_t char16_t char32_t class concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern final float for friend goto if inline int long mutable namespace new noexcept not operator or override private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw try typedef typeid typename union unsigned using virtual void volatile wchar_t while'),
    lit: set('true false nullptr NULL'), type: set('size_t ssize_t ptrdiff_t intptr_t uintptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE std string vector map'), capType: true,
  });
  /* --- C# --- */
  def('cs csharp c#', {
    rules: [...C_COM, ['meta', y(/(?<=^[ \t]*)#[ \t]*[A-Za-z]+[^\n]*/m)], ['str', y(/\$?"""[\s\S]*?(?:"""|$)/)],
      ['str', y(/(?:\$@|@\$|@)"(?:[^"]|"")*"?/)], ['str', y(/\$?"(?:[^"\\\n]|\\.)*"?/)], ['str', SQ],
      ['meta', y(/(?<=^[ \t]*)\[[A-Z]\w*(?:\([^)\n]*\))?\]/m)], ['num', NUM], ...DEFS],
    kw: set('abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double dynamic else enum event explicit extern file finally fixed float for foreach get global goto if implicit in init int interface internal is lock long nameof namespace new object operator out override params partial private protected public readonly record ref required return sbyte scoped sealed select set short sizeof stackalloc static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using value var virtual void volatile when where while with yield from orderby group into join let'),
    lit: set('true false null'), capType: true,
  });
  /* --- Java --- */
  def('java', {
    rules: [...C_COM, ['meta', y(/@[A-Za-z_][\w.]*/)], ['str', y(/"""[\s\S]*?(?:"""|$)/)], ['str', DQ], ['str', SQ], ['num', NUM], ...DEFS],
    kw: set('abstract assert boolean break byte case catch char class const continue default do double else enum exports extends final finally float for goto if implements import instanceof int interface long module native new non-sealed package permits private protected public record requires return sealed short static strictfp super switch synchronized this throw throws transient try var void volatile while yield'),
    lit: set('true false null'), capType: true,
  });
  /* --- JavaScript / TypeScript --- */
  const JS_RULES = [...C_COM, ['meta', y(/(?<![\s\S])#![^\n]*/)], ['str', y(/`(?:[^`\\]|\\[\s\S])*`?/)], ['str', DQ], ['str', SQ],
    ['str', y(/(?<=(?:^|[=(,:;!&|?{}\[+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|void|yield|await))[ \t]*)\/(?![*\/])(?:[^\/\\\n\[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuyv]*/m)],
    ['meta', y(/@[A-Za-z_$][\w$.]*/)], ['num', NUM], ...DEFS];
  const JS_KW = 'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield';
  def('js javascript jsx mjs cjs node', { rules: JS_RULES, kw: set(JS_KW), lit: set('true false null undefined NaN Infinity'), capType: true });
  def('ts typescript tsx mts cts', {
    rules: JS_RULES, capType: true,
    kw: set(JS_KW + ' abstract asserts declare enum implements infer interface is keyof module namespace override private protected public readonly satisfies type unique'),
    lit: set('true false null undefined NaN Infinity'), type: set('string number boolean any unknown never void object bigint symbol'),
  });
  /* --- Python --- */
  def('py python python3 py3 pyw ipython', {
    rules: [['com', y(/#[^\n]*/)], ['meta', y(/(?<=^[ \t]*)@[\w.]+/m)],
      ['str', y(/[rRbBuUfF]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/)],
      ['str', y(/[rRbBuUfF]{0,2}"(?:[^"\\\n]|\\[\s\S])*"?/)], ['str', y(/[rRbBuUfF]{0,2}'(?:[^'\\\n]|\\[\s\S])*'?/)], ['num', NUM], ...DEFS],
    word: y(/[A-Za-z_]\w*/), capType: true,
    kw: set('and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try type while with yield'),
    lit: set('True False None self cls'), type: set('int str float bool bytes list dict set tuple object complex frozenset bytearray'),
  });
  /* --- シェル --- */
  const SH_VAR = /(\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[@*#?$!0-9-]))/;
  def('sh bash zsh shell ksh shellscript console terminal', {
    rules: [['meta', y(/(?<![\s\S])#![^\n]*/)], ['com', y(/(?<![^\s;|&(])#[^\n]*/)],
      ['str', y(/<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?(?:^[ \t]*\2[ \t]*$|$(?![\s\S]))/m)],
      ['str', y(/'[^']*'?/)], [withVars(SH_VAR), y(/"(?:[^"\\]|\\[\s\S])*"?/)],
      ['var', y(/\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[@*#?$!0-9-])/)], ['var', y(/(?<=(?:^|[\s;|&(]))[A-Za-z_]\w*(?==)/m)],
      ['attr', y(/(?<=\s)--?[A-Za-z0-9][\w-]*/)], ['num', y(/(?<![\w.-])\d+(?:\.\d+)?(?![\w.])/)]],
    word: y(/[A-Za-z_][\w.-]*/), call: false,
    kw: set('if then else elif fi for while until do done case esac in function select time return break continue exit local export readonly declare typeset unset shift source alias trap eval exec set'),
    fns: set('echo printf cd pwd read test cat grep egrep sed awk ls cp mv rm mkdir rmdir touch chmod chown chgrp ln sudo su find xargs curl wget git docker kubectl helm systemctl journalctl service tar gzip gunzip zip unzip ssh scp rsync sort uniq head tail cut tr wc ps kill pkill top df du free mount umount apt apt-get yum dnf rpm dpkg pip pip3 python python3 node npm npx make sleep date env which whoami hostname ping ip ifconfig netstat ss nc openssl tee basename dirname realpath true false'),
  });
  /* --- バッチファイル（cmd） --- */
  def('bat cmd batch dos', {
    rules: [['com', y(/(?<=^[ \t]*@?)(?:rem(?=[\s:]|$)[^\n]*|::[^\n]*)/im)], ['fn', y(/(?<=^[ \t]*):[A-Za-z_][\w.-]*/m)], ['meta', y(/(?<=^[ \t]*)@/m)],
      ['var', y(/%~[a-zA-Z$:]*\d|%%~?[a-zA-Z]|%\d|%\*|%[^%\s"]+%|![^!\s"]+!/)], ['str', y(/"[^"\n]*"?/)],
      ['attr', y(/(?<=\s)\/[A-Za-z?][\w:-]*/)], ['num', y(/(?<![\w.])\d+(?![\w.])/)]],
    word: y(/[A-Za-z_][\w.-]*/), call: false, ci: true,
    kw: set('if else for in do goto call exit set setlocal endlocal echo off on not exist defined errorlevel equ neq lss leq gtr geq pause shift start cd chdir pushd popd md mkdir rd rmdir del erase copy xcopy robocopy move ren rename type cls title choice timeout nul con cmd color ver path prompt find findstr where taskkill tasklist sc net reg powershell'),
  });
  /* --- PowerShell --- */
  const PS_OPS = set('-eq -ne -gt -ge -lt -le -like -notlike -match -notmatch -contains -notcontains -in -notin -replace -split -join -and -or -not -xor -is -isnot -as -band -bor -bxor -bnot -shl -shr -f -ceq -cne -clike -cmatch -ieq -imatch');
  def('ps1 powershell pwsh ps psm1 psd1', {
    rules: [['com', y(/<#[\s\S]*?(?:#>|$)/)], ['com', y(/#[^\n]*/)],
      ['str', y(/@"[ \t]*\n[\s\S]*?(?:\n"@|$)/)], ['str', y(/@'[ \t]*\n[\s\S]*?(?:\n'@|$)/)],
      [withVars(/(\$(?:\{[^}\n]*\}|[\w:]+))/), y(/"(?:[^"`]|`[\s\S]|"")*"?/)], ['str', y(/'(?:[^']|'')*'?/)],
      [(m, emit) => emit(/^\$(?:true|false|null)$/i.test(m[0]) ? 'lit' : 'var', m[0]), y(/\$(?:\{[^}\n]*\}|[\w:?^$]+)/)],
      ['type', y(/\[[A-Za-z_][\w.`]*(?:\[[\w.,\s\[\]]*\])?\](?=[ \t]*[$\[\w(:]|[ \t]*$|::)/m)],
      [(m, emit) => emit(PS_OPS.has(m[0].toLowerCase()) ? 'kw' : 'attr', m[0]), y(/(?<=^|[\s(])-[A-Za-z][\w]*/m)],
      ['num', NUM], ...DEFS],
    word: y(/[A-Za-z_][\w]*(?:-[A-Za-z][\w]*)*/), ci: true, call: false,
    classify: w => (w.includes('-') ? 'fn' : null),
    kw: set('begin break catch class continue data default define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in param process return static switch throw trap try until using var while workflow'),
  });
  /* --- SQL --- */
  def('sql mysql pgsql postgres postgresql plsql tsql mssql sqlite oracle psql mariadb bigquery snowflake hive', {
    rules: [['com', y(/--[^\n]*/)], ['com', y(/\/\*[\s\S]*?(?:\*\/|$)/)], ['str', y(/[NnEe]?'(?:[^']|'')*'?/)],
      ['attr', y(/"(?:[^"]|"")*"?|`[^`\n]*`?/)], ['var', y(/(?<![\w@:])[@:$][A-Za-z_]\w*/)], ['num', NUM]],
    word: y(/[A-Za-z_][\w$#]*/), ci: true, call: false,
    kw: set('add all alter analyze and any as asc begin between by cascade case check column commit constraint create cross current database declare default delete desc distinct drop else end except exec execute exists explain fetch first for foreign from full function grant group having if in index inner insert intersect into is join key lateral left like limit merge matched natural next not nulls offset on only or order outer over partition primary procedure recursive references rename replace return returns revoke right rollback rows schema select sequence set table temp temporary then to top transaction trigger truncate union unique update using vacuum values view when where while window with'),
    type: set('int integer bigint smallint tinyint decimal numeric float real double precision char varchar nvarchar nchar text date time timestamp timestamptz datetime interval boolean bool blob clob bytea serial bigserial uuid json jsonb xml money bit'),
    lit: set('true false null unknown'),
    fns: set('count sum avg min max coalesce nullif cast convert concat substring substr trim ltrim rtrim upper lower length len replace round floor ceil ceiling abs now current_date current_time current_timestamp date_trunc extract to_char to_date to_number row_number rank dense_rank ntile lag lead first_value last_value ifnull isnull nvl iif greatest least string_agg group_concat array_agg json_agg json_extract datediff dateadd getdate sysdate format generate_series'),
  });
  /* --- HTML・XML --- */
  def('html htm xhtml vue svelte', {
    rules: [['com', y(/<[!]--[\s\S]*?(?:-->|$)/)], ['meta', y(/<![A-Za-z][^>]*>?/)],
      [embed('js'), y(/<([s]cript)\b[^>]*>[\s\S]*?(?=<\/[s]cript\s*>|$(?![\s\S]))/i)],
      [embed('css'), y(/<(style)\b[^>]*>[\s\S]*?(?=<\/style\s*>|$(?![\s\S]))/i)],
      [tagTok, TAG], ['num', y(/&(?:#\d+|#x[\dA-Fa-f]+|[A-Za-z]\w*);/)]],
    word: y(/[^\s<&]+/), call: false,
  });
  def('xml svg xaml xsl xslt plist csproj vbproj props targets nuspec resx wsdl xsd rss atom pom', {
    rules: [['com', y(/<[!]--[\s\S]*?(?:-->|$)/)], ['meta', y(/<\?[\s\S]*?(?:\?>|$)/)], ['str', y(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/)],
      ['meta', y(/<![A-Za-z][^>]*>?/)], [tagTok, TAG], ['num', y(/&(?:#\d+|#x[\dA-Fa-f]+|[A-Za-z]\w*);/)]],
    word: y(/[^\s<&]+/), call: false,
  });
  /* --- CSS --- */
  def('css scss sass less', {
    rules: [['com', y(/\/\*[\s\S]*?(?:\*\/|$)/)], ['com', y(/(?<![:\w])\/\/[^\n]*/)], ['str', DQ], ['str', SQ],
      ['kw', y(/@[\w-]+/)], ['var', y(/--[\w-]+|\$[\w-]+/)],
      ['attr', y(/(?<=(?:^|[{;])[ \t]*)[A-Za-z-][\w-]*(?=[ \t]*:(?![^;{}\n]*\{))/m)],
      ['num', y(/#[\dA-Fa-f]{3,8}(?![\w-])/)], ['num', y(/(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:%|[A-Za-z]+)?/)],
      ['kw', y(/!important\b/)], ['type', y(/(?<![\w-])[.#][A-Za-z_-][\w-]*/)]],
    word: y(/[A-Za-z_-][\w-]*/),
  });
  /* --- JSON・YAML・TOML・INI --- */
  def('json jsonc json5 geojson webmanifest', {
    rules: [...C_COM, ['attr', y(/"(?:[^"\\\n]|\\.)*"(?=\s*:)/)], ['str', DQ], ['str', SQ], ['num', y(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/)]],
    lit: set('true false null NaN Infinity'), call: false,
  });
  const YAML_KEY = /(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\n]|'')*'|[^\s#:'"\[\]{},&*!|>%@`-][^\n:#]*?|-[^\s#:][^\n:#]*?)/;
  def('yaml yml', {
    rules: [['com', y(/(?<![^\s])#[^\n]*/)], ['meta', y(/(?<=^)(?:---|\.\.\.)(?=[ \t]|$)/m)],
      ['attr', new RegExp('(?<=^[ \\t]*(?:-[ \\t]+)*)' + YAML_KEY.source + '(?=[ \\t]*:(?:[ \\t]|$))', 'my')],
      ['kw', y(/(?<=^[ \t]*)-(?=[ \t]|$)/m)], ['var', y(/[&*][\w-]+/)], ['type', y(/!{1,2}[\w!\/.-]*/)],
      ['str', y(/"(?:[^"\\]|\\[\s\S])*"?|'(?:[^']|'')*'?/)], ['kw', y(/[|>][-+0-9]*(?=[ \t]*(?:#[^\n]*)?$)/m)],
      ['num', y(/(?<![\w.-])[-+]?(?:0x[\dA-Fa-f]+|0o[0-7]+|\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|\.inf|\.nan)(?![\w.-]|[ \t]*[^\s#,\]}])/i)],
      ['lit', y(/~(?=\s|$)/)]],
    word: y(/[A-Za-z_][\w.-]*/), ci: true, call: false, lit: set('true false null yes no on off'),
  });
  def('toml', {
    rules: [['com', y(/#[^\n]*/)], ['sec', y(/(?<=^[ \t]*)\[\[?[^\]\n]*\]\]?/m)],
      ['attr', y(/(?<=^[ \t]*|[{,][ \t]*)(?:[\w-]+|"(?:[^"\\\n]|\\.)*"|'[^'\n]*')(?:[ \t]*\.[ \t]*(?:[\w-]+|"(?:[^"\\\n]|\\.)*"|'[^'\n]*'))*(?=[ \t]*=)/m)],
      ['str', y(/"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/)], ['str', DQ], ['str', y(/'[^'\n]*'?/)],
      ['num', y(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?/)],
      ['num', y(/(?<![\w.])[+-]?(?:0x[\dA-Fa-f_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?|inf|nan)(?![\w.])/)]],
    word: y(/[A-Za-z_][\w-]*/), call: false, lit: set('true false'),
  });
  def('ini conf cfg properties prop env dotenv editorconfig gitconfig desktop service cnf inf', {
    rules: [['com', y(/(?<=^[ \t]*)[;#!][^\n]*/m)], ['sec', y(/(?<=^[ \t]*)\[[^\]\n]*\]/m)],
      ['attr', y(/(?<=^[ \t]*)(?:export[ \t]+)?[^\s=:;#!\[][^=:\n]*?(?=[ \t]*[=:])/m)],
      ['str', y(/"(?:[^"\\\n]|\\.)*"?|'[^'\n]*'?/)], ['var', y(/\$\{[^}\n]*\}|\$[A-Za-z_]\w*|%\([\w.]+\)s|%[A-Za-z_]\w*%/)],
      ['num', y(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/)]],
    word: y(/[A-Za-z_][\w.-]*/), call: false, ci: true, lit: set('true false yes no on off null none'),
  });
  /* --- Markdown（フェンスの中は、その言語で色分けする） --- */
  const mdFence = (m, emit) => {
    const open = m[1] + m[2], inner = m[3], rest = m[0].slice(open.length + 1 + inner.length);
    emit('meta', open); emit('', '\n');
    const lang = L[(m[2].trim().split(/[\s:{]/)[0] || '').toLowerCase()];
    if (lang && inner) for (const [c, s] of run(lang, inner)) emit(c, s);
    else emit('', inner);
    emit('meta', rest);
  };
  const frontMatter = (m, emit) => {
    const lines = m[0].split('\n');
    emit('meta', lines[0]); emit('', '\n');
    for (const [c, s] of run(L.yaml, lines.slice(1, -1).join('\n'))) emit(c, s);
    emit('', '\n'); emit('meta', lines[lines.length - 1]);
  };
  const mdLink = (m, emit) => {
    const k = m[0].indexOf('](') >= 0 ? m[0].indexOf('](') + 1 : m[0].indexOf('][') + 1;
    emit('str', m[0].slice(0, k)); emit('attr', m[0].slice(k));
  };
  def('md markdown mdx', {
    rules: [[frontMatter, y(/(?<![\s\S])---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?=\n|$)/)],
      [mdFence, y(/(?<=^ {0,3})(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:^ {0,3}\1[`~]*[ \t]*$|$(?![\s\S]))/m)],
      ['sec', y(/(?<=^ {0,3})#{1,6}(?=[ \t]|$)[^\n]*/m)], ['meta', y(/(?<=^ {0,3}):{3,}[^\n]*/m)],
      ['meta', y(/(?<=^ {0,3})(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m)],
      ['kw', y(/(?<=^[ \t]*)(?:[-*+]|\d{1,9}[.)])(?=[ \t])/m)], ['kw', y(/(?<=^[ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[[ xX]\]/m)],
      ['com', y(/(?<=^ {0,3})>[ \t]?(?:\[![A-Za-z]+\])?/m)],
      ['attr', y(/(?<=^ {0,3})\*?\[[^\]\n]+\]:[^\n]*/m)], ['', y(/\\[!-\/:-@\[-`{-~]/)],
      ['str', y(/(`+)(?!`)[^\n]*?[^`\n]\1(?!`)/)], ['attr', y(/\[\^[^\]\s]+\]/)],
      [mdLink, y(/!?\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\](?:\([^)\n]*\)|\[[^\]\n]*\])/)],
      ['kw', y(/(?<![\w:]):(?:ok|ng|warn|info|tag|menu)(?=\[)/)],
      ['strong', y(/\*\*(?=\S)[^\n]*?\S\*\*|(?<!\w)__(?=\S)[^\n]*?\S__(?!\w)/)],
      ['em', y(/\*(?=[^\s*])[^\n*]*?[^\s*]\*|(?<!\w)_(?=[^\s_])[^\n_]*?[^\s_]_(?!\w)/)], ['del', y(/~~(?=\S)[^\n]*?\S~~/)],
      ['com', y(/<[!]--[\s\S]*?(?:-->|$)/)], [tagTok, TAG], ['op', y(/\|/)]],
    word: y(/[^\s`*_~\[\]<>!:|\\&]+/), call: false,
  });

  /* --- CSV・TSV（列ごとに色を変える。引用符の中の区切りと改行は列の中身） --- */
  function csvTokens(code, tab) {
    const sep = tab ? '\t' : ',';
    const field = tab ? /"(?:[^"]|"")*"?|[^\t\n]*/y : /"(?:[^"]|"")*"?|[^,\n]*/y;
    const rest = tab ? /[^\t\n]*/y : /[^,\n]*/y;
    const out = [];
    let i = 0, col = 0;
    while (i <= code.length) {
      field.lastIndex = i;
      const m = field.exec(code);
      let f = m ? m[0] : '';
      // 引用符の後ろに文字が続く崩れた列（"ab"cd）は、区切りまでを同じ列にする
      if (f[0] === '"') { rest.lastIndex = i + f.length; const r = rest.exec(code); if (r) f += r[0]; }
      if (f) out.push(['c' + (col % 6), f]);
      i += f.length;
      if (i >= code.length) break;
      if (code[i] === sep) { out.push(['op', sep]); col++; } else { out.push(['', '\n']); col = 0; }
      i++;
    }
    return out;
  }

  const EXT = {
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', ino: 'cpp', cs: 'cs', java: 'java',
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'ts', py: 'py', pyw: 'py',
    sh: 'sh', bash: 'sh', zsh: 'sh', ksh: 'sh', bat: 'bat', cmd: 'bat', ps1: 'ps1', psm1: 'ps1', psd1: 'ps1', sql: 'sql',
    html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html', css: 'css', scss: 'css', sass: 'css', less: 'css',
    md: 'md', markdown: 'md', mdx: 'md', json: 'json', jsonc: 'json', json5: 'json', xml: 'xml', svg: 'xml', xaml: 'xml',
    xsl: 'xml', xslt: 'xml', csproj: 'xml', vbproj: 'xml', props: 'xml', targets: 'xml', config: 'xml', plist: 'xml', resx: 'xml',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', conf: 'ini', cfg: 'ini', cnf: 'ini', properties: 'ini', env: 'ini',
    editorconfig: 'ini', gitconfig: 'ini', service: 'ini', csv: 'csv', tsv: 'tsv',
  };
  const isCsv = k => k === 'csv' || k === 'tsv' || k === 'tab';
  const known = k => isCsv(k) || !!L[k];
  function tokens(code, key) {
    if (isCsv(key)) return csvTokens(code, key !== 'csv' || (!/,/.test(code.split('\n')[0]) && /\t/.test(code)));
    return run(L[key], code);
  }
  /* 字句を行に分ける（行をまたぐ字句は、行ごとに同じ種類で分ける） */
  function lines(code, key) {
    const out = [[]];
    for (const [c, t] of tokens(code, key)) {
      t.split('\n').forEach((p, k) => { if (k) out.push([]); if (p) out[out.length - 1].push([c, p]); });
    }
    return out;
  }
  const lineHtml = toks => toks.map(([c, t]) => (c ? '<span class="tk-' + c + '">' + escHtml(t) + '</span>' : escHtml(t))).join('');
  return {
    /* 言語名（大文字・小文字は区別しない）を、色分けできる言語のキーにする。できなければ '' */
    lang: name => { const k = String(name || '').toLowerCase(); return known(k) ? k : ''; },
    byFile: name => {
      const b = String(name || '').split(/[\\/]/).pop().toLowerCase();
      if (/^\.env(\.|$)/.test(b)) return 'ini';
      const m = b.match(/\.([a-z0-9]+)$/) || b.match(/^\.([a-z0-9]+)$/);
      return m && EXT[m[1]] ? EXT[m[1]] : '';
    },
    lines: (code, key) => (key && code.length <= 300000 ? lines(code, key) : null),
    html: (code, key) => (key && code.length <= 300000 ? lines(code, key).map(lineHtml).join('\n') : escHtml(code)),
    lineHtml,
  };
})();

/* ===== グラフ（:::chart。Markdown の表から SVG を描く。外部ライブラリなし） =====
   系列の色は --chart-1〜8 の順に固定で割り当てる（構文強調の --tk-* と共通。9 系列目以降は描かない）。
   棒は 24px 以下で、値の側の角だけ丸める。線は 2px、点は 2px の地の色の縁取り付き。2 系列以上は凡例を付ける */
const Chart = (() => {
  const TYPES = { bar: 'bar', column: 'bar', vbar: 'bar', barh: 'barh', hbar: 'barh', stacked: 'stacked', stack: 'stacked', line: 'line', area: 'area', share: 'share', ratio: 'share', pie: 'share', donut: 'share' };
  const MAX = 8;
  const color = k => 'var(--chart-' + ((k % MAX) + 1) + ')';
  const onColor = () => 'var(--chart-on)';
  const r1 = v => Math.round(v * 10) / 10;
  const tw = (s, fs) => Array.from(String(s)).reduce((w, ch) => w + (/[\u0000-ÿ]/.test(ch) ? 0.6 : 1), 0) * fs;
  const trunc = (s, max, fs) => {
    s = String(s);
    if (tw(s, fs) <= max) return s;
    const a = Array.from(s);
    while (a.length > 1 && tw(a.join('') + '…', fs) > max) a.pop();
    return a.join('') + '…';
  };
  const num = s => {
    const t = String(s == null ? '' : s).replace(/[,，\s]/g, '').replace(/[−–]/g, '-');
    const m = t.match(/[-+]?\d*\.?\d+/);
    return m ? parseFloat(m[0]) : null;
  };
  const unitOf = cells => {
    const sfx = cells.filter(c => num(c) != null).map(c => (c.replace(/[,，]/g, '').trim().match(/[-+−]?\d*\.?\d+\s*(.*)$/) || [])[1] || '');
    return sfx.length && sfx.every(x => x === sfx[0]) && sfx[0].length <= 4 ? sfx[0].trim() : '';
  };
  const full = (v, unit) => (v == null ? '—' : v.toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + (unit || ''));
  const tick = v => {
    const a = Math.abs(v), t = x => Number(x.toFixed(2)).toLocaleString('ja-JP');
    return a >= 1e8 ? t(v / 1e8) + '億' : a >= 1e4 ? t(v / 1e4) + '万' : t(v);
  };
  /* 目盛り。整数だけのデータ（件数など）なら、目盛りも整数にする */
  function nice(lo, hi, n, int = false) {
    if (lo === hi) { if (lo === 0) hi = 1; else if (lo > 0) lo = 0; else hi = 0; }
    const raw = (hi - lo) / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    let mult = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    if (int && mult === 2.5) mult = 2;
    const step = int ? Math.max(1, mult * mag) : mult * mag;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let v = a; v <= b + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return { lo: a, hi: b, ticks };
  }
  /* 値の側の角だけを丸めた棒（up: 上向き / right: 右向き） */
  function vbar(x, y, w, h, up) {
    if (h <= 0.5 || w <= 0) return '';
    const r = Math.min(4, w / 2, h);
    return up
      ? 'M' + r1(x) + ',' + r1(y + h) + 'V' + r1(y + r) + 'Q' + r1(x) + ',' + r1(y) + ' ' + r1(x + r) + ',' + r1(y) + 'H' + r1(x + w - r) + 'Q' + r1(x + w) + ',' + r1(y) + ' ' + r1(x + w) + ',' + r1(y + r) + 'V' + r1(y + h) + 'Z'
      : 'M' + r1(x) + ',' + r1(y) + 'V' + r1(y + h - r) + 'Q' + r1(x) + ',' + r1(y + h) + ' ' + r1(x + r) + ',' + r1(y + h) + 'H' + r1(x + w - r) + 'Q' + r1(x + w) + ',' + r1(y + h) + ' ' + r1(x + w) + ',' + r1(y + h - r) + 'V' + r1(y) + 'Z';
  }
  function hbar(x, y, w, h, right) {
    if (w <= 0.5 || h <= 0) return '';
    const r = Math.min(4, h / 2, w);
    return right
      ? 'M' + r1(x) + ',' + r1(y) + 'H' + r1(x + w - r) + 'Q' + r1(x + w) + ',' + r1(y) + ' ' + r1(x + w) + ',' + r1(y + r) + 'V' + r1(y + h - r) + 'Q' + r1(x + w) + ',' + r1(y + h) + ' ' + r1(x + w - r) + ',' + r1(y + h) + 'H' + r1(x) + 'Z'
      : 'M' + r1(x + w) + ',' + r1(y) + 'H' + r1(x + r) + 'Q' + r1(x) + ',' + r1(y) + ' ' + r1(x) + ',' + r1(y + r) + 'V' + r1(y + h - r) + 'Q' + r1(x) + ',' + r1(y + h) + ' ' + r1(x + r) + ',' + r1(y + h) + 'H' + r1(x + w) + 'Z';
  }
  const text = (x, y, s, cls, anchor, fs, extra = '') => '<text class="' + cls + '" x="' + r1(x) + '" y="' + r1(y) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + ' font-size="' + r1(fs) + '"' + extra + '>' + escHtml(s) + '</text>';
  const hit = (x, y, w, h, attrs) => '<rect class="chart-hit" x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(Math.max(1, w)) + '" height="' + r1(Math.max(1, h)) + '"' + attrs + '/>';

  /* 表（<table>）から、グラフのデータを作る。1 列目が項目、2 列目以降が系列 */
  function data(table, type, opts = {}) {
    const head = table.tHead && table.tHead.rows[0] ? Array.from(table.tHead.rows[0].cells).map(c => c.textContent.trim()) : [];
    const rows = Array.from((table.tBodies[0] || { rows: [] }).rows).map(r => Array.from(r.cells).map(c => c.textContent.trim()));
    const nCols = Math.max(head.length, ...rows.map(r => r.length), 0);
    let cats = rows.map(r => r[0] || '');
    let series = [];
    for (let k = 1; k < nCols; k++) series.push({ name: head[k] || '系列 ' + k, values: rows.map(r => num(r[k])) });
    const unit = opts.unit != null ? opts.unit : unitOf(rows.flatMap(r => r.slice(1)));
    let dropped = Math.max(0, series.length - MAX), folded = 0;
    series = series.slice(0, MAX);
    // 構成比は、9 番目以降の項目を「その他」にまとめる
    if (type === 'share' && cats.length > MAX) {
      folded = cats.length - (MAX - 1);
      cats = cats.slice(0, MAX - 1).concat(['その他']);
      series = series.map(s => ({ name: s.name, values: s.values.slice(0, MAX - 1).concat([s.values.slice(MAX - 1).reduce((a, v) => a + Math.max(0, v || 0), 0)]) }));
    }
    return { type, cats, series, unit, dropped, folded, min: opts.min, max: opts.max, label: opts.label || '' };
  }

  function legend(d) {
    const items = d.type === 'share' ? d.cats.map((c, k) => [c, k]) : d.series.length >= 2 ? d.series.map((s, k) => [s.name, k]) : [];
    if (!items.length) return '';
    const line = d.type === 'line';
    return '<div class="chart-legend">' + items.map(([n, k]) => '<span class="lg"><i class="sw' + (line ? ' line' : '') + '" style="--c:' + color(k) + '"></i>' + escHtml(n) + '</span>').join('') + '</div>';
  }
  function note(d) {
    const t = [];
    if (d.dropped) t.push('系列が多いため、9 番目以降の ' + d.dropped + ' 系列はグラフに描いていません（データのタブには全部あります）。');
    if (d.folded) t.push('8 番目以降の ' + d.folded + ' 項目は「その他」にまとめました。');
    return t.length ? '<p class="chart-note">' + escHtml(t.join('')) + '</p>' : '';
  }

  /* 縦棒・積み上げ・折れ線・面 */
  function vertical(d, W, fs) {
    const S = d.series.length, N = d.cats.length, kind = d.type;
    const H = Math.round(fs * 21);
    const totals = d.cats.map((_, i) => d.series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0));
    const vals = kind === 'stacked' ? totals : d.series.flatMap(s => s.values.filter(v => v != null));
    if (!vals.length) return { H, body: '' };
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (kind !== 'line' || (lo >= 0 && lo <= hi * 0.5)) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (d.min != null && !isNaN(d.min)) lo = d.min;
    if (d.max != null && !isNaN(d.max)) hi = d.max;
    const sc = nice(lo, hi, 5, vals.every(Number.isInteger));
    const labels = sc.ticks.map(tick);
    const ends = (kind === 'line' || kind === 'area') && S >= 2 && S <= 4;
    const padL = Math.ceil(Math.max(...labels.map(t => tw(t, fs)))) + 10;
    const padR = ends ? Math.min(W * 0.25, Math.max(...d.series.map(s => tw(s.name, fs))) + 14) : (kind === 'line' || kind === 'area') && S === 1 ? Math.min(W * 0.2, tw(full(d.series[0].values.filter(v => v != null).pop(), d.unit), fs) / 2 + 8) : 8;
    const padT = d.unit ? fs * 1.7 + 6 : fs + 6, padB = fs * 2 + 2;
    const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
    const Y = v => y1 - (Math.max(sc.lo, Math.min(sc.hi, v)) - sc.lo) / (sc.hi - sc.lo) * (y1 - y0);
    const yZero = Y(Math.max(sc.lo, Math.min(sc.hi, 0)));
    let out = '';
    sc.ticks.forEach((t, k) => {
      const yy = r1(Y(t));
      out += '<line class="chart-grid" x1="' + x0 + '" x2="' + r1(x1) + '" y1="' + yy + '" y2="' + yy + '"/>' + text(x0 - 8, Y(t) + fs * 0.35, labels[k], 'chart-tick', 'end', fs);
    });
    if (sc.lo <= 0 && sc.hi >= 0) out += '<line class="chart-axis" x1="' + x0 + '" x2="' + r1(x1) + '" y1="' + r1(yZero) + '" y2="' + r1(yZero) + '"/>';
    if (d.unit) out += text(2, fs, '（' + d.unit + '）', 'chart-tick', 'start', fs * 0.9);
    const bars = kind === 'bar' || kind === 'stacked';
    const band = (x1 - x0) / Math.max(1, N);
    const xs = d.cats.map((_, i) => (bars ? x0 + band * (i + 0.5) : N === 1 ? (x0 + x1) / 2 : x0 + 8 + i * (x1 - x0 - 16) / (N - 1)));
    // 項目名。入りきらないときは間引き、長いものは省略する（全文はツールチップとデータのタブにある）
    const step = bars ? band : N > 1 ? (x1 - x0 - 16) / (N - 1) : x1 - x0;
    const every = Math.max(1, Math.ceil((Math.min(fs * 7, Math.max(...d.cats.map(c => tw(c, fs)))) + 10) / Math.max(1, step)));
    d.cats.forEach((c, i) => { if (i % every === 0) out += text(xs[i], y1 + fs * 1.5, trunc(c, step * every - 6, fs), 'chart-cat', 'middle', fs); });
    if (kind === 'bar') {
      const gap = 2, bw = Math.max(2, Math.min(24, (band * 0.72 - gap * (S - 1)) / S)), gw = bw * S + gap * (S - 1);
      d.series.forEach((s, k) => s.values.forEach((v, i) => {
        if (v == null) return;
        const x = xs[i] - gw / 2 + k * (bw + gap), yv = Y(v), top = Math.min(yv, yZero), h = Math.abs(yZero - yv);
        out += '<path class="chart-mark" fill="' + color(k) + '" d="' + vbar(x, top, bw, h, v >= 0) + '"/>';
        if (S === 1 && N <= 16) {
          const lab = full(v, d.unit);
          if (tw(lab, fs * 0.92) <= band - 4) out += text(x + bw / 2, v >= 0 ? top - 5 : top + h + fs, lab, 'chart-val', 'middle', fs * 0.92);
        }
        out += hit(x - gap / 2, y0, bw + gap, y1 - y0, ' data-i="' + i + '" data-s="' + k + '"');
      }));
    } else if (kind === 'stacked') {
      const bw = Math.max(4, Math.min(24, band * 0.6));
      d.cats.forEach((c, i) => {
        let acc = 0;
        const last = d.series.reduce((m, s, k) => ((s.values[i] || 0) > 0 ? k : m), -1);
        d.series.forEach((s, k) => {
          const v = s.values[i] || 0;
          if (v <= 0) return;
          const top = Y(acc + v), bot = Y(acc) - (acc > 0 ? 2 : 0);
          out += k === last
            ? '<path class="chart-mark" fill="' + color(k) + '" d="' + vbar(xs[i] - bw / 2, top, bw, bot - top, true) + '"/>'
            : bot - top > 0.5 ? '<rect class="chart-mark" fill="' + color(k) + '" x="' + r1(xs[i] - bw / 2) + '" y="' + r1(top) + '" width="' + r1(bw) + '" height="' + r1(bot - top) + '"/>' : '';
          acc += v;
        });
        if (N <= 16) {
          const lab = full(totals[i], d.unit);
          if (tw(lab, fs * 0.92) <= band - 4) out += text(xs[i], Y(totals[i]) - 5, lab, 'chart-val', 'middle', fs * 0.92);
        }
        out += hit(xs[i] - band / 2, y0, band, y1 - y0, ' data-i="' + i + '"');
      });
    } else {
      // 折れ線・面。値の無い項目では線を切る
      d.series.forEach((s, k) => {
        let dd = '', seg = [];
        const segs = [];
        s.values.forEach((v, i) => { if (v == null) { if (seg.length) segs.push(seg); seg = []; } else seg.push([xs[i], Y(v)]); });
        if (seg.length) segs.push(seg);
        for (const g of segs) {
          dd += g.map((p, j) => (j ? 'L' : 'M') + r1(p[0]) + ',' + r1(p[1])).join('');
          if (kind === 'area' && g.length > 1) out += '<path class="chart-area" fill="' + color(k) + '" d="M' + r1(g[0][0]) + ',' + r1(yZero) + g.map(p => 'L' + r1(p[0]) + ',' + r1(p[1])).join('') + 'L' + r1(g[g.length - 1][0]) + ',' + r1(yZero) + 'Z"/>';
        }
        out += '<path class="chart-line" stroke="' + color(k) + '" d="' + dd + '"/>';
        s.values.forEach((v, i) => {
          if (v == null || (N > 24 && i !== s.values.length - 1)) return;
          out += '<circle class="chart-dot" fill="' + color(k) + '" cx="' + r1(xs[i]) + '" cy="' + r1(Y(v)) + '" r="4"/>';
        });
      });
      // 線の端の名前（2〜4 系列で、端どうしが離れているときだけ）。1 系列なら最後の値
      const lastOf = s => { for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) return i; return -1; };
      if (ends) {
        const pos = d.series.map((s, k) => ({ k, i: lastOf(s), name: s.name })).filter(p => p.i >= 0).map(p => ({ ...p, y: Y(d.series[p.k].values[p.i]) })).sort((a, b) => a.y - b.y);
        if (pos.every((p, j) => !j || p.y - pos[j - 1].y >= fs + 2)) pos.forEach(p => { out += text(xs[p.i] + 8, p.y + fs * 0.35, trunc(p.name, padR - 10, fs), 'chart-end', 'start', fs); });
      } else if (S === 1) {
        const i = lastOf(d.series[0]);
        if (i >= 0) out += text(xs[i], Y(d.series[0].values[i]) - 9, full(d.series[0].values[i], d.unit), 'chart-val', 'middle', fs * 0.92);
      }
      out += '<line class="chart-cross" x1="0" x2="0" y1="' + r1(y0) + '" y2="' + r1(y1) + '" visibility="hidden"/>';
      out += hit(x0, y0, x1 - x0, y1 - y0, ' data-xs="' + xs.map(r1).join(',') + '" tabindex="0"');
    }
    return { H, body: out };
  }
  /* 横棒 */
  function horizontal(d, W, fs) {
    const S = d.series.length, N = d.cats.length;
    const bw = S === 1 ? 18 : Math.max(6, Math.min(14, 44 / S)), gh = bw * S + 2 * (S - 1), rowH = Math.max(gh + 12, fs * 2);
    const vals = d.series.flatMap(s => s.values.filter(v => v != null));
    if (!vals.length) return { H: 40, body: '' };
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    if (d.min != null && !isNaN(d.min)) lo = d.min;
    if (d.max != null && !isNaN(d.max)) hi = d.max;
    const catW = Math.min(W * 0.35, Math.max(...d.cats.map(c => tw(c, fs)))) + 16;
    const valW = S === 1 ? Math.max(...vals.map(v => tw(full(v, d.unit), fs * 0.92))) + 10 : 10;
    const x0 = catW, x1 = W - valW;
    const sc = nice(lo, hi, Math.max(2, Math.min(6, Math.floor((x1 - x0) / 90))), vals.every(Number.isInteger));
    const padT = 4, H = Math.round(padT + N * rowH + fs + 12), yB = padT + N * rowH;
    const X = v => x0 + (Math.max(sc.lo, Math.min(sc.hi, v)) - sc.lo) / (sc.hi - sc.lo) * (x1 - x0);
    const xZero = X(Math.max(sc.lo, Math.min(sc.hi, 0)));
    let out = '';
    sc.ticks.forEach(t => {
      const xx = r1(X(t));
      out += '<line class="chart-grid" x1="' + xx + '" x2="' + xx + '" y1="' + padT + '" y2="' + r1(yB) + '"/>' + text(X(t), yB + fs + 6, tick(t), 'chart-tick', 'middle', fs);
    });
    out += '<line class="chart-axis" x1="' + r1(xZero) + '" x2="' + r1(xZero) + '" y1="' + padT + '" y2="' + r1(yB) + '"/>';
    d.cats.forEach((c, i) => {
      const top = padT + i * rowH, gy = top + (rowH - gh) / 2;
      out += text(x0 - 10, top + rowH / 2 + fs * 0.35, trunc(c, catW - 14, fs), 'chart-cat', 'end', fs);
      d.series.forEach((s, k) => {
        const v = s.values[i];
        if (v == null) return;
        const y = gy + k * (bw + 2), xv = X(v), left = Math.min(xv, xZero), w = Math.abs(xv - xZero);
        out += '<path class="chart-mark" fill="' + color(k) + '" d="' + hbar(left, y, w, bw, v >= 0) + '"/>';
        if (S === 1) out += v >= 0 ? text(left + w + 6, y + bw / 2 + fs * 0.33, full(v, d.unit), 'chart-val', 'start', fs * 0.92) : text(left - 6, y + bw / 2 + fs * 0.33, full(v, d.unit), 'chart-val', 'end', fs * 0.92);
        out += hit(x0, y - 1, x1 - x0, bw + 2, ' data-i="' + i + '" data-s="' + k + '"');
      });
    });
    return { H, body: out };
  }
  /* 構成比（1 本の帯を項目で分ける。系列ごとに 1 本） */
  function share(d, W, fs) {
    const S = d.series.length, barH = 28, gapY = 12;
    const labW = S > 1 ? Math.min(W * 0.3, Math.max(...d.series.map(s => tw(s.name, fs)))) + 12 : 0;
    const H = S * (barH + gapY) - gapY + 4;
    let out = '';
    d.series.forEach((s, k) => {
      const vals = s.values.map(v => Math.max(0, v || 0)), total = vals.reduce((a, v) => a + v, 0);
      const y = k * (barH + gapY) + 2;
      if (S > 1) out += text(labW - 10, y + barH / 2 + fs * 0.35, trunc(s.name, labW - 14, fs), 'chart-cat', 'end', fs);
      if (!total) return;
      const span = W - labW;
      let x = labW;
      const shown = vals.map((v, i) => [v, i]).filter(([v]) => v > 0);
      shown.forEach(([v, i], j) => {
        const w = span * v / total, bw = j < shown.length - 1 ? w - 2 : w;
        if (bw > 0.5) out += '<rect class="chart-mark" fill="' + color(i) + '" x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(bw) + '" height="' + barH + '" rx="' + Math.min(4, bw / 2) + '"/>';
        const pct = Math.round(v / total * 1000) / 10 + '%';
        if (tw(pct, fs) + 12 <= bw) out += text(x + 6, y + barH / 2 + fs * 0.35, pct, 'chart-in', 'start', fs, ' style="fill:' + onColor(i) + '"');
        out += hit(x, y - 3, Math.max(2, w), barH + 6, ' data-i="' + i + '" data-s="' + k + '"');
        x += w;
      });
    });
    return { H, body: out };
  }
  function svg(d, W, fs) {
    W = Math.max(200, Math.round(W));
    const r = d.type === 'barh' ? horizontal(d, W, fs) : d.type === 'share' ? share(d, W, fs) : vertical(d, W, fs);
    const label = (d.label ? d.label + '（' : '（') + 'グラフ。値はデータのタブにあります）';
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + r.H + '" width="' + W + '" height="' + r.H + '" role="img" aria-label="' + escAttr(label) + '">' + r.body + '</svg>';
  }
  /* ツールチップの中身（[見出し, [[色, 値, 名前], …]]） */
  function tipRows(d, i, s) {
    if (d.type === 'share') {
      const vals = d.series[s].values, total = vals.reduce((a, v) => a + Math.max(0, v || 0), 0);
      const v = vals[i] || 0;
      return [d.cats[i] + (d.series.length > 1 ? '（' + d.series[s].name + '）' : ''), [[color(i), full(v, d.unit) + '・' + (total ? Math.round(v / total * 1000) / 10 : 0) + '%', '']]];
    }
    const rows = (s != null ? [s] : d.series.map((_, k) => k)).map(k => [color(k), full(d.series[k].values[i], d.unit), d.series.length > 1 ? d.series[k].name : '']);
    if (d.type === 'stacked' && s == null && d.series.length > 1) rows.push(['', full(d.series.reduce((a, x) => a + Math.max(0, x.values[i] || 0), 0), d.unit), '合計']);
    return [d.cats[i], rows];
  }
  return { TYPES, data, legend, note, svg, tipRows };
})();

function createParser(opts = {}) {
  const slots = [];
  const usedIds = new Set(opts.reserved || []);
  const fnDefs = new Map();
  const fnOrder = [];
  const linkDefs = new Map();
  // 用語の意味（*[略語]: 意味 と :::glossary の項目）。本文中の用語に、意味を添える
  const abbrs = new Map(), glossary = new Map();
  const sec = [0, 0];
  const figNo = { fig: 0, tbl: 0 };
  let tabSeq = 0;

  const hold = html => '\u0000' + (slots.push(html) - 1) + '\u0000';
  const indentOf = l => l.match(/^ */)[0].length;

  function uniqueId(base) {
    base = base || 'section';
    let id = base, n = 1;
    while (usedIds.has(id)) id = base + '-' + (++n);
    usedIds.add(id);
    return id;
  }
  const slugify = t => t.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-').slice(0, 80);

  function cleanRawStyle(raw) {
    // HTML の文字参照を CSS の一部として解釈させない
    if (raw.includes('&')) return '';
    const probe = document.createElement('span');
    probe.style.cssText = raw;
    const out = [];
    const decls = [];
    let start = 0, quote = '', escaped = false, depth = 0;
    const css = probe.style.cssText;
    for (let i = 0; i < css.length; i++) {
      const ch = css[i];
      if (escaped) { escaped = false; continue; }
      if (quote) {
        if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && depth) depth--;
      else if (ch === ';' && depth === 0) { decls.push(css.slice(start, i)); start = i + 1; }
    }
    decls.push(css.slice(start));
    const parsed = [];
    for (const decl of decls) {
      const colon = decl.indexOf(':');
      if (colon < 1) continue;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      const value = decl.slice(colon + 1).trim().replace(/\s*!important\s*$/i, '');
      const compact = value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
      if (!value || value.includes('\\') || /@import|expression\(|behavior:|-moz-binding|javascript:|vbscript:/i.test(compact)
          || /(?:url|src|image|image-set|cross-fade|element|paint|attr)\s*\(/i.test(value)) continue;
      parsed.push({ prop, value, vars: [...value.matchAll(/var\(\s*(--[a-z0-9_-]+)/gi)].map(m => m[1].toLowerCase()) });
    }
    // 安全な値を持つ独自変数だけを、既定の色変数と同じように参照できるようにする
    const custom = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      for (const d of parsed) {
        if (!/^--[a-z0-9_-]+$/i.test(d.prop) || custom.has(d.prop)) continue;
        if (d.vars.every(v => RAW_CSS_VARS.has(v) || custom.has(v))) { custom.add(d.prop); changed = true; }
      }
    }
    for (const { prop, value, vars } of parsed) {
      if (!RAW_CSS_PROPS.has(prop) && !custom.has(prop)) continue;
      if (vars.some(v => !RAW_CSS_VARS.has(v) && !custom.has(v))) continue;
      out.push(prop + ':' + value);
    }
    return out.join(';');
  }

  function decodeRawRefs(raw) {
    const named = { colon: ':', sol: '/', bsol: '\\', tab: '\t', newline: '\n', lpar: '(', rpar: ')', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    return String(raw)
      .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (all, hex, dec) => {
        const n = parseInt(hex || dec, hex ? 16 : 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\uFFFD';
      })
      .replace(/&(colon|sol|bsol|tab|newline|lpar|rpar|amp|quot|apos|lt|gt);?/gi, (all, name) => named[name.toLowerCase()]);
  }

  function cleanRawUrl(raw, kind) {
    const value = decodeRawRefs(raw).trim();
    const compact = value.replace(/[\s\u0000-\u001f\u007f]+/g, '');
    if (!value || !compact || /^[\\/]{2}/.test(compact)) return null;
    if (kind === 'svg') return /^#[A-Za-z_][\w:.-]*$/.test(compact) ? compact : null;
    const m = compact.match(/^([A-Za-z][\w+.-]*):/);
    if (kind === 'img') {
      if (/^data:/i.test(compact)) return /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp|svg\+xml)(?:[;,]|$)/i.test(compact) ? value : null;
      if (m && !/^(?:https?|blob)$/i.test(m[1])) return null;
      return value;
    }
    if (m && !/^(?:https?|mailto|tel)$/i.test(m[1])) return null;
    return value;
  }

  function cleanRawSvgValue(raw) {
    const value = decodeRawRefs(raw).trim();
    if (!value || value.includes('&') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value) || /(?:javascript|vbscript|data|https?):/i.test(value)) return null;
    const urls = [...value.matchAll(/url\(([^)]*)\)/gi)];
    if (urls.some(m => !/^\s*['"]?#[A-Za-z_][\w:.-]*['"]?\s*$/.test(m[1]))) return null;
    return value;
  }

  function rawTagInfo(token) {
    const m = token.match(/^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)/);
    return m ? { close: !!m[1], tag: m[2].toLowerCase(), head: m[0].length, self: /\/\s*>$/.test(token) } : null;
  }

  function rawAttributes(token, info) {
    let text = token.slice(info.head).replace(/\/?\s*>$/, '').trim();
    if (!text) return [];
    const out = [], seen = new Set();
    let pos = 0;
    while (pos < text.length) {
      const ws = text.slice(pos).match(/^\s+/);
      if (ws) pos += ws[0].length;
      if (pos >= text.length) break;
      RAW_ATTR_TOKEN.lastIndex = pos;
      const m = RAW_ATTR_TOKEN.exec(text);
      if (!m) return [];
      const name = m[1].toLowerCase();
      if (!seen.has(name)) {
        seen.add(name);
        out.push([name, m[2] ?? m[3] ?? m[4] ?? '']);
      }
      pos = RAW_ATTR_TOKEN.lastIndex;
    }
    return out;
  }

  function sanitizeRawTag(token) {
    const info = rawTagInfo(token);
    if (!info || (!RAW_HTML_TAGS.has(info.tag) && !RAW_SVG_TAGS.has(info.tag))) return '';
    const tagName = RAW_SVG_NAMES[info.tag] || info.tag;
    if (info.close) return RAW_VOID_TAGS.has(info.tag) ? '' : '</' + tagName + '>';
    const attrs = rawAttributes(token, info);
    const out = [];
    let target = '', href = false;
    for (const [name, raw] of attrs) {
      if (/^on/i.test(name) || /^data-/i.test(name) || name === 'name' || name === 'is' || name === 'srcdoc'
          || name === 'action' || name === 'formaction' || name === 'xlink:href') continue;
      let value = raw, outName = name, preserveRefs = true;
      if (name === 'id') {
        value = value.trim();
        if (!/^[A-Za-z_][\w:.-]*$/.test(value) || /^ui-/i.test(value) || usedIds.has(value)) continue;
        usedIds.add(value);
      } else if (name === 'style') {
        value = cleanRawStyle(value);
        if (!value) continue;
        preserveRefs = false;
      } else if (name === 'class') {
        if (value.includes('&')) continue;
        value = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().replace(/\s+/g, ' ');
        value = value.split(' ').filter(c => RAW_SAFE_CLASSES.has(c)
          || (/^c-[\p{L}\p{N}_-]+$/u.test(c) && !RAW_DENIED_C_CLASSES.has(c))).join(' ');
        if (!value) continue;
      } else if (name === 'dir') {
        value = value.toLowerCase();
        if (!/^(?:ltr|rtl|auto)$/.test(value)) continue;
      } else if (name === 'tabindex') {
        if (value !== '0' && value !== '-1') continue;
      } else if (name === 'hidden' || (info.tag === 'details' && name === 'open') || (info.tag === 'ol' && name === 'reversed')) {
        out.push(' ' + name);
        continue;
      } else if (name.startsWith('aria-') || ['title', 'lang', 'role'].includes(name)) {
        // 文字列としてだけ使う属性
      } else if (info.tag === 'a' && name === 'href') {
        value = cleanRawUrl(value, 'href');
        if (value == null) continue;
        href = true;
        preserveRefs = false;
      } else if (info.tag === 'a' && name === 'target') {
        value = value.toLowerCase();
        if (value !== '_blank' && value !== '_self') continue;
        target = value;
        continue;
      } else if (info.tag === 'a' && name === 'rel') {
        continue;
      } else if (info.tag === 'img' && name === 'src') {
        value = cleanRawUrl(value, 'img');
        if (value == null) continue;
        preserveRefs = false;
      } else if ((info.tag === 'blockquote' || info.tag === 'q') && name === 'cite') {
        value = cleanRawUrl(value, 'href');
        if (value == null) continue;
        preserveRefs = false;
      } else if (info.tag === 'img' && name === 'loading') {
        value = value.toLowerCase();
        if (value !== 'lazy' && value !== 'eager') continue;
      } else if (info.tag === 'img' && name === 'decoding') {
        value = value.toLowerCase();
        if (!/^(?:sync|async|auto)$/.test(value)) continue;
      } else if (RAW_SVG_ATTRS.has(name)) {
        if (name === 'xmlns') {
          if (value !== 'http://www.w3.org/2000/svg') continue;
        } else {
          value = cleanRawSvgValue(value);
          if (value == null) continue;
        }
        outName = RAW_SVG_ATTR_NAMES[name] || name;
        preserveRefs = false;
      } else if (!(RAW_TAG_ATTRS[info.tag] && RAW_TAG_ATTRS[info.tag].has(name)) && !RAW_GLOBAL_ATTRS.has(name)) {
        continue;
      }
      const encoded = preserveRefs
        ? String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        : escAttr(value);
      out.push(' ' + outName + '="' + encoded + '"');
    }
    if (info.tag === 'a' && href && target) {
      out.push(' target="' + target + '"');
      if (target === '_blank') out.push(' rel="noopener noreferrer"');
    }
    const open = '<' + tagName + out.join('') + '>';
    if (RAW_VOID_TAGS.has(info.tag)) return open;
    return info.self ? open + '</' + tagName + '>' : open;
  }

  function sanitizeRawHtml(raw, protect = false) {
    let out = '', last = 0, blocked = '', depth = 0, m;
    RAW_HTML_TOKEN.lastIndex = 0;
    while ((m = RAW_HTML_TOKEN.exec(raw))) {
      if (!blocked) out += protect ? raw.slice(last, m.index) : raw.slice(last, m.index).replace(/</g, '&lt;');
      const token = m[0], info = token.startsWith('<!--') ? null : rawTagInfo(token);
      if (blocked) {
        if (info && info.tag === blocked) {
          if (!info.close && !info.self) depth++;
          else if (info.close && --depth === 0) blocked = '';
        }
      } else if (info && !info.close && !info.self && RAW_DROP_CONTENT.has(info.tag)) {
        blocked = info.tag;
        depth = 1;
      } else if (info) {
        const clean = sanitizeRawTag(token);
        if (clean) out += protect ? hold(clean) : clean;
      }
      last = RAW_HTML_TOKEN.lastIndex;
    }
    if (!blocked) out += protect ? raw.slice(last) : raw.slice(last).replace(/</g, '&lt;');
    return out;
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  }
  function isTableStart(lines, i) {
    const a = lines[i], b = lines[i + 1];
    if (b == null || !a.includes('|') || !b.includes('|')) return false;
    const d = splitRow(b);
    return d.every(c => /^:?-+:?$/.test(c)) && splitRow(a).length === d.length;
  }
  function isFence(line) {
    const m = line.match(RX.fence);
    return !!m && !(m[2][0] === '`' && m[3].includes('`'));
  }
  function isListStart(line, interrupting) {
    const m = line.match(RX.list);
    if (!m) return false;
    if (!interrupting) return true;
    return !!(m[4] && m[4].trim()) && (/^[-*+]$/.test(m[2]) || /^1[.)]$/.test(m[2]));
  }
  function startsBlock(lines, i) {
    const l = lines[i];
    return RX.blank.test(l) || isFence(l) || RX.heading.test(l) || RX.hr.test(l) || RX.quote.test(l)
      || RX.html.test(l) || RX.fnDef.test(l) || RX.linkDef.test(l) || RX.abbrDef.test(l) || RX.container.test(l) || isListStart(l, true) || isTableStart(lines, i);
  }

  function parseBlocks(lines, ctx = {}) {
    const out = [];
    let i = 0, m;
    while (i < lines.length) {
      const line = lines[i];
      if (RX.blank.test(line)) { i++; continue; }
      // 参照形式の定義は parse() の最初にまとめて読んであるので、本文には出さない
      if (RX.linkDef.test(line) || RX.abbrDef.test(line)) { i++; continue; }

      if (isFence(line)) {
        m = line.match(RX.fence);
        const close = new RegExp('^ {0,3}' + (m[2][0] === '`' ? '`' : '~') + '{' + m[2].length + ',}[ \\t]*$');
        const strip = new RegExp('^ {0,' + m[1].length + '}');
        const body = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) body.push(lines[i++].replace(strip, ''));
        i++;
        out.push(renderCode(body.join('\n'), m[3].trim()));
        continue;
      }
      if ((m = line.match(RX.container)) && m[2]) {
        // ::: 名前 … ::: の囲み。入れ子は「名前付きの ::: で開き、名前のない ::: で閉じる」の対応で数える
        const body = [], inFence = fenceTracker();
        let depth = 1;
        i++;
        while (i < lines.length) {
          const l = lines[i++];
          if (!inFence(l)) {
            const c = l.match(RX.container);
            if (c) { if (c[2]) depth++; else if (--depth === 0) break; }
          }
          body.push(l);
        }
        out.push(renderContainer(m[2], body));
        continue;
      }
      if ((m = line.match(RX.heading))) { out.push(renderHeading(m[1].length, (m[2] || '').trim(), ctx.top)); i++; continue; }
      if (RX.hr.test(line)) { out.push('<hr>'); i++; continue; }
      if (RX.quote.test(line)) {
        const q = [];
        while (i < lines.length) {
          const l = lines[i];
          if (RX.quote.test(l)) { q.push(l.replace(RX.quote, '')); i++; }
          else if (q.length && !RX.blank.test(q[q.length - 1]) && !startsBlock(lines, i)) { q.push(l); i++; }
          else break;
        }
        out.push(renderQuote(q));
        continue;
      }
      if (isTableStart(lines, i)) {
        const head = splitRow(lines[i]);
        const aligns = splitRow(lines[i + 1]).map(c => (c.startsWith(':') && c.endsWith(':')) ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && !RX.blank.test(lines[i]) && !RX.quote.test(lines[i]) && !isFence(lines[i])) rows.push(splitRow(lines[i++]));
        out.push(renderTable(head, aligns, rows));
        continue;
      }
      if ((m = line.match(RX.fnDef))) {
        const id = m[1], parts = [m[2]];
        i++;
        while (i < lines.length && !RX.blank.test(lines[i]) && !RX.fnDef.test(lines[i]) && (/^ {2,}/.test(lines[i]) || !startsBlock(lines, i))) parts.push(lines[i++].trim());
        if (!fnDefs.has(id)) fnDefs.set(id, parts.join('\n'));
        continue;
      }
      if (RX.html.test(line)) {
        const dm = line.match(/^ {0,3}<[!]--\s*(pagebreak|slide)\s*-->\s*$/i);
        if (dm) {
          out.push('<div class="pagebreak" data-kind="' + (dm[1].toLowerCase() === 'slide' ? 'slide' : 'page') + '" aria-hidden="true"></div>');
          i++;
          continue;
        }
        const block = [];
        let end = null;
        if (/^ {0,3}<[!]--/.test(line)) end = l => l.includes('-->');
        else {
          const t = line.match(/^ {0,3}<(pre|style|[s]cript|textarea)\b/i);
          if (t) { const re = new RegExp('<\\/' + t[1] + '>', 'i'); end = l => re.test(l); }
        }
        if (end) { while (i < lines.length) { const l = lines[i++]; block.push(l); if (end(l)) break; } }
        else { while (i < lines.length && !RX.blank.test(lines[i])) block.push(lines[i++]); }
        out.push(sanitizeRawHtml(block.join('\n')));
        continue;
      }
      if (isListStart(line, false)) { const r = parseList(lines, i); out.push(r.html); i = r.next; continue; }

      const para = [line];
      i++;
      while (i < lines.length && !startsBlock(lines, i)) para.push(lines[i++]);
      out.push(renderParagraph(para, ctx.tight));
    }
    return out.join('\n');
  }

  function hasInnerBlank(item) {
    const inFence = fenceTracker();
    return item.some(l => !inFence(l) && l === '');
  }

  function parseList(lines, i) {
    const first = lines[i].match(RX.list);
    const base = first[1].length;
    const ordered = /\d/.test(first[2]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let loose = false;
    while (i < lines.length) {
      const m = lines[i].match(RX.list);
      if (!m || m[1].length < base || m[1].length > base + 1 || /\d/.test(m[2]) !== ordered || RX.hr.test(lines[i])) break;
      const sp = m[3] ? m[3].replace(/\t/g, '    ').length : 1;
      let shift = m[1].length + m[2].length + (sp > 4 ? 1 : sp);
      const item = [m[4] || ''];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (RX.blank.test(l)) { item.push(''); i++; continue; }
        const ind = indentOf(l);
        if (ind >= shift) { item.push(l.slice(shift)); i++; continue; }
        if (RX.list.test(l) && !RX.hr.test(l)) {
          if (ind >= base + 2) { shift = ind; item.push(l.slice(ind)); i++; continue; }
          break;
        }
        if (item[item.length - 1] !== '' && !startsBlock(lines, i)) { item.push(l.trim()); i++; continue; }
        break;
      }
      let trailing = false;
      while (item.length > 1 && item[item.length - 1] === '') { item.pop(); trailing = true; }
      if (hasInnerBlank(item)) loose = true;
      items.push(item);
      if (trailing && i < lines.length) {
        const nm = lines[i].match(RX.list);
        if (nm && nm[1].length >= base && nm[1].length <= base + 1 && /\d/.test(nm[2]) === ordered) loose = true;
      }
    }
    const tag = ordered ? 'ol' : 'ul';
    const lis = items.map(item => {
      const tm = item[0].match(/^\[([ xX])\][ \t]+/);
      let pre = '', cls = '';
      if (tm) {
        const done = tm[1] !== ' ';
        cls = ' class="task"';
        pre = '<input type="checkbox" disabled' + (done ? ' checked' : '') + ' aria-label="' + (done ? '完了' : '未完了') + '">';
        item[0] = item[0].slice(tm[0].length);
      }
      return '<li' + cls + '>' + pre + parseBlocks(item, { tight: !loose }) + '</li>';
    });
    return { html: '<' + tag + (ordered && start !== 1 ? ' start="' + start + '"' : '') + '>\n' + lis.join('\n') + '\n</' + tag + '>', next: i };
  }

  /* 画像だけの段落（1 枚、またはライト用とダーク用の 2 枚）なら、表題にする代替テキストを返す（無ければ空文字）。図にしない段落は null */
  function figureCaption(text) {
    const imgs = [];
    const rest = text.replace(/!\[([^\]]*)\](?:\(\s*((?:[^\s()]|\([^\s()]*\))*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)|\[([^\]]*)\])?/g, (a, alt, url, ref) => {
      const u = url != null ? url : (linkDefs.get(refKey(ref || alt)) || {}).url;
      if (u == null) return a;
      imgs.push({ alt, mode: (u.match(/#gh-(light|dark)-mode-only$/i) || [])[1] });
      return '';
    });
    if (rest.trim() || !imgs.length || imgs.length > 2) return null;
    if (imgs.length === 2 && imgs.map(x => (x.mode || '').toLowerCase()).sort().join() !== 'dark,light') return null;
    return imgs.map(x => x.alt).find(Boolean) || '';
  }
  /* 画像の HTML。URL の末尾の #gh-light-mode-only / #gh-dark-mode-only は、テーマで出し分けるクラスにする */
  function imgHtml(url, alt, title) {
    let u = String(url).trim(), cls = '';
    const t = u.match(/#gh-(light|dark)-mode-only$/i);
    if (t) { cls = 'img-' + t[1].toLowerCase(); u = u.slice(0, -t[0].length); }
    return '<img src="' + escAttr(safeUrl(u, true)) + '" alt="' + escAttr(stripTags(alt.replace(/\u0000\d+\u0000/g, ''))) + '"'
      + (title ? ' title="' + escAttr(title) + '"' : '') + (cls ? ' class="' + cls + '"' : '') + '>';
  }

  function renderParagraph(lines, tight) {
    const text = lines.map((l, k) => k ? l.replace(/^[ \t]+/, '') : l.replace(/^ {0,3}/, '')).join('\n').replace(/[ \t]+$/, '');
    const cap = tight ? null : figureCaption(text);
    if (cap != null) return '<figure>' + parseInline(text) + (cap ? '<figcaption>' + parseInline(cap) + '</figcaption>' : '') + '</figure>';
    const html = parseInline(text);
    return tight ? html : '<p>' + html + '</p>';
  }

  /* 末尾の {#id .class -} を取り出す（見出しと囲みで共通） */
  function takeAttrs(text, anywhere = false) {
    const res = { text, id: '', classes: [], unnumbered: false };
    const am = text.match(anywhere ? /[ \t]*\{([^{}]*)\}/ : /[ \t]*\{([^{}]*)\}[ \t]*$/);
    if (!am) return res;
    const tokens = am[1].trim().split(/\s+/);
    if (!tokens.every(t => /^(#[^\s#.]+|\.[\w-]+|-)$/.test(t))) return res;
    for (const t of tokens) {
      if (t === '-' || t === '.unnumbered') res.unnumbered = true;
      else if (t[0] === '#') res.id = t.slice(1);
      else res.classes.push(t.slice(1));
    }
    res.text = text.slice(0, am.index) + (anywhere ? ' ' + text.slice(am.index + am[0].length) : '');
    return res;
  }

  function renderHeading(level, raw, top) {
    const at = takeAttrs(raw);
    const text = at.text, unnumbered = at.unnumbered, classes = at.classes;
    const inner = parseInline(text);
    const id = uniqueId(at.id || slugify(stripTags(inner)));
    let no = '';
    if (opts.numbering && top && !unnumbered && (level === 2 || level === 3)) {
      if (level === 2) { sec[0]++; sec[1] = 0; no = sec[0] + '.'; }
      else { sec[1]++; no = sec[0] ? sec[0] + '.' + sec[1] : String(sec[1]); }
    }
    const secno = no ? '<span class="secno">' + no + '</span>' : '';
    const anchor = level >= 2 && level <= 4 ? '<a class="anchor" href="#' + escAttr(id) + '" aria-label="この見出しへのリンク">#</a>' : '';
    const cls = classes.length ? ' class="' + escAttr(classes.join(' ')) + '"' : '';
    return '<h' + level + ' id="' + escAttr(id) + '"' + cls + '>' + secno + inner + anchor + '</h' + level + '>';
  }

  /* ----- 囲み（::: 名前）の部品 ----- */
  function frag(html) { const t = document.createElement('template'); t.innerHTML = safeRenderedHtml(html); return t.content; }
  function htmlOf(nodes) { const d = document.createElement('div'); d.append(...nodes); return d.innerHTML; }
  const firstList = f => Array.from(f.children).find(e => e.tagName === 'UL' || e.tagName === 'OL');
  function headInner(h) { const c = h.cloneNode(true); $$('.anchor', c).forEach(x => x.remove()); return c.innerHTML.trim(); }

  /* --- か見出しで区切って、パネルの配列にする（入れ子の囲みとフェンスの中は見ない） */
  function splitPanels(lines) {
    const scan = fn => {
      const inFence = fenceTracker();
      let depth = 0;
      lines.forEach((l, k) => {
        if (inFence(l)) return;
        const c = l.match(RX.container);
        if (c) { depth += c[2] ? 1 : -1; return; }
        if (depth === 0) fn(l, k);
      });
    };
    let cuts = [];
    scan((l, k) => { if (RX.hr.test(l)) cuts.push({ k, drop: true }); });
    if (!cuts.length) {
      const hs = [];
      scan((l, k) => { const m = l.match(RX.heading); if (m) hs.push({ k, level: m[1].length }); });
      if (hs.length) {
        const min = Math.min(...hs.map(h => h.level));
        cuts = hs.filter(h => h.level === min && h.k > 0).map(h => ({ k: h.k, drop: false }));
      }
    }
    const panels = [];
    let start = 0;
    for (const c of cuts) { panels.push(lines.slice(start, c.k)); start = c.drop ? c.k + 1 : c.k; }
    panels.push(lines.slice(start));
    return panels.filter(p => p.some(l => l.trim()));
  }
  /* パネルの先頭の見出しをタイトルとして取り出す。見出しに {.best} があれば推奨扱い */
  function panel(lines) {
    const f = frag(parseBlocks(lines, {}));
    const first = f.firstElementChild;
    let title = '', best = false;
    if (first && /^H[1-6]$/.test(first.tagName)) {
      title = headInner(first);
      best = first.classList.contains('best') || first.classList.contains('recommend');
      first.remove();
    }
    return { title, best, body: htmlOf(Array.from(f.childNodes)).trim() };
  }
  /* リスト項目の先頭の太字を「項目名」にする。直後の「：」は取り除く */
  function titleize(li) {
    let host = li;
    const fe = li.firstElementChild;
    if (fe && fe.tagName === 'P' && !(li.firstChild.nodeType === 3 && li.firstChild.textContent.trim())) host = fe;
    let n = host.firstChild;
    while (n && n.nodeType === 3 && !n.textContent.trim()) n = n.nextSibling;
    if (!n || n.nodeType !== 1 || n.tagName !== 'STRONG') return null;
    n.classList.add('item-title');
    const next = n.nextSibling;
    if (next && next.nodeType === 3) next.textContent = next.textContent.replace(/^\s*[:：]\s*/, '');
    return n;
  }
  /* 項目を「見出し部分」と「本文」に分ける。太字が無ければ、最初の「：」の前を見出しにする */
  function splitHead(li, colon) {
    let head = '';
    const t = titleize(li);
    if (t) {
      head = t.innerHTML;
      const p = t.parentNode;
      t.remove();
      if (p !== li && !p.textContent.trim() && !p.children.length) p.remove();
    } else if (colon) {
      const n = li.firstChild;
      if (n && n.nodeType === 3) {
        const m = n.textContent.match(/^\s*([^：:\n]+?)\s*[:：]\s*/);
        if (m) { head = escHtml(m[1]); n.textContent = n.textContent.slice(m[0].length); }
      }
    }
    return { head, body: li.innerHTML.trim() };
  }
  function listOf(lines) {
    const f = frag(parseBlocks(lines, {}));
    return { f, list: firstList(f) };
  }

  /* タブの見出しの列と中身（最初のタブを選んだ状態）。labels は HTML */
  function tabsHtml(labels, bodies) {
    const gid = uniqueId('tabs-' + (++tabSeq));
    return '<div class="tab-list" role="tablist">' + labels.map((l, k) => '<button type="button" class="tab" role="tab" id="' + gid + '-t' + k + '" aria-controls="' + gid + '-p' + k + '" aria-selected="' + (k === 0) + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>'
      + bodies.map((b, k) => '<div class="tab-panel' + (k === 0 ? ' is-active' : '') + '" role="tabpanel" id="' + gid + '-p' + k + '" aria-labelledby="' + gid + '-t' + k + '" data-label="' + escAttr(stripTags(labels[k])) + '">' + b + '</div>').join('');
  }

  function renderContainer(info, lines) {
    const at = takeAttrs(info, true);
    const nm = at.text.trim().match(/^([A-Za-z][\w-]*)?\s*(.*)$/) || [];
    let name = (nm[1] || '').toLowerCase(), arg = (nm[2] || '').trim();
    if (at.id) usedIds.add(at.id);
    const extraCls = at.classes.length ? ' ' + escAttr(at.classes.join(' ')) : '';
    const open = (tag, cls, attrs = '') => '<' + tag + ' class="c-block ' + cls + extraCls + '"' + (at.id ? ' id="' + escAttr(at.id) + '"' : '') + attrs + '>';
    const title = arg ? '<p class="c-title">' + parseInline(arg) + '</p>' : '';
    const blocks = () => parseBlocks(lines, {});

    if (name === 'message') { name = /^alert\b/i.test(arg) ? 'warning' : 'note'; arg = arg.replace(/^alert\b\s*/i, ''); }
    if (ALERTS[name]) {
      const [label, type] = ALERTS[name];
      return open('div', 'alert alert-' + type, ' role="note"') + '<p class="alert-title">' + ALERT_ICONS[type] + '<span>' + (arg ? parseInline(arg) : label) + '</span></p>' + blocks() + '</div>';
    }
    switch (name) {
      case 'steps':
      case 'flow': {
        const { f, list } = listOf(lines);
        if (list) { list.classList.add('c-items'); Array.from(list.children).forEach(titleize); }
        return open('div', 'c-' + name, name === 'steps' ? ' data-split="items"' : '') + title + htmlOf(Array.from(f.childNodes)) + '</div>';
      }
      case 'timeline': {
        const { f, list } = listOf(lines);
        if (list) {
          list.classList.add('c-items');
          for (const li of Array.from(list.children)) {
            const { head, body } = splitHead(li, true);
            li.innerHTML = '<div class="tl-when">' + head + '</div><div class="tl-what">' + body + '</div>';
          }
        }
        return open('div', 'c-timeline', ' data-split="items"') + title + htmlOf(Array.from(f.childNodes)) + '</div>';
      }
      case 'cards': {
        const panels = splitPanels(lines);
        let cards;
        if (panels.length > 1 || (panels[0] && RX.heading.test(panels[0].find(l => l.trim()) || ''))) {
          cards = panels.map(panel).map(x => '<div class="card' + (x.best ? ' is-best' : '') + '">' + (x.title ? '<p class="card-title">' + x.title + '</p>' : '') + x.body + '</div>');
        } else {
          const { f, list } = listOf(lines);
          cards = list
            ? Array.from(list.children).map(li => { titleize(li); return '<div class="card">' + li.innerHTML + '</div>'; })
            : ['<div class="card">' + htmlOf(Array.from(f.childNodes)) + '</div>'];
        }
        return open('div', 'c-cards', ' data-split="items"') + title + '<div class="c-items">' + cards.join('') + '</div></div>';
      }
      case 'columns': {
        const ratio = /^\d+(?:\s*:\s*\d+)+$/.test(arg) ? arg.split(':').map(x => x.trim() + 'fr').join(' ') : '';
        const cols = splitPanels(lines).map(p => '<div class="col">' + parseBlocks(p, {}) + '</div>');
        return open('div', 'c-columns') + (ratio ? '' : title)
          + '<div class="c-panels" style="--n:' + Math.max(1, cols.length) + (ratio ? ';grid-template-columns:' + ratio : '') + '">' + cols.join('') + '</div></div>';
      }
      case 'compare': {
        const ps = splitPanels(lines).map(panel);
        return open('div', 'c-compare') + title + '<div class="c-panels" style="--n:' + Math.max(1, ps.length) + '">'
          + ps.map(x => '<div class="panel' + (x.best ? ' is-best' : '') + '">' + (x.title ? '<div class="panel-head">' + x.title + '</div>' : '') + '<div class="panel-body">' + x.body + '</div></div>').join('')
          + '</div></div>';
      }
      case 'pros-cons':
      case 'proscons': {
        const ps = splitPanels(lines).map(panel);
        const kinds = [['pros', 'メリット'], ['cons', 'デメリット']];
        return open('div', 'c-pros-cons') + title + '<div class="c-panels" style="--n:' + Math.max(2, ps.length) + '">'
          + ps.map((x, k) => { const d = kinds[k] || ['other', '']; return '<div class="panel ' + d[0] + '"><div class="panel-head">' + (x.title || d[1]) + '</div><div class="panel-body">' + x.body + '</div></div>'; }).join('')
          + '</div></div>';
      }
      case 'tabs': {
        const ps = splitPanels(lines).map(panel);
        return open('div', 'c-tabs') + title + tabsHtml(ps.map((x, k) => x.title || 'タブ ' + (k + 1)), ps.map(x => x.body)) + '</div>';
      }
      case 'example': {
        // 同じ Markdown から「表示」と「書き方」のタブを作る（2 か所に書かないので、見本と書き方がずれない）
        const src = lines.join('\n').replace(/^(?:[ \t]*\n)+|\s+$/g, '');
        return open('div', 'c-tabs c-example') + title + tabsHtml(['表示', '書き方'], [blocks(), renderCode(src, 'markdown')]) + '</div>';
      }
      case 'summary':
        return open('div', 'c-summary') + '<p class="c-title">' + (arg ? parseInline(arg) : '要旨') + '</p>' + blocks() + '</div>';
      case 'lead':
        return open('div', 'c-lead') + blocks() + '</div>';
      case 'metrics': {
        const { list } = listOf(lines);
        const items = list ? Array.from(list.children).map(li => {
          const { head, body } = splitHead(li, false);
          return '<div class="metric"><div class="metric-value">' + head + '</div><div class="metric-label">' + body + '</div></div>';
        }) : [];
        return open('div', 'c-metrics') + title + '<div class="c-items">' + items.join('') + '</div></div>';
      }
      case 'progress': {
        const { list } = listOf(lines);
        const rows = list ? Array.from(list.children).map(li => {
          let pct = 0;
          const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
          let last = null;
          while (walker.nextNode()) if (walker.currentNode.textContent.trim()) last = walker.currentNode;
          const m = last && last.textContent.match(/(\d+(?:\.\d+)?)\s*[%％]\s*$/);
          if (m) { pct = Math.max(0, Math.min(100, parseFloat(m[1]))); last.textContent = last.textContent.slice(0, m.index); }
          return '<div class="bar-row' + (pct >= 100 ? ' is-done' : '') + '"><div class="bar-label">' + li.innerHTML.trim() + '</div>'
            + '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div>'
            + '<div class="bar-value">' + pct + '%</div></div>';
        }) : [];
        return open('div', 'c-progress', ' data-split="items"') + title + '<div class="c-items">' + rows.join('') + '</div></div>';
      }
      case 'details':
        return open('details', 'c-details') + '<summary>' + (arg ? parseInline(arg) : '詳細') + '</summary>' + blocks() + '</details>';
      case 'qa': {
        let qas = splitPanels(lines).map(panel).filter(x => x.title).map(x => [x.title, x.body]);
        if (!qas.length) {
          const { list } = listOf(lines);
          qas = list ? Array.from(list.children).map(li => {
            const t = titleize(li);
            if (t) { const q = t.innerHTML; t.remove(); return [q, li.innerHTML.trim()]; }
            const p = li.firstElementChild && li.firstElementChild.tagName === 'P' ? li.firstElementChild : null;
            if (p) { const q = p.innerHTML; p.remove(); return [q, li.innerHTML.trim()]; }
            return [li.innerHTML.trim(), ''];
          }) : [];
        }
        return open('div', 'c-qa', ' data-split="items"') + title + '<div class="c-items">'
          + qas.map(([q, a]) => '<div class="qa"><p class="q">' + q + '</p><div class="a">' + a + '</div></div>').join('') + '</div></div>';
      }
      case 'quote':
        return open('figure', 'c-quote') + '<blockquote>' + blocks() + '</blockquote>' + (arg ? '<figcaption>出典：' + parseInline(arg) + '</figcaption>' : '') + '</figure>';
      case 'figure':
        return open('figure', 'c-figure') + blocks() + '<figcaption><span class="fig-no">図 ' + (++figNo.fig) + '</span>' + (arg ? parseInline(arg) : '') + '</figcaption></figure>';
      case 'table':
        return open('figure', 'c-figure c-table-figure') + '<figcaption><span class="fig-no">表 ' + (++figNo.tbl) + '</span>' + (arg ? parseInline(arg) : '') + '</figcaption>' + blocks() + '</figure>';
      case 'spec': {
        const { list } = listOf(lines);
        const rows = list ? Array.from(list.children).map(li => { const { head, body } = splitHead(li, true); return '<div><dt>' + head + '</dt><dd>' + body + '</dd></div>'; }) : [];
        return open('div', 'c-spec', ' data-split="items"') + title + '<dl class="c-items">' + rows.join('') + '</dl></div>';
      }
      case 'history': {
        // 確定した版から改版履歴の表を作る（古い版から順に）
        const hist = (opts.history || []).slice().reverse();
        if (!hist.length) return open('div', 'c-history') + title + '<p class="c-history-empty">確定した版はまだありません。版を確定すると、ここに改版履歴が入ります。</p></div>';
        return open('div', 'c-history') + title + tableBox('<thead><tr><th>版</th><th>日付</th><th>作成者</th><th>内容</th></tr></thead><tbody>'
          + hist.map(v => '<tr><td>' + escHtml(v.version) + '</td><td>' + escHtml(v.date) + '</td><td>' + escHtml(v.author) + '</td><td>' + parseInline(v.note || '') + '</td></tr>').join('')
          + '</tbody>') + '</div>';
      }
      case 'glossary': {
        // 用語集。項目は「**用語**：意味」。本文中のその用語には、意味が添えられる
        const { list } = listOf(lines);
        const rows = list ? Array.from(list.children).map(li => {
          const { head, body } = splitHead(li, true);
          const term = stripTags(head).trim();
          const id = uniqueId('term-' + slugify(term));
          if (term && !glossary.has(term)) glossary.set(term, { tip: stripTags(body).replace(/\s+/g, ' ').trim(), ref: id });
          return '<div id="' + escAttr(id) + '"><dt>' + head + '</dt><dd>' + body + '</dd></div>';
        }) : [];
        return open('div', 'c-spec c-glossary', ' data-split="items"') + title + '<dl class="c-items">' + rows.join('') + '</dl></div>';
      }
      case 'chart':
        return renderChart(arg, blocks(), open, extraCls);
      case 'tree':
      case 'doc-only':
      case 'slide-only':
        return open('div', 'c-' + name) + title + blocks() + '</div>';
      default:
        return open('div', 'c-custom' + (name ? ' c-' + escAttr(name) : '')) + title + blocks() + '</div>';
    }
  }

  /* :::chart 種類 表題 unit=単位 min=下限 max=上限。中の表（Markdown の表か ```csv）からグラフを描き、「グラフ」と「データ」のタブにする */
  function renderChart(arg, inner, open) {
    let type = 'bar';
    const opts = {}, rest = [];
    arg.split(/\s+/).filter(Boolean).forEach((t, k) => {
      const kv = t.match(/^(unit|min|max)=(.*)$/i);
      if (kv) { const key = kv[1].toLowerCase(); opts[key] = key === 'unit' ? kv[2].replace(/^["']|["']$/g, '') : parseFloat(kv[2]); return; }
      if (k === 0 && Chart.TYPES[t.toLowerCase()]) { type = Chart.TYPES[t.toLowerCase()]; return; }
      rest.push(t);
    });
    const label = rest.join(' ');
    const title = label ? '<p class="c-title">' + parseInline(label) + '</p>' : '';
    const table = frag(inner).querySelector('table');
    if (!table) return open('div', 'c-chart') + title + '<p class="chart-note">グラフにする表が見つかりません。:::chart の中に、Markdown の表か ```csv を書いてください。</p>' + inner + '</div>';
    opts.label = stripTags(parseInline(label)).trim();
    const d = Chart.data(table, type, opts);
    const body = '<div class="chart-box">' + Chart.legend(d) + '<div class="chart-plot">' + Chart.svg(d, 720, 12) + '</div>' + Chart.note(d) + '</div>';
    return open('div', 'c-tabs c-chart', ' data-chart="' + escAttr(JSON.stringify(d)) + '"') + title + tabsHtml(['グラフ', 'データ'], [body, inner]) + '</div>';
  }

  /* ----- ソースコードの差分（GitHub の差分画面に近い表示） ----- */
  /* unified diff（git diff / diff -u の出力）を、ファイル → ハンク → 行に分ける */
  function parseUnifiedDiff(text) {
    const lines = text.replace(/\n$/, '').split('\n');
    const files = [];
    const clean = s => s.replace(/\t.*$/, '').replace(/^"?[ab]\//, '').replace(/"$/, '');
    let f = null, h = null, o = 0, n = 0, m;
    const newFile = () => { f = { oldName: '', newName: '', status: 'modified', binary: false, hunks: [], add: 0, del: 0 }; files.push(f); h = null; };
    for (let k = 0; k < lines.length; k++) {
      const line = lines[k];
      if ((m = line.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/))) { newFile(); f.oldName = m[1]; f.newName = m[2]; continue; }
      if (/^--- /.test(line) && (!h || /^\+\+\+ /.test(lines[k + 1] || ''))) {
        // diff --git の直後なら同じファイル、前のファイルにハンクがあれば（diff -u の複数ファイル）次のファイル
        if (!f || f.hunks.length) newFile();
        f.oldName = clean(line.slice(4));
        h = null;
        continue;
      }
      if (/^\+\+\+ /.test(line) && f && !h) { f.newName = clean(line.slice(4)); continue; }
      if (!f) newFile();
      if ((m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/))) {
        h = { header: line, lines: [], numbered: true };
        f.hunks.push(h);
        o = +m[1]; n = +m[2];
        continue;
      }
      if (!h) {
        if (/^new file mode/.test(line)) { f.status = 'added'; continue; }
        if (/^deleted file mode/.test(line)) { f.status = 'deleted'; continue; }
        if ((m = line.match(/^rename from (.+)$/))) { f.oldName = m[1]; f.status = 'renamed'; continue; }
        if ((m = line.match(/^rename to (.+)$/))) { f.newName = m[1]; f.status = 'renamed'; continue; }
        if (/^Binary files /.test(line)) { f.binary = true; continue; }
        if (/^(index |similarity index|old mode|new mode)/.test(line)) continue;
        // @@ の無い差分（+/- の行だけ）は、行番号なしのハンクとして扱う
        h = { header: '', lines: [], numbered: false };
        f.hunks.push(h);
      }
      if (line.startsWith('\\')) { h.lines.push({ t: 'meta', s: line }); continue; }
      const c = line[0], s = line.slice(1);
      if (c === '+') { h.lines.push({ t: 'add', s, n: h.numbered ? n++ : '' }); f.add++; }
      else if (c === '-') { h.lines.push({ t: 'del', s, o: h.numbered ? o++ : '' }); f.del++; }
      else h.lines.push({ t: 'ctx', s: c === ' ' ? s : line, o: h.numbered ? o++ : '', n: h.numbered ? n++ : '' });
    }
    for (const x of files) {
      if (x.oldName === '/dev/null') x.status = 'added';
      if (x.newName === '/dev/null') x.status = 'deleted';
      if (x.status === 'modified' && x.oldName && x.newName && x.oldName !== x.newName) x.status = 'renamed';
    }
    return files;
  }
  /* 変更行の組（削除と追加）について、語単位で違う部分を強調する */
  const diffTokens = s => s.match(/[A-Za-z0-9_]+|\s+|[\s\S]/gu) || [];
  function lcsKeep(a, b) {
    const n = a.length, m = b.length;
    if (!n || !m || n * m > 90000) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ka = new Array(n).fill(false), kb = new Array(m).fill(false);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[i] === b[j]) { ka[i] = kb[j] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return { ka, kb };
  }
  /* 残らなかった語の範囲（文字の位置）を [始め, 終わり] の配列にする */
  function changedRanges(tokens, keep) {
    const out = [];
    let p = 0;
    tokens.forEach((t, k) => {
      if (!keep[k]) { const last = out[out.length - 1]; if (last && last[1] === p) last[1] += t.length; else out.push([p, p + t.length]); }
      p += t.length;
    });
    return out;
  }
  function wordMark(a, b) {
    const ta = diffTokens(a.s), tb = diffTokens(b.s);
    const r = lcsKeep(ta, tb);
    if (!r) return;
    const same = ta.reduce((sum, t, i) => sum + (r.ka[i] ? t.length : 0), 0);
    // ほとんど別の行になっているときは、行全体の色分けだけにする
    if (same < Math.max(a.s.length, b.s.length) * 0.35) return;
    a.marks = changedRanges(ta, r.ka);
    b.marks = changedRanges(tb, r.kb);
  }
  /* 1 行の HTML。構文の色（字句）と、語単位の変更の印を重ねる */
  function segHtml(s, toks, marks, mcls) {
    if (!(toks && toks.length) && !(marks && marks.length)) return escHtml(s);
    const tk = [], cuts = new Set([0, s.length]);
    let p = 0;
    for (const [c, t] of toks || []) { tk.push([p, p + t.length, c]); cuts.add(p); p += t.length; cuts.add(p); }
    for (const [a, b] of marks || []) { cuts.add(a); cuts.add(b); }
    const pts = [...cuts].filter(x => x <= s.length).sort((a, b) => a - b);
    let out = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a >= b) continue;
      const t = tk.find(r => r[0] <= a && a < r[1]);
      const cls = [t && t[2] ? 'tk-' + t[2] : '', marks && marks.some(([x, y]) => x <= a && b <= y) ? mcls : ''].filter(Boolean).join(' ');
      const txt = escHtml(s.slice(a, b));
      out += cls ? '<span class="' + cls + '">' + txt + '</span>' : txt;
    }
    return out;
  }
  /* ハンクごとに、変更前（文脈＋削除）と変更後（文脈＋追加）の行を続けて色分けする（行をまたぐコメントなども正しく色が付く） */
  function tokenizeHunk(h, key) {
    const oldL = h.lines.filter(l => l.t === 'ctx' || l.t === 'del'), newL = h.lines.filter(l => l.t === 'ctx' || l.t === 'add');
    const to = HL.lines(oldL.map(l => l.s).join('\n'), key), tn = HL.lines(newL.map(l => l.s).join('\n'), key);
    if (!to || !tn) return;
    oldL.forEach((l, k) => { if (l.t === 'del') l.tk = to[k]; });
    newL.forEach((l, k) => { l.tk = tn[k]; });
  }
  /* 統合（unified）と左右（split）の 2 つの表の行を作る */
  function diffTables(hunks, key) {
    let u = '', s = '';
    const num = v => (v === '' || v == null ? '' : String(v));
    const cell = (l, mk) => '<span class="mk" aria-hidden="true">' + mk + '</span>' + segHtml(l.s, l.tk, l.marks, l.t === 'del' ? 'wd' : 'wa');
    if (key) hunks.forEach(h => tokenizeHunk(h, key));
    for (const h of hunks) {
      if (h.header) {
        u += '<tr class="gh-hunk"><td class="ln" colspan="2"></td><td class="code">' + escHtml(h.header) + '</td></tr>';
        s += '<tr class="gh-hunk"><td class="ln"></td><td class="code" colspan="3">' + escHtml(h.header) + '</td></tr>';
      }
      const L = h.lines;
      for (let i = 0; i < L.length;) {
        const t = L[i].t;
        if (t === 'del' || t === 'add') {
          let j = i;
          while (j < L.length && L[j].t === 'del') j++;
          let k = j;
          while (k < L.length && L[k].t === 'add') k++;
          const dels = L.slice(i, j), adds = L.slice(j, k);
          for (let p = 0; p < Math.min(dels.length, adds.length); p++) wordMark(dels[p], adds[p]);
          dels.forEach(l => { u += '<tr class="gh-del"><td class="ln">' + num(l.o) + '</td><td class="ln"></td><td class="code">' + cell(l, '-') + '</td></tr>'; });
          adds.forEach(l => { u += '<tr class="gh-add"><td class="ln"></td><td class="ln">' + num(l.n) + '</td><td class="code">' + cell(l, '+') + '</td></tr>'; });
          for (let r = 0; r < Math.max(dels.length, adds.length); r++) {
            const a = dels[r], b = adds[r];
            s += '<tr class="gh-chg">'
              + (a ? '<td class="ln d">' + num(a.o) + '</td><td class="code d">' + cell(a, '-') + '</td>' : '<td class="ln e"></td><td class="code e"></td>')
              + (b ? '<td class="ln a">' + num(b.n) + '</td><td class="code a">' + cell(b, '+') + '</td>' : '<td class="ln e"></td><td class="code e"></td>')
              + '</tr>';
          }
          i = k;
        } else if (t === 'meta') {
          u += '<tr class="gh-meta"><td class="ln" colspan="2"></td><td class="code">' + escHtml(L[i].s) + '</td></tr>';
          s += '<tr class="gh-meta"><td class="ln"></td><td class="code" colspan="3">' + escHtml(L[i].s) + '</td></tr>';
          i++;
        } else {
          const l = L[i];
          u += '<tr class="gh-ctx"><td class="ln">' + num(l.o) + '</td><td class="ln">' + num(l.n) + '</td><td class="code">' + cell(l, ' ') + '</td></tr>';
          s += '<tr class="gh-ctx"><td class="ln">' + num(l.o) + '</td><td class="code">' + cell(l, ' ') + '</td><td class="ln">' + num(l.n) + '</td><td class="code">' + cell(l, ' ') + '</td></tr>';
          i++;
        }
      }
    }
    return { u, s };
  }
  /* langHint: ```diff lang=yaml で決めた言語。無ければファイル名の拡張子から決める */
  function renderGhDiff(code, title, split, langHint = '') {
    const files = parseUnifiedDiff(code);
    if (files.length === 1 && !files[0].oldName && !files[0].newName && title) files[0].newName = title;
    let A = 0, D = 0, maxLn = 0, numbered = false;
    for (const f of files) {
      A += f.add; D += f.del;
      for (const h of f.hunks) {
        if (h.numbered) numbered = true;
        for (const l of h.lines) maxLn = Math.max(maxLn, +l.o || 0, +l.n || 0);
      }
    }
    const tAttr = ' style="--lnw:' + String(maxLn || 1).length + 'ch"';
    const tCls = numbered ? '' : ' no-ln';
    const fileHtml = files.map(f => {
      const name = f.status === 'renamed' && f.oldName && f.newName
        ? escHtml(f.oldName) + ' → ' + escHtml(f.newName)
        : escHtml((f.status === 'deleted' ? f.oldName : f.newName) || f.oldName || '（ファイル名なし）');
      const badge = { added: '追加', deleted: '削除', renamed: '名前変更' }[f.status];
      const tot = f.add + f.del;
      const ga = tot ? Math.round(f.add / tot * 5) : 0, gd = tot ? 5 - ga : 0;
      const bar = '<span class="gh-bar" aria-hidden="true">' + '<i class="a"></i>'.repeat(ga) + '<i class="d"></i>'.repeat(gd) + '<i></i>'.repeat(5 - ga - gd) + '</span>';
      let body;
      if (f.binary) body = '<p class="gh-note">バイナリファイルのため、差分は表示しません。</p>';
      else if (!f.hunks.length) body = '<p class="gh-note">内容の変更はありません。</p>';
      else {
        const t = diffTables(f.hunks, langHint || HL.byFile(f.status === 'deleted' ? f.oldName : f.newName || f.oldName) || HL.byFile(title));
        body = '<table class="gh-table gh-unified' + tCls + '"' + tAttr + '><colgroup><col class="c-ln"><col class="c-ln"><col></colgroup><tbody>' + t.u + '</tbody></table>'
          + '<table class="gh-table gh-split' + tCls + '"' + tAttr + '><colgroup><col class="c-ln"><col><col class="c-ln"><col></colgroup><tbody>' + t.s + '</tbody></table>';
      }
      return '<details class="gh-file" open><summary class="gh-file-head"><span class="gh-chev" aria-hidden="true"></span><span class="gh-name">' + name + '</span>'
        + (badge ? '<span class="gh-badge gh-' + f.status + '">' + badge + '</span>' : '')
        + '<span class="gh-fstat"><b class="a">+' + f.add + '</b><b class="d">−' + f.del + '</b>' + bar + '</span></summary>' + body + '</details>';
    }).join('');
    return '<div class="gh-diff" data-view="' + (split ? 'split' : 'unified') + '"><div class="gh-toolbar">'
      + (title && !(files.length === 1 && files[0].newName === title) ? '<span class="gh-title">' + escHtml(title) + '</span>' : '')
      + '<span class="gh-summary">' + files.length + ' ファイル <b class="a">+' + A + '</b> <b class="d">−' + D + '</b></span>'
      + '<span class="gh-view" role="group" aria-label="差分の表示方法"><button type="button" data-diffview="unified">統合</button><button type="button" data-diffview="split">左右</button></span>'
      + '<button type="button" class="copy-btn">コピー</button></div>'
      + '<pre class="gh-raw" hidden>' + escHtml(code) + '</pre>' + fileHtml + '</div>';
  }

  function renderCode(code, info) {
    let title = '';
    const tm = info.match(/\btitle=(?:"([^"]*)"|'([^']*)'|(\S+))/);
    if (tm) { title = tm[1] ?? tm[2] ?? tm[3]; info = info.replace(tm[0], ''); }
    let lang = (info.trim().split(/\s+/)[0] || '').replace(/^\{\.?|\}$/g, '');
    const colon = lang.indexOf(':');
    if (colon > 0) { title = title || lang.slice(colon + 1); lang = lang.slice(0, colon); }
    if (lang.toLowerCase() === 'mermaid') {
      return '<div class="mermaid-block" data-state="pending"><pre class="mermaid-src"><code>' + escHtml(code) + '</code></pre></div>';
    }
    const flags = info.trim().split(/\s+/).slice(1).map(s => s.toLowerCase());
    if (/^(diff|patch)$/i.test(lang)) {
      const lm = info.match(/\blang=([\w#+.-]+)/i);
      return renderGhDiff(code, title, flags.includes('split'), lm ? HL.lang(lm[1]) : '');
    }
    const key = HL.lang(lang);
    // ```csv / ```tsv は表にする。ソースのまま（列ごとに色分け）見せるときは ```csv code
    if ((key === 'csv' || key === 'tsv' || key === 'tab') && !flags.includes('code')) {
      const t = renderCsvTable(code, key !== 'csv' || (!/,/.test(code.split('\n')[0]) && /\t/.test(code)), flags);
      return (title ? '<p class="csv-title">' + escHtml(title) + '</p>\n' : '') + t;
    }
    return '<div class="codeblock"><div class="code-head">'
      + (title ? '<span class="code-title">' + escHtml(title) + '</span>' : '')
      + (lang ? '<span class="code-lang">' + escHtml(lang) + '</span>' : '')
      + '<button type="button" class="copy-btn">コピー</button></div><pre><code'
      + (lang ? ' class="language-' + escAttr(lang) + '"' : '') + '>' + HL.html(code, key) + '</code></pre></div>';
  }

  function renderQuote(q) {
    const am = (q[0] || '').match(/^\s*\[!([A-Za-z]+)\][-+]?[ \t]*(.*)$/);
    if (am && ALERTS[am[1].toLowerCase()]) {
      const [label, type] = ALERTS[am[1].toLowerCase()];
      const title = am[2].trim() ? parseInline(am[2].trim()) : label;
      return '<div class="alert alert-' + type + '" role="note"><p class="alert-title">' + ALERT_ICONS[type] + '<span>' + title + '</span></p>'
        + parseBlocks(q.slice(1), {}) + '</div>';
    }
    return '<blockquote>\n' + parseBlocks(q, {}) + '\n</blockquote>';
  }

  /* 表の外枠。.table-scroll が横のスクロールを受け持つ（並べ替え・絞り込みの道具は、表示するときに .table-wrap に足す） */
  const tableBox = inner => '<div class="table-wrap"><div class="table-scroll"><table>\n' + inner + '\n</table></div></div>';
  function renderTable(head, aligns, rows) {
    const cell = (tag, txt, k) => '<' + tag + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + parseInline(txt || '') + '</' + tag + '>';
    const thead = head ? '<thead><tr>' + head.map((c, k) => cell('th', c, k)).join('') + '</tr></thead>\n' : '';
    const n = head ? head.length : Math.max(0, ...rows.map(r => r.length));
    const tbody = rows.map(r => '<tr>' + Array.from({ length: n }, (_, k) => cell('td', r[k], k)).join('') + '</tr>').join('\n');
    return tableBox(thead + '<tbody>\n' + tbody + '\n</tbody>');
  }
  /* CSV・TSV（RFC 4180: 引用符の中の区切り・改行・"" に対応）を行の配列にする */
  function parseCsv(text, sep) {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"' && f === '') q = true;
      else if (ch === sep) { row.push(f); f = ''; }
      else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }
  const NUM_CELL = /^[-+−]?[¥$€£]?\s*[-+−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:%|％|[A-Za-z]{1,3}|[円件個人台回本秒分時日月年万億倍]{1,2})?$/;
  /* ```csv / ```tsv を表にする。数値だけの列は右に揃える。noheader で 1 行目も中身として扱う */
  function renderCsvTable(code, tab, flags) {
    const sep = tab ? '\t' : ',';
    const rows = parseCsv(code, sep);
    if (!rows.length) return '';
    const head = flags.includes('noheader') ? null : rows.shift();
    const n = Math.max(head ? head.length : 0, ...rows.map(r => r.length));
    const aligns = Array.from({ length: n }, (_, k) => {
      const vals = rows.map(r => (r[k] || '').trim()).filter(Boolean);
      return vals.length && vals.every(v => NUM_CELL.test(v)) ? 'right' : '';
    });
    const esc = s => String(s == null ? '' : s).replace(/\n/g, '<br>');
    return renderTable(head ? Array.from({ length: n }, (_, k) => esc(head[k])) : null, aligns, rows.map(r => r.map(esc)));
  }

  function safeUrl(url, isImg) {
    const u = String(url).trim();
    if (/^(javascript|vbscript):/i.test(u.replace(/[\s\u0000-\u001f]/g, ''))) return '#';
    if (!isImg && /^data:/i.test(u)) return '#';
    return u;
  }
  function linkHtml(url, inner, title) {
    const href = safeUrl(url);
    const ext = /^https?:\/\//i.test(href);
    const showUrl = ext && stripTags(inner.replace(/\u0000\d+\u0000/g, '\u0001')).trim() !== href;
    const xref = !inner && href.startsWith('#');
    const cls = [ext ? 'ext' : '', showUrl ? 'show-url' : '', xref ? 'xref' : ''].filter(Boolean).join(' ');
    return '<a href="' + escAttr(href) + '"' + (cls ? ' class="' + cls + '"' : '') + (title ? ' title="' + escAttr(title) + '"' : '')
      + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + inner + '</a>';
  }
  function footnoteRef(id) {
    let n = fnOrder.indexOf(id);
    const first = n < 0;
    if (first) n = fnOrder.push(id) - 1;
    return '<sup class="fn-ref"><a href="#footnote-' + (n + 1) + '"' + (first ? ' id="footnote-ref-' + (n + 1) + '"' : '') + '>' + (n + 1) + '</a></sup>';
  }

  function parseInline(src, nested = false, inLink = false) {
    let s = String(src);
    // コードスパン
    s = s.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (a, t, code) => {
      code = code.replace(/\n/g, ' ');
      if (/^ [\s\S]* $/.test(code) && code.trim()) code = code.slice(1, -1);
      return hold('<code>' + escHtml(code) + '</code>');
    });
    // バックスラッシュによるエスケープ
    s = s.replace(/\\([!-\/:-@\[-`{-~])/g, (a, ch) => hold(escHtml(ch)));
    // <https://...> 形式の自動リンク
    s = s.replace(/<((?:https?|ftp):\/\/[^\s<>]+|mailto:[^\s<>]+)>/gi, (a, url) => hold(linkHtml(url, escHtml(url.replace(/^mailto:/i, '')))));
    // HTML は表示用のタグと属性だけを残す。危険な要素は、文中でも中身ごと取り除く
    s = sanitizeRawHtml(s, true);
    // 脚注の参照
    s = s.replace(/\[\^([^\]\s]+)\]/g, (a, id) => hold(footnoteRef(id)));
    // 文中のラベル :ok[完了] など、画面操作の経路 :menu[設定 > ネットワーク]
    s = s.replace(/(^|[^\w:]):(ok|ng|warn|info|tag|menu)\[([^\]\n]+)\]/g, (a, pre, kind, text) => pre + hold(kind === 'menu'
      ? '<span class="menu-path">' + text.split(/\s*(?:>|＞|›)\s*/).filter(Boolean).map(p => '<span>' + parseInline(p, true) + '</span>').join('') + '</span>'
      : '<span class="lbl lbl-' + kind + '">' + parseInline(text, true) + '</span>'));
    // 画像とリンク
    s = s.replace(/!\[([^\]]*)\]\(\s*((?:[^\s()]|\([^\s()]*\))*)(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g, (a, alt, url, t1, t2) => hold(imgHtml(url, alt, t1 ?? t2)));
    // 参照形式の画像 ![代替][名前]・![代替][]・![代替]（定義があるときだけ）
    s = s.replace(/!\[([^\]]*)\](?:\[([^\]]*)\])?/g, (a, alt, ref) => {
      const d = linkDefs.get(refKey(ref || alt));
      return d ? hold(imgHtml(d.url, alt, d.title)) : a;
    });
    s = s.replace(/\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*((?:[^\s()]|\([^\s()]*\))*)(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g,
      (a, text, url, t1, t2) => hold(linkHtml(url, parseInline(text, true, true), t1 ?? t2)));
    // 参照形式のリンク [文字][名前]・[文字][]・[文字]（定義があるときだけ）
    if (!inLink) {
      s = s.replace(/\[((?:[^\[\]]|\[[^\[\]]*\])*)\](?:\[([^\]]*)\])?/g, (a, text, ref) => {
        const d = linkDefs.size ? linkDefs.get(refKey(ref || text)) : null;
        return d ? hold(linkHtml(d.url, parseInline(text, true, true), d.title)) : a;
      });
    }
    // 裸の URL（日本語の句読点の手前で止める）
    if (!inLink) {
      s = s.replace(/\bhttps?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+/g, url => {
        let tail = '';
        while (/[.,;:!?'"*_\]]$/.test(url) || (url.endsWith(')') && url.split('(').length < url.split(')').length)) {
          tail = url.slice(-1) + tail;
          url = url.slice(0, -1);
        }
        return hold(linkHtml(url, escHtml(url))) + tail;
      });
    }
    s = escText(s);
    // 強調（日本語の記号の前後でも効くよう、CommonMark より緩く判定する）
    s = s.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
      .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
    if (nested) return s;
    while (/\u0000\d+\u0000/.test(s)) s = s.replace(/\u0000(\d+)\u0000/g, (a, n) => slots[+n]);
    // 改行。日本語どうしの間の改行は、余計な空白にならないよう詰める
    if (opts.breaks) s = s.replace(/(?: {2,}|\\)?\n/g, '<br>\n');
    else s = s.replace(/(?: {2,}|\\)\n/g, '<br>\n').replace(RE_CJK_JOIN, '$1$2$3');
    return s;
  }

  function renderFootnotes() {
    const nRef = fnOrder.length;
    const ids = fnOrder.concat([...fnDefs.keys()].filter(k => !fnOrder.includes(k)));
    if (!ids.length) return '';
    const items = ids.map((id, k) => {
      const def = fnDefs.get(id);
      const body = def != null ? parseInline(def) : '<span class="fn-missing">[^' + escHtml(id) + '] の内容が書かれていません</span>';
      const back = k < nRef ? ' <a class="fn-back" href="#footnote-ref-' + (k + 1) + '" aria-label="本文の参照位置へ戻る">↩\uFE0E</a>' : '';
      return '<li id="footnote-' + (k + 1) + '">' + body + back + '</li>';
    });
    return '\n<h2 id="' + uniqueId('footnotes') + '" class="footnotes-title">脚注</h2>\n<ol class="footnotes">\n' + items.join('\n') + '\n</ol>';
  }

  return {
    parse(src) {
      const inFence = fenceTracker();
      const lines = src.split('\n').map(l => (inFence(l) ? l : l.replace(/^[ \t]+/, w => w.replace(/\t/g, '    '))));
      // 参照形式の定義（[名前]: URL）を先に集める。定義は本文のどこに書いてもよい
      const scan = fenceTracker();
      for (const l of lines) {
        if (scan(l)) continue;
        const d = l.match(RX.linkDef);
        if (d && !linkDefs.has(refKey(d[1]))) linkDefs.set(refKey(d[1]), { url: d[2].replace(/^<([^>]*)>$/, '$1'), title: d[3] ?? d[4] ?? d[5] ?? '' });
        const ab = l.match(RX.abbrDef);
        if (ab && ab[1].trim() && !abbrs.has(ab[1].trim())) abbrs.set(ab[1].trim(), { tip: stripTags(parseInline(ab[2])).trim(), ref: '' });
      }
      let html = parseBlocks(lines, { top: true }) + renderFootnotes();
      if (html.includes('class="xref')) html = fillXrefs(html);
      return abbrs.size || glossary.size ? markTerms(html) : html;
    },
    ghDiff: renderGhDiff,
  };

  /* 本文中の用語（:::glossary と *[略語]: の項目）に、意味を添える。印を付けるのは H2 の章ごとに最初の 1 回だけ */
  function markTerms(html) {
    const terms = new Map([...abbrs, ...glossary]);
    const keys = [...terms.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(keys.map(k => (/^\w/.test(k) ? '(?<!\\w)' : '') + esc(k) + (/\w$/.test(k) ? '(?!\\w)' : '')).join('|'), 'g');
    const SKIP = 'h1, h2, h3, h4, h5, h6, a, code, pre, kbd, abbr, button, textarea, svg, style, script, .c-glossary, .gh-diff, .codeblock, .mermaid-block, .fn-ref, .footnotes, .tab-list, .menu-path, .chart-box';
    const f = frag(html);
    let seen = new Set();
    for (const top of Array.from(f.children)) {
      if (top.tagName === 'H2') { seen = new Set(); continue; }
      if (top.matches(SKIP)) continue;
      const w = document.createTreeWalker(top, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      const nodes = [];
      while (w.nextNode()) nodes.push(w.currentNode);
      for (const node of nodes) {
        const s = node.data, parts = [];
        let m, last = 0;
        re.lastIndex = 0;
        while ((m = re.exec(s))) {
          if (seen.has(m[0])) continue;
          seen.add(m[0]);
          const t = terms.get(m[0]);
          const ab = document.createElement('abbr');
          ab.className = 'term';
          ab.title = t.tip;
          ab.tabIndex = 0;
          if (t.ref) ab.dataset.ref = t.ref;
          ab.textContent = m[0];
          parts.push(s.slice(last, m.index), ab);
          last = m.index + m[0].length;
        }
        if (parts.length) { parts.push(s.slice(last)); node.replaceWith(...parts.filter(p => p !== '')); }
      }
    }
    return htmlOf(Array.from(f.childNodes));
  }

  /* [](#ID) を、参照先の図表番号（図 1・表 2）や章番号付きの見出しに置き換える */
  function fillXrefs(html) {
    const f = frag(html);
    f.querySelectorAll('a.xref').forEach(a => {
      let id = a.getAttribute('href').slice(1);
      try { id = decodeURIComponent(id); } catch (e) { /* そのまま使う */ }
      const t = f.getElementById(id);
      let label = '';
      if (t) {
        const no = t.querySelector('.fig-no');
        if (no) label = no.textContent;
        else if (/^H[1-6]$/.test(t.tagName)) {
          const c = t.cloneNode(true);
          $$('.anchor', c).forEach(x => x.remove());
          const s = c.querySelector('.secno');
          const n = s ? s.textContent : '';
          if (s) s.remove();
          label = (n ? n + ' ' : '') + c.textContent.trim();
        } else label = t.textContent.trim().slice(0, 40);
      }
      if (!label) { a.classList.add('xref-missing'); label = '参照先が見つかりません（#' + id + '）'; }
      a.textContent = label;
    });
    return htmlOf(Array.from(f.childNodes));
  }
}

/* ===== 文書全体の HTML ===== */
function renderDocHeader(meta, title, [logo, logoDark] = ['', '']) {
  const marks = [];
  if (meta.status) {
    const st = STATUS[meta.status.toLowerCase()];
    marks.push('<span class="stamp stamp-' + (st ? st[1] : 'other') + '">' + escHtml(st ? st[0] : meta.status) + '</span>');
  }
  if (meta.classification) marks.push('<span class="classif">' + escHtml(meta.classification) + '</span>');
  const order = Object.keys(META_LABELS);
  const rank = k => (order.includes(k) ? order.indexOf(k) : order.length);
  const keys = Object.keys(meta).filter(k => !META_HIDDEN.has(k) && meta[k] !== '').sort((a, b) => rank(a) - rank(b));
  const cells = keys.map(k => '<div><dt>' + escHtml(META_LABELS[k] || k) + '</dt><dd>' + escHtml(meta[k]) + '</dd></div>');
  if (!title && !marks.length && !cells.length && !logo) return '';
  const okSrc = v => { const u = v ? String(v).trim() : ''; return u && !/^(javascript|vbscript):/i.test(u.replace(/[\s\u0000-\u001f]/g, '')) ? u : ''; };
  const src = okSrc(logo), srcDark = src ? okSrc(logoDark) : '';
  const logoImg = (u, cls) => '<img class="doc-logo' + cls + '" src="' + escAttr(u) + '" alt="">';
  return '<header class="doc-header"><div class="tb-head">'
    + (marks.length ? '<div class="tb-marks">' + marks.join('') + '</div>' : '')
    + (src ? '<div class="tb-logo">' + (srcDark ? logoImg(src, ' img-light') + logoImg(srcDark, ' img-dark') : logoImg(src, '')) + '</div>' : '')
    + (title ? '<h1 class="doc-title">' + escHtml(title) + '</h1>' : '')
    + (meta.subtitle ? '<p class="doc-subtitle">' + escHtml(meta.subtitle) + '</p>' : '')
    + '</div>' + (cells.length ? '<dl class="tb-meta">' + cells.join('') + '</dl>' : '') + '</header>';
}

/* opts.history: :::history に入れる版の一覧（新しい順）。省略すると、このファイルの全部の版 */
function renderDocument(md, opts = {}) {
  const { meta, body } = parseFrontMatter(md);
  let text = body, title = meta.title || '';
  if (!title) {
    const m = text.match(/^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\n|$)/);
    if (m) { title = m[1].replace(/[*_`~]/g, ''); text = text.slice(m[0].length); }
  }
  const history = opts.history || state.versions;
  const parser = createParser({ numbering: truthy(meta.numbering), breaks: truthy(meta.breaks), reserved: RESERVED, history });
  const content = parser.parse(text);
  const theme = docThemeCss(meta);
  // 本文が空のテンプレートをそのまま開いたときは、書き始め方を出す
  const empty = !title && !text.trim()
    ? '<div class="doc-empty"><p class="doc-empty-title">本文がまだありません</p>'
      + '<p><code>.md</code> ファイルをこの画面にドロップするか、<kbd>E</kbd> キーで Markdown を書き始めてください。</p>'
      + '<p><button class="text-btn" type="button" data-action="edit">書き始める</button></p></div>'
    : '';
  return (theme ? '<style class="doc-theme">' + theme + '</style>' : '')
    + renderDocHeader(meta, title, docLogo(meta, body)) + empty
    + '<nav class="print-toc" id="ui-print-toc" aria-label="目次"></nav>'
    + '<div class="md' + (truthy(meta.h2_pagebreak) ? ' h2-break' : '') + '" id="ui-content">\n' + content + '\n</div>';
}

/* ===== 画面 ===== */
const els = {
  source: $('#md-source'), doc: $('#ui-doc'), toc: $('#ui-toc'), sidebar: $('#ui-sidebar'),
  topbar: $('#ui-topbar'), title: $('#ui-title'), crumb: $('#ui-crumb'), progress: $('#ui-progress'), themeTrigger: $('.theme-trigger'), themeMenu: $('#ui-theme-menu'),
  measure: $('#ui-measure'),
  textarea: $('#ui-textarea'), editorStatus: $('#ui-editor-status'),
  slides: $('#ui-slides'), stage: $('#ui-stage'), printSlides: $('#ui-print-slides'),
  help: $('#ui-help'), toast: $('#ui-toast'), drop: $('#ui-drop'), backdrop: $('#ui-backdrop'),
  pageStyle: $('#ui-page-style'),
  verbar: $('#ui-verbar'), versions: $('#ui-versions'), versionsBody: $('#ui-versions-body'), verFile: $('#ui-ver-file'),
  main: $('.main'), widthHandle: $('#ui-width'), sidebarWidthHandle: $('#ui-sidebar-width'), tip: $('#ui-tip'),
  search: $('#ui-search'), searchInput: $('#ui-search-input'), searchCount: $('#ui-search-count'),
};
const RESERVED = $$('[id]').filter(e => !els.doc.contains(e)).map(e => e.id);
const state = {
  md: '', savedMd: '', dirty: false, meta: {}, title: '', fileBase: '',
  content: null, headings: [], current: null, mermaidBlocks: [],
  // 確定した版（新しい順）と、いま表示しているもの（作業中 / 過去の版 / 比較）
  versions: [], savedVersionsKey: '', view: { mode: 'current' }, changes: [], changeIdx: -1, diffStats: null,
};

/* script 要素（type="text/markdown"）の中身を読む。<\/script> の書き換えを戻し、共通の字下げを取る */
function readScript(el) {
  let raw = el.textContent.replace(/\r\n?/g, '\n').replace(/<\\(\/?)([s]cript)/gi, '<$1$2');
  raw = raw.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
  const lines = raw.split('\n');
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length));
  return (Number.isFinite(ind) && ind > 0 ? lines.map(l => l.slice(ind)).join('\n') : raw) + '\n';
}
const readSource = () => readScript(els.source);
/* 保存するときに、script 要素を途中で終わらせる文字列を書き換える */
const escScript = md => md.replace(/<(\/?)([s]cript)/gi, '<\\$1$2').replace(/\n?$/, '\n');
function readVersions() {
  return $$('script.md-version').map(el => ({
    version: el.dataset.version || '', date: el.dataset.date || '', author: el.dataset.author || '', note: el.dataset.note || '', md: readScript(el),
  }));
}
const versionsKey = () => state.versions.map(v => [v.version, v.date, v.author, v.note, hash(v.md)].join('\u0001')).join('\u0002');
/* i は版の番号（state.versions の添字）。-1 は作業中 */
const verMd = i => (i < 0 ? state.md : state.versions[i].md);
const verHistory = i => (i < 0 ? state.versions : state.versions.slice(i));
const verLabel = i => (i < 0 ? '作業中' : '版 ' + (state.versions[i].version || '（番号なし）'));
const verLabelLong = i => {
  if (i < 0) return '作業中';
  const v = state.versions[i];
  return verLabel(i) + (v.date || v.author ? '（' + [v.date, v.author].filter(Boolean).join('・') + '）' : '');
};

function render(md, useBaked = false) {
  state.md = md;
  state.view = { mode: 'current' };
  showView(useBaked);
}

/* state.view に合わせて本文を描き直す */
function showView(useBaked = false) {
  if (Slides.active) Slides.exit();
  const v = state.view;
  if (v.mode === 'version') {
    const md = verMd(v.i);
    state.meta = parseFrontMatter(md).meta;
    els.doc.innerHTML = safeRenderedHtml(renderDocument(md, { history: verHistory(v.i) }));
    delete els.doc.dataset.mdHash;
  } else if (v.mode === 'compare') {
    renderCompare();
    delete els.doc.dataset.mdHash;
  } else {
    state.meta = parseFrontMatter(state.md).meta;
    const key = hash(ENGINE + '\n' + versionsKey() + '\n' + state.md);
    if (!(useBaked && els.doc.dataset.mdHash === key && $('#ui-content', els.doc))) {
      els.doc.innerHTML = safeRenderedHtml(renderDocument(state.md));
      els.doc.dataset.mdHash = key;
    }
  }
  document.body.dataset.view = v.mode;
  enhance();
  if (v.mode === 'compare') { markTocChanges(); collectChanges(); }
  updateVerBar();
}
function setView(view) {
  state.view = view;
  showView();
  setHash(viewHash(view));
  window.scrollTo({ top: 0, behavior: 'instant' });
}
/* 過去の版・比較の表示は URL に残す（#version=1.0、#compare=1.1..1.2、作業中は work、Markdown の比較は &md） */
function viewHash(v) {
  const id = i => (i < 0 ? 'work' : encodeURIComponent(state.versions[i].version));
  if (v.mode === 'version') return '#version=' + id(v.i);
  if (v.mode === 'compare') return '#compare=' + id(v.a) + '..' + id(v.b) + (v.as === 'md' ? '&md' : '');
  return '';
}
function viewFromHash(h) {
  const m = h.match(/^#(version|compare)=([^&]+)(&md)?$/);
  if (!m) return null;
  const find = s => { s = decodeURIComponent(s); if (s === 'work') return -1; const i = state.versions.findIndex(v => v.version === s); return i < 0 ? null : i; };
  if (m[1] === 'version') { const i = find(m[2]); return i !== null && i >= 0 ? { mode: 'version', i } : null; }
  const [a, b] = m[2].split('..').map(find);
  return a != null && b != null && a !== b ? { mode: 'compare', a, b, as: m[3] ? 'md' : 'doc' } : null;
}

function enhance() {
  state.content = $('#ui-content', els.doc);
  state.title = ($('.doc-title', els.doc)?.textContent || '').trim() || state.fileBase || 'レポート';
  document.title = state.title;
  els.title.textContent = state.title;
  buildToc();
  fillPrintToc(els.doc);
  els.pageStyle.textContent = docPageCss();
  syncDiffViews(els.doc);
  initTables(els.doc);
  state.mermaidBlocks = $$('.mermaid-block', els.doc);
  renderMermaid();
  drawCharts(els.doc);
  state.logo = $('.doc-logo', els.doc)?.getAttribute('src') || '';
  state.logoDark = $('.doc-logo.img-dark', els.doc)?.getAttribute('src') || '';
  Width.place();
  if (Search.q) Search.run();
  updateScroll();
}

function setMarkdown(md) {
  md = md.replace(/\r\n?/g, '\n');
  if (Slides.active) Slides.exit();
  render(md);
  if (Editor.isOpen() && els.textarea.value !== md && document.activeElement !== els.textarea) els.textarea.value = md;
  updateDirty();
}

function updateDirty() {
  state.dirty = state.md !== state.savedMd || versionsKey() !== state.savedVersionsKey;
  els.editorStatus.textContent = state.dirty ? '未保存の変更あり（Ctrl+S で保存）' : '変更なし';
  els.editorStatus.classList.toggle('is-dirty', state.dirty);
}

function docPageCss() {
  const c = state.meta.classification;
  return '@page { margin: 18mm 16mm 18mm;'
    + ' @top-left { content: ' + cssString(state.title) + '; font-size: 8pt; color: #777; }'
    + (c ? ' @top-right { content: ' + cssString(c) + '; font-size: 8pt; font-weight: bold; color: #b3261e; }' : '')
    + ' @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #777; } }';
}

/* ----- 目次 ----- */
function headingList(content) {
  if (!content) return [];
  return $$(':scope > h2:not(.vd-removed), :scope > h3:not(.vd-removed)', content).map(el => {
    const c = el.cloneNode(true);
    $$('.anchor, .secno, .fn-ref', c).forEach(x => x.remove());
    return { el, id: el.id, level: el.tagName === 'H2' ? 2 : 3, no: el.querySelector('.secno')?.textContent || '', text: c.textContent.trim() };
  });
}
function tocItems(list) {
  return list.map(h => '<li class="lv' + h.level + '"><a href="#' + escAttr(h.id) + '" data-id="' + escAttr(h.id) + '">'
    + (h.no ? '<span class="toc-no">' + escHtml(h.no) + '</span>' : '') + '<span>' + escHtml(h.text) + '</span></a></li>').join('');
}
function buildToc() {
  state.headings = headingList(state.content);
  els.toc.innerHTML = tocItems(state.headings);
  state.current = null;
  document.body.classList.toggle('no-toc', !state.headings.length);
}
function fillPrintToc(root) {
  const nav = root.querySelector('#ui-print-toc');
  if (!nav) return;
  const list = headingList(root.querySelector('#ui-content'));
  nav.innerHTML = list.length > 2 ? '<p class="print-toc-title">目次</p><ol>' + tocItems(list) + '</ol>' : '';
}
function headingText(el) {
  const c = el.cloneNode(true);
  $$('.anchor, .fn-ref', c).forEach(x => x.remove());
  const no = c.querySelector('.secno');
  const n = no ? no.textContent : '';
  if (no) no.remove();
  return (n ? n + ' ' : '') + c.textContent.trim();
}

/* ----- スクロール位置（目次の印・読了バー） ----- */
const PAD = 16;
const headerH = () => els.topbar.offsetHeight || 52;
let scrollQueued = false;
function onScroll() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; updateScroll(); });
}
function updateScroll() {
  if (Slides.active) return;
  const de = document.documentElement;
  const max = de.scrollHeight - de.clientHeight;
  els.progress.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, de.scrollTop / max) : 0) + ')';
  const line = headerH() + PAD + 12;
  let cur = null;
  for (const h of state.headings) { if (h.el.getBoundingClientRect().top <= line) cur = h; else break; }
  const last = state.headings[state.headings.length - 1];
  if (last && max > 0 && de.scrollTop >= max - 2 && last.el.getBoundingClientRect().top < innerHeight) cur = last;
  setCurrent(cur);
}
function setCurrent(cur) {
  if (cur === state.current) return;
  state.current = cur;
  updateCrumb(cur);
  $$('a.active', els.toc).forEach(a => a.classList.remove('active'));
  if (!cur) return;
  const a = els.toc.querySelector('a[data-id="' + CSS.escape(cur.id) + '"]');
  if (!a) return;
  a.classList.add('active');
  const sb = els.sidebar, r = a.getBoundingClientRect(), b = sb.getBoundingClientRect();
  if (b.height && (r.top < b.top + 48 || r.bottom > b.bottom - 48)) sb.scrollTop += r.top - b.top - b.height / 3;
}
/* ツールバーのパンくず（いま読んでいる章 › 節） */
function updateCrumb(cur) {
  if (!cur) { els.crumb.textContent = ''; return; }
  const list = state.headings;
  let h2 = null;
  for (let k = list.indexOf(cur); k >= 0; k--) if (list[k].level === 2) { h2 = list[k]; break; }
  const parts = (h2 ? [h2] : []).concat(cur.level === 3 ? [cur] : []);
  els.crumb.innerHTML = parts.map(h => '<span>' + escHtml((h.no ? h.no + ' ' : '') + h.text) + '</span>').join('');
}
function jumpHeading(dir) {
  const pos = headerH() + PAD;
  const list = state.headings;
  const target = dir > 0
    ? list.find(h => h.el.getBoundingClientRect().top > pos + 4)
    : [...list].reverse().find(h => h.el.getBoundingClientRect().top < pos - 4);
  const behavior = reduceMotion() ? 'auto' : 'smooth';
  if (target) target.el.scrollIntoView({ behavior, block: 'start' });
  else if (dir < 0) window.scrollTo({ top: 0, behavior });
}

/* ----- Mermaid（ライト用とダーク用を両方描いておき、CSS で切り替える） ----- */
const mmCache = new Map();
const mmPrefix = 'mmd' + Date.now().toString(36);
let mmSeq = 0, mmLib = null, mmQueue = Promise.resolve();
function loadMermaid() {
  if (mmLib) return mmLib;
  mmLib = new Promise((resolve, reject) => {
    if (!CONFIG.mermaidSrc) { reject(new Error('disabled')); return; }
    if (window.mermaid) { resolve(window.mermaid); return; }
    const s = document.createElement('script');
    s.src = CONFIG.mermaidSrc;
    if (CONFIG.mermaidIntegrity) { s.integrity = CONFIG.mermaidIntegrity; s.crossOrigin = 'anonymous'; }
    s.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('mermaid not found')));
    s.onerror = () => reject(new Error('network'));
    setTimeout(() => reject(new Error('timeout')), 20000);
    document.head.append(s);
  });
  return mmLib;
}
function mermaidNote(b, msg) {
  let p = b.querySelector('.mermaid-note');
  if (!p) { p = document.createElement('p'); p.className = 'mermaid-note'; b.append(p); }
  p.textContent = msg;
}
function renderMermaid() {
  const blocks = state.mermaidBlocks.filter(b => b.dataset.state !== 'done');
  if (!blocks.length) return;
  blocks.forEach(b => { if (b.dataset.src == null) b.dataset.src = b.querySelector('code')?.textContent ?? ''; });
  mmQueue = mmQueue.then(async () => {
    let mm;
    try { mm = await loadMermaid(); }
    catch (e) {
      blocks.forEach(b => mermaidNote(b, CONFIG.mermaidSrc
        ? '図を描くライブラリ（Mermaid）を読み込めなかったため、図のソースを表示しています。ネットワークにつながると図になります。'
        : 'Mermaid の読み込みを無効にしているため、図のソースを表示しています。'));
      Slides.refresh();
      return;
    }
    const font = getComputedStyle(document.body).fontFamily;
    for (const theme of ['default', 'dark']) {
      const need = blocks.filter(b => state.mermaidBlocks.includes(b) && !b._mmError && !mmCache.has(theme + '\n' + b.dataset.src));
      if (!need.length) continue;
      mm.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: font, suppressErrorRendering: true });
      for (const b of need) {
        const key = theme + '\n' + b.dataset.src;
        if (mmCache.has(key)) continue;
        const id = mmPrefix + '-' + (++mmSeq);
        try { mmCache.set(key, (await mm.render(id, b.dataset.src)).svg); }
        catch (err) {
          b._mmError = String((err && err.message) || err).split('\n')[0];
          document.getElementById('d' + id)?.remove();
          document.getElementById(id)?.remove();
        }
      }
    }
    for (const b of blocks) {
      if (!state.mermaidBlocks.includes(b)) continue;
      const light = mmCache.get('default\n' + b.dataset.src), dark = mmCache.get('dark\n' + b.dataset.src);
      if (light && dark) {
        b.innerHTML = '<div class="mm-light">' + light + '</div><div class="mm-dark">' + dark + '</div>';
        b.dataset.state = 'done';
      } else if (b._mmError) {
        b.dataset.state = 'error';
        mermaidNote(b, 'Mermaid の書き方に誤りがあるため、図のソースを表示しています: ' + b._mmError);
      }
    }
    Slides.refresh();
  }).catch(err => console.error(err));
}

/* ----- 版の比較（差分の計算） ----- */
/* 2 つの列の最長共通部分列から、eq / del / ins の並びを作る。先頭と末尾の一致は先に除く */
function diffSeq(a, b) {
  const n0 = a.length, m0 = b.length;
  let pre = 0;
  while (pre < n0 && pre < m0 && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n0 - pre && suf < m0 - pre && a[n0 - 1 - suf] === b[m0 - 1 - suf]) suf++;
  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ t: 'eq', a: i, b: i });
  const A = a.slice(pre, n0 - suf), B = b.slice(pre, m0 - suf), n = A.length, m = B.length;
  if (n && m && n * m <= 4e6) {
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push({ t: 'eq', a: pre + i, b: pre + j }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', a: pre + i }); i++; }
      else { ops.push({ t: 'ins', b: pre + j }); j++; }
    }
    for (; i < n; i++) ops.push({ t: 'del', a: pre + i });
    for (; j < m; j++) ops.push({ t: 'ins', b: pre + j });
  } else {
    for (let i = 0; i < n; i++) ops.push({ t: 'del', a: pre + i });
    for (let j = 0; j < m; j++) ops.push({ t: 'ins', b: pre + j });
  }
  for (let k = 0; k < suf; k++) ops.push({ t: 'eq', a: n0 - suf + k, b: m0 - suf + k });
  return ops;
}
const wordTokens = s => s.match(/[A-Za-z0-9_]+|\s+|[\s\S]/gu) || [];
/* 見た目の文字（見出しの番号や # のリンク、脚注の番号などは除く）の text node */
function textNodesOf(el) {
  // 章番号・図表番号・参照（[](#ID)）の文字は自動で振り直されるので、比較に含めない
  const skip = '.anchor, .secno, .fn-ref, .xref, .fig-no, .copy-btn, .gh-raw, .mk, .tab-list, .gh-view, svg, .mermaid-block, style, script';
  const out = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  while (w.nextNode()) out.push(w.currentNode);
  return out;
}
const plainText = el => textNodesOf(el).map(n => n.data).join('').replace(/\s+/g, ' ').trim();
/* 文字の 2-gram の重なりで似ている度合いを測る（0〜1） */
function similarity(x, y) {
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  x = x.slice(0, 3000); y = y.slice(0, 3000);
  const grams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const gx = grams(x), gy = grams(y);
  let inter = 0;
  gx.forEach((n, g) => { inter += Math.min(n, gy.get(g) || 0); });
  return (2 * inter) / (x.length + y.length - 2);
}
/* 変更されたブロックの中で、消えた語を <del>、増えた語を <ins> で示す */
function applyInlineDiff(a, b) {
  const nodesA = textNodesOf(a), nodesB = textNodesOf(b);
  const ta = nodesA.map(n => n.data).join(''), tb = nodesB.map(n => n.data).join('');
  if (ta === tb) return;
  const A = wordTokens(ta), B = wordTokens(tb);
  if (!A.length || !B.length || A.length * B.length > 250000) return;
  const ins = [], dels = [];
  let off = 0;
  for (const o of diffSeq(A, B)) {
    if (o.t === 'eq') off += B[o.b].length;
    else if (o.t === 'ins') {
      const last = ins[ins.length - 1];
      if (last && last[1] === off) last[1] += B[o.b].length; else ins.push([off, off + B[o.b].length]);
      off += B[o.b].length;
    } else {
      const last = dels[dels.length - 1];
      if (last && last.at === off) last.s += A[o.a]; else dels.push({ at: off, s: A[o.a] });
    }
  }
  let start = 0;
  nodesB.forEach((node, k) => {
    const s = start, len = node.data.length, e = s + len;
    start = e;
    const last = k === nodesB.length - 1;
    const myIns = ins.filter(([x, y]) => y > s && x < e);
    const myDels = dels.filter(d => (d.at >= s && d.at < e) || (last && d.at === e));
    if (!myIns.length && !myDels.length) return;
    const cuts = new Set([0, len]);
    myIns.forEach(([x, y]) => { cuts.add(Math.max(0, x - s)); cuts.add(Math.min(len, y - s)); });
    myDels.forEach(d => cuts.add(d.at - s));
    const pts = Array.from(cuts).sort((p, q) => p - q);
    const frag = document.createDocumentFragment();
    pts.forEach((p, i) => {
      myDels.filter(d => d.at - s === p).forEach(d => { const el = document.createElement('del'); el.className = 'vd-del'; el.textContent = d.s; frag.append(el); });
      if (i === pts.length - 1) return;
      const piece = node.data.slice(p, pts[i + 1]);
      if (!piece) return;
      if (myIns.some(([x, y]) => s + p >= x && s + pts[i + 1] <= y)) { const el = document.createElement('ins'); el.className = 'vd-ins'; el.textContent = piece; frag.append(el); }
      else frag.append(piece);
    });
    node.replaceWith(frag);
  });
}
/* ブロックを比べるための文字列。自動で振られる ID や番号は除く */
function blockSig(el) {
  const c = el.cloneNode(true);
  $$('.anchor, .secno, .fn-ref, .fig-no, .copy-btn, .gh-raw', c).forEach(x => x.remove());
  $$('a.xref', c).forEach(x => { x.textContent = ''; });
  [c, ...c.querySelectorAll('*')].forEach(x => {
    x.removeAttribute('id'); x.removeAttribute('aria-controls'); x.removeAttribute('aria-labelledby');
    if ((x.getAttribute('href') || '').startsWith('#')) x.removeAttribute('href');
  });
  return c.outerHTML.replace(/\s+/g, ' ');
}
/* リストの項目・表の行の単位で比べる（消えた項目は、取り消し線付きの項目としてその位置に残す） */
function diffChildren(a, b) {
  const ai = Array.from(a.children), bi = Array.from(b.children);
  const out = [];
  let dels = [], ins = [];
  const removed = el => {
    const c = el.cloneNode(true);
    [c, ...c.querySelectorAll('[id]')].forEach(x => x.removeAttribute('id'));
    c.classList.add('vd-item-removed');
    return c;
  };
  const flush = () => {
    // 似ている組は「変更」、組にならないものは消えた項目 → 増えた項目の順に並べる
    let p = 0, pending = [];
    for (const nb of ins) {
      let found = -1;
      const tb = plainText(nb);
      for (let k = p; k < dels.length; k++) if (similarity(plainText(dels[k]), tb) >= 0.4) { found = k; break; }
      if (found >= 0) {
        for (let k = p; k < found; k++) out.push(removed(dels[k]));
        out.push(...pending);
        pending = [];
        nb.classList.add('vd-item-changed');
        applyInlineDiff(dels[found], nb);
        out.push(nb);
        p = found + 1;
      } else {
        nb.classList.add('vd-item-added');
        pending.push(nb);
      }
    }
    for (let k = p; k < dels.length; k++) out.push(removed(dels[k]));
    out.push(...pending);
    dels = []; ins = [];
  };
  for (const o of diffSeq(ai.map(blockSig), bi.map(blockSig))) {
    if (o.t === 'eq') { flush(); out.push(bi[o.b]); }
    else if (o.t === 'del') dels.push(ai[o.a]);
    else ins.push(bi[o.b]);
  }
  flush();
  b.replaceChildren(...out);
}
/* 変更されたブロックの中を比べる。リストと表は項目・行の単位、それ以外は語の単位 */
function diffInside(a, b) {
  if (b.matches('.mermaid-block')) return;
  if (b.matches('ul, ol') && a.matches('ul, ol')) { diffChildren(a, b); return; }
  // 表は、見出しの行と表の外の文字（表題など）が同じときだけ、行の単位で比べる
  const ta = a.querySelectorAll('table'), tb = b.querySelectorAll('table');
  if (ta.length === 1 && tb.length === 1 && ta[0].tBodies[0] && tb[0].tBodies[0]) {
    const head = t => (t.tHead ? plainText(t.tHead) : '');
    const outside = el => { const c = el.cloneNode(true); c.querySelectorAll('table').forEach(x => x.remove()); return plainText(c); };
    if (head(ta[0]) === head(tb[0]) && outside(a) === outside(b)) {
      diffChildren(ta[0].tBodies[0], tb[0].tBodies[0]);
      return;
    }
  }
  applyInlineDiff(a, b);
}
/* 2 つの版の本文（renderDocument の HTML）を段落・表などのブロック単位で比べ、比較後の版に印を付けて返す */
function blockDiff(baseHtml, targetHtml, inline) {
  const parts = html => { const box = document.createElement('div'); box.innerHTML = safeRenderedHtml(html); return { box, header: box.querySelector('.doc-header'), content: box.querySelector('#ui-content') }; };
  const A = parts(baseHtml), B = parts(targetHtml);
  const stats = { added: 0, removed: 0, changed: 0, header: false, sections: [] };
  if (A.header && B.header && blockSig(A.header) !== blockSig(B.header)) {
    B.header.classList.add('vd-changed');
    stats.header = true;
    if (inline) applyInlineDiff(A.header, B.header);
  }
  const a = A.content ? Array.from(A.content.children) : [], b = B.content ? Array.from(B.content.children) : [];
  const out = [];
  const removed = el => {
    const c = el.cloneNode(true);
    [c, ...c.querySelectorAll('[id]')].forEach(x => x.removeAttribute('id'));
    c.classList.add('vd-block', 'vd-removed');
    stats.removed++;
    return c;
  };
  let dels = [], ins = [];
  const flush = () => {
    // 似ているブロックの組は「変更」、組にならないものは消えたブロック → 増えたブロックの順に並べる
    let p = 0, pending = [];
    for (const nb of ins) {
      let found = -1;
      const tb = plainText(nb);
      for (let k = p; k < dels.length; k++) {
        if (dels[k].tagName === nb.tagName && dels[k].className.split(' ')[0] === nb.className.split(' ')[0] && similarity(plainText(dels[k]), tb) >= 0.4) { found = k; break; }
      }
      if (found >= 0) {
        for (let k = p; k < found; k++) out.push(removed(dels[k]));
        out.push(...pending);
        pending = [];
        nb.classList.add('vd-block', 'vd-changed');
        if (inline) diffInside(dels[found], nb);
        stats.changed++;
        out.push(nb);
        p = found + 1;
      } else {
        nb.classList.add('vd-block', 'vd-added');
        stats.added++;
        pending.push(nb);
      }
    }
    for (let k = p; k < dels.length; k++) out.push(removed(dels[k]));
    out.push(...pending);
    dels = []; ins = [];
  };
  for (const o of diffSeq(a.map(blockSig), b.map(blockSig))) {
    if (o.t === 'eq') { flush(); out.push(b[o.b]); }
    else if (o.t === 'del') dels.push(a[o.a]);
    else ins.push(b[o.b]);
  }
  flush();
  if (B.content) B.content.replaceChildren(...out);
  let h2 = null;
  for (const n of out) {
    if (n.tagName === 'H2' && !n.classList.contains('vd-removed')) h2 = n;
    if (n.classList.contains('vd-block')) {
      const label = h2 ? headingText(h2) : '冒頭';
      if (!stats.sections.includes(label)) stats.sections.push(label);
    }
  }
  return { box: B.box, stats };
}
/* Markdown どうしの行単位の差分を、unified diff の文字列にする（前後 3 行を付ける） */
function unifiedDiff(aText, bText, name) {
  const a = aText.replace(/\n$/, '').split('\n'), b = bText.replace(/\n$/, '').split('\n');
  const ops = diffSeq(a, b);
  const idx = [];
  ops.forEach((o, k) => { if (o.t !== 'eq') idx.push(k); });
  if (!idx.length) return '';
  const C = 3, ranges = [];
  let s = Math.max(0, idx[0] - C), e = Math.min(ops.length, idx[0] + C + 1);
  for (const k of idx.slice(1)) {
    if (k - C <= e) e = Math.min(ops.length, k + C + 1);
    else { ranges.push([s, e]); s = Math.max(0, k - C); e = Math.min(ops.length, k + C + 1); }
  }
  ranges.push([s, e]);
  const aBefore = [0], bBefore = [0];
  ops.forEach((o, k) => { aBefore[k + 1] = aBefore[k] + (o.t !== 'ins' ? 1 : 0); bBefore[k + 1] = bBefore[k] + (o.t !== 'del' ? 1 : 0); });
  let out = '--- a/' + name + '\n+++ b/' + name + '\n';
  for (const [hs, he] of ranges) {
    const ac = aBefore[he] - aBefore[hs], bc = bBefore[he] - bBefore[hs];
    out += '@@ -' + (ac ? aBefore[hs] + 1 : aBefore[hs]) + ',' + ac + ' +' + (bc ? bBefore[hs] + 1 : bBefore[hs]) + ',' + bc + ' @@\n';
    for (const o of ops.slice(hs, he)) out += (o.t === 'eq' ? ' ' + a[o.a] : o.t === 'del' ? '-' + a[o.a] : '+' + b[o.b]) + '\n';
  }
  return out;
}

/* ----- 版の比較（表示） ----- */
function renderCompare() {
  const v = state.view;
  const aMd = verMd(v.a), bMd = verMd(v.b);
  state.meta = parseFrontMatter(bMd).meta;
  state.diffStats = null;
  if (v.as === 'md') {
    const text = unifiedDiff(aMd, bMd, baseName() + '.md');
    let add = 0, del = 0;
    text.split('\n').forEach(l => { if (/^\+(?!\+\+ )/.test(l)) add++; else if (/^-(?!-- )/.test(l)) del++; });
    state.diffStats = { lines: true, add, del };
    const theme = docThemeCss(state.meta);
    els.doc.innerHTML = safeRenderedHtml((theme ? '<style class="doc-theme">' + theme + '</style>' : '')
      + '<div class="md" id="ui-content">' + (text ? createParser({}).ghDiff(text, '', false) : '<p>Markdown に違いはありません。</p>') + '</div>');
    return;
  }
  const r = blockDiff(renderDocument(aMd, { history: verHistory(v.a) }), renderDocument(bMd, { history: verHistory(v.b) }), true);
  state.diffStats = r.stats;
  els.doc.replaceChildren(...Array.from(r.box.childNodes));
}
/* 変更がある章・節に、目次で印を付ける */
function markTocChanges() {
  if (!state.content) return;
  const ids = new Set();
  let h2 = null, h3 = null;
  for (const n of state.content.children) {
    if (n.tagName === 'H2' && n.id) { h2 = n.id; h3 = null; }
    else if (n.tagName === 'H3' && n.id) h3 = n.id;
    if (n.classList.contains('vd-block')) { if (h2) ids.add(h2); if (h3) ids.add(h3); }
  }
  $$('a[data-id]', els.toc).forEach(a => a.classList.toggle('has-change', ids.has(a.dataset.id)));
}
function collectChanges() {
  state.changes = state.view.as === 'md'
    ? $$('#ui-content tr.gh-hunk', els.doc)
    : $$('.doc-header.vd-changed, #ui-content > .vd-block', els.doc);
  state.changeIdx = -1;
}
/* Markdown の比較では、統合と左右の両方の表にハンクがあるので、見えている方だけを数える */
const visibleChanges = () => state.changes.filter(e => e.getClientRects().length);
function gotoChange(dir) {
  const list = visibleChanges();
  if (state.view.mode !== 'compare') return;
  if (!list.length) { toast('変更はありません'); return; }
  state.changeIdx = (state.changeIdx + dir + list.length) % list.length;
  $$('.vd-current', els.doc).forEach(x => x.classList.remove('vd-current'));
  const el = list[state.changeIdx];
  el.classList.add('vd-current');
  el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
  const pos = els.verbar.querySelector('.vb-pos');
  if (pos) pos.textContent = (state.changeIdx + 1) + ' / ' + list.length;
}
/* 本文の上の帯（過去の版や比較を表示しているときだけ出す） */
function updateVerBar() {
  const v = state.view, bar = els.verbar;
  if (v.mode === 'current') { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  if (v.mode === 'version') {
    bar.innerHTML = '<span class="vb-text"><b>' + escHtml(verLabelLong(v.i)) + '</b> を表示しています。過去の版は読み取り専用です。</span>'
      + '<span class="vb-actions"><button type="button" class="btn" data-action="ver-compare-this">作業中と比較</button><button type="button" class="btn primary" data-action="ver-exit">作業中の版に戻る</button></span>';
    return;
  }
  const s = state.diffStats || {};
  const total = visibleChanges().length;
  const count = s.lines
    ? (s.add || s.del ? '<b class="a">+' + s.add + '</b> <b class="d">−' + s.del + '</b> 行' : '違いはありません')
    : (total ? '変更 ' + total + ' か所（追加 ' + s.added + '・削除 ' + s.removed + '・変更 ' + (s.changed + (s.header ? 1 : 0)) + '）' : '違いはありません');
  bar.innerHTML = '<span class="vb-text"><b>' + escHtml(verLabelLong(v.a)) + '</b> → <b>' + escHtml(verLabelLong(v.b)) + '</b> を比較しています</span>'
    + '<span class="vb-count">' + count + '</span>'
    + '<span class="vb-actions"><span class="vb-seg" role="group" aria-label="比較の見せ方">'
    + '<button type="button" data-action="ver-as-doc" aria-pressed="' + (v.as !== 'md') + '">文書</button>'
    + '<button type="button" data-action="ver-as-md" aria-pressed="' + (v.as === 'md') + '">Markdown</button></span>'
    + (total ? '<button type="button" class="btn" data-action="ver-prev" title="前の変更（Shift+N）">前へ</button><span class="vb-pos">– / ' + total + '</span><button type="button" class="btn" data-action="ver-next" title="次の変更（N）">次へ</button>' : '')
    + '<button type="button" class="btn primary" data-action="ver-exit">比較を終了</button></span>';
}
function compareVersions(a, b, as = 'doc') {
  if (a === b) { toast('同じ版どうしは比較できません'); return; }
  Versions.close();
  if (Editor.isOpen()) Editor.close();
  setView({ mode: 'compare', a, b, as });
}

/* ----- 版の管理（確定・取り込み・削除） ----- */
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function cmpVer(x, y) {
  const px = String(x).split(/[^0-9]+/).filter(Boolean).map(Number), py = String(y).split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(px.length, py.length); i++) { const d = (px[i] || 0) - (py[i] || 0); if (d) return d; }
  return 0;
}
function suggestVersion() {
  const fm = parseFrontMatter(state.md).meta.version || '';
  const last = state.versions[0] ? state.versions[0].version : '';
  if (!last) return fm || '1.0';
  if (fm && fm !== last && cmpVer(fm, last) > 0) return fm;
  const m = last.match(/^(.*?)(\d+)(\D*)$/);
  return m ? m[1] + (Number(m[2]) + 1) + m[3] : last;
}
/* フロントマターの値を書き換える（無ければ足す）。フロントマターが無い文書はそのまま */
function setFrontMatterValue(md, key, value) {
  const m = md.match(/^(﻿?---[ \t]*\n)([\s\S]*?)(\n(?:---|\.\.\.)[ \t]*(?:\n|$))/);
  if (!m) return md;
  const re = new RegExp('^' + key + '[ \\t]*:.*$', 'm');
  const body = re.test(m[2]) ? m[2].replace(re, key + ': ' + value) : m[2] + '\n' + key + ': ' + value;
  return m[1] + body + m[3] + md.slice(m[0].length);
}
function sortVersions() {
  state.versions.sort((x, y) => (y.date || '').localeCompare(x.date || '') || cmpVer(y.version, x.version));
}
function confirmVersion(f) {
  let md = setFrontMatterValue(state.md, 'version', f.version);
  if ('updated' in parseFrontMatter(md).meta && f.date) md = setFrontMatterValue(md, 'updated', f.date);
  state.versions.unshift({ version: f.version, date: f.date, author: f.author, note: f.note, md });
  sortVersions();
  setMarkdown(md);
  exportHtml();
  toast('版 ' + f.version + ' を確定し、HTML として保存しました');
}
function importVersion(f, md) {
  state.versions.push({ version: f.version, date: f.date, author: f.author, note: f.note, md });
  sortVersions();
  showView();
  updateDirty();
  toast('版 ' + f.version + ' を取り込みました。Ctrl+S で保存してください');
}
async function readFileText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('shift_jis').decode(buf); }
}
/* HTML 全体を DOM にせず、Markdown の script だけをデータとして取り出す。
   コメント・実行用スクリプトの中にある、見かけのタグは取り込まない。 */
function markdownScripts(html) {
  const result = [];
  const blocks = /<[!]--[\s\S]*?-->|<[s]cript(?=[\s/>])((?:[^<>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/[s]cript\s*>/gi;
  for (const match of html.matchAll(blocks)) {
    if (match[1] == null) continue;
    const attrs = DOMPurify.sanitize('<div ' + match[1] + '></div>', { RETURN_DOM: true, ADD_ATTR: ['type'] }).querySelector('div');
    if (!attrs || (attrs.getAttribute('type') || '').toLowerCase() !== 'text/markdown') continue;
    attrs.textContent = match[2];
    result.push(attrs);
  }
  return result;
}
async function importFile(file) {
  const text = (await readFileText(file)).replace(/\r\n?/g, '\n');
  if (/\.html?$/i.test(file.name) || /^\s*<!doctype html|<html[\s>]/i.test(text.slice(0, 500))) {
    // 保存した HTML なら、その中の版を全部取り込む。版が無ければ本文を 1 つの版として取り込む
    const scripts = markdownScripts(text);
    const vs = scripts.filter(el => el.classList.contains('md-version')).map(el => ({ version: el.dataset.version || '', date: el.dataset.date || '', author: el.dataset.author || '', note: el.dataset.note || '', md: readScript(el) }));
    const fresh = vs.filter(v => !state.versions.some(x => x.version === v.version && x.md === v.md));
    if (fresh.length) {
      state.versions.push(...fresh);
      sortVersions();
      showView();
      updateDirty();
      renderVersionPanel();
      toast(fresh.length + ' 件の版を取り込みました。Ctrl+S で保存してください');
      return;
    }
    const src = scripts.find(el => el.id === 'md-source');
    if (!src) { toast('この HTML には取り込める Markdown がありません'); return; }
    return openVersionForm('import', readScript(src), file);
  }
  return openVersionForm('import', text.replace(/\n?$/, '\n'), file);
}
function deleteVersion(i) {
  const v = state.versions[i];
  if (!window.confirm(verLabel(i) + ' を削除します。保存すると元に戻せません。よろしいですか？')) return;
  state.versions.splice(i, 1);
  backToCurrent();
  updateDirty();
  renderVersionPanel();
  toast((v.version ? '版 ' + v.version : '版') + ' を削除しました。Ctrl+S で保存すると確定します');
}
function deleteAllVersions() {
  const n = state.versions.length;
  if (!n || !window.confirm('版を ' + n + ' 件すべて削除します。保存すると元に戻せません。よろしいですか？')) return;
  state.versions = [];
  backToCurrent();
  updateDirty();
  renderVersionPanel();
  toast('版をすべて削除しました。Ctrl+S で保存すると確定します');
}
/* 版を消したあとは作業中の表示に戻す（URL に残った #version= や #compare= も消す） */
function backToCurrent() {
  if (state.view.mode !== 'current') setView({ mode: 'current' });
  else showView();
}

/* ----- 版の管理パネル ----- */
const summaryCache = new Map();
function versionSummary(a, b) {
  const aMd = verMd(a), bMd = verMd(b);
  const key = hash(aMd) + '|' + hash(bMd);
  if (!summaryCache.has(key)) summaryCache.set(key, blockDiff(renderDocument(aMd, { history: [] }), renderDocument(bMd, { history: [] }), false).stats);
  return summaryCache.get(key);
}
function summaryHtml(s) {
  const n = s.added + s.removed + s.changed;
  if (!n && !s.header) return '<span class="muted">本文の変更なし</span>';
  const secs = s.sections.slice(0, 3).map(escHtml).join('、') + (s.sections.length > 3 ? ' ほか ' + (s.sections.length - 3) : '');
  return '<span class="ver-counts"><b class="a">+' + s.added + '</b> <b class="d">−' + s.removed + '</b> <b class="c">~' + s.changed + '</b></span>' + (secs ? '<span class="ver-secs">' + secs + '</span>' : '');
}
let verForm = null;
function openVersionForm(mode, md, file) {
  const fm = parseFrontMatter(md || state.md).meta;
  if (mode === 'confirm') {
    verForm = { mode, version: suggestVersion(), date: todayIso(), author: fm.author || (state.versions[0] && state.versions[0].author) || '', note: '' };
  } else {
    const d = file && file.lastModified ? new Date(file.lastModified) : null;
    const fileDate = d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
    verForm = { mode, md, version: fm.version || '', date: fm.updated || fm.date || fileDate, author: fm.author || '', note: '' };
  }
  Versions.open();
  setTimeout(() => $('#ui-ver-f-version', els.versionsBody)?.focus(), 0);
}
function renderVersionPanel() {
  const vs = state.versions;
  const hasWorking = !vs.length || vs[0].md !== state.md;
  const opt = (i, sel) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + escHtml(verLabelLong(i)) + '</option>';
  const all = (hasWorking ? [-1] : []).concat(vs.map((_, i) => i));
  const defA = vs.length ? (hasWorking ? 0 : Math.min(1, vs.length - 1)) : -1, defB = hasWorking ? -1 : 0;
  let html = '<div class="ver-actions"><button type="button" class="btn primary" data-action="ver-form-confirm">版を確定…</button>'
    + '<button type="button" class="btn" data-action="ver-import">過去の版を取り込む…</button>'
    + '<span class="ver-hint">確定した版は、このファイルの中に全文で残ります（' + vs.length + ' 件）</span>'
    + (vs.length ? '<button type="button" class="btn danger ver-delete-all" data-action="ver-delete-all">版をすべて削除</button>' : '') + '</div>';
  if (verForm) {
    const f = verForm;
    html += '<form class="ver-form" id="ui-ver-form" novalidate><p class="ver-form-title">' + (f.mode === 'confirm' ? 'いまの内容を版として確定する' : '取り込む版の情報') + '</p>'
      + '<label>版<input id="ui-ver-f-version" name="version" value="' + escAttr(f.version) + '" required></label>'
      + '<label>日付<input name="date" type="date" value="' + escAttr(f.date) + '"></label>'
      + '<label>作成者<input name="author" value="' + escAttr(f.author) + '"></label>'
      + '<label class="wide">内容<input name="note" value="' + escAttr(f.note) + '" placeholder="性能要件の見直し"></label>'
      + '<p class="ver-error" id="ui-ver-error" role="alert"></p>'
      + '<div class="ver-form-buttons"><button type="submit" class="btn primary">' + (f.mode === 'confirm' ? '版を確定して保存' : '取り込む') + '</button><button type="button" class="btn" data-action="ver-form-cancel">やめる</button></div></form>';
  }
  if (all.length >= 2) {
    html += '<div class="ver-compare"><span>比較</span><select id="ui-ver-a" aria-label="比べる元の版">' + all.map(i => opt(i, defA)).join('') + '</select><span>→</span>'
      + '<select id="ui-ver-b" aria-label="比べる先の版">' + all.map(i => opt(i, defB)).join('') + '</select>'
      + '<button type="button" class="btn" data-action="ver-compare-sel">比較する</button></div>';
  }
  html += '<table class="ver-table"><thead><tr><th>版</th><th>日付</th><th>作成者</th><th>内容</th><th>前の版からの変更</th><th></th></tr></thead><tbody>';
  if (hasWorking) {
    html += '<tr class="is-working"><td>作業中</td><td></td><td></td><td>' + (vs.length ? '未確定の変更があります' : 'まだ版を確定していません') + '</td><td>' + (vs.length ? summaryHtml(versionSummary(0, -1)) : '') + '</td>'
      + '<td class="ver-ops"><button type="button" class="btn" data-action="ver-view" data-i="-1">表示</button>' + (vs.length ? '<button type="button" class="btn" data-action="ver-diff" data-a="0" data-b="-1">比較</button>' : '') + '</td></tr>';
  }
  vs.forEach((v, i) => {
    const prev = i + 1 < vs.length ? i + 1 : null;
    html += '<tr' + (state.view.mode === 'version' && state.view.i === i ? ' class="is-viewing"' : '') + '><td class="ver-no">' + escHtml(v.version || '—') + '</td><td>' + escHtml(v.date) + '</td><td>' + escHtml(v.author) + '</td><td>' + escHtml(v.note) + '</td>'
      + '<td>' + (prev !== null ? summaryHtml(versionSummary(prev, i)) : '<span class="muted">最初の版</span>') + '</td>'
      + '<td class="ver-ops"><button type="button" class="btn" data-action="ver-view" data-i="' + i + '">表示</button>'
      + (prev !== null ? '<button type="button" class="btn" data-action="ver-diff" data-a="' + prev + '" data-b="' + i + '">比較</button>' : '')
      + '<button type="button" class="btn" data-action="ver-md" data-i="' + i + '" title="この版の Markdown をダウンロード">MD</button>'
      + '<button type="button" class="btn danger" data-action="ver-delete" data-i="' + i + '" title="この版を削除">削除</button></td></tr>';
  });
  html += '</tbody></table>';
  if (!vs.length) html += '<p class="ver-empty">版を確定すると、ここに一覧が出ます。過去の版と比べたり、過去の版を表示したりできます。</p>';
  els.versionsBody.innerHTML = html;
  const form = $('#ui-ver-form', els.versionsBody);
  if (form) form.addEventListener('submit', onVersionSubmit);
}
function onVersionSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const f = { version: String(fd.get('version') || '').trim(), date: String(fd.get('date') || '').trim(), author: String(fd.get('author') || '').trim(), note: String(fd.get('note') || '').trim() };
  const err = $('#ui-ver-error', els.versionsBody);
  if (!f.version) { err.textContent = '版の番号を入れてください。'; return; }
  if (state.versions.some(v => v.version === f.version)) { err.textContent = '版 ' + f.version + ' はもうあります。別の番号にしてください。'; return; }
  if (verForm.mode === 'confirm' && !f.note) { err.textContent = '内容（何を変えたか）を入れてください。改版履歴に載ります。'; return; }
  const mode = verForm.mode, md = verForm.md;
  verForm = null;
  if (mode === 'confirm') confirmVersion(f); else importVersion(f, md);
  renderVersionPanel();
}
const Versions = {
  open() { Help.close(); renderVersionPanel(); els.versions.hidden = false; },
  close() { els.versions.hidden = true; verForm = null; },
};

/* ----- スライド ----- */
function makeSlideShell() {
  const el = document.createElement('section');
  el.className = 'slide';
  el.innerHTML = '<div class="slide-crumb"></div><div class="slide-body md"></div>'
    + '<div class="slide-foot"><span class="slide-brand"><img class="slide-logo" alt="" hidden><img class="slide-logo img-dark" alt="" hidden><span class="slide-doc"></span></span><span class="slide-num"></span></div><div class="slide-progress"></div>';
  return el;
}
function titleSlideContent() {
  const wrap = document.createElement('div');
  wrap.className = 'title-slide';
  const hdr = $('.doc-header', els.doc);
  if (hdr) wrap.append(hdr.cloneNode(true));
  return wrap;
}
const overflows = body => body.scrollHeight > body.clientHeight + 2;
/* 文字を minPct% まで縮め、それでも入らなければ一番大きな図・画像だけを縮める。収まれば true */
function fitBody(body, minPct) {
  body.style.fontSize = '';
  body.style.removeProperty('--media-max');
  body.classList.remove('is-overflow');
  let size = 100;
  while (overflows(body) && size > minPct) { size -= 5; body.style.fontSize = size + '%'; }
  if (!overflows(body)) return true;
  // SVG 要素には offsetHeight が無いので clientHeight も見る（拡大縮小の影響を受けない高さ）
  const hOf = e => e.offsetHeight || e.clientHeight || 0;
  const media = $$('img, .mermaid-block .mm-light, .mermaid-block .mm-dark, .chart-plot svg', body).filter(e => hOf(e) > 0);
  if (media.length) {
    const tallest = media.reduce((a, b) => (hOf(b) > hOf(a) ? b : a));
    const target = hOf(tallest) - (body.scrollHeight - body.clientHeight) - 6;
    if (target >= 120) body.style.setProperty('--media-max', target + 'px');
  }
  return !overflows(body);
}
/* 表示用。分割したあとでも入らないとき（分けられない大きな塊）だけ、50% まで縮めてからスクロールにする */
function fitSlide(body) {
  if (!body) return;
  if (!fitBody(body, CONFIG.slideMinScale)) {
    let size = parseInt(body.style.fontSize, 10) || 100;
    while (overflows(body) && size > 50) { size -= 5; body.style.fontSize = size + '%'; }
    if (overflows(body)) body.classList.add('is-overflow');
  }
  body.scrollTop = 0;
}
function fillShell(shell, slide, nodes) {
  $('.slide-crumb', shell).textContent = slide.crumb || '';
  shell.classList.toggle('is-title', slide.kind === 'title');
  shell.classList.toggle('is-section', slide.kind !== 'title' && nodes.length === 1 && /^H[12]$/.test(nodes[0].tagName) && !nodes[0].classList.contains('cont-heading'));
  const body = $('.slide-body', shell);
  body.replaceChildren(...nodes);
  return body;
}
function mountSlide(shell, slide, i, total) {
  const body = fillShell(shell, slide, slide.kind === 'title' ? [titleSlideContent()] : slide.nodes);
  $('.slide-doc', shell).textContent = state.title;
  const setLogo = (lg, src) => { if (src) { if (lg.getAttribute('src') !== src) lg.setAttribute('src', src); lg.hidden = false; } else lg.hidden = true; };
  const [lg, lgDark] = $$('.slide-logo', shell);
  setLogo(lg, state.logo);
  setLogo(lgDark, state.logoDark);
  lg.classList.toggle('img-light', !!state.logoDark);
  $('.slide-num', shell).textContent = (i + 1) + ' / ' + total;
  shell.style.setProperty('--progress', ((i + 1) / total).toFixed(4));
  fitSlide(body);
  $$('img', body).forEach(img => { if (!img.complete) img.addEventListener('load', () => fitSlide(body), { once: true }); });
}

/* ----- 収まらないスライドの分割 ----- */
let measureShellEl = null;
function measureShell() {
  if (!measureShellEl) { measureShellEl = makeSlideShell(); els.measure.append(measureShellEl); }
  return measureShellEl;
}
/* 続きのスライドの先頭に置く見出し（元の見出しの複製） */
function contHeading(h) {
  const c = h.cloneNode(true);
  c.removeAttribute('id');
  c.classList.add('cont-heading');
  $$('.anchor', c).forEach(x => x.remove());
  const mark = document.createElement('span');
  mark.className = 'cont-mark';
  mark.textContent = '（続き）';
  c.append(mark);
  return c;
}
/* 分けられる塊の単位: 表は行（見出し行は毎回付ける）、リストは項目、コードは行、steps などの囲みは項目 */
function splitter(node) {
  if (node.matches('.table-wrap')) {
    const table = node.querySelector('table');
    const tbody = table && table.tBodies[0];
    if (!tbody) return null;
    // 絞り込みで隠している行は、スライドにも出さない
    const rows = Array.from(tbody.rows).filter(r => !r.hidden);
    const scroll = table.parentElement !== node ? table.parentElement : null;
    return { count: rows.length, make(a, b) {
      const w = node.cloneNode(false), t = table.cloneNode(false), tb = tbody.cloneNode(false);
      if (table.tHead) t.append(table.tHead.cloneNode(true));
      rows.slice(a, b).forEach(r => tb.append(r.cloneNode(true)));
      t.append(tb);
      if (scroll) { const sc = scroll.cloneNode(false); sc.append(t); w.append(sc); } else w.append(t);
      return w;
    } };
  }
  if (node.matches('ul, ol')) {
    const items = Array.from(node.children);
    return { count: items.length, make(a, b) {
      const l = node.cloneNode(false);
      if (node.tagName === 'OL') l.start = (node.start || 1) + a;
      items.slice(a, b).forEach(li => l.append(li.cloneNode(true)));
      return l;
    } };
  }
  if (node.matches('p')) {
    // 段落は文の切れ目（。！？ や ". "）で分ける。太字やリンクの途中では切らない
    const units = [];
    let cur = [];
    for (const ch of Array.from(node.childNodes)) {
      if (ch.nodeType !== 3) { cur.push(ch); continue; }
      const parts = ch.textContent.split(/(?<=[。．！？!?]|\.\s)/);
      parts.forEach((t, k) => {
        if (!t) return;
        cur.push(document.createTextNode(t));
        if (k < parts.length - 1 || /(?:[。．！？!?]|\.\s)\s*$/.test(t)) { units.push(cur); cur = []; }
      });
    }
    if (cur.length) units.push(cur);
    return { count: units.length, make(a, b) {
      const p = node.cloneNode(false);
      units.slice(a, b).forEach(u => u.forEach(n => p.append(n.cloneNode(true))));
      return p;
    } };
  }
  if (node.matches('.gh-diff')) {
    // 差分は、いま表示している方の表（統合か左右）の行単位で分ける。続きの部分にもファイル名の見出しを付ける
    const view = node.dataset.view === 'split' ? 'split' : 'unified';
    const units = [];
    $$(':scope > .gh-file', node).forEach(f => {
      const t = f.querySelector('.gh-' + view);
      const rows = t ? Array.from(t.tBodies[0].rows) : [];
      if (rows.length) rows.forEach(tr => units.push({ f, t, tr }));
      else units.push({ f, t: null, tr: null });
    });
    return { count: units.length, make(a, b) {
      const n = node.cloneNode(false);
      n.classList.add('is-part');
      n.dataset.view = view;
      const bar = node.querySelector(':scope > .gh-toolbar');
      if (bar && a === 0) n.append(bar.cloneNode(true));
      let curF = null, body = null;
      units.slice(a, b).forEach(u => {
        if (u.f !== curF) {
          curF = u.f;
          const fc = u.f.cloneNode(false);
          fc.open = true;
          fc.append(u.f.querySelector(':scope > summary').cloneNode(true));
          if (u.t) {
            const tc = u.t.cloneNode(false);
            const cg = u.t.querySelector('colgroup');
            if (cg) tc.append(cg.cloneNode(true));
            body = document.createElement('tbody');
            tc.append(body);
            fc.append(tc);
          } else {
            const note = u.f.querySelector('.gh-note');
            if (note) fc.append(note.cloneNode(true));
          }
          n.append(fc);
        }
        if (u.tr) body.append(u.tr.cloneNode(true));
      });
      return n;
    } };
  }
  if (node.matches('.codeblock')) {
    // 色分けの span は行ごとに閉じているので、HTML を改行で分ければ行の単位になる
    const lines = node.querySelector('code').innerHTML.replace(/\n$/, '').split('\n');
    return { count: lines.length, make(a, b) {
      const c = node.cloneNode(true);
      c.querySelector('code').innerHTML = lines.slice(a, b).join('\n');
      return c;
    } };
  }
  if (node.matches('.c-tabs')) {
    // タブ（example の見本を含む）は、選んでいるタブの中身を塊の単位で分ける。中の表・リスト・差分などはさらにその単位で分ける。
    // どの部分にもタブの見出しとほかのタブを付けるので、続きのスライドでも「書き方」に切り替えられる
    const panels = $$(':scope > .tab-panel', node);
    const active = panels.find(p => p.classList.contains('is-active')) || panels[0];
    if (!active) return null;
    const units = [];
    Array.from(active.children).forEach(ch => {
      const s = splitter(ch);
      if (s && s.count > 1) for (let i = 0; i < s.count; i++) units.push({ ch, s, i });
      else units.push({ ch, s: null, i: 0 });
    });
    return { count: units.length, make(a, b) {
      const n = node.cloneNode(false);
      n.removeAttribute('id');
      Array.from(node.children).forEach(k => {
        if (k !== active) { n.append(k.cloneNode(true)); return; }
        const p = active.cloneNode(false);
        const part = units.slice(a, b);
        for (let j = 0; j < part.length;) {
          const u = part[j];
          let e = j + 1;
          while (e < part.length && part[e].ch === u.ch) e++;
          p.append(u.s ? u.s.make(u.i, part[e - 1].i + 1) : u.ch.cloneNode(true));
          j = e;
        }
        n.append(p);
      });
      return n;
    } };
  }
  if (node.matches('[data-split="items"]')) {
    const box = node.querySelector(':scope > .c-items');
    if (!box) return null;
    const items = Array.from(box.children), kids = Array.from(node.children), at = kids.indexOf(box);
    return { count: items.length, make(a, b) {
      const n = node.cloneNode(false);
      n.removeAttribute('id');
      kids.forEach((k, idx) => {
        if (k === box) {
          const ib = box.cloneNode(false);
          if (box.tagName === 'OL') ib.start = (box.start || 1) + a;
          items.slice(a, b).forEach(it => ib.append(it.cloneNode(true)));
          n.append(ib);
        } else if ((idx < at && a === 0) || (idx > at && b === items.length)) n.append(k.cloneNode(true));
      });
      return n;
    } };
  }
  return null;
}
/* 先頭から入るだけ入れた部分と、残りの 2 つに分ける。先頭に minFirst 単位も入らなければ null */
function splitBlock(node, fits, minFirst = 1) {
  const s = splitter(node);
  if (!s || s.count < minFirst + 1 || !fits(s.make(0, minFirst))) return null;
  let lo = minFirst, hi = s.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(s.make(0, mid))) lo = mid; else hi = mid - 1;
  }
  // 次のページに 1〜2 単位だけ残る（表の最後の 1 行だけ、など）のを避ける
  if (s.count - lo < 3) lo = Math.max(minFirst, s.count - 3);
  return [s.make(0, lo), s.make(lo, s.count)];
}

const Slides = {
  active: false, index: 0, list: [], original: [], shell: null,
  build() {
    const level = parseInt(state.meta.slide_level, 10) || CONFIG.slideLevel;
    const isSplit = el => el.tagName === 'H1' || el.tagName === 'H2' || (level >= 3 && el.tagName === 'H3');
    const list = [];
    if ($('.doc-header', els.doc)) list.push({ kind: 'title', nodes: [] });
    let cur = null, h2 = null;
    for (const node of this.original) {
      if (isSplit(node)) {
        if (node.tagName !== 'H3') h2 = node;
        cur = { kind: 'content', nodes: [node], heading: node, crumb: node.tagName === 'H3' && h2 ? headingText(h2) : '' };
        list.push(cur);
      } else if (node.classList.contains('pagebreak')) {
        const hd = cur && cur.heading;
        cur = { kind: 'content', nodes: hd ? [contHeading(hd)] : [], heading: hd, crumb: cur ? cur.crumb : '' };
        list.push(cur);
      } else {
        if (!cur) { cur = { kind: 'content', nodes: [], heading: null, crumb: '' }; list.push(cur); }
        cur.nodes.push(node);
      }
    }
    const logical = list.filter(s => s.kind === 'title' || s.nodes.some(n => !n.classList.contains('cont-heading')));
    this.list = logical.flatMap(s => this.paginate(s));
    $('.slide-body', measureShell()).replaceChildren();
  },
  /* 1 枚に収まらないスライドを、塊の切れ目で複数枚に分ける */
  paginate(slide) {
    if (slide.kind === 'title') return [slide];
    const shell = measureShell();
    if (fitBody(fillShell(shell, slide, slide.nodes), CONFIG.slideMinScale)) return [slide];
    // 詰め込みは下限の大きさで判定する（表示するときは、内容が少なければ 100% まで戻る）
    const pack = CONFIG.slideMinScale;
    const fits = nodes => {
      const b = fillShell(shell, slide, nodes);
      b.style.removeProperty('--media-max');
      b.style.fontSize = pack + '%';
      return !overflows(b);
    };
    const fresh = () => (slide.heading ? [contHeading(slide.heading)] : []);
    const hasBody = arr => arr.some(n => !/^H[1-6]$/.test(n.tagName));
    const pages = [], queue = slide.nodes.slice();
    let cur = [];
    while (queue.length) {
      const node = queue.shift();
      if (fits(cur.concat(node))) { cur.push(node); continue; }
      if (hasBody(cur)) {
        // 新しいページに丸ごと入る塊は分けずに次のページへ送る。
        // 1 ページに入りきらない大きな塊だけ、余白に 3 単位（表なら 3 行）以上入るなら前半をこのページに入れる
        const head = fits(fresh().concat(node)) ? null : splitBlock(node, n => fits(cur.concat(n)), 3);
        if (head) { cur.push(head[0]); queue.unshift(head[1]); }
        else queue.unshift(node);
        pages.push(cur);
        cur = fresh();
        continue;
      }
      const parts = splitBlock(node, n => fits(cur.concat(n)));
      if (parts) { cur.push(parts[0]); queue.unshift(parts[1]); } else cur.push(node);
      pages.push(cur);
      cur = fresh();
    }
    if (hasBody(cur)) pages.push(cur);
    return pages.map(nodes => ({ kind: 'content', nodes, heading: slide.heading, crumb: slide.crumb }));
  },
  /* 図の描画が終わるなどして大きさが変わったときに、分割をやり直す */
  refresh() {
    if (!this.active) return;
    const s = this.list[this.index];
    const anchor = s && (s.nodes.find(n => !n.classList.contains('cont-heading')) || s.heading);
    $('.slide-body', this.shell).replaceChildren();
    state.content.append(...this.original);
    this.build();
    const k = this.list.findIndex(p => p.nodes.includes(anchor));
    this.go(k >= 0 ? k : this.index);
    if (Search.q) Search.run();
  },
  enter(at) {
    if (this.active || !state.content) return;
    Editor.close(); closeDrawer(); Help.close();
    this.original = Array.from(state.content.children);
    this.build();
    if (!this.list.length) return;
    const idx = typeof at === 'number' ? at : this.indexOf(state.current && state.current.el);
    this.active = true;
    document.body.classList.add('presenting');
    els.slides.hidden = false;
    hideTip();
    this.layout();
    this.go(idx);
    if (Search.q) Search.run();
  },
  indexOf(el) {
    if (!el) return 0;
    const i = this.list.findIndex(s => s.nodes.includes(el));
    return i < 0 ? 0 : i;
  },
  go(i) {
    if (!this.active) return;
    i = Math.max(0, Math.min(this.list.length - 1, i | 0));
    const dir = i < this.index ? -1 : 1;
    this.index = i;
    mountSlide(this.shell, this.list[i], i, this.list.length);
    const body = $('.slide-body', this.shell);
    if (body.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      body.animate([{ opacity: 0, transform: 'translateX(' + dir * 14 + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2, .7, .2, 1)' });
    }
    setHash('#slide-' + (i + 1));
  },
  next() { if (this.index < this.list.length - 1) this.go(this.index + 1); },
  prev() { if (this.index > 0) this.go(this.index - 1); },
  refit() { if (this.active) fitSlide($('.slide-body', this.shell)); },
  layout() { els.stage.style.setProperty('--scale', String(Math.min(innerWidth / 1280, innerHeight / 720))); },
  exit() {
    if (!this.active) return;
    const s = this.list[this.index];
    const target = s && (s.heading || s.nodes[0]);
    this.active = false;
    $('.slide-body', this.shell).replaceChildren();
    state.content.append(...this.original);
    els.slides.hidden = true;
    document.body.classList.remove('presenting');
    setHash('');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
    if (Search.q) Search.run();
    updateScroll();
  },
  preparePrint() {
    const root = els.printSlides;
    root.replaceChildren();
    this.list.forEach((s, i) => { const page = makeSlideShell(); root.append(page); mountSlide(page, s, i, this.list.length); });
    document.body.classList.add('print-slides');
    els.pageStyle.textContent = '@page { size: 1280px 720px; margin: 0; }';
  },
  afterPrint() {
    els.printSlides.replaceChildren();
    document.body.classList.remove('print-slides');
    els.pageStyle.textContent = docPageCss();
    this.go(this.index);
  },
};

/* ----- 編集 ----- */
const Editor = {
  isOpen: () => document.body.classList.contains('editing'),
  open() {
    if (Slides.active) Slides.exit();
    closeDrawer();
    if (state.view.mode !== 'current') { setView({ mode: 'current' }); toast('作業中の版に戻して編集します'); }
    document.body.classList.add('editing');
    if (els.textarea.value !== state.md) els.textarea.value = state.md;
    els.textarea.focus();
  },
  close() { document.body.classList.remove('editing'); },
  toggle() { if (this.isOpen()) this.close(); else this.open(); },
};

/* ----- テーマ ----- */
const Theme = {
  systemScheme: matchMedia('(prefers-color-scheme: dark)'),
  modes: ['auto', 'light', 'dark'],
  names: { auto: 'システム設定に合わせる', light: 'ライト', dark: 'ダーク' },
  get: () => document.documentElement.getAttribute('data-theme') || 'auto',
  set(mode) {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    store.set(KEY_THEME, mode);
    this.sync();
  },
  cycle() {
    this.choose(this.modes[(this.modes.indexOf(this.get()) + 1) % this.modes.length]);
  },
  choose(m) {
    this.close();
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(() => this.set(m));
    else this.set(m);
    toast('テーマ: ' + this.names[m]);
  },
  open() {
    els.themeMenu.hidden = false;
    els.themeTrigger.setAttribute('aria-expanded', 'true');
    els.themeMenu.querySelector('[aria-checked="true"]').focus();
  },
  close(focus = false) {
    els.themeMenu.hidden = true;
    els.themeTrigger.setAttribute('aria-expanded', 'false');
    if (focus) els.themeTrigger.focus();
  },
  sync() {
    const m = this.get();
    els.themeTrigger.dataset.mode = m === 'auto' ? (this.systemScheme.matches ? 'dark' : 'light') : m;
    els.themeTrigger.setAttribute('aria-label', 'テーマ: ' + this.names[m]);
    $$('[data-theme-mode]', els.themeMenu).forEach(b => b.setAttribute('aria-checked', String(b.dataset.themeMode === m)));
    els.themeTrigger.title = 'テーマ: ' + this.names[m] + '（T で切り替え）';
  },
};

Theme.systemScheme.addEventListener('change', () => { if (Theme.get() === 'auto') Theme.sync(); });

/* ----- 目次の開閉・ヘルプ・通知 ----- */
const isNarrow = () => matchMedia('(max-width: 900px)').matches;
function toggleToc() {
  if (isNarrow()) {
    const open = document.body.classList.toggle('toc-open');
    els.backdrop.hidden = !open;
  } else {
    const hidden = document.body.classList.toggle('toc-hidden');
    store.set(KEY_TOC, hidden ? 'hidden' : 'shown');
  }
}
function closeDrawer() { document.body.classList.remove('toc-open'); els.backdrop.hidden = true; }
const Help = {
  open() { els.help.hidden = false; $('[data-action="help-close"]', els.help)?.focus(); },
  close() { els.help.hidden = true; },
};
let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('全画面表示にできませんでした'));
}

/* ----- 保存・ダウンロード ----- */
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function baseName() {
  const raw = state.meta.filename || state.fileBase || state.title || 'report';
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'report';
}
function downloadMd() {
  download(state.md, baseName() + '.md', 'text/markdown;charset=utf-8');
  toast('Markdown をダウンロードしました');
}
function exportHtml() {
  const doc = new DOMParser().parseFromString(PRISTINE, 'text/html');
  const root = doc.documentElement;
  root.removeAttribute('data-theme');
  root.removeAttribute('style');   // 本文の幅は見る人ごとの設定なので、ファイルには残さない
  root.className = 'no-js';
  doc.title = state.title;
  const src = doc.getElementById('md-source');
  src.textContent = '\n' + escScript(state.md);
  // 確定した版を、作業中の Markdown のすぐ後ろに新しい順で書き出す
  doc.querySelectorAll('script.md-version').forEach(s => { if (s.previousSibling && s.previousSibling.nodeType === 3 && !s.previousSibling.data.trim()) s.previousSibling.remove(); s.remove(); });
  let ref = src;
  for (const v of state.versions) {
    const s = doc.createElement('script');
    s.setAttribute('type', 'text/markdown');
    s.className = 'md-version';
    s.setAttribute('data-version', v.version);
    s.setAttribute('data-date', v.date);
    s.setAttribute('data-author', v.author);
    s.setAttribute('data-note', v.note);
    s.textContent = '\n' + escScript(v.md);
    ref.after(doc.createTextNode('\n'), s);
    ref = s;
  }
  // 描画済みの本文も入れておく（JavaScript が動かない環境でも読めるように）
  const docEl = doc.getElementById('ui-doc');
  docEl.innerHTML = safeRenderedHtml(renderDocument(state.md));
  docEl.setAttribute('data-md-hash', hash(ENGINE + '\n' + versionsKey() + '\n' + state.md));
  const drawn = new Map(state.mermaidBlocks.filter(b => b.dataset.state === 'done').map(b => [b.dataset.src, b.innerHTML]));
  docEl.querySelectorAll('.mermaid-block').forEach(b => {
    const src = b.querySelector('code')?.textContent ?? '';
    b.setAttribute('data-src', src);
    if (drawn.has(src)) { b.innerHTML = drawn.get(src); b.setAttribute('data-state', 'done'); }
  });
  fillPrintToc(docEl);
  doc.getElementById('ui-title').textContent = state.title;
  doc.getElementById('ui-page-style').textContent = docPageCss();
  doc.querySelectorAll('noscript').forEach(n => n.remove());
  download('<!doctype html>\n' + root.outerHTML + '\n', baseName() + '.html', 'text/html;charset=utf-8');
  state.savedMd = state.md;
  state.savedVersionsKey = versionsKey();
  updateDirty();
  toast('HTML として保存しました');
}

/* 差分の表示方法（統合 / 左右）。選んだ方法は全部の差分に当て、次に開いたときも使う */
let diffViewPref;
function syncDiffViews(root) {
  if (diffViewPref === undefined) diffViewPref = store.get(KEY_DIFF);
  const v = diffViewPref;
  if (v !== 'unified' && v !== 'split') return;
  const list = $$('.gh-diff', root);
  if (root.matches && root.matches('.gh-diff')) list.push(root);
  list.forEach(d => { if (!d.classList.contains('is-part')) d.dataset.view = v; });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}
async function copyCode(btn) {
  const raw = btn.closest('.gh-diff')?.querySelector(':scope > .gh-raw');
  const text = raw ? raw.textContent : (btn.closest('.codeblock')?.querySelector('code')?.textContent ?? '');
  const ok = await copyText(text);
  btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
  setTimeout(() => { btn.textContent = 'コピー'; }, 1600);
}

/* ----- 表の並べ替え・絞り込み・コピー ----- */
const TABLE_FILTER_ROWS = 6;   // この行数以上の表に、絞り込みの欄を出す
const normText = s => String(s).normalize('NFKC').toLowerCase();
function initTables(root) {
  $$('.table-wrap', root).forEach(w => {
    if (w.closest('.slide-body') || w.querySelector(':scope > .tbl-tools')) return;
    const table = w.querySelector('table'), tb = table && table.tBodies[0];
    if (!tb || tb.rows.length < 2) return;
    Array.from(tb.rows).forEach((r, k) => { r.dataset.order = k; });
    const n = tb.rows.length, big = n >= TABLE_FILTER_ROWS;
    const tools = document.createElement('div');
    tools.className = 'tbl-tools' + (big ? '' : ' is-mini');
    tools.innerHTML = (big ? '<input type="search" class="tbl-filter" placeholder="絞り込み" aria-label="表の行を絞り込む"><span class="tbl-count">' + n + ' 行</span>' : '')
      + '<button type="button" class="tbl-copy" title="Excel などに貼れる形（タブ区切り）でコピー">コピー</button>';
    w.prepend(tools);
    w.classList.toggle('is-long', n >= 15);
    const hr = table.tHead && table.tHead.rows[0];
    if (hr) Array.from(hr.cells).forEach(th => { th.classList.add('sortable'); th.tabIndex = 0; th.setAttribute('aria-sort', 'none'); th.title = '押すと並べ替え（昇順 → 降順 → 元の順）'; });
  });
  fitTables(root);
}
/* 横にはみ出さない表は、スクロールしても見出しの行が画面の上に残るようにする */
function fitTables(root) {
  $$('.table-scroll', root).forEach(s => {
    if (s.closest('.slide-body')) return;
    s.classList.remove('fits');
    s.classList.toggle('fits', s.scrollWidth <= s.clientWidth + 1);
  });
}
const sortNum = s => { const m = String(s).replace(/[,，\s]/g, '').replace(/[−–]/g, '-').match(/[-+]?\d*\.?\d+/); return m ? parseFloat(m[0]) : NaN; };
const RE_SORT_NUM = /^[-+−]?[¥$€£]?\s*[-+−]?[\d,，]*\.?\d+\s*\S{0,3}$/;
function sortTable(th) {
  const table = th.closest('table'), tb = table.tBodies[0];
  if (!tb) return;
  const idx = Array.from(th.parentElement.cells).indexOf(th);
  const cur = th.getAttribute('aria-sort');
  const next = cur === 'ascending' ? 'descending' : cur === 'descending' ? 'none' : 'ascending';
  $$('th[aria-sort]', table.tHead).forEach(x => x.setAttribute('aria-sort', 'none'));
  th.setAttribute('aria-sort', next);
  const rows = Array.from(tb.rows);
  if (next === 'none') rows.sort((a, b) => a.dataset.order - b.dataset.order);
  else {
    const val = r => (r.cells[idx] ? r.cells[idx].textContent.trim() : '');
    const filled = rows.map(val).filter(Boolean);
    const numeric = filled.length > 0 && filled.every(v => RE_SORT_NUM.test(v));
    const coll = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (!x !== !y) return !x ? 1 : -1;   // 空の欄は、どちらの向きでも最後
      const c = numeric ? sortNum(x) - sortNum(y) : coll.compare(x, y);
      return next === 'ascending' ? c : -c;
    });
  }
  tb.append(...rows);
}
function filterTable(input) {
  const w = input.closest('.table-wrap'), tb = w.querySelector('tbody');
  const terms = normText(input.value).split(/\s+/).filter(Boolean);
  let shown = 0;
  Array.from(tb.rows).forEach(r => {
    const ok = !terms.length || terms.every(q => normText(r.textContent).includes(q));
    r.hidden = !ok;
    if (ok) shown++;
  });
  const cnt = w.querySelector('.tbl-count');
  if (cnt) cnt.textContent = terms.length ? shown + ' / ' + tb.rows.length + ' 行' : tb.rows.length + ' 行';
  w.classList.toggle('is-filtered', terms.length > 0);
}
/* 見出しの行と、見えている行を、タブ区切り（Excel に貼れる形）にする */
function tableTsv(table) {
  const cell = c => {
    const t = c.textContent.replace(/\s+/g, ' ').trim();
    return /[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const rows = Array.from(table.rows).filter(r => !r.hidden);
  return rows.map(r => Array.from(r.cells).map(cell).join('\t')).join('\n') + '\n';
}

/* ----- グラフ（表示する幅に合わせて描き直す）とツールチップ ----- */
const chartCache = new WeakMap();
function chartDataOf(box) {
  if (!chartCache.has(box)) { let d = null; try { d = JSON.parse(box.dataset.chart); } catch (e) { d = null; } chartCache.set(box, d); }
  return chartCache.get(box);
}
function drawCharts(root) {
  $$('.c-chart[data-chart]', root).forEach(box => {
    const plot = box.querySelector('.chart-plot');
    // スライドでは、描いたものをそのまま拡大する（文字も大きくなる）
    if (!plot || plot.closest('.slide-body')) return;
    const w = plot.clientWidth;
    if (w < 120) return;
    const fs = Math.round(Math.max(12, Math.min(15, parseFloat(getComputedStyle(plot).fontSize) * 0.78)) * 10) / 10;
    const W = Math.min(Math.round(w), 1000), key = W + '/' + fs;
    if (plot.dataset.w === key) return;
    const d = chartDataOf(box);
    if (!d) return;
    plot.innerHTML = Chart.svg(d, W, fs);
    plot.dataset.w = key;
  });
}
let tipOwner = null;
function showTip(owner, build, x, y, below = false) {
  const t = els.tip;
  tipOwner = owner;
  t.replaceChildren();
  build(t);
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = below ? x : x + 14, top = below ? y : y + 16;
  if (left + r.width > innerWidth - 8) left = Math.max(8, (below ? innerWidth - 8 : x - 14) - r.width);
  if (top + r.height > innerHeight - 8) top = Math.max(8, y - r.height - (below ? 32 : 12));
  t.style.left = Math.max(8, left) + 'px';
  t.style.top = Math.max(8, top) + 'px';
}
function hideTip() {
  els.tip.hidden = true;
  if (tipOwner && tipOwner.ownerSVGElement) tipOwner.ownerSVGElement.querySelector('.chart-cross')?.setAttribute('visibility', 'hidden');
  tipOwner = null;
}
const tipLine = (t, cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; t.append(d); return d; };
function chartTip(target, e) {
  const box = target.closest('.c-chart'), d = box && chartDataOf(box);
  if (!d) return;
  let i = target.dataset.i != null ? +target.dataset.i : 0;
  const s = target.dataset.s != null ? +target.dataset.s : null;
  const svg = target.ownerSVGElement;
  if (target.dataset.xs) {
    // 折れ線・面: 縦の線をいちばん近い項目に合わせ、全系列の値を出す
    const xs = target.dataset.xs.split(',').map(Number);
    if (e && e.clientX != null && svg.getScreenCTM()) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const px = pt.matrixTransform(svg.getScreenCTM().inverse()).x;
      i = xs.reduce((best, x, k) => (Math.abs(x - px) < Math.abs(xs[best] - px) ? k : best), 0);
    } else i = Math.max(0, Math.min(xs.length - 1, target._idx || 0));
    target._idx = i;
    const cross = svg.querySelector('.chart-cross');
    if (cross) { cross.setAttribute('x1', xs[i]); cross.setAttribute('x2', xs[i]); cross.setAttribute('visibility', 'visible'); }
  }
  const [head, rows] = Chart.tipRows(d, i, s);
  const rect = target.getBoundingClientRect();
  let cx = e && e.clientX != null ? e.clientX : rect.left + rect.width / 2, cy = e && e.clientY != null ? e.clientY : rect.top + 8;
  if (target.dataset.xs && !(e && e.clientX != null) && svg.getScreenCTM()) {
    const pt = svg.createSVGPoint();
    pt.x = target.dataset.xs.split(',').map(Number)[i]; pt.y = 0;
    cx = pt.matrixTransform(svg.getScreenCTM()).x;
  }
  showTip(target, t => {
    tipLine(t, 'tip-head', head);
    for (const [c, v, n] of rows) {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const k = document.createElement('i');
      k.className = 'tip-key' + (c ? '' : ' none');
      if (c) k.style.setProperty('--c', c);
      const b = document.createElement('b');
      b.textContent = v;
      row.append(k, b);
      if (n) { const sp = document.createElement('span'); sp.textContent = n; row.append(sp); }
      t.append(row);
    }
  }, cx, cy);
}
function termTip(el) {
  if (el.title) { el.dataset.tip = el.title; el.removeAttribute('title'); }
  const r = el.getBoundingClientRect();
  showTip(el, t => {
    tipLine(t, 'tip-head', el.textContent);
    tipLine(t, 'tip-body', el.dataset.tip || '');
    if (el.dataset.ref) tipLine(t, 'tip-hint', '押すと用語集へ移動');
  }, r.left, r.bottom + 6, true);
}

/* ----- 文書内の検索（閉じた折りたたみ・選んでいないタブ・ほかのスライドの中も探す） ----- */
const SEARCH_SKIP = 'script, style, svg, textarea, .gh-raw, .copy-btn, .anchor, .mk, .ln, .tbl-tools, .tab-list, .gh-view, .chart-box, .print-toc, .gh-diff[data-view="unified"] .gh-split, .gh-diff[data-view="split"] .gh-unified';
const Search = {
  hits: [], idx: -1, q: '',
  isOpen: () => !els.search.hidden,
  open() {
    els.search.hidden = false;
    els.searchInput.focus();
    els.searchInput.select();
    if (els.searchInput.value.trim()) this.run();
  },
  close() {
    els.search.hidden = true;
    this.clear();
    this.q = '';
    if (document.activeElement === els.searchInput) els.searchInput.blur();
  },
  clear() {
    this.hits = []; this.idx = -1;
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('search-hit'); CSS.highlights.delete('search-current'); }
    $$('.toc-hits', els.toc).forEach(x => x.remove());
    els.searchCount.textContent = '';
  },
  /* 探す範囲: 読み物では表紙と本文、スライドでは各スライドの中身 */
  roots() {
    if (Slides.active) return Slides.list.map((s, k) => ({ k, nodes: s.kind === 'title' ? [] : s.nodes }));
    return [{ k: -1, nodes: [$('.doc-header', els.doc), ...(state.content ? Array.from(state.content.children) : [])].filter(Boolean) }];
  },
  run() {
    const q = normText(els.searchInput.value.trim()).replace(/\s+/g, ' ');
    this.clear();
    this.q = q;
    if (!q) return;
    for (const root of this.roots()) {
      for (const node of root.nodes) {
        const texts = [];
        const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest(SEARCH_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
        while (w.nextNode()) texts.push(w.currentNode);
        // 正規化した文字列と、元の文字の位置の対応（全角・半角、大文字・小文字の違いは区別しない。空白は 1 つにまとめる）
        let str = '';
        const map = [];
        texts.forEach((tn, ti) => {
          let off = 0;
          for (const ch of tn.data) {
            let n = /\s/.test(ch) ? ' ' : normText(ch);
            if (n === ' ' && str.endsWith(' ')) n = '';
            for (let u = 0; u < n.length; u++) map.push([ti, off, ch.length]);
            str += n;
            off += ch.length;
          }
        });
        for (let p = str.indexOf(q); p >= 0 && this.hits.length < 3000; p = str.indexOf(q, p + q.length)) {
          const a = map[p], b = map[p + q.length - 1];
          const range = document.createRange();
          range.setStart(texts[a[0]], a[1]);
          range.setEnd(texts[b[0]], b[1] + b[2]);
          this.hits.push({ range, slide: root.k, block: node });
        }
      }
    }
    this.paint();
    this.countToc();
    this.updateCount();
  },
  paint() {
    if (!(window.CSS && CSS.highlights && window.Highlight)) return;
    CSS.highlights.set('search-hit', new Highlight(...this.hits.map(h => h.range)));
    const cur = this.hits[this.idx];
    if (cur) CSS.highlights.set('search-current', new Highlight(cur.range)); else CSS.highlights.delete('search-current');
  },
  updateCount() {
    const n = this.hits.length;
    els.searchCount.textContent = !this.q ? '' : !n ? '0 件' : (this.idx >= 0 ? (this.idx + 1) + ' / ' : '') + n + ' 件';
  },
  /* 目次に、章・節ごとの件数を出す（章の件数は、その中の節も含む） */
  countToc() {
    if (Slides.active || !state.content) return;
    const owner = new Map();
    let h2 = null, h3 = null;
    for (const c of state.content.children) {
      if (c.tagName === 'H2') { h2 = c.id; h3 = null; } else if (c.tagName === 'H3') h3 = c.id;
      owner.set(c, [h2, h3]);
    }
    const count = new Map();
    for (const h of this.hits) {
      const o = owner.get(h.block);
      if (!o) continue;
      new Set(o.filter(Boolean)).forEach(id => count.set(id, (count.get(id) || 0) + 1));
    }
    count.forEach((n, id) => {
      const a = els.toc.querySelector('a[data-id="' + CSS.escape(id) + '"]');
      if (a) { const b = document.createElement('span'); b.className = 'toc-hits'; b.textContent = n; a.append(b); }
    });
  },
  goto(dir) {
    const n = this.hits.length;
    if (!n) { if (this.q) toast('見つかりませんでした'); return; }
    this.idx = (this.idx + dir + n) % n;
    const h = this.hits[this.idx];
    if (Slides.active && h.slide >= 0 && h.slide !== Slides.index) Slides.go(h.slide);
    revealNode(h.range.startContainer);
    this.paint();
    this.updateCount();
    if (!(window.CSS && CSS.highlights)) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(h.range); }
    if (!Slides.active) {
      const r = h.range.getBoundingClientRect();
      if (r.top < headerH() + 60 || r.bottom > innerHeight - 40) window.scrollTo({ top: window.scrollY + r.top - innerHeight / 3, behavior: reduceMotion() ? 'auto' : 'smooth' });
    } else {
      const body = $('.slide-body', Slides.shell), r = h.range.getBoundingClientRect(), b = body.getBoundingClientRect();
      if (body.classList.contains('is-overflow') && (r.top < b.top || r.bottom > b.bottom)) body.scrollTop += r.top - b.top - b.height / 3;
    }
  },
};
/* 閉じた折りたたみを開き、選んでいないタブに切り替えて、node を見えるようにする */
function revealNode(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (el.tagName === 'DETAILS' && !el.open) el.open = true;
    if (el.classList.contains('tab-panel') && !el.classList.contains('is-active')) {
      const box = el.parentElement;
      activateTab(box, String($$(':scope > .tab-panel', box).indexOf(el)));
    }
  }
}
function activateTab(box, k) {
  $$(':scope > .tab-list > .tab', box).forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
  $$(':scope > .tab-panel', box).forEach((p, idx) => p.classList.toggle('is-active', String(idx) === k));
  drawCharts(box);
  fitTables(box);
  if (Slides.active) Slides.refit();
}

/* ----- 左メニューの幅 ----- */
const KEY_SIDEBAR_WIDTH = 'hypertext-markdown:sidebar-width';
const SidebarWidth = {
  min: 200,
  // 本文に 480px と左右の余白（最大 64px ずつ）を残す
  max() { return Math.max(this.min, Math.min(480, document.documentElement.clientWidth - 608)); },
  sync() {
    const h = els.sidebarWidthHandle, w = els.sidebar.offsetWidth;
    h.setAttribute('aria-valuemin', String(this.min));
    h.setAttribute('aria-valuemax', String(this.max()));
    h.setAttribute('aria-valuenow', String(w));
    $('.width-label', h).textContent = w + 'px';
  },
  set(px, save) {
    const w = px == null ? null : Math.round(Math.max(this.min, Math.min(this.max(), px)));
    if (w == null) document.documentElement.style.removeProperty('--side-w');
    else document.documentElement.style.setProperty('--side-w', w + 'px');
    if (save) store.set(KEY_SIDEBAR_WIDTH, w == null ? '' : String(w));
    this.sync();
    Width.place();
  },
  start(e) {
    if (e.button !== 0 || !e.isPrimary || isNarrow()) return;
    e.preventDefault();
    const h = els.sidebarWidthHandle, startX = e.clientX, startW = els.sidebar.offsetWidth;
    h.focus({ preventScroll: true });
    document.body.classList.add('sidebar-resizing');
    const move = ev => { if (ev.pointerId === e.pointerId) this.set(startW + ev.clientX - startX, false); };
    const up = ev => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      h.removeEventListener('lostpointercapture', up);
      document.body.classList.remove('sidebar-resizing');
      if (h.hasPointerCapture(e.pointerId)) h.releasePointerCapture(e.pointerId);
      // ドラッグのために当てたフォーカスを外し、ポインターが離れたら取っ手が消えるようにする
      h.blur();
      this.set(els.sidebar.offsetWidth, true);
      Width.done();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    h.addEventListener('lostpointercapture', up);
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* window のイベントでドラッグを続ける */ }
  },
  step(dx) { this.set(els.sidebar.offsetWidth + dx, true); Width.done(); },
  reset() { this.set(null, true); Width.done(); toast('左メニューの幅を標準に戻しました'); },
};

/* ----- 取っ手とスクロールバーを、使うときだけ見せる ----- */
// 取っ手はポインターが近づくと .is-near、スクロールバーはスクロール中と、ポインターを端へ寄せたときに .is-scrolling を付ける
const Quiet = {
  NEAR: 40, EDGE: 14, HIDE_MS: 1000,
  timers: new WeakMap(), held: new Set(), x: -1, y: -1, queued: false,
  show(el) {
    el.classList.add('is-scrolling');
    clearTimeout(this.timers.get(el));
    this.timers.set(el, setTimeout(() => { if (!this.held.has(el)) el.classList.remove('is-scrolling'); }, this.HIDE_MS));
  },
  hold(el, on) {
    if (on) { this.held.add(el); el.classList.add('is-scrolling'); }
    else if (this.held.delete(el)) this.show(el);
  },
  near(h) {
    const r = h.getBoundingClientRect();
    return r.width > 0 && Math.abs(this.x - (r.left + r.width / 2)) <= this.NEAR && this.y >= r.top && this.y <= r.bottom;
  },
  update() {
    this.queued = false;
    const on = this.x >= 0, de = document.documentElement, sb = els.sidebar;
    for (const h of [els.widthHandle, els.sidebarWidthHandle]) h.classList.toggle('is-near', on && this.near(h));
    this.hold(de, on && this.x >= de.clientWidth - this.EDGE);
    const r = sb.getBoundingClientRect(), bar = r.left + sb.clientLeft + sb.clientWidth;
    this.hold(sb, on && sb.scrollHeight > sb.clientHeight && this.x >= bar - this.EDGE && this.x < r.right && this.y >= r.top && this.y <= r.bottom);
  },
  move(e) {
    if (e.pointerType === 'touch') return;
    this.x = e.clientX; this.y = e.clientY;
    if (!this.queued) { this.queued = true; requestAnimationFrame(() => this.update()); }
  },
  leave() { this.x = -1; this.update(); },
};

/* ----- 本文の幅（右端の取っ手をドラッグ。ダブルクリックで標準に戻す） ----- */
const KEY_MEASURE = 'hypertext-markdown:measure';
const Width = {
  min: 480,
  max() { const cs = getComputedStyle(els.main); return els.main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); },
  place() { const d = els.doc; if (d.offsetWidth) els.widthHandle.style.left = (d.offsetLeft + d.offsetWidth + 10) + 'px'; },
  set(px, save) {
    if (px) document.documentElement.style.setProperty('--measure', Math.round(px) + 'px');
    else document.documentElement.style.removeProperty('--measure');
    if (save) store.set(KEY_MEASURE, px ? String(Math.round(px)) : '');
    this.place();
    const w = els.doc.offsetWidth;
    els.widthHandle.setAttribute('aria-valuenow', String(w));
    $('.width-label', els.widthHandle).textContent = w + 'px';
  },
  done() { drawCharts(els.doc); fitTables(els.doc); updateScroll(); },
  start(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const h = els.widthHandle, startX = e.clientX, startW = els.doc.offsetWidth, max = this.max();
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* 取れなくてもドラッグはできる */ }
    document.body.classList.add('resizing');
    const move = ev => this.set(Math.max(this.min, Math.min(max, startW + 2 * (ev.clientX - startX))), false);
    const up = () => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      this.set(els.doc.offsetWidth, true);
      this.done();
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  },
  step(dx) { this.set(Math.max(this.min, Math.min(this.max(), els.doc.offsetWidth + dx)), true); this.done(); },
  reset() { this.set(null, true); this.done(); toast('本文の幅を標準に戻しました'); },
};

/* ----- 文書ごとの見た目（フロントマターの palette・accent・font・mono・logo） ----- */
const PALETTES = {
  indigo: ['#2b4c8c', '#93b2ec'], blue: ['#1f5fbf', '#8ab4f8'], teal: ['#0f6e6e', '#6fcfc9'], green: ['#2c6e3f', '#7fcf96'],
  wine: ['#8c2b4c', '#f0a0b8'], orange: ['#a4501a', '#f2a66b'], purple: ['#5b3aa0', '#c2a6f5'], gray: ['#3d4654', '#b6bfcc'],
};
const PALETTE_ALIAS = { navy: 'indigo', '紺': 'indigo', '藍': 'indigo', '青': 'blue', '青緑': 'teal', '緑': 'green', red: 'wine', '赤': 'wine', 'えんじ': 'wine', brown: 'orange', '橙': 'orange', '茶': 'orange', '紫': 'purple', grey: 'gray', mono: 'gray', slate: 'gray', '灰': 'gray', '墨': 'gray' };
const FONT_SANS = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';
const FONTS = {
  gothic: null, ud: '"BIZ UDPGothic", ' + FONT_SANS, meiryo: 'Meiryo, ' + FONT_SANS, yugothic: '"Yu Gothic", YuGothic, ' + FONT_SANS,
  noto: '"Noto Sans JP", ' + FONT_SANS, system: 'system-ui, -apple-system, "Segoe UI", ' + FONT_SANS,
  mincho: '"BIZ UDPMincho", "Yu Mincho", YuMincho, "Hiragino Mincho ProN", "Noto Serif JP", serif',
};
const FONT_ALIAS = { 'ゴシック': 'gothic', '明朝': 'mincho', 'メイリオ': 'meiryo', '游ゴシック': 'yugothic', 'ud': 'ud', serif: 'mincho', sans: 'gothic' };
const safeColor = v => (/^(#[0-9a-f]{3,8}|(?:rgb|hsl|oklch|oklab|lab|lch)a?\([\d\s.,%\/+-]+\)|[a-z]{3,20})$/i.test(String(v).trim()) ? String(v).trim() : '');
const safeFontList = v => (/^[^;{}<>\\]+$/.test(String(v)) ? String(v).trim() : '');
function docThemeCss(meta) {
  let css = '';
  // 色: palette（名前）か accent（"#色" または "#ライト / #ダーク"）。accent が優先
  let light = '', dark = '';
  // 文書にどちらも無いときは、テンプレートの既定（CONFIG.accent）を使う
  const own = meta.palette || meta.accent;
  const p = String(own ? meta.palette || '' : CONFIG.accent).trim().toLowerCase();
  const pal = PALETTES[PALETTE_ALIAS[p] || p];
  if (pal) [light, dark] = pal;
  const accent = own ? meta.accent : (pal ? '' : CONFIG.accent);
  if (accent) {
    const [a, b] = String(accent).split('/').map(safeColor);
    if (a) { light = a; dark = b || 'color-mix(in oklab, ' + a + ' 55%, white)'; }
  }
  if (light) {
    const L = '--accent:' + light + ';--accent-soft:color-mix(in srgb, ' + light + ' 10%, var(--bg));';
    const D = '--accent:' + dark + ';--accent-soft:color-mix(in srgb, ' + dark + ' 13%, transparent);';
    css += ':root:root{' + L + '}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + D + '}}:root[data-theme="dark"]{' + D + '}'
      + '@media print{:root:not([data-print-none]){--accent:' + light + ';--accent-soft:color-mix(in srgb, ' + light + ' 8%, #fff);}}';
  }
  const fk = String(meta.font || '').trim();
  const font = fk ? (Object.prototype.hasOwnProperty.call(FONTS, FONT_ALIAS[fk] || fk.toLowerCase()) ? FONTS[FONT_ALIAS[fk] || fk.toLowerCase()] : safeFontList(fk)) : null;
  if (font) css += ':root:root{--font:"Backslash Sans", ' + font + ';}';
  const mono = safeFontList(meta.mono || '');
  if (mono) css += ':root:root{--mono:' + mono + ', Consolas, monospace;}';
  return css;
}
/* logo は URL・data: URL・参照形式の名前（[logo]: data:… を本文の末尾に書いた場合）のどれでもよい。
   文書に無いときは、テンプレートの既定（CONFIG.logo と CONFIG.logoDark）を使う。戻り値は [ライト用, ダーク用] */
function docLogo(meta, body) {
  const v = String(meta.logo || '').trim();
  if (!v) return [String(CONFIG.logo || '').trim(), String(CONFIG.logo ? CONFIG.logoDark || '' : '').trim()];
  const inFence = fenceTracker();
  for (const l of body.split('\n')) {
    if (inFence(l)) continue;
    const d = l.match(RX.linkDef);
    if (d && refKey(d[1]) === refKey(v)) return [d[2].replace(/^<([^>]*)>$/, '$1'), ''];
  }
  return [v, ''];
}

/* ===== 操作 ===== */
const ACTIONS = {
  toc: toggleToc, slides: () => Slides.enter(), edit: () => Editor.toggle(),
  md: downloadMd, html: exportHtml, print: () => window.print(), help: () => Help.open(), 'help-close': () => Help.close(),
  'editor-close': () => Editor.close(), 'slide-prev': () => Slides.prev(), 'slide-next': () => Slides.next(),
  'slide-exit': () => Slides.exit(), fullscreen: toggleFullscreen,
  // 版の管理
  versions: () => Versions.open(), 'versions-close': () => Versions.close(),
  'ver-form-confirm': () => openVersionForm('confirm'),
  'ver-form-cancel': () => { verForm = null; renderVersionPanel(); },
  'ver-import': () => els.verFile.click(),
  'ver-view': b => { const i = +b.dataset.i; Versions.close(); if (Editor.isOpen()) Editor.close(); setView(i < 0 ? { mode: 'current' } : { mode: 'version', i }); },
  'ver-diff': b => compareVersions(+b.dataset.a, +b.dataset.b),
  'ver-compare-sel': () => compareVersions(+$('#ui-ver-a').value, +$('#ui-ver-b').value),
  'ver-md': b => { const i = +b.dataset.i; download(state.versions[i].md, baseName() + '-v' + (state.versions[i].version || i).toString().replace(/[\\/:*?"<>|]/g, '_') + '.md', 'text/markdown;charset=utf-8'); },
  'ver-delete': b => deleteVersion(+b.dataset.i),
  'ver-delete-all': () => deleteAllVersions(),
  'ver-exit': () => setView({ mode: 'current' }),
  'ver-compare-this': () => compareVersions(state.view.i, -1),
  'ver-as-doc': () => { if (state.view.mode === 'compare') setView({ ...state.view, as: 'doc' }); },
  'ver-as-md': () => { if (state.view.mode === 'compare') setView({ ...state.view, as: 'md' }); },
  'ver-next': () => gotoChange(1),
  'ver-prev': () => gotoChange(-1),
  // 文書内の検索
  search: () => Search.open(), 'search-next': () => Search.goto(1), 'search-prev': () => Search.goto(-1), 'search-close': () => Search.close(),
};
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (btn && ACTIONS[btn.dataset.action]) { e.preventDefault(); ACTIONS[btn.dataset.action](btn); return; }
  const copy = e.target.closest('.copy-btn');
  if (copy) { copyCode(copy); return; }
  const dv = e.target.closest('[data-diffview]');
  if (dv) {
    diffViewPref = dv.dataset.diffview;
    store.set(KEY_DIFF, diffViewPref);
    syncDiffViews(document);
    if (Slides.active) { Slides.original.forEach(syncDiffViews); Slides.refresh(); }
    return;
  }
  const tab = e.target.closest('.c-tabs .tab');
  if (tab) { activateTab(tab.closest('.c-tabs'), tab.dataset.tab); return; }
  const th = e.target.closest('th.sortable');
  if (th && !Slides.active && state.view.mode !== 'compare') { sortTable(th); return; }
  const tcopy = e.target.closest('.tbl-copy');
  if (tcopy) {
    copyText(tableTsv(tcopy.closest('.table-wrap').querySelector('table'))).then(ok => {
      tcopy.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
      setTimeout(() => { tcopy.textContent = 'コピー'; }, 1600);
    });
    return;
  }
  const term = e.target.closest('abbr.term[data-ref]');
  if (term && !Slides.active) {
    const t = document.getElementById(term.dataset.ref);
    if (t) { hideTip(); t.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' }); t.classList.remove('is-flash'); void t.offsetWidth; t.classList.add('is-flash'); }
    return;
  }
  if (e.target.closest('#ui-toc a') && isNarrow()) closeDrawer();
});
document.addEventListener('input', e => { if (e.target.matches && e.target.matches('.tbl-filter')) filterTable(e.target); });
/* ツールチップ: グラフ（棒・帯は棒ごと、折れ線は縦の線で項目ごと）と、用語の意味 */
document.addEventListener('pointermove', e => {
  const h = e.target.closest && e.target.closest('.chart-hit');
  if (h) chartTip(h, e);
  else if (tipOwner && tipOwner.classList && tipOwner.classList.contains('chart-hit')) hideTip();
});
document.addEventListener('pointerover', e => {
  const t = e.target.closest && e.target.closest('abbr.term');
  if (t && tipOwner !== t) termTip(t);
});
document.addEventListener('pointerout', e => {
  const t = e.target.closest && e.target.closest('abbr.term, .chart-hit');
  if (t && t === tipOwner && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip();
});
document.addEventListener('focusin', e => {
  const t = e.target;
  if (t.matches && t.matches('abbr.term')) termTip(t);
  else if (t.matches && t.matches('.chart-hit')) chartTip(t, null);
});
document.addEventListener('focusout', e => { if (e.target === tipOwner) hideTip(); });
window.addEventListener('scroll', () => { if (tipOwner) hideTip(); }, { passive: true });
els.searchInput.addEventListener('input', debounce(() => Search.run(), 150));
els.searchInput.addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (Search.q !== normText(els.searchInput.value.trim()).replace(/\s+/g, ' ')) Search.run();
    Search.goto(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); Search.close(); }
});
els.widthHandle.addEventListener('pointerdown', e => Width.start(e));
els.sidebarWidthHandle.addEventListener('pointerdown', e => SidebarWidth.start(e));
els.sidebarWidthHandle.addEventListener('dblclick', () => SidebarWidth.reset());
els.sidebarWidthHandle.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); SidebarWidth.step(e.key === 'ArrowRight' ? 16 : -16); }
  else if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); SidebarWidth.reset(); }
});
els.widthHandle.addEventListener('dblclick', () => Width.reset());
els.widthHandle.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); Width.step(e.key === 'ArrowRight' ? 32 : -32); }
  else if (e.key === 'Home' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); Width.reset(); }
});
els.backdrop.addEventListener('click', closeDrawer);
els.help.addEventListener('click', e => { if (e.target === els.help) Help.close(); });
els.versions.addEventListener('click', e => { if (e.target === els.versions) Versions.close(); });
els.themeTrigger.addEventListener('click', () => {
  if (els.themeMenu.hidden) Theme.open(); else Theme.close();
});
els.themeMenu.addEventListener('click', e => {
  const option = e.target.closest('[data-theme-mode]');
  if (option) { Theme.choose(option.dataset.themeMode); els.themeTrigger.focus(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.theme-picker')) Theme.close(); });
document.addEventListener('focusin', e => { if (!e.target.closest('.theme-picker')) Theme.close(); });
$('.theme-picker').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); Theme.close(true); return; }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    e.preventDefault(); e.stopPropagation();
    if (els.themeMenu.hidden) { Theme.open(); return; }
    const options = $$('[data-theme-mode]', els.themeMenu);
    const i = options.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (i + (e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
    options[next].focus();
  }
});
els.verFile.addEventListener('change', () => { const f = els.verFile.files[0]; els.verFile.value = ''; if (f) importFile(f); });

let jumpBuf = '';
document.addEventListener('keydown', e => {
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k.toLowerCase() === 's') { e.preventDefault(); exportHtml(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) {
    if (k === 'Escape') e.target.blur();
    return;
  }
  // 表の見出し（並べ替え）と、折れ線グラフ（← → で項目を移る）
  if (e.target.matches && e.target.matches('th.sortable') && (k === 'Enter' || k === ' ')) { e.preventDefault(); sortTable(e.target); return; }
  if (e.target.matches && e.target.matches('.chart-hit[data-xs]') && (k === 'ArrowLeft' || k === 'ArrowRight')) {
    e.preventDefault();
    e.target._idx = (e.target._idx || 0) + (k === 'ArrowRight' ? 1 : -1);
    chartTip(e.target, null);
    return;
  }
  if (k === '/' && els.help.hidden && els.versions.hidden) { e.preventDefault(); Search.open(); return; }
  if (k === 'Escape' && Search.isOpen()) { e.preventDefault(); Search.close(); return; }
  if (!els.help.hidden) {
    if (k === 'Escape' || k === '?') { e.preventDefault(); Help.close(); }
    return;
  }
  if (!els.versions.hidden) {
    if (k === 'Escape' || k === 'v' || k === 'V') { e.preventDefault(); Versions.close(); }
    return;
  }
  if (Slides.active) {
    if (/^[0-9]$/.test(k)) { jumpBuf += k; return; }
    if (k === 'Enter' && jumpBuf) { e.preventDefault(); Slides.go(parseInt(jumpBuf, 10) - 1); jumpBuf = ''; return; }
    jumpBuf = '';
    switch (k) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case 'Enter': case 'n': case 'j': case 'l': Slides.next(); break;
      case ' ': if (e.shiftKey) Slides.prev(); else Slides.next(); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': case 'p': case 'k': case 'h': Slides.prev(); break;
      case 'Home': Slides.go(0); break;
      case 'End': Slides.go(Slides.list.length - 1); break;
      case 'Escape': case 's': case 'S': Slides.exit(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 't': case 'T': Theme.cycle(); break;
      case '?': Help.open(); break;
      default: return;
    }
    e.preventDefault();
    return;
  }
  switch (k) {
    case 'j': case 'J': jumpHeading(1); break;
    case 'k': case 'K': jumpHeading(-1); break;
    case 't': case 'T': Theme.cycle(); break;
    case 'b': case 'B': toggleToc(); break;
    case 's': Slides.enter(); break;
    case 'S': Slides.enter(0); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'e': case 'E': Editor.toggle(); break;
    case 'd': case 'D': downloadMd(); break;
    case 'v': case 'V': Versions.open(); break;
    case 'n': if (state.view.mode === 'compare') gotoChange(1); else return; break;
    case 'N': if (state.view.mode === 'compare') gotoChange(-1); else return; break;
    case '?': Help.open(); break;
    case 'Escape':
      if (document.body.classList.contains('toc-open')) closeDrawer();
      else if (Editor.isOpen()) Editor.close();
      else if (state.view.mode !== 'current') setView({ mode: 'current' });
      else return;
      break;
    default: return;
  }
  e.preventDefault();
});

els.textarea.addEventListener('input', debounce(() => {
  const y = window.scrollY;
  setMarkdown(els.textarea.value);
  window.scrollTo({ top: y, behavior: 'instant' });
}, 250));
els.textarea.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  if (!document.execCommand('insertText', false, '  ')) {
    els.textarea.setRangeText('  ', els.textarea.selectionStart, els.textarea.selectionEnd, 'end');
    els.textarea.dispatchEvent(new Event('input'));
  }
});

let uiTimer;
els.slides.addEventListener('mousemove', () => {
  els.slides.classList.add('show-ui');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => els.slides.classList.remove('show-ui'), 2000);
});
let touchX = null;
els.slides.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
els.slides.addEventListener('touchend', e => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) { if (dx < 0) Slides.next(); else Slides.prev(); }
});

/* 編集欄に画像を貼り付け・ドロップすると、base64 にして埋め込む。
   本文のカーソル位置には ![名前][名前] を、長い data: URL の定義は Markdown の末尾にまとめて置く */
const isImageFile = f => /^image\//.test(f.type);
const readDataUrl = f => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(f); });
async function embedImages(fileList) {
  const files = Array.from(fileList).filter(isImageFile);
  if (!files.length) return;
  const ta = els.textarea;
  const pos = ta.selectionStart;
  const used = new Set(ta.value.split('\n').map(l => l.match(RX.linkDef)).filter(Boolean).map(d => refKey(d[1])));
  const refs = [], defs = [];
  let bytes = 0;
  for (const f of files) {
    let url;
    try { url = await readDataUrl(f); } catch (err) { toast(f.name + ' を読み込めませんでした'); continue; }
    bytes += url.length;
    // ファイル名を代替テキスト（図の表題）と定義の名前にする。クリップボードの画像は名前が「image.png」なので、表題は空にして名前は image-2… と番号を振る
    const stem = f.name && !/^image\.\w+$/i.test(f.name) ? f.name.replace(/\.[^.]+$/, '') : '';
    const alt = stem.replace(/[\[\]]/g, '');
    const base = alt.replace(/\s+/g, '-').slice(0, 40) || 'image';
    let id = base, n = 1;
    while (used.has(refKey(id))) id = base + '-' + (++n);
    used.add(refKey(id));
    refs.push('![' + alt + '][' + id + ']');
    defs.push('[' + id + ']: ' + url);
  }
  if (!refs.length) return;
  const v = ta.value;
  const lastLine = v.replace(/\n+$/, '').split('\n').pop() || '';
  const tail = (v.endsWith('\n') ? '' : '\n') + (RX.linkDef.test(lastLine) ? '' : '\n') + defs.join('\n') + '\n';
  // 画像は 1 枚ずつ段落にする（画像だけの段落は図として中央に置かれる）。前後に空行が無ければ足す
  const before = v.slice(0, pos), after = v.slice(pos);
  const pre = !before || /\n\n$/.test(before) ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after || /^\n\n/.test(after) ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const refText = pre + refs.join('\n\n') + post;
  const insert = (at, text) => {
    ta.setSelectionRange(at, at);
    if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, at, at, 'end');
  };
  ta.focus();
  insert(v.length, tail);   // 先に末尾へ定義を足す（カーソルより後ろなので、カーソルの位置はずれない）
  insert(pos, refText);
  const caret = pos + refText.length - post.length;
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event('input'));
  const kb = Math.max(1, Math.round(bytes / 1024));
  toast('画像を ' + refs.length + ' 枚埋め込みました（' + kb + 'KB）。定義は Markdown の末尾にあります' + (kb > 1024 ? '。大きいので、縮小してから入れることをおすすめします' : ''));
}
els.textarea.addEventListener('paste', e => {
  const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
  if (!files.some(isImageFile)) return;
  e.preventDefault();
  embedImages(files);
});

/* ドラッグ＆ドロップで .md を読み込む（UTF-8 でなければ Shift_JIS として読む）。編集中は画像も受け付ける */
let dragDepth = 0;
const hasFiles = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
const dragsImage = e => Array.from((e.dataTransfer && e.dataTransfer.items) || []).some(it => it.kind === 'file' && /^image\//.test(it.type));
window.addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (++dragDepth === 1) {
    $('div', els.drop).textContent = !dragsImage(e) ? 'Markdown ファイルをドロップして読み込む'
      : Editor.isOpen() ? '画像をドロップして、カーソルの位置に埋め込む' : '画像は、編集欄（E）を開いてからドロップしてください';
    els.drop.hidden = false;
  }
});
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; els.drop.hidden = true; } });
window.addEventListener('drop', async e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.drop.hidden = true;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (isImageFile(file)) {
    if (Editor.isOpen()) embedImages(e.dataTransfer.files);
    else toast('画像は、編集欄（E）を開いてから貼り付けるかドロップすると埋め込めます');
    return;
  }
  if (!/\.(md|markdown|mdown|txt)$/i.test(file.name) && !/^text\//.test(file.type)) { toast('読み込めるのは .md・.markdown・.txt のファイルです'); return; }
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (err) { text = new TextDecoder('shift_jis').decode(buf); }
  // 版があるファイルに読み込むときは、新しい文書として版を消すか、同じ文書の続きとして残すかを聞く
  const n = state.versions.length;
  const clear = n > 0 && window.confirm('このファイルには確定した版が ' + n + ' 件あります。\n'
    + '読み込んだ Markdown を新しい文書として始めるなら、版を消してください。\n\n'
    + 'OK：版を消す\nキャンセル：版を残す（同じ文書の新しい内容として、版と比べられる）');
  if (clear) state.versions = [];
  if (state.view.mode !== 'current') setHash('');
  state.fileBase = file.name.replace(/\.[^.]+$/, '');
  setMarkdown(text);
  window.scrollTo({ top: 0, behavior: 'instant' });
  toast(file.name + ' を読み込みました' + (clear ? '（版は消しました）' : '') + '。Ctrl+S で HTML として保存できます');
});

const openedDetails = [];
window.addEventListener('beforeprint', () => {
  if (Slides.active) { Slides.preparePrint(); return; }
  $$('details:not([open])', els.doc).forEach(d => { d.open = true; openedDetails.push(d); });
});
window.addEventListener('afterprint', () => {
  if (document.body.classList.contains('print-slides')) { Slides.afterPrint(); return; }
  openedDetails.splice(0).forEach(d => { d.open = false; });
});
window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('scroll', () => Quiet.show(document.documentElement), { passive: true });
// 目次は読んでいる見出しに合わせて自動で動く（setCurrent）。ホイール・タッチ・キー・スクロールバーのドラッグの直後か
// 押している間のスクロールだけを、利用者の操作として知らせる
let tocUserUntil = 0, tocPressed = false;
const tocUser = () => { tocUserUntil = performance.now() + 800; };
for (const type of ['wheel', 'touchstart', 'touchmove', 'keydown']) els.sidebar.addEventListener(type, tocUser, { passive: true });
els.sidebar.addEventListener('pointerdown', () => { tocPressed = true; tocUser(); }, { passive: true });
window.addEventListener('pointerup', () => { tocPressed = false; }, { passive: true });
window.addEventListener('pointercancel', () => { tocPressed = false; }, { passive: true });
els.sidebar.addEventListener('scroll', () => {
  if (!tocPressed && performance.now() > tocUserUntil) return;
  tocUser();
  Quiet.show(els.sidebar);
}, { passive: true });
document.addEventListener('pointermove', e => Quiet.move(e), { passive: true });
document.documentElement.addEventListener('pointerleave', () => Quiet.leave());
window.addEventListener('blur', () => Quiet.leave());
const relayout = debounce(() => { if (Slides.active) return; drawCharts(els.doc); fitTables(els.doc); Width.place(); SidebarWidth.sync(); }, 150);
window.addEventListener('resize', () => { if (Slides.active) Slides.layout(); else { onScroll(); relayout(); } });
// 目次や編集欄の開閉で本文の列の幅が変わったときも、グラフ・表・幅の取っ手を合わせる
if (window.ResizeObserver) new ResizeObserver(relayout).observe(els.main);
document.addEventListener('fullscreenchange', () => { if (Slides.active) Slides.layout(); });

/* ===== 起動 ===== */
function init() {
  Slides.shell = makeSlideShell();
  els.stage.append(Slides.shell);
  if (store.get(KEY_TOC) === 'hidden') document.body.classList.add('toc-hidden');
  const mw = parseInt(store.get(KEY_MEASURE), 10);
  if (mw >= Width.min) document.documentElement.style.setProperty('--measure', mw + 'px');
  const sw = parseInt(store.get(KEY_SIDEBAR_WIDTH), 10);
  if (sw >= SidebarWidth.min && sw <= 480) document.documentElement.style.setProperty('--side-w', sw + 'px');
  SidebarWidth.sync();
  Theme.sync();
  const md = readSource();
  const drawnNow = !els.doc.firstElementChild;
  state.savedMd = md;
  state.versions = readVersions();
  state.savedVersionsKey = versionsKey();
  render(md, true);
  // 開いたときに 1 度だけ、表紙を上から順に出す。編集のたびに繰り返さないように、終わったら外す
  if (drawnNow && location.hash.length <= 1) {
    els.doc.classList.add('intro');
    setTimeout(() => els.doc.classList.remove('intro'), 2000);
  }
  updateDirty();
  const sm = location.hash.match(/^#slide-(\d+)$/);
  const vh = viewFromHash(location.hash);
  if (vh) setView(vh);
  else if (sm) Slides.enter(parseInt(sm[1], 10) - 1);
  else if (location.hash.length > 1) {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { id = location.hash.slice(1); }
    const t = document.getElementById(id);
    if (t) t.scrollIntoView({ behavior: 'instant' });
  }
}
init();
})();
