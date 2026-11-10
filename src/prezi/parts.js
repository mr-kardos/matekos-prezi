// Formula parts: a text box animated "by paragraph" can also reveal its formulas piece by piece.
// A formula gets a new piece
//   - at every new row (\\) of a top-level multi-line environment (aligned, gathered, array, …),
//   - after a wide space (\quad, \qquad),
//   - after an implication arrow (\Rightarrow, \implies, \Leftrightarrow, \iff, …).
// Spaces and arrows that stand together count as one place ("a \quad\Rightarrow\quad b" = two pieces: "a ⇒" and "b"),
// and a piece never consists of spaces and arrows alone (a row that starts with ⇒ keeps its arrow).
//
// The places are found in the TeX code, by one function for everything: the number of pieces (model, timeline,
// PowerPoint timing) and the rendered formula, where an invisible zero-width marker is put at every place
// (\class{mpb}{\kern0pt} – it does not change the layout). In the rendered SVG everything after the n-th marker
// belongs to piece n, so the counts can never disagree.

/** Animation pieces of a rendered text box, in order: top-level blocks, list items one by one. */
export function pieceEls(txt) {
  const pm = txt.querySelector('.ProseMirror'); if (!pm) return [];
  const out = [];
  for (const b of pm.children) {
    if (b.matches('ul, ol')) out.push(...[...b.children].filter(c => c.tagName === 'LI'));
    else if (!b.matches('.ProseMirror-gapcursor, img.ProseMirror-separator')) out.push(b);
  }
  return out;
}

export const PART_MARK = '\\class{mpb}{\\kern0pt}';
const ARROWS = new Set(['Rightarrow', 'implies', 'Longrightarrow', 'Leftrightarrow', 'iff', 'Longleftrightarrow', 'Leftarrow', 'impliedby', 'Longleftarrow']);
const ARROW_CH = '⇒⇔⟹⟺⇐⟸';
const WIDE = new Set(['quad', 'qquad']);
const NEUTRAL = new Set([',', ';', ':', '!', ' ', '>', 'hline', 'hdashline', 'displaystyle', 'textstyle', 'notag', 'nonumber']);
const ROW_ENV = /^(aligned|align|alignat|alignedat|gathered|gather|split|multline|eqnarray|flalign|array)\*?$/;
const ARG_ENV = /^(array|alignat|alignedat)\*?$/;

const cache = new Map();
/** {tex: the TeX code with the piece markers, breaks: number of markers (pieces = breaks + 1)} */
export function markTex(tex) {
  tex = String(tex ?? '');
  let r = cache.get(tex);
  if (!r) {
    const ins = scan(tex);
    let out = tex; for (let k = ins.length - 1; k >= 0; k--) out = out.slice(0, ins[k]) + PART_MARK + out.slice(ins[k]);
    r = {tex: out, breaks: ins.length};
    if (cache.size > 4000) cache.clear();
    cache.set(tex, r);
  }
  return r;
}
/** Positions in the TeX code where a new piece starts. */
function scan(tex) {
  const ins = [], env = [];
  let depth = 0, lr = 0, cand = null, rowCand = null, has = false;
  // only the formula's own level counts: not inside {…}, \left…\right, matrices, cases
  const active = () => depth === 0 && lr === 0 && (env.length === 0 || (env.length === 1 && env[0]));
  const content = sub => {                       // something visible follows (sub: a sub/superscript – never split before it)
    if (rowCand != null) { if (has) ins.push(rowCand); }
    else if (cand != null && has && !sub) ins.push(cand);
    cand = rowCand = null; has = true;
  };
  const sep = j => {                             // a wide space or an arrow ended at j
    if (rowCand != null) { if (has) ins.push(rowCand); rowCand = null; has = false; }   // it opens the new row's piece
    cand = j;
  };
  for (let i = 0; i < tex.length;) {
    const ch = tex[i];
    if (ch === '\\') {
      let j = i + 1;
      if (j < tex.length && /[a-zA-Z]/.test(tex[j])) { while (j < tex.length && /[a-zA-Z]/.test(tex[j])) j++; }
      else j = Math.min(tex.length, i + 2);
      const cs = tex.slice(i + 1, j);
      if (cs === 'begin' || cs === 'end') {
        const m = /^\s*\{([^{}]*)\}/.exec(tex.slice(j)), name = m ? m[1].trim() : '';
        if (m) j += m[0].length;
        if (cs === 'begin') {
          const rows = depth === 0 && lr === 0 && env.length === 0 && ROW_ENV.test(name);
          if (!rows) content();
          env.push(rows);
          if (ARG_ENV.test(name)) { const a = /^\s*(\[[^\]]*\]\s*)?\{[^{}]*\}/.exec(tex.slice(j)); if (a) j += a[0].length; }   // column description
        } else env.pop();
        i = j; continue;
      }
      if (cs === '\\') {                         // new row
        if (active()) {
          const m = /^\*?\s*(\[[^\]]*\])?(\s|\\hline\b|\\hdashline\b)*/.exec(tex.slice(j)); j += m[0].length;
          rowCand = j; cand = null;
        }
        i = j; continue;
      }
      if (WIDE.has(cs) || ARROWS.has(cs)) { if (active()) sep(j); else content(); i = j; continue; }
      if (cs === 'left') { content(); lr++; i = j; continue; }
      if (cs === 'right') { lr = Math.max(0, lr - 1); i = j; continue; }
      if (NEUTRAL.has(cs)) { i = j; continue; }
      content(); i = j; continue;
    }
    if (ch === '{') { content(); depth++; i++; continue; }
    if (ch === '}') { depth = Math.max(0, depth - 1); i++; continue; }
    if (ch === '&' || ch === '~' || /\s/.test(ch)) { i++; continue; }
    if (ch === '%') { while (i < tex.length && tex[i] !== '\n') i++; continue; }
    if (ARROW_CH.includes(ch)) { if (active()) sep(i + 1); else content(); i++; continue; }
    content(ch === '_' || ch === '^' || ch === "'"); i++;
  }
  return ins;
}

