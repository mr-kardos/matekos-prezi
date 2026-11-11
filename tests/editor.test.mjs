// The real text editor (src/prezi/textview.js with every extension), run without a browser window:
// typing corrections, which characters start a list, and the look of the list symbols.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', {pretendToBeVisual: true});
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'MutationObserver', 'getComputedStyle', 'DOMParser', 'NodeFilter', 'requestAnimationFrame', 'cancelAnimationFrame', 'InputEvent', 'KeyboardEvent', 'ClipboardEvent', 'Range', 'Selection', 'CSS']) { if (dom.window[k]) globalThis[k] = dom.window[k]; }
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
const server = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'silent'});
after(() => server.close());
const tv = await server.ssrLoadModule('/src/prezi/textview.js');
const EMPTY = {type: 'doc', content: [{type: 'paragraph'}]};
const ed = tv.mountEditor(document.getElementById('host'), EMPTY, {});
/** Type text the way the keyboard does (so the typing rules run). */
const type = t => { for (const ch of t) { const {from, to} = ed.state.selection; if (!ed.view.someProp('handleTextInput', f => f(ed.view, from, to, ch))) ed.view.dispatch(ed.state.tr.insertText(ch, from, to)); } };
const fresh = () => ed.commands.setContent(EMPTY);
const first = () => ed.getJSON().content[0];
const textOf = n => (n.content || []).map(c => c.type === 'text' ? c.text : c.type === 'math' ? '$' + c.attrs.tex + '$' : textOf(c)).join('');

test('typing: Hungarian quotation marks and dash, but never inside a formula', () => {
  fresh(); type('Azt mondta: "szia" -- és ("így") $f"(x)$');
  assert.equal(textOf(first()), 'Azt mondta: „szia” – és („így”) $f"(x)$');
});

test('typing "- " starts a list; "+ ", "* " and "1. " do not', () => {
  fresh(); type('- elem'); assert.equal(first().type, 'bulletList'); assert.equal(textOf(first()), 'elem');
  for (const t of ['+ 2x', '* y', '1. z']) { fresh(); type(t); assert.equal(first().type, 'paragraph', t); assert.equal(textOf(first()), t); }
});

test('a list symbol takes the size and colour its item starts with (while editing and when drawn)', () => {
  const item = marks => ({type: 'listItem', content: [{type: 'paragraph', content: [{type: 'text', text: 'szöveg', ...(marks ? {marks} : {})}]}]});
  ed.commands.setContent({type: 'doc', content: [{type: 'bulletList', content: [item([{type: 'textStyle', attrs: {color: '#ff0000', fontSize: '40pt'}}]), item(null)]}]});
  const look = root => [...root.querySelectorAll('.lm')].map(m => [m.textContent, m.style.color, m.style.fontSize]);
  const want = [['•', 'rgb(255, 0, 0)', '40pt'], ['•', '', '']];
  assert.deepEqual(look(document.getElementById('host')), want);
  const drawn = document.createElement('div'); tv.renderStatic(drawn, ed.getJSON(), null);
  assert.deepEqual(look(drawn), want);
});
