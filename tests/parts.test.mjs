// Formula parts (src/prezi/parts.js): where a formula is cut into steps, the piece count, the rendered pieces,
// and that the invisible markers do not change the formula's layout in MathJax.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { markTex, partCount, markDoc, PART_MARK } from '../src/prezi/parts.js';

const cut = tex => markTex(tex).tex.split(PART_MARK).map(s => s.trim());
const CASES = [
  ['a=b \\quad \\Rightarrow \\quad c=d', ['a=b \\quad \\Rightarrow \\quad', 'c=d']],
  ['x+1=3 \\implies x=2', ['x+1=3 \\implies', 'x=2']],
  ['\\begin{aligned} 2x+1 &= 7 \\\\ 2x &= 6 \\\\ x &= 3 \\end{aligned}', ['\\begin{aligned} 2x+1 &= 7 \\\\', '2x &= 6 \\\\', 'x &= 3 \\end{aligned}']],
  ['\\begin{aligned} a &= b \\\\[4pt] &\\Rightarrow c = d \\quad e \\\\ \\end{aligned}', ['\\begin{aligned} a &= b \\\\[4pt]', '&\\Rightarrow c = d \\quad', 'e \\\\ \\end{aligned}']],
  ['\\Rightarrow x = 2', ['\\Rightarrow x = 2']],                       // nothing before the arrow
  ['a \\quad', ['a \\quad']],                                           // nothing after the space
  ['\\frac{a \\quad b}{c} \\Rightarrow \\left( x \\quad y \\right) \\qquad \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} \\iff z',
    ['\\frac{a \\quad b}{c} \\Rightarrow', '\\left( x \\quad y \\right) \\qquad', '\\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} \\iff', 'z']],
  ['A \\Rightarrow_{x} B ⇒ C', ['A \\Rightarrow_{x} B ⇒', 'C']],        // never between an arrow and its subscript
  ['f(x)=\\begin{cases} 1 \\quad x>0 \\\\ 0 \\end{cases} \\quad g', ['f(x)=\\begin{cases} 1 \\quad x>0 \\\\ 0 \\end{cases} \\quad', 'g']],
  ['\\begin{array}{ll} a & b \\\\ \\hline c & d \\end{array}', ['\\begin{array}{ll} a & b \\\\ \\hline', 'c & d \\end{array}']],
  ['a \\\\ b \\\\ c', ['a \\\\', 'b \\\\', 'c']],
  ['x \\quad\\quad\\, \\Leftrightarrow ~ y \\qquad z^2', ['x \\quad\\quad\\, \\Leftrightarrow', '~ y \\qquad', 'z^2']],
  ['a \\to b \\rightarrow c', ['a \\to b \\rightarrow c']],             // plain arrows do not cut
  ['', ['']],
];

test('formulas are cut at rows, wide spaces and implication arrows', () => {
  for (const [tex, parts] of CASES) {
    assert.deepEqual(cut(tex), parts, tex);
    assert.equal(markTex(tex).breaks, parts.length - 1, tex);
  }
});

test('piece count of a text box: paragraphs and list items plus the formula parts in them', () => {
  const math = tex => ({type: 'math', attrs: {tex}});
  const o = {type: 'text', doc: {type: 'doc', content: [
    {type: 'paragraph', content: [{type: 'text', text: 'Tehát '}, math(CASES[0][0])]},            // 2
    {type: 'paragraph'},                                                                          // 1
    {type: 'bulletList', content: [{type: 'listItem', content: [{type: 'paragraph', content: [math(CASES[2][0])]}]}, {type: 'listItem', content: [{type: 'paragraph'}]}]},   // 3 + 1
  ]}};
  assert.equal(partCount(o), 7);
  assert.equal(partCount({type: 'table', doc: o.doc}), 1);
  const marked = markDoc(o.doc);
  assert.equal(marked.content[0].content[1].attrs.tex, markTex(CASES[0][0]).tex);
  assert.equal(o.doc.content[0].content[1].attrs.tex, CASES[0][0], 'the original document is untouched');
});

