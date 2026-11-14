// Steps (src/prezi/steps.js): one animated slide ⇄ one slide per step – the slideshow must look exactly the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Anim } from '../src/prezi/anim.js';
import { blockPieceCounts } from '../src/prezi/parts.js';
import { splitSlide, mergeRun, findRuns, slideStates, slideStatesBefore, clicksOf } from '../src/prezi/steps.js';

let n = 0;
const uid = () => 'u' + (++n);
const keep = { uid, reid: (o, map) => { map.set(o.id, o.id); } };                 // ids kept: states compare directly
const fresh = { uid, reid: function reid(o, map) { const id = uid(); map.set(o.id, id); o.id = id; (o.children || []).forEach(c => reid(c, map)); } };
const sigOf = o => o.type + '|' + JSON.stringify(o.doc || o.shape || o.media || (o.children || []).map(c => c.id));
const P = t => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }), M = tex => ({ type: 'paragraph', content: [{ type: 'math', attrs: { tex } }] });
const box = (id, y, ...blocks) => ({ id, type: 'text', x: 40, y, w: 600, h: 200, doc: { type: 'doc', content: blocks } });
const shape = (id, x) => ({ id, type: 'shape', shape: 'rect', x, y: 300, w: 80, h: 60 });
const A = (target, effect, trigger, extra = {}) => ({ id: uid(), target, effect, trigger, ...extra });

/** The effects of every step as the slideshow plays them: [{effect, key, trigger, dur, delay}] per step (the start too). */
const stepEffects = s => { const g = Anim.groups(Anim.expand(s).filter(a => !a.pre)); return g.map(x => x.chains.flat().map(a => [a.effect, a.key, a.trigger, Anim.durOf(a), Anim.delayOf(a), a.dir || ''].join())); };
const norm = st => ({ vis: Object.fromEntries(Object.entries(st.vis).filter(([, v]) => v)), grow: Object.fromEntries(Object.entries(st.grow).filter(([, v]) => v)) });
/** What is seen, per object of the original slide: its pieces shown / grown (a whole-object key stands for all its pieces). */
// `slide`: the slide the state belongs to – a copy of a box there may have fewer paragraphs (the later ones are not seen)
const seen = (orig, st, slide = orig) => Object.fromEntries(orig.objects.map(o => { const ks = Anim.pieceKeys(orig, o), mine = slide.objects.find(q => q.id === o.id);
  const by = Anim.splitMode(orig, o)?.mode === 'parts', have = mine && mine.type === 'text' ? blockPieceCounts(mine, by).reduce((x, y) => x + y, 0) : ks.length;
  return [o.id, ks.map((k, i) => i >= have ? '00' : [!!(st.vis[k] ?? st.vis[o.id]), !!(st.grow[k] ?? st.grow[o.id])].map(Number).join('')).join(' ')]; }));

const SAMPLE = () => ({
  id: 's1', template: 'body', transition: { type: 'fade' },
  objects: [box('T', 40, P('Első'), M('a=b \\quad \\Rightarrow \\quad c=d'), P('Harmadik')), shape('R', 100), shape('Q', 300), shape('Z', 500)],
  anims: [
    A('R', 'fade', 'with'),                                  // automatic at the start
    A('T', 'fly', 'click', { byParagraph: 'parts', dir: 'l' }),   // paragraph + formula parts, one click each
    A('Q', 'grow', 'with'),
    A('Z', 'fade', 'click'), A('R', 'flyOut', 'after', { dur: 700 }),
    A('Z', 'disappear', 'click')
  ]
});

test('one slide per step: every slide starts as the step before ended and plays that step when it appears', () => {
  const s = SAMPLE(), states = slideStates(s), eff = stepEffects(s), parts = splitSlide(s, keep);
  assert.equal(parts.length, clicksOf(s) + 1);
  assert.deepEqual(parts[0].transition, { type: 'fade' }); assert.ok(parts.slice(1).every(p => !p.transition), 'no slide transition between the steps');
  parts.forEach((p, j) => {
    assert.equal(clicksOf(p), 0, 'a step slide has no clicks');
    const present = st => ({ vis: Object.fromEntries(Object.entries(st.vis).filter(([k]) => p.objects.some(o => o.id === k.split('#')[0]))), grow: st.grow });
    if (j > 0) assert.deepEqual(seen(s, present(slideStatesBefore(p)), p), seen(s, states[j - 1]), `slide ${j} starts as step ${j - 1} ended`);
    assert.deepEqual(seen(s, present(slideStates(p).at(-1)), p), seen(s, states[j]), `slide ${j} ends as step ${j}`);
    const own = stepEffects(p)[0] || [], orig = j === 0 ? (eff[0] || []) : eff[j - (Anim.groups(Anim.expand(s))[0].auto ? 0 : 1)];
    // a key of a box that is not cut into pieces on the copy (it has one paragraph left) is the whole box there
    const nk = x => { const f = x.split(','); const id = f[1].split('#')[0], o = p.objects.find(q => q.id === id); if (o && Anim.pieceKeys(p, o).length === 1) f[1] = id; return f.filter((_, i) => i !== 2).join(); };
    assert.deepEqual(own.map(nk), (orig || []).map(nk), `slide ${j} plays the same effects`);
  });
});

