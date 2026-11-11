// Pasted text (src/prezi/paste.js): paragraphs and lists survive, the look of the source does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { cleanPastedHTML } = await import('../src/prezi/paste.js');

test('plain paragraphs keep bold, italic, underline and links only', () => {
  assert.equal(cleanPastedHTML('<p style="font-size:30px;color:red">Egy <b>vastag</b> és <span style="font-style:italic">dőlt</span> <a href="https://x.hu">link</a></p><div>Második<br>harmadik</div>'),
    '<p>Egy <strong>vastag</strong> és <em>dőlt</em> <a href="https://x.hu">link</a></p><p>Második</p><p>harmadik</p>');
  assert.equal(cleanPastedHTML(''), '<p></p>');
});

test('lists stay lists, with their levels', () => {
  assert.equal(cleanPastedHTML('<p>Előtte</p><ul><li>egy</li><li>kettő<ul><li>belső</li></ul></li></ul><ol><li><p>első</p></li><li>második</li></ol><p>Utána</p>'),
    '<p>Előtte</p><ul><li><p>egy</p></li><li><p>kettő</p><ul><li><p>belső</p></li></ul></li></ul><ol><li><p>első</p></li><li><p>második</p></li></ol><p>Utána</p>');
  // a nested list written next to (not inside) its item, as some programs do
  assert.equal(cleanPastedHTML('<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>'), '<ul><li><p>a</p><ul><li><p>b</p></li></ul></li><li><p>c</p></li></ul>');
});

test('Word lists (paragraphs with mso-list) become real lists', () => {
  const p = (lvl, sym, text) => `<p class="MsoListParagraph" style="mso-list:l0 level${lvl} lfo1"><!--[if !supportLists]--><span style="mso-list:Ignore">${sym}<span>&nbsp;&nbsp;</span></span><!--[endif]-->${text}</p>`;
  assert.equal(cleanPastedHTML('<p>Cím</p>' + p(1, '·', 'egy') + p(2, 'o', 'belső') + p(1, '·', 'kettő') + '<p>Vége</p>'),
    '<p>Cím</p><ul><li><p>egy</p><ul><li><p>belső</p></li></ul></li><li><p>kettő</p></li></ul><p>Vége</p>');
  assert.equal(cleanPastedHTML(p(1, 'a)', 'első') + p(1, 'b)', 'második')), '<ol data-num="lower-alpha"><li><p>első</p></li><li><p>második</p></li></ol>');
  assert.equal(cleanPastedHTML(p(1, '1.', 'első') + p(1, '2.', 'második')), '<ol><li><p>első</p></li><li><p>második</p></li></ol>');
});

test('text copied inside the app is kept as it is (without sizes)', () => {
  assert.equal(cleanPastedHTML('<p data-pm-slice="1 1 []" style="font-size: 12px;color:red">x</p>'), '<p data-pm-slice="1 1 []" style="color:red">x</p>');
});
