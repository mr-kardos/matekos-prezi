// Text boxes use the Matekos Doksi editor: the same TipTap extensions, formula node ($…$ typing,
// pasted TeX, formula editor), tables and lists. A box that is not being edited is drawn from the same
// document with the same HTML, CSS and MathJax rendering, so it looks exactly like the live editor.
import { Editor, Extension, InputRule, generateHTML } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import Document from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize, FontFamily } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { ListItem } from '@tiptap/extension-list';
import { ParaFormat, KvBulletList, KvOrderedList, ListMarkers, KvTable, KvTableRow, KvTableCell, KvTableHeader, MathNode, ListItemAttrs, ListJoin, CommentMark, TabNode, MathCaret, ListGapFit, fitListGapsDOM, ordinal, listDefaults } from '../editor/extensions.js';
import { layoutTabs } from '../tabs.js';
import { renderInto, mathStyleOf } from '../math.js';
import { emptyDoc } from './model.js';
import { cleanPastedHTML } from './paste.js';

const hooks = {onEdit: null, onRendered: null, onPreview: null, getScale: null};

/** Upper case display (the typed letters stay as they were): <span style="text-transform:uppercase">. */
const TextCase = Extension.create({
  name: 'textCase',
  addGlobalAttributes() {
    return [{types: ['textStyle'], attributes: {textTransform: {
      default: null,
      parseHTML: el => el.style.textTransform === 'uppercase' ? 'uppercase' : null,
      renderHTML: a => a.textTransform ? {style: `text-transform:${a.textTransform}`} : {}
    }}}];
  },
  addCommands() {
    return {
      setUppercase: () => ({chain}) => chain().setMark('textStyle', {textTransform: 'uppercase'}).run(),
      unsetUppercase: () => ({chain}) => chain().setMark('textStyle', {textTransform: null}).removeEmptyTextStyle().run()
    };
  }
});
export { cleanPastedHTML };

/** Typing corrections: Hungarian quotation marks („ ”) for ", and a dash (–) for two hyphens. Never inside a formula
 *  that is being typed ($…), and Backspace right after a correction brings back what was typed. */