test('with new object ids every effect still points at an object of its slide', () => {
  const parts = splitSlide(SAMPLE(), fresh);
  for (const p of parts) for (const a of p.anims) assert.ok(p.objects.some(o => o.id === a.target), 'target exists');
});

test('back to one slide: the same states and the same effects at every click', () => {
  const s = SAMPLE(), parts = splitSlide(s, fresh);
  assert.deepEqual(findRuns(parts, sigOf), [parts.map((_, i) => i)]);
  const m = mergeRun(parts, { uid, sigOf });
  assert.equal(clicksOf(m), clicksOf(s));
  const a = slideStates(s), b = slideStates(m);
  // the merged slide has its own object ids: compare by object order and piece number
  const byPos = (slide, st) => { const idx = {}; slide.objects.forEach((o, i) => { idx[o.id] = i; }); return st.map(x => ({ vis: Object.keys(norm(x).vis).map(k => { const [id, p] = k.split('#'); return idx[id] + (p ? '#' + p : ''); }).sort(), grow: Object.keys(norm(x).grow).map(k => idx[k.split('#')[0]]).sort() })); };
  assert.deepEqual(byPos(m, b), byPos(s, a));
  assert.deepEqual(stepEffects(m).map(g => g.length), stepEffects(s).map(g => g.length).map((l, i) => l), 'same number of effects per step');
});

test('slides that are not steps of one another are not merged', () => {
  const a = { id: 'a', template: 'body', objects: [shape('R', 100)], anims: [] };
  const b = { id: 'b', template: 'body', objects: [shape('X', 400)], anims: [] };           // nothing in common
  const c = { id: 'c', template: 'body', transition: { type: 'fade' }, objects: [shape('R', 100), shape('Y', 300)], anims: [] };   // a transition between them
  const d = { id: 'd', template: 'body', objects: [{ ...shape('R', 100), x: 120 }, shape('Y', 300)], anims: [] };                 // R moved
  assert.deepEqual(findRuns([a, b], sigOf), []);
  assert.deepEqual(findRuns([a, c], sigOf), []);
  assert.deepEqual(findRuns([a, d], sigOf), []);
  const e = { id: 'e', template: 'body', objects: [shape('R2', 100), shape('Y', 300)], anims: [] };                                // R stays, Y appears
  assert.deepEqual(findRuns([a, e], sigOf), [[0, 1]]);
  const m = mergeRun([a, e], { uid, sigOf });
  assert.equal(clicksOf(m), 1); assert.equal(m.objects.length, 2);
  assert.deepEqual(Anim.expand(m).map(x => [x.effect, x.trigger]), [['appear', 'click']]);
});

test('split: the copies of a box shown paragraph by paragraph have only the paragraphs they show', () => {
  const parts = splitSlide(SAMPLE(), keep);
  const lens = parts.map(p => { const t = p.objects.find(o => o.id === 'T'); return t ? t.doc.content.length : 0; });
  assert.deepEqual(lens, [0, 1, 2, 2, 3, 3, 3].slice(0, parts.length));
});

test('merge: the same text box growing paragraph by paragraph becomes one box revealed by paragraphs', () => {
  const T = (...ps) => ({ ...box('T' + ps.length, 40, ...ps.map(P)), h: 60 * ps.length });
  const slides = [1, 2, 3].map(k => ({ id: 's' + k, template: 'body', objects: [T(...['Első', 'Második', 'Harmadik'].slice(0, k)), shape('R' + k, 700)], anims: [] }));
  assert.deepEqual(findRuns(slides, sigOf), [[0, 1, 2]]);
  const m = mergeRun(slides, { uid, sigOf });
  assert.equal(m.objects.filter(o => o.type === 'text').length, 1, 'one text box');
  const t = m.objects.find(o => o.type === 'text');
  assert.equal(t.doc.content.length, 3, 'with all its paragraphs');
  assert.deepEqual(m.anims.map(a => [a.effect, a.trigger, a.byParagraph, a.pieces]), [['appear', 'click', true, [1, 2]]], 'one "by paragraph" effect');
  assert.equal(clicksOf(m), 2);
  assert.deepEqual(slideStates(m).map(st => [0, 1, 2].map(i => st.vis[`${t.id}#${i}`] ? 1 : 0).join('')), ['100', '110', '111']);
});

test('split and merge back: the box revealed by paragraphs comes back as one box', () => {
  const s = SAMPLE(), m = mergeRun(splitSlide(s, fresh), { uid, sigOf });
  const t = m.objects.filter(o => o.type === 'text');
  assert.equal(t.length, 1); assert.equal(t[0].doc.content.length, 3);
  assert.equal(clicksOf(m), clicksOf(s));
});