test('rendered pieces: text and formula parts in reading order, also for a formula rendered later', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.document = dom.window.document;
  const { partPieces, partEls, setPartVis, refreshParts } = await import('../src/prezi/parts.js');
  const svg = (...segs) => `<mjx-container><svg viewBox="0 0 10 10"><g>${segs.map((s, i) => (i ? '<g class="mpb" data-mml-node="mspace"></g>' : '') + [...s].map(c => `<g><path d="${c}"/></g>`).join('')).join('')}</g></svg></mjx-container>`;
  const esc = t => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  document.body.innerHTML = `<div class="txt" data-parts="1"><div class="ProseMirror">` +
    `<p>Sima bekezdés <strong>vastag</strong></p>` +
    `<p>Tehát <span class="math" data-tex="${esc(markTex(CASES[0][0]).tex)}">${svg('ab', 'cd')}</span>, <em>kész</em>.</p>` +
    `<ul><li><span class="lm">•</span><p><span class="math" data-tex="${esc(markTex('\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}').tex)}"><span class="mpending">…</span></span></p></li></ul>` +
    `</div></div>`;
  const txt = document.querySelector('.txt');
  const show = p => p.set ? partEls(p).map(e => e.localName === 'path' ? e.getAttribute('d') : e.textContent).join('|') : '<' + p.localName + '>';
  let P = partPieces(txt);
  assert.deepEqual(P.map(show), ['<p>', 'Tehát |a|b', 'c|d|, |kész|.', '•', '']);
  setPartVis(P[2], 'hidden'); setPartVis(P[4], 'hidden');
  document.querySelectorAll('span.math')[1].innerHTML = svg('x1', 'y2');          // the second formula is rendered only now
  refreshParts(txt); P = partPieces(txt);
  assert.deepEqual(P.map(show), ['<p>', 'Tehát |a|b', 'c|d|, |kész|.', '•|x|1', 'y|2']);
  const hidden = [...document.querySelectorAll('[data-part]')].filter(e => e.style.visibility === 'hidden').map(e => e.getAttribute('d') || e.textContent);
  assert.deepEqual(hidden, ['c', 'd', ', ', 'kész', '.', 'y', '2']);
  const wrappers = document.querySelectorAll('.ppart').length; partPieces(txt);
  assert.equal(document.querySelectorAll('.ppart').length, wrappers, 'finding the pieces again changes nothing');
});

test('the markers leave the formula exactly as MathJax draws it without them', async () => {
  const require = createRequire(import.meta.url);
  const MJ = await require('mathjax').init({
    loader: {load: ['input/tex', 'output/svg', 'adaptors/liteDOM'], paths: {'mathjax-bonum': path.dirname(require.resolve('@mathjax/mathjax-bonum-font/package.json'))}},
    output: {font: 'mathjax-bonum'}, svg: {fontCache: 'none'}
  });
  const A = MJ.startup.adaptor, draw = async tex => A.outerHTML(await MJ.tex2svgPromise(tex, {display: false}));
  const plain = s => s.replace(/ data-latex="[^"]*"/g, '').replace(/<g data-mml-node="mspace" class="mpb"[^>]*><\/g>/g, '');
  for (const [tex] of CASES) if (tex) for (const wrap of [t => '\\displaystyle ' + t, t => '\\displaystyle \\boldsymbol{' + t + '}']) {
    const m = markTex(tex), a = await draw(wrap(tex)), b = await draw(wrap(m.tex));
    assert.ok(!/merror|data-mjx-error/.test(b), 'no TeX error: ' + tex);
    assert.equal((b.match(/class="mpb"/g) || []).length, m.breaks, 'every marker is drawn: ' + tex);
    assert.equal(plain(b), plain(a), 'same layout: ' + tex);
  }
});
