// PowerPoint (.pptx) import.
// Reads the presentation XML and builds a Matekos Prezi document:
//  - slide masters / layouts -> template (backgrounds, decorations, title/body placeholders for new slides)
//  - text boxes (paragraphs, runs, bullets, fonts, colours, sizes), shapes, pictures, tables, groups
//  - MathType / Equation Editor objects -> TeX formulas (mtef.js), placed INTO the text where the old file
//    left room for them (runs of spaces / tabs, a text box split in two, formula at a line end); otherwise
//    a formula box of the same size
//  - animations and transitions that Prezi knows
// Everything that cannot be converted is listed in the import report.
import JSZip from 'jszip';
import { oleToTeX } from './mtef.js';
import { uid, W, H } from './model.js';

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const parseXML = s => new DOMParser().parseFromString(s, 'application/xml');
const ch = (el, name) => el ? [...el.children].find(c => c.localName === name) || null : null;
const chs = (el, name) => el ? [...el.children].filter(c => c.localName === name) : [];
const desc = (el, name) => el ? el.getElementsByTagNameNS('*', name)[0] || null : null;
const descs = (el, name) => el ? [...el.getElementsByTagNameNS('*', name)] : [];
const path = (...ns) => ns.reduce((e, n) => ch(e, n), ns.shift());
const num = (v, d = 0) => v == null || v === '' ? d : +v;
const rid = el => el && (el.getAttributeNS(NS_R, 'id') || el.getAttribute('r:id') || el.getAttributeNS(NS_R, 'embed') || el.getAttribute('r:embed'));

/* ---------- package helpers ---------- */
async function readXML(zip, p) { const f = zip.file(p); return f ? parseXML(await f.async('string')) : null; }
function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}
async function rels(zip, p) {
  const parts = p.split('/'), file = parts.pop(), x = await readXML(zip, [...parts, '_rels', file + '.rels'].join('/'));
  const out = {};
  if (x) for (const r of descs(x, 'Relationship')) out[r.getAttribute('Id')] = {type: r.getAttribute('Type').split('/').pop(), target: r.getAttribute('TargetMode') === 'External' ? null : resolvePath(p, r.getAttribute('Target'))};
  return out;
}

