// Text boxes use the Matekos Doksi editor: the same TipTap extensions, formula node ($…$ typing,
// pasted TeX, formula editor), tables and lists. A box that is not being edited is drawn from the same
// document with the same HTML, CSS and MathJax rendering, so it looks exactly like the live editor.
import { Editor, generateHTML } from '@tiptap/core';
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
export function setTextHooks(h) { Object.assign(hooks, h); }

function extensions() {
  return [
    StarterKit.configure({
      heading: {levels: [1, 2, 3]}, code: false, codeBlock: false, blockquote: false, horizontalRule: false,
      link: false, bulletList: false, orderedList: false, listItem: false, dropcursor: {color: '#2f6fdb', width: 2}
    }),
    ListItem, KvBulletList, KvOrderedList, ListMarkers,
    TextStyle, Color, FontSize,
    Highlight.configure({multicolor: true}),
    TextAlign.configure({types: ['heading', 'paragraph']}),
    Subscript, Superscript,
    KvTable, KvTableRow, KvTableHeader, KvTableCell,
    ParaFormat,
    MathNode.configure({
      onEdit: (pos, node) => hooks.onEdit?.(pos, node),
      onRendered: () => hooks.onRendered?.(),
      onPreview: p => hooks.onPreview?.(p)
    })
  ];
}
const STATIC_EXT = extensions();

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
export function renderStatic(host, json, onRendered) {
  const pm = document.createElement('div'); pm.className = 'ProseMirror';
  let html = '';
  try { html = generateHTML(json || emptyDoc(), STATIC_EXT); } catch (e) { html = '<p></p>'; }
  pm.innerHTML = html;
  for (const t of pm.querySelectorAll(':scope > table')) { const w = document.createElement('div'); w.className = 'tableWrapper'; t.replaceWith(w); w.appendChild(t); }
  addMarkers(pm);
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
export function mountEditor(host, json, {onUpdate, onSelection, onFocus, onBlur} = {}) {
  host.innerHTML = '';
  return new Editor({
    element: host,
    extensions: extensions(),
    content: json || emptyDoc(),
    editorProps: {
      attributes: {spellcheck: 'true', lang: 'hu'},
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