const HunTyping = Extension.create({
  name: 'hunTyping',
  addInputRules() {
    const before = (state, pos) => { const $p = state.doc.resolve(pos); return $p.parent.textBetween(0, $p.parentOffset, undefined, '\ufffc'); };
    const inFormula = t => (t.split('$').length - 1) % 2 === 1;
    return [
      new InputRule({find: /"$/, handler: ({state, range}) => {
        const t = before(state, range.from); if (inFormula(t)) return null;
        state.tr.insertText(!t || /[\s(\[{„–—-]$/.test(t) ? '„' : '”', range.from, range.to);
      }}),
      new InputRule({find: /--$/, handler: ({state, range}) => {
        const t = before(state, range.from); if (inFormula(t) || /-$/.test(t)) return null;
        state.tr.insertText('–', range.from, range.to);
      }})
    ];
  }
});
/** Slides never use display (centred, own-line) formulas – pasted $$…$$ / \\[…\\] stay in the line. */
const InlineMathOnly = Extension.create({
  name: 'inlineMathOnly',
  addProseMirrorPlugins() {
    return [new Plugin({appendTransaction: (trs, _old, state) => {
      if (!trs.some(t => t.docChanged)) return null;
      let tr = null;
      state.doc.descendants((n, pos) => { if (n.type.name === 'math' && n.attrs.display) (tr ??= state.tr).setNodeMarkup(pos, undefined, {...n.attrs, display: false}, n.marks); });
      return tr;
    }})];
  }
});
/** Hanging indent inside lists: the whole paragraph moves right, the list symbol stays (more space after it). */
const ListHang = Extension.create({
  name: 'listHang',
  addGlobalAttributes() {
    return [{types: ['paragraph'], attributes: {hang: {
      default: null,
      parseHTML: el => { const v = parseFloat(el.getAttribute('data-hang')); return isFinite(v) ? v : null; },
      renderHTML: a => a.hang ? {'data-hang': a.hang, style: `--hang:${a.hang}cm;padding-left:${a.hang}cm`} : {}
    }}}];
  }
});
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
      link: {openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: {rel: 'noopener', target: '_blank'}}, bulletList: false, orderedList: false, listItem: false, dropcursor: {color: '#2f6fdb', width: 2},
      ...(table ? {document: false} : {})
    }),
    ...(table ? [Document.extend({content: 'table'}), KvTable, KvTableRow, KvTableHeader, KvTableCell] : []),
    ListItem, KvBulletList, KvOrderedList, ListMarkers, ListItemAttrs, ListJoin, CommentMark, TabNode.configure({getScale: () => hooks.getScale?.() || 1}), MathCaret, ListGapFit.configure({getScale: () => hooks.getScale?.() || 1}),
    TextStyle, Color, FontSize, FontFamily, LetterSpacing, TextCase, InlineMathOnly, ListHang, HunTyping,
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
const DEFAULT_BULLETS = ['•', '◦', '▪'];
const firstLineBold = p => {
  if (!p.textContent.trim()) return false;
  const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) if (n.data.trim() && !n.parentElement.closest('.math') && !n.parentElement.closest('strong, b')) return false;
  return true;
};
/** Size and colour the item's text starts with (set on that text itself): its symbol takes them, as in PowerPoint. */
function firstRunLook(p) {
  const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let at = null;
  for (let n = tw.nextNode(); n && !at; n = tw.nextNode()) {
    if (n.nodeType === 1) { if (n.matches('span.math')) at = n.parentElement; }
    else if (n.data.trim() && !n.parentElement.closest('.math, .lm')) at = n.parentElement;
  }
  const look = {size: '', color: ''};
  for (let e = at; e && e !== p; e = e.parentElement) { if (!look.size && e.style.fontSize) look.size = e.style.fontSize; if (!look.color && e.style.color) look.color = e.style.color; }
  return look;
}
function addMarkers(root, depth = 0) {
  const ends = {};                                  // last number per numbering style on this level (continued lists)
  for (const list of root.querySelectorAll(':scope > ul, :scope > ol, :scope > li > ul, :scope > li > ol')) {
    const ordered = list.tagName === 'OL', sty = list.getAttribute('data-num') || listDefaults.num;
    const items = [...list.children].filter(c => c.tagName === 'LI');
    const start = ordered ? (list.getAttribute('data-cont') === '1' ? (ends[sty] ?? 0) + 1 : +(list.getAttribute('start') || 1)) : 1;
    if (ordered) ends[sty] = start + items.filter(li => !li.hasAttribute('data-ghost')).length - 1;
    let real = -1;
    items.forEach(li => {
      if (!li.hasAttribute('data-ghost')) real++;
      const first = li.firstElementChild;
      if (!li.hasAttribute('data-ghost') && first && /^(P|H[1-3])$/.test(first.tagName)) {
        const s = document.createElement('span'); s.className = 'lm' + (firstLineBold(first) ? ' lm-b' : ''); s.contentEditable = 'false';
        const look = firstRunLook(first); if (look.size) s.style.fontSize = look.size; if (look.color) s.style.color = look.color;
        if (ordered) s.textContent = ordinal(start + Math.max(0, real), sty);
        else if (list.getAttribute('data-bullet-img')) {
          const im = document.createElement('img'); im.src = list.getAttribute('data-bullet-img'); im.alt = '';
          im.style.height = (list.getAttribute('data-bullet-size') || 0.9) + 'em'; s.appendChild(im);
        } else s.textContent = list.getAttribute('data-bullet') || (depth % 3 === 0 ? (listDefaults.bullet || '•') : DEFAULT_BULLETS[depth % 3]);
        first.prepend(s);
      }
      addMarkers(li, depth + 1);
    });
  }
}
/** Tabs of a drawn (not edited) text: their widths once the box is on the page. */
export function layoutStaticTabs(root) {
  for (const pm of root.querySelectorAll('.txt .ProseMirror')) if (pm.querySelector('ul, ol') && pm.isConnected && pm.offsetWidth) fitListGapsDOM(pm, pm.getBoundingClientRect().width / pm.offsetWidth || 1);
  for (const pm of root.querySelectorAll('.txt .ProseMirror')) {
    if (!pm.querySelector('span.tab') || !pm.isConnected || !pm.offsetWidth) continue;
    layoutTabs(pm, pm.getBoundingClientRect().width / pm.offsetWidth || 1);
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
  host.innerHTML = ''; host.appendChild(pm);         // first in place, so each formula can see the text around it
  if (pm.querySelector('ul, ol')) requestAnimationFrame(() => { if (pm.isConnected && pm.offsetWidth) fitListGapsDOM(pm, pm.getBoundingClientRect().width / pm.offsetWidth || 1); });
  if (pm.querySelector('span.tab')) requestAnimationFrame(() => { if (pm.isConnected && pm.offsetWidth) layoutTabs(pm, pm.getBoundingClientRect().width / pm.offsetWidth || 1); });
  for (const sp of pm.querySelectorAll('span.math')) {
    sp.contentEditable = 'false';
    sp.classList.remove('disp');
    const lk = mathStyleOf(sp, host);                 // the text's font and boldness (box or own formatting)
    renderInto(sp, sp.getAttribute('data-tex') || '', false, onRendered, lk.bold, sp.getAttribute('data-wrap') === '1', lk.font);
  }
  return pm;
}
export { pieceEls } from './parts.js';
export function mathPending(root) { return !!root.querySelector('.math .mpending:not(.merr)'); }

/** Live editor inside a text box. */
export function mountEditor(host, json, {onUpdate, onSelection, onFocus, onBlur} = {}, kind = 'text') {
  host.innerHTML = '';
  const editor = new Editor({
    element: host,
    extensions: extensions(kind),
    content: json || emptyDoc(),
    editorProps: {
      attributes: {spellcheck: 'true', lang: 'hu'},
      // pasted text and formulas take the size and font of the text box
      transformPastedHTML: cleanPastedHTML,
      handleDOMEvents: {
        dragstart: (view, e) => { if (e.target?.closest?.('td,th')) { e.preventDefault(); return true; } return false; }
      }
    },
    onUpdate: ({transaction}) => onUpdate?.(transaction),
    onSelectionUpdate: () => onSelection?.(),
    onTransaction: () => onSelection?.(),
    onFocus: () => onFocus?.(),
    onBlur: () => onBlur?.()
  });
  requestAnimationFrame(() => { try { if (editor.view.dom.querySelector('span.tab')) layoutTabs(editor.view.dom, hooks.getScale?.() || 1); } catch (e) { /* not mounted */ } });
  return editor;
}
