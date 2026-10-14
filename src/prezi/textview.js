// Text boxes use the Matekos Doksi editor: the same TipTap extensions, formula node ($…$ typing,
// pasted TeX, formula editor), tables and lists. A box that is not being edited is drawn from the same
// document with the same HTML, CSS and MathJax rendering, so it looks exactly like the live editor.
import { Editor, Extension, generateHTML } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { ListItem } from '@tiptap/extension-list';
import { ParaFormat, KvBulletList, KvOrderedList, ListMarkers, KvTable, KvTableRow, KvTableCell, KvTableHeader, MathNode } from '../editor/extensions.js';
import { renderInto } from '../math.js';
import { emptyDoc } from './model.js';

const hooks = {onEdit: null, onRendered: null, onPreview: null};

/** Letter spacing as a text style (like the font size): <span style="letter-spacing:…">. */
const LetterSpacing = Extension.create({
  name: 'letterSpacing',
  addGlobalAttributes() {
    return [{types: ['textStyle'], attributes: {letterSpacing: {
      default: null,
      parseHTML: el => el.style.letterSpacing || null,
      renderHTML: a => a.letterSpacing ? {style: `letter-spacing:${a.letterSpacing}`} : {}
    }}}];
  },
  addCommands() {
    return {
      setLetterSpacing: v => ({chain}) => chain().setMark('textStyle', {letterSpacing: v}).run(),
      unsetLetterSpacing: () => ({chain}) => chain().setMark('textStyle', {letterSpacing: null}).removeEmptyTextStyle().run()
    };
  }
});
export function setTextHooks(h) { Object.assign(hooks, h); }

/** kind 'text': text boxes (no tables); kind 'table': table objects (the document is exactly one table). */
function extensions(kind = 'text') {
  const table = kind === 'table';
  return [
    StarterKit.configure({
      heading: table ? false : {levels: [1, 2, 3]}, code: false, codeBlock: false, blockquote: false, horizontalRule: false,
      link: false, bulletList: false, orderedList: false, listItem: false, dropcursor: {color: '#2f6fdb', width: 2},
      ...(table ? {document: false} : {})
    }),
    ...(table ? [Document.extend({content: 'table'}), KvTable, KvTableRow, KvTableHeader, KvTableCell] : []),
    ListItem, KvBulletList, KvOrderedList, ListMarkers,
    TextStyle, Color, FontSize, LetterSpacing,
    Highlight.configure({multicolor: true}),
    TextAlign.configure({types: table ? ['paragraph'] : ['heading', 'paragraph']}),
    Subscript, Superscript,
    ParaFormat,
    MathNode.configure({
      onEdit: (pos, node) => hooks.onEdit?.(pos, node),
      onRendered: () => hooks.onRendered?.(),
      onPreview: p => hooks.onPreview?.(p)
    })
  ];
}
const STATIC_EXT = {text: extensions('text'), table: extensions('table')};

/* ---------- list markers for the static view (same output as the ListMarkers plugin) ---------- */
function ordinal(n, style) {
  const alpha = (k, up) => { let s = ''; while (k > 0) { k--; s = String.fromCharCode(97 + k % 26) + s; k = Math.floor(k / 26); } return up ? s.toUpperCase() : s; };
  const roman = (k, up) => { const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (k >= v) { s += r; k -= v; } return up ? s.toUpperCase() : s; };
  switch (style) {
    case 'decimal-paren': return n + ')';
    case 'lower-alpha': return alpha(n) + ')';
    case 'upper-alpha': return alpha(n, true) + '.';
    case 'lower-roman': return roman(n) + '.';
    case 'upper-roman': return roman(n, true) + '.';
    default: return n + '.';
  }
}
const DEFAULT_BULLETS = ['•', '◦', '▪'];
function addMarkers(root, depth = 0) {
  for (const list of root.querySelectorAll(':scope > ul, :scope > ol, :scope > li > ul, :scope > li > ol')) {
    const ordered = list.tagName === 'OL', start = +(list.getAttribute('start') || 1);
    [...list.children].forEach((li, i) => {
      const first = li.firstElementChild;
      if (first && /^(P|H[1-3])$/.test(first.tagName)) {
        const s = document.createElement('span'); s.className = 'lm'; s.contentEditable = 'false';
        if (ordered) s.textContent = ordinal(start + i, list.getAttribute('data-num'));
        else if (list.getAttribute('data-bullet-img')) {
          const im = document.createElement('img'); im.src = list.getAttribute('data-bullet-img'); im.alt = '';
          im.style.height = (list.getAttribute('data-bullet-size') || 0.9) + 'em'; s.appendChild(im);
        } else s.textContent = list.getAttribute('data-bullet') || DEFAULT_BULLETS[depth % 3];
        first.prepend(s);
      }
      addMarkers(li, depth + 1);
    });
  }
}

/** Draw a text document into `host` (a .txt element) without an editor. Returns the content element. */
export function renderStatic(host, json, onRendered, kind = 'text') {
  const pm = document.createElement('div'); pm.className = 'ProseMirror';
  let html = '';
  try { html = generateHTML(json || emptyDoc(), STATIC_EXT[kind]); } catch (e) { html = kind === 'table' ? '' : '<p></p>'; }
  pm.innerHTML = html;
  for (const t of pm.querySelectorAll(':scope > table')) { const w = document.createElement('div'); w.className = 'tableWrapper'; t.replaceWith(w); w.appendChild(t); }
  addMarkers(pm);
  for (const b of pm.querySelectorAll('p, h1, h2, h3')) {
    const hasContent = [...b.childNodes].some(n => !(n.nodeType === 1 && n.classList.contains('lm')) && (n.nodeType !== 3 || n.data.length));
    if (!hasContent) b.appendChild(document.createElement('br'));
  }
  for (const sp of pm.querySelectorAll('span.math')) {
    sp.contentEditable = 'false';
    renderInto(sp, sp.getAttribute('data-tex') || '', sp.getAttribute('data-display') === '1', onRendered, !!sp.closest('strong,b'));
  }
  host.innerHTML = ''; host.appendChild(pm);
  return pm;
}
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
export function mathPending(root) { return !!root.querySelector('.math .mpending:not(.merr)'); }

/** Live editor inside a text box. */
export function mountEditor(host, json, {onUpdate, onSelection, onFocus, onBlur} = {}, kind = 'text') {
  host.innerHTML = '';
  return new Editor({
    element: host,
    extensions: extensions(kind),
    content: json || emptyDoc(),
    editorProps: {
      attributes: {spellcheck: 'true', lang: 'hu'},
      // pasted text and formulas take the size and font of the text box
      transformPastedHTML: html => html.replace(/(font-size|font-family|line-height)\s*:[^;"']*;?/gi, ''),
      handleDOMEvents: {
        dragstart: (view, e) => { if (e.target?.closest?.('td,th')) { e.preventDefault(); return true; } return false; }
      }
    },
    onUpdate: () => onUpdate?.(),
    onSelectionUpdate: () => onSelection?.(),
    onTransaction: () => onSelection?.(),
    onFocus: () => onFocus?.(),
    onBlur: () => onBlur?.()
  });
}