/* ---------- colours ---------- */
const PRST = {black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', gray: '808080', grey: '808080', darkGray: 'a9a9a9', lightGray: 'd3d3d3', orange: 'ffa500'};
function hexToRgb(h) { return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
function rgbToHex(c) { return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function rgbToHsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hslToRgb([h, s, l]) { if (!s) return [l * 255, l * 255, l * 255]; const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]; }
/** colour element container (solidFill, a:fgClr …) -> '#rrggbb' or null. */
function colorOf(holder, ctx, phClr) {
  if (!holder) return null;
  const c = [...holder.children].find(e => /^(srgbClr|schemeClr|sysClr|prstClr|scrgbClr|hslClr)$/.test(e.localName)); if (!c) return null;
  let hex = null;
  if (c.localName === 'srgbClr') hex = c.getAttribute('val');
  else if (c.localName === 'sysClr') hex = c.getAttribute('lastClr') || (c.getAttribute('val') === 'window' ? 'ffffff' : '000000');
  else if (c.localName === 'prstClr') hex = PRST[c.getAttribute('val')] || '000000';
  else if (c.localName === 'scrgbClr') hex = rgbToHex(['r', 'g', 'b'].map(k => num(c.getAttribute(k)) / 100000 * 255)).slice(1);
  else if (c.localName === 'schemeClr') { let v = c.getAttribute('val'); if (v === 'phClr') return phClr || null; v = ctx.clrMap[v] || v; hex = ctx.theme.colors[v]; }
  if (!hex) return null;
  let rgb = hexToRgb(hex);
  for (const m of c.children) {
    const v = num(m.getAttribute('val')) / 100000;
    if (m.localName === 'lumMod') { const h = rgbToHsl(rgb); h[2] *= v; rgb = hslToRgb(h); }
    else if (m.localName === 'lumOff') { const h = rgbToHsl(rgb); h[2] = Math.min(1, h[2] + v); rgb = hslToRgb(h); }
    else if (m.localName === 'tint') rgb = rgb.map(x => x * v + 255 * (1 - v));
    else if (m.localName === 'shade') rgb = rgb.map(x => x * v);
  }
  return rgbToHex(rgb);
}

/* ---------- fonts: PowerPoint names -> Prezi families (metric-compatible where possible) ---------- */
const FONT_MAP = [[/^arial|helvetica|liberation sans|arimo/i, 'liberationsans'], [/^calibri|carlito/i, 'carlito'], [/^cambria(?! math)|caladea/i, 'caladea'],
  [/^times|tinos|liberation serif/i, 'termes'], [/^courier|consolas|liberation mono|cousine/i, 'liberationmono'], [/^verdana|tahoma|segoe|trebuchet|noto sans/i, 'notosans'],
  [/^georgia|noto serif/i, 'notoserif'], [/^comic/i, 'comicneue'], [/^garamond|libertine/i, 'libertine'], [/^palatino|book antiqua|pagella/i, 'pagella'],
  [/^bookman|bonum/i, 'bonum'], [/^century schoolbook|schola/i, 'schola'], [/^roboto/i, 'roboto'], [/^open sans/i, 'opensans'], [/^lato/i, 'lato'],
  [/^montserrat/i, 'montserrat'], [/^inter\b/i, 'inter'], [/^ubuntu/i, 'ubuntu'], [/^fira/i, 'fira'], [/^dejavu/i, 'dejavu'], [/^latin modern|lm roman/i, 'lmodern']];
const mapFont = name => { if (!name) return null; for (const [re, k] of FONT_MAP) if (re.test(name)) return k; return null; };

/* ---------- text style inheritance ---------- */
const LVL = l => `lvl${l}pPr`;
function lvlPPr(lstStyle, lvl) { return lstStyle ? ch(lstStyle, LVL(lvl)) : null; }
/** First value found in the chain of pPr elements (most specific first). */
function pick(chain, fn) { for (const p of chain) { if (!p) continue; const v = fn(p); if (v != null) return v; } return null; }

/* ---------- geometry ---------- */
function xfrmOf(el) {
  if (!el || !el.children) return null;
  const pr = ch(el, 'spPr') || ch(el, 'grpSpPr');
  const x = (pr && ch(pr, 'xfrm')) || ch(el, 'xfrm'); if (!x) return null;
  const off = ch(x, 'off'), ext = ch(x, 'ext'); if (!off || !ext) return null;
  return {x: num(off.getAttribute('x')), y: num(off.getAttribute('y')), cx: num(ext.getAttribute('cx')), cy: num(ext.getAttribute('cy')),
    rot: num(x.getAttribute('rot')) / 60000, flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1',
    chOff: ch(x, 'chOff'), chExt: ch(x, 'chExt')};
}

/* ======================================================================= */
export async function importPptx(buf, {onProgress} = {}) {
  const zip = await JSZip.loadAsync(buf);
  const report = {slides: 0, formulas: 0, inline: 0, standalone: 0, failed: [], skipped: []};
  const pres = await readXML(zip, 'ppt/presentation.xml');
  if (!pres) throw new Error('Ez nem PowerPoint-bemutató (.pptx).');
  const presRels = await rels(zip, 'ppt/presentation.xml');
  const sz = desc(pres, 'sldSz'), CX = num(sz?.getAttribute('cx'), 12192000), CY = num(sz?.getAttribute('cy'), 6858000);
  const k = Math.min(W / (CX / 9525), H / (CY / 9525)), OX = (W - CX / 9525 * k) / 2, OY = (H - CY / 9525 * k) / 2;
  const px = emu => emu / 9525 * k, X = emu => OX + px(emu), Y = emu => OY + px(emu);
  const ptToPx = pt => pt / 0.75 * k;
  const defaultTextStyle = desc(pres, 'defaultTextStyle');
  const media = {}, mediaKeyOf = new Map();
  const slidePaths = descs(desc(pres, 'sldIdLst'), 'sldId').map(s => presRels[rid(s)]?.target).filter(Boolean);

  async function mediaKey(p) {
    if (mediaKeyOf.has(p)) return mediaKeyOf.get(p);
    const f = zip.file(p); if (!f) return null;
    const ext = p.split('.').pop().toLowerCase(), mime = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp'}[ext];
    if (!mime) { mediaKeyOf.set(p, null); return null; }
    const key = 'img' + uid(); media[key] = `data:${mime};base64,` + await f.async('base64'); mediaKeyOf.set(p, key); return key;
  }

  /* ---- theme / master / layout caches ---- */
  const parts = new Map();
  async function part(p) {
    if (parts.has(p)) return parts.get(p);
    const xml = await readXML(zip, p), r = await rels(zip, p), v = {path: p, xml, rels: r};
    parts.set(p, v); return v;
  }
  async function themeOf(master) {
    if (master.theme) return master.theme;
    const t = Object.values(master.rels).find(r => r.type === 'theme'), x = t ? await readXML(zip, t.target) : null, colors = {}, fonts = {};
    const cs = desc(x, 'clrScheme');
    if (cs) for (const c of cs.children) { const v = c.firstElementChild; if (v) colors[c.localName] = v.getAttribute('val') && v.localName === 'srgbClr' ? v.getAttribute('val') : v.getAttribute('lastClr') || v.getAttribute('val'); }
    fonts.major = desc(desc(x, 'majorFont'), 'latin')?.getAttribute('typeface'); fonts.minor = desc(desc(x, 'minorFont'), 'latin')?.getAttribute('typeface');
    const lnW = descs(desc(x, 'lnStyleLst'), 'ln').map(l => num(l.getAttribute('w'), 12700));
    master.theme = {colors, fonts, lnW}; return master.theme;
  }
  const clrMapOf = el => { const m = desc(el, 'clrMap'); const o = {}; if (m) for (const a of m.attributes) o[a.name] = a.value; return o; };

  /* ---- placeholders ---- */
  const phOf = sp => desc(ch(ch(sp, 'nvSpPr') || ch(sp, 'nvPicPr') || ch(sp, 'nvGraphicFramePr'), 'nvPr'), 'ph');
  const phType = ph => ph ? (ph.getAttribute('type') || 'body') : null;
  const sameKind = (a, b) => a === b || ({ctrTitle: 'title', title: 'title', subTitle: 'body', body: 'body', obj: 'body'}[a] === ({ctrTitle: 'title', title: 'title', subTitle: 'body', body: 'body', obj: 'body'}[b]));
  function findPh(tree, ph) {
    if (!tree || !ph) return null;
    const idx = ph.getAttribute('idx'), type = phType(ph);
    const sps = descs(tree, 'sp');
    return sps.find(sp => { const p = phOf(sp); return p && idx != null && p.getAttribute('idx') === idx; })
      || sps.find(sp => { const p = phOf(sp); return p && sameKind(phType(p), type); }) || null;
  }

  /* ---- text ---- */
  function txStyleFor(master, type) {
    const ts = desc(master.xml, 'txStyles');
    if (!ts) return null;
    if (type === 'title' || type === 'ctrTitle') return ch(ts, 'titleStyle');
    if (type) return ch(ts, 'bodyStyle');
    return ch(ts, 'otherStyle');
  }
  /** txBody -> {paras:[{align, lvl, bullet, lineHeight, marL, indent, runs:[{text, bold…}|{br}]}], insets, anchor, fontScale} */
  function readText(txBody, chainLst, ctx, defColor) {
    const bodyPr = ch(txBody, 'bodyPr'), norm = ch(bodyPr, 'normAutofit');
    const fontScale = norm ? num(norm.getAttribute('fontScale'), 100000) / 100000 : 1;
    const ins = a => bodyPr && bodyPr.getAttribute(a) != null ? px(num(bodyPr.getAttribute(a))) : null;
    const insets = {l: ins('lIns') ?? px(91440), t: ins('tIns') ?? px(45720), r: ins('rIns') ?? px(91440), b: ins('bIns') ?? px(45720)};
    const anchor = bodyPr?.getAttribute('anchor') || 't', wrapNone = bodyPr?.getAttribute('wrap') === 'none';
    const paras = [];
    for (const p of chs(txBody, 'p')) {
      const pPr = ch(p, 'pPr'), lvl = num(pPr?.getAttribute('lvl')) + 1;
      const chain = [pPr, ...chainLst.map(l => lvlPPr(l, lvl))];
      const defR = chain.map(e => e && ch(e, 'defRPr'));
      const attr = (name) => pick(chain, e => e.getAttribute(name));
      const buNone = pick(chain, e => ch(e, 'buNone') ? 'none' : ch(e, 'buChar') ? 'char' : ch(e, 'buAutoNum') ? 'num' : ch(e, 'buBlip') ? 'char' : null);
      const buChar = pick(chain, e => ch(e, 'buChar')?.getAttribute('char'));
      const buNum = pick(chain, e => ch(e, 'buAutoNum')?.getAttribute('type'));
      const lnPct = pick(chain, e => { const s = desc(ch(e, 'lnSpc'), 'spcPct'); return s ? num(s.getAttribute('val')) / 100000 : null; });
      const runStyle = rPr => {
        const all = [rPr, ...defR];
        const g = n => pick(all, e => e.getAttribute(n));
        const sizeHund = num(g('sz'), 1800);
        const own = pick(all.slice(0, 3), e => colorOf(ch(e, 'solidFill'), ctx));
        const fill = own || defColor || pick(all.slice(3), e => colorOf(ch(e, 'solidFill'), ctx));
        let face = pick(all, e => ch(e, 'latin')?.getAttribute('typeface'));
        if (face === '+mj-lt') face = ctx.theme.fonts.major; else if (face === '+mn-lt' || !face) face = face === '+mn-lt' || !face ? (ctx.isTitle ? ctx.theme.fonts.major : ctx.theme.fonts.minor) : face;
        return {size: ptToPx(sizeHund / 100 * fontScale), bold: g('b') === '1', italic: g('i') === '1', underline: !!g('u') && g('u') !== 'none',
          strike: !!g('strike') && g('strike') !== 'noStrike', color: fill || '#000000', font: mapFont(face), upper: g('cap') === 'all',
          base: num(g('baseline')) / 1000};
      };
      const runs = [];
      for (const r of p.children) {
        if (r.localName === 'r' || r.localName === 'fld') runs.push({text: ch(r, 't')?.textContent ?? '', ...runStyle(ch(r, 'rPr'))});
        else if (r.localName === 'br') runs.push({br: true, ...runStyle(ch(r, 'rPr'))});
      }
      const endStyle = runStyle(ch(p, 'endParaRPr'));
      paras.push({align: {ctr: 'center', r: 'right', just: 'justify', dist: 'justify'}[attr('algn')] || 'left', lvl, runs, endStyle,
        bullet: buNone === 'char' ? {type: 'bullet', ch: buChar || '•'} : buNone === 'num' ? {type: 'num', style: buNum} : null,
        lineHeight: lnPct ? Math.round(lnPct * 1.2 * 100) / 100 : null});
    }
    return {paras, insets, anchor, wrapNone};
  }
  const hasText = t => t.paras.some(p => p.runs.some(r => r.text && r.text.trim()));

  /* ---- shapes ---- */
  /** Transparency of a colour holder (a:alpha), 1 = opaque. */
  const alphaOf = holder => { const c = holder && [...holder.children].find(e => /Clr$/.test(e.localName)); const a = c && ch(c, 'alpha'); return a ? num(a.getAttribute('val'), 100000) / 100000 : 1; };
  const refIdx = el => el ? num(el.getAttribute('idx'), 0) : 0;
  const lineProps = (spPr, styleEl, ctx) => {
    const ln = ch(spPr, 'ln'), ref = styleEl && ch(styleEl, 'lnRef');
    if (ln && ch(ln, 'noFill')) return null;
    const own = ln && ch(ln, 'solidFill');
    const c = own ? colorOf(own, ctx) : ref && refIdx(ref) > 0 ? colorOf(ref, ctx) : null;
    if (!c) return null;
    const w = ln?.getAttribute('w') != null ? num(ln.getAttribute('w')) : ref && refIdx(ref) > 0 ? (ctx.theme.lnW?.[refIdx(ref) - 1] ?? 12700) : 12700;
    const HEAD = {triangle: 'triangle', stealth: 'triangle', arrow: 'arrow', oval: 'circle', diamond: 'diamond'};
    const pd = ln && ch(ln, 'prstDash')?.getAttribute('val');
    const dash = !pd || pd === 'solid' ? undefined : /dot$/i.test(pd) && !/dash/i.test(pd) ? 'dot' : /dashdot/i.test(pd) ? 'dashdot' : 'dash';
    return {stroke: c, strokeWidth: Math.max(0.5, Math.round(px(w) * 10) / 10), alpha: own ? alphaOf(own) : 1, dash,
      headStart: HEAD[ln && ch(ln, 'headEnd')?.getAttribute('type')], headEnd: HEAD[ln && ch(ln, 'tailEnd')?.getAttribute('type')]};
  };
  const fillProp = (spPr, styleEl, ctx) => {
    if (!spPr) return undefined;
    if (ch(spPr, 'noFill')) return null;
    const sf = ch(spPr, 'solidFill'); if (sf) return colorOf(sf, ctx);
    if (ch(spPr, 'gradFill')) { const gs = desc(spPr, 'gs'); return gs ? colorOf(gs, ctx) : null; }
    if (ch(spPr, 'pattFill')) return colorOf(ch(ch(spPr, 'pattFill'), 'fgClr'), ctx);
    const ref = styleEl && ch(styleEl, 'fillRef');
    if (ref && !ch(spPr, 'blipFill')) return refIdx(ref) > 0 ? colorOf(ref, ctx) : null;
    return undefined;
  };
  const fillAlpha = spPr => { const sf = spPr && (ch(spPr, 'solidFill') || desc(ch(spPr, 'gradFill'), 'gs')); return sf ? alphaOf(sf) : 1; };

  /* PowerPoint shapes Prezi does not have as such: outlines in a unit box (0..1), drawn at any size */
  const reg = (n, r0 = 0.5, rot = -90) => Array.from({length: n}, (_, i) => { const a = (rot + i * 360 / n) * Math.PI / 180; return [0.5 + r0 * Math.cos(a), 0.5 + r0 * Math.sin(a)]; });
  const poly = pts => [['M', ...pts[0]], ...pts.slice(1).map(p => ['L', ...p]), ['Z']];
  const star = (n, inner) => poly(Array.from({length: n * 2}, (_, i) => { const a = (-90 + i * 180 / n) * Math.PI / 180, r = i % 2 ? inner * 0.5 : 0.5; return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]; }));
  const PRESET_PATHS = {
    rtTriangle: poly([[0, 0], [0, 1], [1, 1]]), diamond: poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]),
    parallelogram: poly([[0.25, 0], [1, 0], [0.75, 1], [0, 1]]), trapezoid: poly([[0, 1], [0.25, 0], [0.75, 0], [1, 1]]),
    pentagon: poly(reg(5)), hexagon: poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]),
    heptagon: poly(reg(7)), octagon: poly([[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]]),
    decagon: poly(reg(10)), dodecagon: poly(reg(12)), star4: star(4, 0.38), star5: star(5, 0.38), star6: star(6, 0.5), star8: star(8, 0.6),
    homePlate: poly([[0, 0], [0.8, 0], [1, 0.5], [0.8, 1], [0, 1]]), chevron: poly([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1], [0.25, 0.5]]),
    plus: poly([[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]]),
    snip1Rect: poly([[0, 0], [0.83, 0], [1, 0.17], [1, 1], [0, 1]]), flowChartDecision: poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]),
    flowChartInputOutput: poly([[0.2, 0], [1, 0], [0.8, 1], [0, 1]]), flowChartMerge: poly([[0, 0], [1, 0], [0.5, 1]]), flowChartExtract: poly([[0.5, 0], [1, 1], [0, 1]]),
    upDownArrow: poly([[0.5, 0], [1, 0.25], [0.7, 0.25], [0.7, 0.75], [1, 0.75], [0.5, 1], [0, 0.75], [0.3, 0.75], [0.3, 0.25], [0, 0.25]]),
    leftRightArrow: poly([[0, 0.5], [0.25, 0], [0.25, 0.3], [0.75, 0.3], [0.75, 0], [1, 0.5], [0.75, 1], [0.75, 0.7], [0.25, 0.7], [0.25, 1]]),
  };
  /** Custom geometry (a:custGeom) -> unit-box path, or null when it uses formulas we cannot evaluate. */
  function custPath(spPr) {
    const pl = desc(ch(spPr, 'custGeom'), 'pathLst'); if (!pl) return null;
    const out = [];
    for (const p of chs(pl, 'path')) {
      const pw = num(p.getAttribute('w'), 0), phh = num(p.getAttribute('h'), 0); if (!pw || !phh) return null;
      let cx = 0, cy = 0; const pt = e => { const x = e.getAttribute('x'), y = e.getAttribute('y'); if (!/^-?\d+$/.test(x) || !/^-?\d+$/.test(y)) throw 0; return [+x / pw, +y / phh]; };
      try {
        for (const c of p.children) {
          const pts = chs(c, 'pt').map(pt);
          if (c.localName === 'moveTo') { out.push(['M', ...pts[0]]); [cx, cy] = pts[0]; }
          else if (c.localName === 'lnTo') { out.push(['L', ...pts[0]]); [cx, cy] = pts[0]; }
          else if (c.localName === 'cubicBezTo') { out.push(['C', ...pts[0], ...pts[1], ...pts[2]]); [cx, cy] = pts[2]; }
          else if (c.localName === 'quadBezTo') { out.push(['Q', ...pts[0], ...pts[1]]); [cx, cy] = pts[1]; }
          else if (c.localName === 'arcTo') {
            const wR = num(c.getAttribute('wR')) / pw, hR = num(c.getAttribute('hR')) / phh, st = num(c.getAttribute('stAng')) / 60000 * Math.PI / 180, sw = num(c.getAttribute('swAng')) / 60000 * Math.PI / 180;
            const ox = cx - wR * Math.cos(st), oy = cy - hR * Math.sin(st), n = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2))), d = sw / n;
            for (let i = 0; i < n; i++) {
              const a0 = st + i * d, a1 = a0 + d, kk = 4 / 3 * Math.tan(d / 4);
              const p0 = [ox + wR * Math.cos(a0), oy + hR * Math.sin(a0)], p3 = [ox + wR * Math.cos(a1), oy + hR * Math.sin(a1)];
              out.push(['C', p0[0] - kk * wR * Math.sin(a0), p0[1] + kk * hR * Math.cos(a0), p3[0] + kk * wR * Math.sin(a1), p3[1] - kk * hR * Math.cos(a1), ...p3]);
              [cx, cy] = p3;
            }
          }
          else if (c.localName === 'close') out.push(['Z']);
        }
      } catch (e) { return null; }
    }
    return out.length ? out : null;
  }
  const flipPath = (path, fh, fv) => path.map(([c, ...v]) => [c, ...v.map((n, i) => i % 2 ? (fv ? 1 - n : n) : (fh ? 1 - n : n))]);

  /** Read the shapes of a spTree into objects (absolute px). `tf` maps child EMU coordinates (groups). */
  async function readTree(tree, ctx, out, tf = v => v, opts = {}) {
    for (const el of tree.children) {
      const ln = el.localName;
      try {
        if (ln === 'sp') await readSp(el, ctx, out, tf, opts);
        else if (ln === 'cxnSp') readLine(el, ctx, out, tf);
        else if (ln === 'pic') await readPic(el, ctx, out, tf);
        else if (ln === 'grpSp') {
          const x = xfrmOf(el); if (!x) continue;
          const cOff = x.chOff ? {x: num(x.chOff.getAttribute('x')), y: num(x.chOff.getAttribute('y'))} : {x: x.x, y: x.y};
          const cExt = x.chExt ? {cx: num(x.chExt.getAttribute('cx')) || 1, cy: num(x.chExt.getAttribute('cy')) || 1} : {cx: x.cx || 1, cy: x.cy || 1};
          const sx = x.cx / cExt.cx, sy = x.cy / cExt.cy;
          const inner = r => tf({...r, x: x.x + (r.x - cOff.x) * sx, y: x.y + (r.y - cOff.y) * sy, cx: r.cx * sx, cy: r.cy * sy});
          const kids = [];
          await readTree(el, ctx, kids, inner, opts);
          if (kids.length > 1) out.push({id: uid(), type: 'group', name: ch(ch(el, 'nvGrpSpPr'), 'cNvPr')?.getAttribute('name') || 'Csoport', children: kids, spid: spidOf(el), x: 0, y: 0, w: 1, h: 1, rot: 0});
          else out.push(...kids);
        }
        else if (ln === 'graphicFrame') await readFrame(el, ctx, out, tf);
        else if (ln === 'AlternateContent') {
          const choice = ch(el, 'Choice'), fb = ch(el, 'Fallback');
          const holder = choice && desc(choice, 'oleObj') ? choice : (fb || choice);
          if (holder) await readTree(holder, ctx, out, tf, opts);
        }
        else if (ln === 'contentPart') report.skipped.push({slide: ctx.slideNo, what: 'kézírásos rajz'});
      } catch (e) { console.warn(e); report.skipped.push({slide: ctx.slideNo, what: 'olvashatatlan objektum (' + ln + ')'}); }
    }
  }
  const spidOf = el => { const c = desc(el, 'cNvPr'); return c ? c.getAttribute('id') : null; };
  const geom = r => r && {x: X(r.x), y: Y(r.y), w: px(r.cx), h: px(r.cy), rot: r.rot || 0};

  async function readSp(sp, ctx, out, tf, opts) {
    const spPr = ch(sp, 'spPr'), ph = phOf(sp), styleEl = ch(sp, 'style');
    if (opts.skipPlaceholders && ph) return;
    let r = xfrmOf(sp);
    let layoutPh = null, masterPh = null;
    if (ph) { layoutPh = findPh(ctx.layout && desc(ctx.layout.xml, 'spTree'), ph); masterPh = findPh(desc(ctx.master.xml, 'spTree'), ph); }
    if (!r) r = xfrmOf(layoutPh) || xfrmOf(masterPh);
    if (!r) return;
    const g = geom(tf(r));
    const prst = desc(spPr, 'prstGeom')?.getAttribute('prst') || (desc(spPr, 'custGeom') ? 'custom' : 'rect');
    const fill = fillProp(spPr, styleEl, ctx), line = lineProps(spPr, styleEl, ctx);
    const type = phType(ph);
    const objs = [];
    // the shape itself (when it is visible)
    const blip = desc(ch(spPr, 'blipFill'), 'blip');
    if (blip) { const t = ctx.rels[rid(blip)]?.target, key = t && await mediaKey(t); if (key) objs.push({id: uid(), type: 'image', name: 'Kép', media: key, ...g}); }
    else if ((fill || line) && !ph) {
      const shape = {rect: 'rect', roundRect: 'rect', round2SameRect: 'rect', flowChartProcess: 'rect', flowChartAlternateProcess: 'rect', ellipse: 'ellipse', flowChartConnector: 'ellipse',
        triangle: 'triangle', rightArrow: 'arrow', leftArrow: 'arrow', upArrow: 'arrow', downArrow: 'arrow', line: 'line', straightConnector1: 'line'}[prst];
      const base = {fill: fill || null, stroke: line?.stroke || null, strokeWidth: line?.strokeWidth || 0, ...(line?.dash ? {dash: line.dash} : {})};
      const fa = fill ? fillAlpha(spPr) : 1, la = line ? line.alpha : 1;      // transparency of the fill / of the outline only
      if (fa < 0.999) base.fillOpacity = Math.round(fa * 1000) / 1000;
      if (la < 0.999) base.strokeOpacity = Math.round(la * 1000) / 1000;
      if (shape === 'line') { readLine(sp, ctx, out, tf); return; }
      const path = PRESET_PATHS[prst] || (prst === 'custom' ? custPath(spPr) : null);
      if (shape) {
        let extraRot = {leftArrow: 180, upArrow: 270, downArrow: 90}[prst] || 0;
        if (shape === 'triangle' && r.flipV) extraRot += 180;
        if (shape === 'arrow' && r.flipH) extraRot += 180;
        const o = {id: uid(), type: 'shape', shape, name: {rect: 'Téglalap', ellipse: 'Ellipszis', triangle: 'Háromszög', arrow: 'Nyíl'}[shape], ...g, ...base};
        if (extraRot % 180 === 90) { const cx = o.x + o.w / 2, cy = o.y + o.h / 2; [o.w, o.h] = [o.h, o.w]; o.x = cx - o.w / 2; o.y = cy - o.h / 2; }
        o.rot = ((o.rot || 0) + extraRot) % 360;
        if (prst === 'roundRect') { const adj = desc(ch(desc(spPr, 'prstGeom'), 'avLst'), 'gd'); const f = adj ? num((adj.getAttribute('fmla') || '').split(' ')[1], 16667) / 100000 : 0.16667; o.radius = Math.round(Math.min(o.w, o.h) * f); }
        objs.push(o);
      } else if (path) {
        objs.push({id: uid(), type: 'shape', shape: 'path', name: 'Alakzat', ...g, ...base, path: flipPath(path, r.flipH, r.flipV)});
      } else {
        report.skipped.push({slide: ctx.slideNo, what: `alakzat (${prst}) – téglalapként`});
        objs.push({id: uid(), type: 'shape', shape: 'rect', name: 'Alakzat', ...g, ...base});
      }
    }
    // its text
    const txBody = ch(sp, 'txBody');
    if (txBody) {
      const chainLst = [ch(txBody, 'lstStyle'), layoutPh && desc(layoutPh, 'lstStyle'), masterPh && desc(masterPh, 'lstStyle'),
        txStyleFor(ctx.master, ph ? type : null), defaultTextStyle];
      const fontRefColor = styleEl ? colorOf(ch(styleEl, 'fontRef'), ctx) : null;
      const t = readText(txBody, chainLst, {...ctx, isTitle: type === 'title' || type === 'ctrTitle'}, fontRefColor);
      if (hasText(t)) objs.push({id: uid(), type: 'text', name: ph ? ({title: 'Cím', ctrTitle: 'Cím', subTitle: 'Alcím'}[type] || 'Szöveg') : 'Szöveg',
        x: g.x, y: g.y, w: g.w, h: g.h, rot: g.rot, _text: t, _boxH: g.h});
    }
    if (!objs.length) return;
    const spid = spidOf(sp);
    if (objs.length === 1) { objs[0].spid = spid; out.push(objs[0]); }
    else out.push({id: uid(), type: 'group', name: 'Alakzat szöveggel', spid, children: objs, x: 0, y: 0, w: 1, h: 1, rot: 0});
  }
  function readLine(el, ctx, out, tf) {
    const r = xfrmOf(el); if (!r) return;
    const t = tf(r), x1 = X(t.x), y1 = Y(t.y), x2 = x1 + px(t.cx), y2 = y1 + px(t.cy);
    const [ax, ay, bx, by] = [t.flipH ? x2 : x1, t.flipV ? y2 : y1, t.flipH ? x1 : x2, t.flipV ? y1 : y2];
    const len = Math.hypot(bx - ax, by - ay); if (len < 1) return;
    const line = lineProps(ch(el, 'spPr'), ch(el, 'style'), ctx) || {stroke: '#000000', strokeWidth: 1, alpha: 1};
    const ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI, cx = (ax + bx) / 2, cy = (ay + by) / 2, hh = Math.max(8, line.strokeWidth + 6);
    const {alpha, ...ln} = line; for (const k in ln) if (ln[k] === undefined) delete ln[k];
    out.push({id: uid(), type: 'shape', shape: 'line', name: 'Vonal', x: cx - len / 2, y: cy - hh / 2, w: len, h: hh, rot: ((ang % 360) + 360) % 360, fill: null, ...ln, ...(alpha < 0.999 ? {opacity: alpha} : {}), spid: spidOf(el)});
  }
  async function readPic(pic, ctx, out, tf) {
    const r = xfrmOf(pic); if (!r) return;
    const blip = desc(pic, 'blip'), svgBlip = desc(pic, 'svgBlip');
    const t = (svgBlip && ctx.rels[rid(svgBlip)]?.target) || (blip && ctx.rels[rid(blip)]?.target);
    let key = t && await mediaKey(t);
    if (!key && svgBlip && blip) { const t2 = ctx.rels[rid(blip)]?.target; key = t2 && await mediaKey(t2); }
    const g = geom(tf(r));
    if (!key) { report.skipped.push({slide: ctx.slideNo, what: 'kép EMF/WMF formátumban (helyőrzővel)'}); out.push(placeholderBox(g, 'Kép – illeszd be újra', spidOf(pic))); return; }
    const crop = desc(pic, 'srcRect'), o = {id: uid(), type: 'image', name: 'Kép', media: key, ...g, spid: spidOf(pic)};
    if (crop && ['l', 't', 'r', 'b'].some(a => num(crop.getAttribute(a)))) o.crop = Object.fromEntries(['l', 't', 'r', 'b'].map(a => [a, Math.max(0, num(crop.getAttribute(a)) / 100000)]));
    const am = desc(blip, 'alphaModFix'); if (am) o.opacity = num(am.getAttribute('amt'), 100000) / 100000;
    out.push(o);
  }
  async function cropImage(key, [l, t, r, b]) {
    try {
      const img = new Image(); await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = media[key]; });
      const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * (1 - l - r))); c.height = Math.max(1, Math.round(h * (1 - t - b)));
      c.getContext('2d').drawImage(img, -w * l, -h * t);
      const nk = 'img' + uid(); media[nk] = c.toDataURL('image/png'); return nk;
    } catch (e) { return key; }
  }
  /** Dashed box of the original size / position / rotation, with a note to insert the object again as a picture. */
  function placeholderBox(g, label, spid) {
    return {id: uid(), type: 'group', name: label.split(' –')[0] + ' helye', spid, x: 0, y: 0, w: 1, h: 1, rot: 0, children: [
      {id: uid(), type: 'shape', shape: 'rect', name: 'Helyőrző', ...g, fill: '#f1f1f1', stroke: '#9aa3ad', strokeWidth: 1.5, dash: 'dash'},
      {id: uid(), type: 'text', name: 'Felirat', x: g.x, y: g.y + g.h / 2 - 20, w: g.w, h: 40, rot: g.rot || 0, _boxH: 40,
        _text: {paras: [{align: 'center', lvl: 1, bullet: null, runs: [{text: label, size: 18.67, color: '#6b7785'}]}], insets: {l: 8, t: 4, r: 8, b: 4}, anchor: 't'}}]};
  }
  async function readFrame(fr, ctx, out, tf) {
    const rr = xfrmOf(fr);
    if (!rr) return;
    const g = geom(tf(rr)), data = desc(fr, 'graphicData'), uri = data?.getAttribute('uri') || '';
    if (/\/ole$/.test(uri) || desc(fr, 'oleObj')) {
      const ole = desc(fr, 'oleObj'), prog = ole?.getAttribute('progId') || '';
      const target = ctx.rels[rid(ole)]?.target;
      if (/^Equation\./i.test(prog) || /MathType/i.test(prog)) {
        report.formulas++;
        try {
          const f = zip.file(target); if (!f) throw new Error('hiányzó beágyazott objektum');
          let tex = oleToTeX(await f.async('uint8array'));
          if (/\\(frac|sum|int|oint|prod|lim|binom|bigcup|bigcap)/.test(tex)) tex = '\\displaystyle ' + tex;   // MathType's full-size look
          out.push({id: uid(), type: 'formula', tex, ...g, spid: spidOf(fr)});
        } catch (e) {
          report.failed.push({slide: ctx.slideNo, why: e.message});
          const pic = desc(fr, 'pic'), blip = pic && desc(pic, 'blip'), t = blip && ctx.rels[rid(blip)]?.target, key = t && await mediaKey(t);
          if (key) out.push({id: uid(), type: 'image', name: 'Képlet (kép)', media: key, ...g, spid: spidOf(fr)});
          else out.push({id: uid(), type: 'text', name: 'Át nem alakított képlet', ...g, _text: {paras: [{align: 'left', lvl: 1, runs: [{text: '[képlet – írd be újra]', size: 21.33, color: '#da291c', bold: true}], bullet: null}], insets: {l: 4, t: 2, r: 4, b: 2}, anchor: 't'}, spid: spidOf(fr)});
        }
      } else report.skipped.push({slide: ctx.slideNo, what: 'beágyazott objektum (' + (prog || 'OLE') + ')'});
      return;
    }
    if (/\/table$/.test(uri)) { out.push(readTable(desc(data, 'tbl'), ctx, g, spidOf(fr))); return; }
    const what = /chart/.test(uri) ? 'Diagram' : /diagram/.test(uri) ? 'SmartArt' : 'Objektum';
    report.skipped.push({slide: ctx.slideNo, what: what.toLowerCase() + ' (helyőrzővel)'});
    out.push(placeholderBox(g, `${what} – illeszd be újra képként`, spidOf(fr)));
  }
  function readTable(tbl, ctx, g, spid) {
    const cols = descs(desc(tbl, 'tblGrid'), 'gridCol').map(c => px(num(c.getAttribute('w'))));
    let size = null;
    const rows = chs(tbl, 'tr').map(tr => ({type: 'tableRow', content: chs(tr, 'tc').filter(tc => !tc.getAttribute('hMerge') && !tc.getAttribute('vMerge')).map((tc, ci) => {
      const t = readText(ch(tc, 'txBody'), [ch(ch(tc, 'txBody'), 'lstStyle'), txStyleFor(ctx.master, null), defaultTextStyle], ctx, null);
      const fill = colorOf(ch(ch(tc, 'tcPr'), 'solidFill'), ctx);
      const content = t.paras.map(p => { size ??= p.runs.find(r => r.text)?.size; return paraJSON(p, null, null); });
      const attrs = {}; if (fill) attrs.background = fill;
      const span = num(tc.getAttribute('gridSpan'), 1); if (span > 1) attrs.colspan = span;
      if (cols[ci] && span === 1) attrs.colwidth = [Math.round(cols[ci])];
      return {type: 'tableCell', attrs, content: content.length ? content : [{type: 'paragraph'}]};
    })}));
    return {id: uid(), type: 'table', name: 'Táblázat', ...g, size: size || 24, color: '#1a1a1a', align: 'left', doc: {type: 'doc', content: [{type: 'table', content: rows}]}, spid};
  }

  /* ---- background ---- */
  async function bgOf(el, ctx) {
    const bg = desc(el, 'bg'); if (!bg) return null;
    const pr = ch(bg, 'bgPr');
    if (pr) {
      const blip = desc(ch(pr, 'blipFill'), 'blip');
      if (blip) { const t = ctx.rels[rid(blip)]?.target, key = t && await mediaKey(t); return {image: key, color: '#ffffff'}; }
      const sf = ch(pr, 'solidFill'); if (sf) return {color: colorOf(sf, ctx)};
      const gs = desc(ch(pr, 'gradFill'), 'gs'); if (gs) return {color: colorOf(gs, ctx)};
    }
    const ref = ch(bg, 'bgRef'); if (ref) return {color: colorOf(ref, ctx) || '#ffffff'};
    return null;
  }

  /* ---- paragraphs -> TipTap JSON ---- */
  function marksFor(r, box) {
    const m = [];
    if (r.bold && !box.bold) m.push({type: 'bold'}); if (r.italic) m.push({type: 'italic'}); if (r.underline) m.push({type: 'underline'}); if (r.strike) m.push({type: 'strike'});
    if (r.base > 0) m.push({type: 'superscript'}); else if (r.base < 0) m.push({type: 'subscript'});
    const ts = {};
    if (r.color && r.color.toLowerCase() !== (box.color || '').toLowerCase()) ts.color = r.color;
    if (r.size && Math.abs(r.size - box.size) > 0.6) ts.fontSize = Math.round(r.size * 0.75 * 2) / 2 + 'pt';
    if (r.font && r.font !== box.font) ts.fontFamily = 'MP ' + r.font;
    if (r.upper && !box.upper) ts.textTransform = 'uppercase';
    if (Object.keys(ts).length) m.push({type: 'textStyle', attrs: ts});
    return m;
  }
  function paraJSON(p, box, map) {
    const content = [];
    p.runs.forEach((r, ri) => {
      if (r.br) { content.push({type: 'hardBreak'}); return; }
      if (r.math != null) { content.push({type: 'math', attrs: {tex: r.math, display: false, wrap: true}}); return; }
      if (!r.text) return;
      const n = {type: 'text', text: r.text}; const m = box ? marksFor(r, box) : marksFor(r, {size: r.size, color: r.color});
      if (m.length) n.marks = m;
      content.push(n); if (map) map.push(ri);
    });
    const attrs = {}; if (p.align && p.align !== 'left') attrs.textAlign = p.align; if (p.lineHeight) attrs.lineHeight = p.lineHeight;
    return {type: 'paragraph', ...(Object.keys(attrs).length ? {attrs} : {}), ...(content.length ? {content} : {})};
  }
  /** Merge neighbouring runs that end up with the same formatting (the editor would join them anyway). */
  function normalize(t, box) {
    for (const p of t.paras) {
      const out = [];
      for (const r of p.runs) {
        const prev = out.at(-1);
        if (prev && !prev.br && !r.br && prev.math == null && r.math == null && prev.text != null && r.text != null &&
          JSON.stringify(marksFor(prev, box)) === JSON.stringify(marksFor(r, box))) prev.text += r.text;
        else if (r.br || r.math != null || r.text) out.push({...r});
      }
      p.runs = out;
    }
  }
  /** Text box: box-level size / colour / font (the most common), paragraphs, lists. Returns {doc, nodes} where nodes maps JSON text nodes -> [para, run]. */
  function textJSON(t, box) {
    normalize(t, box);
    const nodes = [], blocks = [];
    let stack = [];                                          // open lists: {lvl, list}
    const newList = p => { const type = p.bullet.type === 'num' ? 'orderedList' : 'bulletList', l = {type, content: []};
      if (type === 'bulletList' && p.bullet.ch && p.bullet.ch !== '•') l.attrs = {bulletChar: p.bullet.ch};
      if (type === 'orderedList' && /alphaLc/.test(p.bullet.style || '')) l.attrs = {numStyle: 'lower-alpha'};
      if (type === 'orderedList' && /alphaUc/.test(p.bullet.style || '')) l.attrs = {numStyle: 'upper-alpha'};
      if (type === 'orderedList' && /romanLc/.test(p.bullet.style || '')) l.attrs = {numStyle: 'lower-roman'};
      return l; };
    t.paras.forEach((p, pi) => {
      const map = [], para = paraJSON(p, box, map);
      map.forEach(ri => nodes.push([pi, ri]));
      if (!p.bullet) { stack = []; blocks.push(para); return; }
      const type = p.bullet.type === 'num' ? 'orderedList' : 'bulletList';
      while (stack.length && stack.at(-1).lvl > p.lvl) stack.pop();
      let top = stack.at(-1);
      if (top && top.lvl === p.lvl && top.list.type !== type) { stack.pop(); top = stack.at(-1); }
      if (!top || top.lvl < p.lvl) {
        const l = newList(p);
        if (top) { const li = top.list.content.at(-1); li.content.push(l); } else blocks.push(l);
        stack.push({lvl: p.lvl, list: l}); top = stack.at(-1);
      }
      top.list.content.push({type: 'listItem', content: [para]});
    });
    return {doc: {type: 'doc', content: blocks.length ? blocks : [{type: 'paragraph'}]}, nodes};
  }
  function boxStyle(t) {
    const count = (fn) => { const c = new Map(); for (const p of t.paras) for (const r of p.runs) if (r.text && r.text.trim()) { const v = fn(r); c.set(v, (c.get(v) || 0) + r.text.length); } return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
    const first = t.paras.find(p => p.runs.length)?.runs[0] || t.paras[0]?.endStyle || {};
    return {size: count(r => Math.round(r.size * 100) / 100) || first.size || 24, color: count(r => r.color) || first.color || '#000000',
      font: count(r => r.font || '') || null, bold: t.paras.every(p => p.runs.every(r => !r.text || !r.text.trim() || r.bold)) || undefined,
      align: t.paras[0]?.align || 'left'};
  }

  /* ---- animations / transitions ---- */
  function readTransition(sld) {
    const tr = descs(sld, 'transition').pop(); if (!tr) return undefined;
    const el = tr.firstElementChild; if (!el) return undefined;
    const p14 = tr.getAttribute('p14:dur') || [...tr.attributes].find(a => a.localName === 'dur')?.value;
    const dur = p14 ? num(p14) : {fast: 500, med: 750, slow: 1000}[tr.getAttribute('spd')] || 700;
    const dirFrom = {l: 'r', r: 'l', u: 'b', d: 't'}[el.getAttribute('dir')] || 'r';
    const type = {fade: el.getAttribute('thruBlk') === '1' ? 'fadeBlack' : 'fade', push: 'push', wipe: 'wipe', cover: 'cover', pull: 'pull', split: 'split', zoom: 'zoom'}[el.localName];
    if (!type) return {type: 'fade', dur};
    const t = {type, dur};
    if (/push|wipe|cover|pull/.test(type)) t.dir = dirFrom;
    if (type === 'split') t.dir = (el.getAttribute('orient') === 'horz' ? 'h' : 'v') + (el.getAttribute('dir') === 'in' ? 'i' : 'o');
    return t;
  }
  const FLY_DIR = {1: 't', 2: 'r', 4: 'b', 8: 'l', 3: 'tr', 6: 'br', 12: 'bl', 9: 'tl'};
  function readAnims(sld, spidMap) {
    const out = [], seen = new Set();
    for (const c of descs(sld, 'cTn')) {
      const cls = c.getAttribute('presetClass'); if (!cls || !/entr|exit|emph/.test(cls)) continue;
      const tgt = desc(c, 'spTgt'); if (!tgt) continue;
      const target = spidMap.get(tgt.getAttribute('spid')); if (!target) continue;
      const pid = num(c.getAttribute('presetID')), sub = num(c.getAttribute('presetSubtype'));
      const para = !!desc(tgt, 'txEl');
      const key = target + '|' + cls + '|' + pid + (para ? '|p' : '');
      const trigger = {clickEffect: 'click', withEffect: 'with', afterEffect: 'after'}[c.getAttribute('nodeType')] || 'click';
      if (para && seen.has(key)) continue;
      seen.add(key);
      let effect, dir;
      if (cls === 'entr') { effect = {1: 'appear', 10: 'fade', 2: 'fly', 22: 'wipe', 42: 'float', 47: 'float'}[pid] || 'fade'; if (pid === 2) dir = FLY_DIR[sub] || 'b'; if (pid === 47) dir = 'd'; }
      else if (cls === 'exit') { effect = {1: 'disappear', 10: 'fadeOut', 2: 'flyOut', 22: 'wipeOut', 42: 'floatOut', 47: 'floatOut'}[pid] || 'fadeOut'; if (pid === 2) dir = FLY_DIR[sub] || 'b'; if (pid === 47) dir = 'd'; }
      else effect = {26: 'pulse', 6: 'grow', 8: 'spin'}[pid] || 'pulse';
      const durs = descs(c, 'cTn').filter(x => x !== c && /^\d+$/.test(x.getAttribute('dur') || '')).map(x => num(x.getAttribute('dur')));
      const dur = durs.length ? Math.max(...durs) : undefined;
      const delay = num(desc(c, 'cond')?.getAttribute('delay'));
      const a = {id: uid(), target, effect, trigger};
      if (dir) a.dir = dir; if (dur && dur > 1 && !['appear', 'disappear'].includes(effect)) a.dur = dur; if (delay > 0) a.delay = delay;
      if (para) a.byParagraph = true;
      out.push(a);
    }
    return out;
  }

  /* ======================= build the document ======================= */
  const templates = {}, layoutKey = new Map();
  let master = null, masterObjs = null;
  const slides = [];
  for (const [si, sp] of slidePaths.entries()) {
    onProgress?.(`Diák beolvasása… ${si + 1}/${slidePaths.length}`);
    const slide = await part(sp);
    const lp = Object.values(slide.rels).find(r => r.type === 'slideLayout')?.target, layout = lp ? await part(lp) : null;
    const mp = layout && Object.values(layout.rels).find(r => r.type === 'slideMaster')?.target, mst = mp ? await part(mp) : null;
    if (!mst) continue;
    const theme = await themeOf(mst);
    const ctxBase = {theme, clrMap: {...clrMapOf(mst.xml)}, master: mst, layout, slideNo: si + 1};
    // template per layout (with the master's decorations shared through doc.master)
    if (!master) {
      master = mst; masterObjs = [];
      await readTree(desc(mst.xml, 'spTree'), {...ctxBase, rels: mst.rels}, masterObjs, v => v, {skipPlaceholders: true});
      ctxBase.masterBg = await bgOf(mst.xml, {...ctxBase, rels: mst.rels});
    }
    if (layout && !layoutKey.has(lp)) {
      const key = 'imp' + layoutKey.size, lobjs = [];
      await readTree(desc(layout.xml, 'spTree'), {...ctxBase, rels: layout.rels}, lobjs, v => v, {skipPlaceholders: true});
      const lbg = await bgOf(layout.xml, {...ctxBase, rels: layout.rels});
      const phs = [];
      for (const s of descs(desc(layout.xml, 'spTree'), 'sp')) {
        const ph = phOf(s), t = phType(ph); if (!ph || !/title|ctrTitle|subTitle|body|obj/.test(t)) continue;
        const r = xfrmOf(s) || xfrmOf(findPh(desc(mst.xml, 'spTree'), ph)); if (!r) continue;
        const g = geom(r), key2 = /title/i.test(t) && !/sub/i.test(t) ? 'title' : t === 'subTitle' ? 'subtitle' : 'body';
        let kk = key2, n = 2; while (phs.some(p => p.placeholder === kk)) kk = key2 + n++;
        const st = txStyleFor(mst, t), l1 = st && ch(st, 'lvl1pPr'), d = l1 && ch(l1, 'defRPr');
        const size = ptToPx(num(d?.getAttribute('sz'), key2 === 'title' ? 4400 : 2400) / 100);
        phs.push({id: uid(), type: 'text', name: (kk.startsWith('title') ? 'Cím' : kk.startsWith('subtitle') ? 'Alcím' : 'Szöveg') + ' helykitöltő', placeholder: kk,
          prompt: kk.startsWith('title') ? 'Cím' : 'Szöveg', ...g, rot: 0, size, color: colorOf(ch(d, 'solidFill'), {...ctxBase, rels: layout.rels}) || '#000000',
          bold: undefined, align: {ctr: 'center', r: 'right'}[l1?.getAttribute('algn')] || (t === 'ctrTitle' || t === 'subTitle' ? 'center' : 'left'), doc: {type: 'doc', content: [{type: 'paragraph'}]}});
      }
      const showMaster = layout.xml.documentElement.getAttribute('showMasterSp') !== '0';
      templates[key] = {name: desc(layout.xml, 'cSld')?.getAttribute('name') || 'Diatípus ' + (layoutKey.size + 1), ownBg: !!lbg, background: lbg?.image || null,
        bgColor: (lbg || ctxBase.masterBg || {}).color || '#ffffff', showMaster, objects: [...lobjs.map(finishStatic), ...phs]};
      layoutKey.set(lp, key);
    }
    // the slide
    const ctx = {...ctxBase, rels: slide.rels};
    const objs = [];
    const sbg = await bgOf(slide.xml, ctx);
    if (sbg) objs.push(sbg.image ? {id: uid(), type: 'image', name: 'Háttér', media: sbg.image, x: 0, y: 0, w: W, h: H, rot: 0, locked: true}
      : {id: uid(), type: 'shape', shape: 'rect', name: 'Háttér', x: 0, y: 0, w: W, h: H, rot: 0, fill: sbg.color, stroke: null, strokeWidth: 0, locked: true});
    await readTree(desc(slide.xml, 'spTree'), ctx, objs);
    const spidMap = new Map(); (function walk(list) { for (const o of list) { if (o.spid) spidMap.set(o.spid, o.id); if (o.children) walk(o.children); } })(objs);
    slides.push({s: {id: uid(), template: layoutKey.get(lp), objects: objs, anims: readAnims(slide.xml, spidMap), transition: readTransition(slide.xml)}});
    report.slides++;
  }
  function finishStatic(o) { return o; }
  const doc = {format: 'mprezi', version: 4, size: {w: W, h: H}, templateName: 'Importált', title: null,
    master: {background: null, bgColor: '#ffffff', objects: masterObjs || []}, templates, slides: slides.map(x => x.s)};
  // master background (used by layouts without their own)
  if (master) { const mb = await bgOf(master.xml, {theme: await themeOf(master), clrMap: clrMapOf(master.xml), rels: master.rels, master}); if (mb) { doc.master.background = mb.image || null; doc.master.bgColor = mb.color || '#ffffff'; } }
  return {doc, media, report, textJSON, boxStyle};
}

