// Animation order (src/prezi/anim.js): pieces of a text box, clicks, what is hidden when the slide appears.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Anim } from '../src/prezi/anim.js';

const P = (...c) => ({type: 'paragraph', content: c}), T = text => ({type: 'text', text}), M = tex => ({type: 'math', attrs: {tex}});
const box = (id, ...blocks) => ({id, type: 'text', x: 0, y: 0, w: 400, h: 200, doc: {type: 'doc', content: blocks}});
const keys = list => list.map(a => a.key);
const steps = list => Anim.groups(list).map(g => (g.auto ? 'auto:' : '') + g.chains.map(c => c.map(a => a.key).join('+')).join('>'));

test('one piece per object without "by paragraph"', () => {
  const o = box('T', P(T('a')), P(T('b')));
  const s = {objects: [o], anims: [{id: 'a1', target: 'T', effect: 'fade', trigger: 'click'}]};
  assert.equal(Anim.splitMode(s, o), null);
  assert.deepEqual(Anim.pieceKeys(s, o), ['T']);
  assert.deepEqual(steps(Anim.expand(s)), ['T']);
});

test('by paragraph: one click per paragraph; a whole-box animation moves all pieces together', () => {
  const o = box('T', P(T('a')), P(T('b')), P(M('x \\quad y')));
  const s = {objects: [o, {id: 'S', type: 'shape'}], anims: [
    {id: 'a1', target: 'T', effect: 'fade', trigger: 'click', byParagraph: true},
    {id: 'a2', target: 'S', effect: 'appear', trigger: 'with'},
    {id: 'a3', target: 'T', effect: 'fadeOut', trigger: 'click'},
  ]};
  assert.deepEqual(Anim.splitMode(s, o), {mode: 'para', n: 3});
  const list = Anim.expand(s);
  assert.deepEqual(steps(list), ['T#0', 'T#1', 'T#2+S', 'T#0+T#1+T#2']);
  assert.deepEqual([...Anim.initiallyHidden(list)].sort(), ['S', 'T#0', 'T#1', 'T#2']);
  assert.deepEqual(Anim.numbers(list), [1, 2, 3, 3, 4, 4, 4]);
});

test('formulas in parts: the formula parts are steps of their own', () => {
  const o = box('T', P(T('a')), P(M('a \\quad b \\Rightarrow c')));
  const s = {objects: [o], anims: [{id: 'a1', target: 'T', effect: 'fade', trigger: 'click', byParagraph: 'parts'}]};
  assert.deepEqual(Anim.splitMode(s, o), {mode: 'parts', n: 4});
  assert.deepEqual(keys(Anim.expand(s)), ['T#0', 'T#1', 'T#2', 'T#3']);
  // one paragraph is enough when its formula has parts
  const one = box('U', P(M('x=1 \\implies y=2')));
  assert.deepEqual(Anim.splitMode({objects: [one], anims: [{id: 'b', target: 'U', effect: 'fade', trigger: 'click', byParagraph: 'parts'}]}, one), {mode: 'parts', n: 2});
  // nothing to cut: falls back to paragraphs, or to one piece
  const plain = box('V', P(T('a')), P(T('b')));
  assert.deepEqual(Anim.splitMode({objects: [plain], anims: [{id: 'c', target: 'V', effect: 'fade', trigger: 'click', byParagraph: 'parts'}]}, plain), {mode: 'para', n: 2});
  const single = box('W', P(T('a')));
  assert.equal(Anim.splitMode({objects: [single], anims: [{id: 'd', target: 'W', effect: 'fade', trigger: 'click', byParagraph: 'parts'}]}, single), null);
});

test('a rotated text box is never cut into pieces', () => {
  const o = {...box('T', P(T('a')), P(T('b'))), rot: 30};
  assert.equal(Anim.splitMode({objects: [o], anims: [{id: 'a', target: 'T', effect: 'fade', trigger: 'click', byParagraph: true}]}, o), null);
});