/* ---------- model ---------- */
const mathBreaks = node => { let k = 0; (function w(x) { if (x.type === 'math') k += markTex(x.attrs?.tex).breaks; (x.content || []).forEach(w); })(node || {}); return k; };
/** Animation pieces of a text box when its formulas are revealed in parts: paragraphs / list items, plus the formula parts in them. */
export function partCount(o) {
  if (o.type !== 'text') return 1;
  let n = 0;
  for (const b of o.doc?.content ?? []) {
    if (b.type === 'bulletList' || b.type === 'orderedList') { if (b.content?.length) for (const li of b.content) n += 1 + mathBreaks(li); else n += 1; }
    else n += 1 + mathBreaks(b);
  }
  return n;
}
/** A copy of a text document whose formulas carry the piece markers (for the slideshow and the exports). */
export function markDoc(json) {
  return (function w(x) {
    if (x.type === 'math') return {...x, attrs: {...x.attrs, tex: markTex(x.attrs?.tex).tex}};
    return x.content ? {...x, content: x.content.map(w)} : x;
  })(json || {type: 'doc', content: []});
}

/* ---------- rendered text ---------- */
const BLOCKS = 'p,h1,h2,h3,h4,li,ul,ol,div,blockquote';
const DRAW = new Set(['path', 'use', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'circle', 'text', 'image']);
const marksIn = sp => (sp.getAttribute('data-tex') || '').split(PART_MARK).length - 1;
/** The drawn elements of a rendered formula get the number of their piece (once per rendering). */
function tagFormula(sp, base) {
  const svgs = sp.querySelectorAll('mjx-container > svg'); if (!svgs.length || sp._partsOf === svgs[0]) return;
  sp._partsOf = svgs[0];
  let seg = 0;
  for (const svg of svgs) for (const el of svg.querySelectorAll('*')) {
    if (el.classList.contains('mpb')) { seg++; continue; }
    if (DRAW.has(el.localName)) el.setAttribute('data-part', base + seg);
  }
}
/** Pieces of one block: the block itself, or – when a formula in it has parts – one set per part
 *  ({set, block, part}; its elements carry data-part = the piece's number inside the text box). */
function blockPieces(B, base) {
  const n = 1 + [...B.querySelectorAll('span.math')].reduce((t, sp) => t + marksIn(sp), 0);
  if (n === 1) return [B];
  let c = base;
  (function walk(node) {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 3) {                                  // text: wrapped, so it can be shown / hidden on its own
        if (!ch.data.trim()) continue;
        const w = document.createElement('span'); w.className = 'ppart'; w.setAttribute('data-part', c); ch.replaceWith(w); w.appendChild(ch);
        continue;
      }
      if (ch.nodeType !== 1 || ch.classList.contains('ppart')) continue;
      if (ch.matches('span.math')) { const m = marksIn(ch); if (m) { tagFormula(ch, c); c += m; } else ch.setAttribute('data-part', c); continue; }
      if (ch.matches(BLOCKS) || [...ch.querySelectorAll('span.math')].some(marksIn)) walk(ch);
      else ch.setAttribute('data-part', c);
    }
  })(B);
  return Array.from({length: n}, (_, k) => ({set: true, block: B, part: base + k}));
}
/** Animation pieces of a rendered text box whose formulas are revealed in parts (see pieceEls for the plain case). */
export function partPieces(txt) {
  const out = [];
  for (const B of pieceEls(txt)) out.push(...blockPieces(B, out.length));
  return out;
}
export const partEls = p => [...p.block.querySelectorAll(`[data-part="${p.part}"]`)];
/** Show / hide a piece (v: '' or 'hidden'); remembered, so a formula that is rendered later follows it. */
export function setPartVis(p, v) {
  (p.block._pv ||= {})[p.part] = v;
  for (const e of partEls(p)) e.style.visibility = v;
}
/** After a formula was rendered: tag it and apply the remembered visibility. */
export function refreshParts(txt) {
  for (const p of partPieces(txt)) if (p.set && p.block._pv && p.part in p.block._pv) for (const e of partEls(p)) e.style.visibility = p.block._pv[p.part];
}