/* ======================================================================= */
/*  Second phase (in the page): measure text with the editor's own renderer, put formulas into the lines,
    merge split text boxes, size standalone formulas, set the final text boxes.                          */
export async function placeContent(doc, {renderText, measureMath, onProgress, textJSON, boxStyle, report}) {
  for (const [si, s] of doc.slides.entries()) {
    onProgress?.(`Képletek elhelyezése… ${si + 1}/${doc.slides.length}`);
    s.objects = await placeIn(s.objects, si + 1);
  }
  for (const L of Object.values(doc.templates)) L.objects = await placeIn(L.objects, null);
  doc.master.objects = await placeIn(doc.master.objects, null);

  async function placeIn(list, slideNo) {
    // flatten groups for matching, keep structure
    const texts = [], formulas = [];
    (function walk(l) { for (const o of l) { if (o.type === 'text' && o._text) texts.push(o); else if (o.type === 'formula') formulas.push(o); if (o.children) walk(o.children); } })(list);
    // 1. lay out every text box once
    const lay = new Map();
    for (const t of texts) { try { const L = await layoutBox(t); lay.set(t, L); if (L.lines.length === 1) t._oneLine = true; } catch (e) { console.warn(e); } }
    // 2. each formula: into a text line (gap, line end, line start, or between two boxes)
    const consumed = new Set(), edits = new Map(), merges = [];
    for (const f of formulas) {
      const fx = f.x + f.w / 2, fy = f.y + f.h / 2;
      let best = null;
      for (const t of texts) {
        const L = lay.get(t); if (!L) continue;
        for (const ln of L.lines) {
          if (fy < ln.top - ln.h * 0.35 || fy > ln.bottom + ln.h * 0.35) continue;
          const gapLeft = f.x - ln.right, gapRight = ln.left - (f.x + f.w), em = ln.h;
          let score = null, at = null;
          // a gap of spaces / tabs under the formula
          for (const gp of ln.gaps) { const ov = Math.min(gp.right, f.x + f.w) - Math.max(gp.left, f.x); if (ov > -em * 0.6) { const sc = 3 + ov / Math.max(1, f.w); if (score == null || sc > score) { score = sc; at = {kind: 'gap', gap: gp}; } } }
          if (score == null && fx >= ln.left && fx <= ln.right) { score = 1.5; at = {kind: 'inside', x: f.x}; }
          if (score == null && gapLeft > -em && gapLeft < em * 2.5) { score = 2; at = {kind: 'end'}; }
          if (score == null && gapRight > -em && gapRight < em * 1.5) { score = 1.8; at = {kind: 'start'}; }
          if (score != null && (!best || score > best.score)) best = {score, t, ln, at};
        }
      }
      if (!best) continue;
      const {t, ln, at} = best, L = lay.get(t);
      let edit;
      if (at.kind === 'gap') edit = {node: at.gap.node, start: at.gap.start, end: at.gap.end, para: at.gap.para, run: at.gap.run, mode: 'replace'};
      else if (at.kind === 'end') edit = {...ln.lastPos, mode: 'after'};
      else if (at.kind === 'start') edit = {...ln.firstPos, mode: 'before'};
      else { const c = ln.chars.reduce((a, c) => Math.abs(c.x - at.x) < Math.abs(a.x - at.x) ? c : a, ln.chars[0]); edit = {...c.pos, mode: 'before'}; }
      if (at.kind === 'end') t.w = Math.max(t.w, f.x + f.w - t.x + 24);
      if (at.kind === 'start' && f.x < t.x) { t.w += t.x - f.x; t.x = f.x; }
      if (!edits.has(t)) edits.set(t, []);
      edits.get(t).push({...edit, tex: f.tex, f});
      consumed.add(f); report.inline++;
      // a text box right after the formula on the same line: its text continues this line
      if (at.kind === 'end' && ln.isLast) {
        const B = texts.find(b => b !== t && !merges.some(m => m.b === b) && (() => { const BL = lay.get(b); const l0 = BL?.lines[0]; return l0 && Math.abs((l0.top + l0.bottom) / 2 - (ln.top + ln.bottom) / 2) < ln.h * 0.6 && l0.left > f.x + f.w * 0.5 && l0.left - (f.x + f.w) < ln.h * 2.5; })());
        if (B) merges.push({a: t, b: B});
      }
    }
    // 3. apply the edits (from the end, so positions stay valid)
    for (const [t, list_] of edits) {
      list_.sort((a, b) => b.para - a.para || b.run - a.run || b.start - a.start);
      for (const e of list_) {
        const p = t._text.paras[e.para], r = p.runs[e.run];
        const mathRun = {math: e.tex, size: r.size, color: r.color};
        if (e.mode === 'replace') {
          const before = r.text.slice(0, e.start).replace(/[\t ]+$/, ''), after = r.text.slice(e.end).replace(/^[\t ]+/, '');
          p.runs.splice(e.run, 1, {...r, text: before + (before ? ' ' : '')}, mathRun, {...r, text: (after ? ' ' : '') + after});
        } else if (e.mode === 'after') {
          const cut = e.start + 1, before = r.text.slice(0, cut).replace(/[\t ]+$/, ''), after = r.text.slice(cut).replace(/^[\t ]+/, '');
          p.runs.splice(e.run, 1, {...r, text: before + ' '}, mathRun, {...r, text: (after ? ' ' : '') + after});
        } else {
          const before = r.text.slice(0, e.start).replace(/[\t ]+$/, ''), after = r.text.slice(e.start).replace(/^[\t ]+/, '');
          p.runs.splice(e.run, 1, {...r, text: before + (before ? ' ' : '')}, mathRun, {...r, text: ' ' + after});
        }
      }
    }
    for (const {a, b} of merges) {
      const last = a._text.paras[a._text.paras.length - 1], [first, ...rest] = b._text.paras;
      last.runs.push({...(first.runs[0] || {}), text: ' '}, ...first.runs); a._text.paras.push(...rest);
      a.w = Math.max(a.x + a.w, b.x + b.w) - a.x; b._gone = true;
    }
    // 4. formulas left alone: own text box, sized to the old picture
    const out = [];
    const rebuild = async l => {
      const res = [];
      for (const o of l) {
        if (consumed.has(o) || o._gone) continue;
        if (o.type === 'formula') { report.standalone++; res.push(await formulaBox(o)); continue; }
        if (o.children) { o.children = await rebuild(o.children); if (!o.children.length) continue; if (o.children.length === 1) { res.push(o.children[0]); continue; } fitGroupBox(o); res.push(o); continue; }
        if (o.type === 'text' && o._text) res.push(await finishText(o)); else { delete o.spid; res.push(o); }
      }
      return res;
    };
    out.push(...await rebuild(list));
    return out;
  }
  function fitGroupBox(g) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of g.children) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h); }
    Object.assign(g, {x: x0, y: y0, w: x1 - x0, h: y1 - y0}); delete g.spid;
  }
  async function formulaBox(f) {
    const m = await measureMath(f.tex);                              // {h, w} of the formula at font size 1
    const size = Math.max(12, Math.min(160, Math.min(f.h / (m.h || 1.2), f.w / (m.w || 1)) || 32));
    return {id: f.id, type: 'text', name: 'Képlet', x: f.x - 8, y: f.y - 8 + Math.max(0, (f.h - size * (m.h || 1.2)) / 2), w: Math.max(f.w + 24, size * m.w + 24, 60), h: f.h + 16, rot: 0,
      size: Math.round(size * 100) / 100, color: '#000000', align: 'left', doc: {type: 'doc', content: [{type: 'paragraph', content: [{type: 'math', attrs: {tex: f.tex, display: false}}]}]}};
  }
  /** Text box geometry in Prezi: PowerPoint insets -> the 8 px padding, vertical anchoring (top / middle / bottom). */
  async function boxFor(o) {
    const t = o._text, st = boxStyle(t), box = {size: st.size, color: st.color, font: st.font, bold: st.bold};
    const {doc: json, nodes} = textJSON(t, box);
    const tmp = {id: o.id, type: 'text', x: o.x + t.insets.l - 8, y: o.y + t.insets.t - 8, w: Math.max(30, o.w - t.insets.l - t.insets.r + 16), h: 40, rot: o.rot || 0,
      size: st.size, color: st.color, font: st.font || undefined, bold: st.bold, align: 'left', doc: json};
    const h = await renderText(tmp);
    const inner = o._boxH - t.insets.t - t.insets.b;
    if (t.anchor === 'ctr') tmp.y = o.y + t.insets.t - 8 + (inner - (h - 16)) / 2;
    else if (t.anchor === 'b') tmp.y = o.y + o._boxH - t.insets.b - h + 8;
    tmp.h = h;
    return {tmp, nodes};
  }
  async function finishText(o) {
    const {tmp} = await boxFor(o);
    if (o._oneLine) {                                              // a one-line box stays one line with its new formula
      const leftDoc = JSON.parse(JSON.stringify(tmp.doc).replace(/"textAlign":"(center|right|justify)"/g, '"textAlign":null'));
      const need = await renderText({...tmp, w: 2400, align: 'left', doc: leftDoc}, root => {
        let r = -Infinity; const rg = document.createRange(), wk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = wk.nextNode(); n; n = wk.nextNode()) { if (!n.data.trim() || n.parentElement.closest('.math, .lm')) continue; rg.selectNodeContents(n); for (const rc of rg.getClientRects()) r = Math.max(r, rc.right); }
        for (const m of root.querySelectorAll('.math')) r = Math.max(r, m.getBoundingClientRect().right);
        return r === -Infinity ? 0 : r - root.getBoundingClientRect().left + 12; });
      if (need > tmp.w) { tmp.w = Math.min(need, W - tmp.x); tmp.h = await renderText(tmp); }
    }
    Object.assign(o, {x: tmp.x, y: tmp.y, w: tmp.w, h: tmp.h, size: tmp.size, color: tmp.color, align: 'left', doc: tmp.doc});
    if (tmp.font) o.font = tmp.font; else delete o.font;
    if (tmp.bold) o.bold = true; else delete o.bold;
    delete o._text; delete o._boxH; delete o.spid; delete o._oneLine;
    return o;
  }
  /** Lines of a text box as the editor lays them out: [{top,bottom,left,right,h,gaps,chars,firstPos,lastPos,isLast}] */
  async function layoutBox(o) {
    const {tmp, nodes} = await boxFor(o);
    return renderText(tmp, (root, ox, oy) => {
      // walk the rendered text nodes in document order: they correspond to the JSON text nodes
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: n => n.parentElement.closest('.lm, .math') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
      const rg = document.createRange(), chars = [];
      let i = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode(), i++) {
        const [para, run] = nodes[i] || []; if (para == null) continue;
        for (let c = 0; c < n.data.length; c++) {
          rg.setStart(n, c); rg.setEnd(n, c + 1); const rc = rg.getClientRects()[0]; if (!rc) continue;
          chars.push({ch: n.data[c], x: rc.left - ox, r: rc.right - ox, top: rc.top - oy, bottom: rc.bottom - oy, pos: {para, run, start: c, node: i}});
        }
      }
      const lines = [];
      for (const c of chars) {
        let ln = lines.find(l => Math.abs(l.mid - (c.top + c.bottom) / 2) < (c.bottom - c.top) * 0.5);
        if (!ln) { ln = {mid: (c.top + c.bottom) / 2, chars: []}; lines.push(ln); }
        ln.chars.push(c);
      }
      lines.sort((a, b) => a.mid - b.mid);
      return {lines: lines.map((l, li) => {
        const cs = l.chars.sort((a, b) => a.x - b.x), vis = cs.filter(c => c.ch.trim());
        const top = Math.min(...cs.map(c => c.top)), bottom = Math.max(...cs.map(c => c.bottom));
        const gaps = []; let run = null;
        for (const c of cs) {
          if (!c.ch.trim() || c.ch === '\u00a0') {
            if (run && run.pos.para === c.pos.para && run.pos.run === c.pos.run && run.end === c.pos.start) { run.end++; run.right = c.r; run.n++; run.tab ||= c.ch === '\t'; }
            else { run = {pos: c.pos, start: c.pos.start, end: c.pos.start + 1, left: c.x, right: c.r, n: 1, tab: c.ch === '\t'}; gaps.push(run); }
          } else run = null;
        }
        const big = gaps.filter(gp => gp.n >= 2 || gp.tab || gp.right - gp.left > (bottom - top) * 0.9)
          .map(gp => ({left: gp.left + tmp.x, right: gp.right + tmp.x, para: gp.pos.para, run: gp.pos.run, node: gp.pos.node, start: gp.start, end: gp.end}));
        const abs = c => ({...c, x: c.x + tmp.x, r: c.r + tmp.x});
        return {top: top + tmp.y, bottom: bottom + tmp.y, h: bottom - top, left: (vis[0] || cs[0]).x + tmp.x, right: (vis.at(-1) || cs.at(-1)).r + tmp.x,
          gaps: big, chars: cs.map(abs), firstPos: (vis[0] || cs[0]).pos, lastPos: (vis.at(-1) || cs.at(-1)).pos, isLast: li === lines.length - 1};
      })};
    });
  }
}
