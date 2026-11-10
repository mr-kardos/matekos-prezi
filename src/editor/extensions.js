import { Extension, Node, Mark, mergeAttributes } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BulletList, OrderedList } from '@tiptap/extension-list';
import { Table, TableRow, TableCell, TableHeader, TableView } from '@tiptap/extension-table';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { renderInto, isReady, mathReady, mathFontFromCSS } from '../math.js';
import { layoutTabs } from '../tabs.js';

const numOrNull = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;

/* ------------------------------------------------------------------ */
/* Paragraph formatting: spacing, indents, line height, line shading   */
/* ------------------------------------------------------------------ */
export const ParaFormat = Extension.create({
  name: 'paraFormat',
  addGlobalAttributes() {
    const css = (key, name, prop, unit) => ({
      default: null,
      parseHTML: el => numOrNull(el.getAttribute('data-' + name)),
      renderHTML: a => a[key] == null ? {} : { style: `${prop}:${a[key]}${unit}`, ['data-' + name]: a[key] }
    });
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: el => { const v = el.style.lineHeight; return v && /^[\d.]+$/.test(v) ? +v : numOrNull(el.getAttribute('data-lh')); },
          renderHTML: a => a.lineHeight ? { style: `line-height:${a.lineHeight}`, 'data-lh': a.lineHeight } : {}
        },
        spaceBefore: css('spaceBefore', 'sb', '--sb', 'pt'),
        spaceAfter: css('spaceAfter', 'sa', '--sa', 'pt'),
        indentLeft: css('indentLeft', 'il', 'margin-left', 'cm'),
        indentRight: css('indentRight', 'ir', 'margin-right', 'cm'),
        firstLine: css('firstLine', 'fl', 'text-indent', 'cm'),
        shade: {
          default: null,
          parseHTML: el => el.getAttribute('data-shade') || null,
          renderHTML: a => a.shade ? { class: 'shaded', style: `--shade:${a.shade}`, 'data-shade': a.shade } : {}
        },
        keepNext: {
          default: false,
          parseHTML: el => el.getAttribute('data-kn') === '1',
          renderHTML: a => a.keepNext ? { 'data-kn': '1' } : {}
        },
        // tab stops: JSON [{pos: cm, align: left|center|right, leader?}]
        tabStops: {
          default: null,
          parseHTML: el => el.getAttribute('data-tabs') || null,
          renderHTML: a => a.tabStops ? { 'data-tabs': typeof a.tabStops === 'string' ? a.tabStops : JSON.stringify(a.tabStops) } : {}
        }
      }
    }];
  },
  addCommands() {
    return {
      setParaAttrs: attrs => ({ tr, state, dispatch }) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
        });
        if (dispatch) dispatch(tr);
        return true;
      },
      shiftIndent: delta => ({ tr, state, dispatch }) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            const v = Math.max(0, Math.round(((node.attrs.indentLeft || 0) + delta) * 100) / 100);
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indentLeft: v || null });
          }
        });
        if (dispatch) dispatch(tr);
        return true;
      }
    };
  }
});

/* ------------------------------------------------------------------ */
/* Lists with custom symbol / picture bullets and numbering styles     */
/* ------------------------------------------------------------------ */
function legacyBullet(el) {
  const v = el.style && el.style.getPropertyValue('--bullet');
  if (!v) return '';
  try { return JSON.parse(v.trim().replace(/^'|'$/g, '"')); } catch (e) { return v.replace(/["']/g, ''); }
}
export const KvBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      bulletChar: { default: '', parseHTML: el => el.getAttribute('data-bullet') || legacyBullet(el) || '', renderHTML: a => a.bulletChar ? { 'data-bullet': a.bulletChar } : {} },
      bulletImage: { default: '', parseHTML: el => el.getAttribute('data-bullet-img') || '', renderHTML: a => a.bulletImage ? { 'data-bullet-img': a.bulletImage } : {} },
      // hanging indent of the whole list (all levels): the text starts this far from its symbol, and an inner
      // list's symbol stands where the outer text starts – so the gaps are equal on every level
      gap: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-gap')), renderHTML: a => a.gap ? { 'data-gap': a.gap, style: `--gap:${a.gap}cm` } : {} },
      bulletSize: { default: 0.9, parseHTML: el => numOrNull(el.getAttribute('data-bullet-size')) ?? 0.9, renderHTML: a => a.bulletImage ? { 'data-bullet-size': a.bulletSize } : {} }
    };
  }
});
export const KvOrderedList = OrderedList.extend({
  addInputRules() { return []; },
  addAttributes() {
    return {
      ...this.parent?.(),
      // hanging indent of the whole list (all levels): the text starts this far from its symbol, and an inner
      // list's symbol stands where the outer text starts – so the gaps are equal on every level
      gap: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-gap')), renderHTML: a => a.gap ? { 'data-gap': a.gap, style: `--gap:${a.gap}cm` } : {} },
      numStyle: { default: null, parseHTML: el => el.getAttribute('data-num') || null, renderHTML: a => a.numStyle ? { 'data-num': a.numStyle } : {} },
      cont: { default: false, parseHTML: el => el.getAttribute('data-cont') === '1', renderHTML: a => a.cont ? { 'data-cont': '1' } : {} }
    };
  }
});

export function ordinal(n, style) {
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
/** Default list symbol and numbering of the document template (Normál stílus). */
export const listDefaults = { bullet: '•', num: 'decimal', img: null };   // img: the template's picture symbol (Matekos végtelen)
const bulletAt = depth => depth % 3 === 0 ? (listDefaults.img ? '•' : (listDefaults.bullet || '•')) : DEFAULT_BULLETS[depth % 3];
/** Real (measurable, printable) list markers, rendered as widgets at the start of each item's first line. */
export const ListMarkers = Extension.create({
  name: 'listMarkers',
  addProseMirrorPlugins() {
    const build = doc => {
      const decos = [];
      /** carry: markers of outer items whose first line is the first line of a nested list (same-line nesting) */
      const walk = (node, pos, depth, carry) => {
        const ends = {};                              // last number of the lists on this level, per numbering style
        node.forEach((child, off) => {
          const cpos = pos + off + 1;
          if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
            const ordered = child.type.name === 'orderedList';
            const sty = child.attrs.numStyle || listDefaults.num;
            const start = ordered ? (child.attrs.cont ? (ends[sty] ?? 0) + 1 : (child.attrs.start ?? 1)) : 1;
            if (ordered) { let n = 0; child.forEach(it => { if (!it.attrs.ghost) n++; }); ends[sty] = start + n - 1; }
            let real = -1;                           // holder items are not counted
            child.forEach((item, ioff) => {
              if (!item.attrs.ghost) real++;
              const idx = Math.max(0, real);
              const ipos = cpos + 1 + ioff;          // position of listItem
              const first = item.firstChild;
              const mk = {
                key: ordered ? 'o' + ordinal(start + idx, child.attrs.numStyle || listDefaults.num)
                  : child.attrs.bulletImage ? 'i' + child.attrs.bulletSize + child.attrs.bulletImage.length + child.attrs.bulletImage.slice(-24)
                    : 'b' + (child.attrs.bulletChar || bulletAt(depth)) + (!child.attrs.bulletChar && depth % 3 === 0 && listDefaults.img ? 'img' : ''),
                text: ordered ? ordinal(start + idx, child.attrs.numStyle || listDefaults.num) : (child.attrs.bulletImage || (!child.attrs.bulletChar && depth % 3 === 0 && listDefaults.img)) ? null : (child.attrs.bulletChar || bulletAt(depth)),
                img: !ordered && child.attrs.bulletImage ? child.attrs.bulletImage : (!ordered && !child.attrs.bulletChar && depth % 3 === 0 && listDefaults.img) || null,
                size: child.attrs.bulletImage ? (child.attrs.bulletSize || 0.9) : 0.7
              };
              const here = idx === 0 && carry ? carry : [];
              // all the text of the item's first line bold -> the symbol bold too
              let allBold = false;
              if (first && first.isTextblock && first.textContent.trim()) { allBold = true; first.descendants(c => { if (c.isText && c.text.trim() && !c.marks.some(m => m.type.name === 'bold')) allBold = false; }); }
              mk.bold = allBold;
              // an item that starts with an empty line and a list: the nested list's first item shares the line
              const sameLine = !!item.attrs.sameLine && first && first.isTextblock && !first.content.size && item.childCount > 1 && /List$/.test(item.child(1).type.name);
              if (sameLine) {
                decos.push(Decoration.node(ipos + 1, ipos + 1 + first.nodeSize, { class: 'lm-collapsed' }));
                walk(item, ipos, depth + 1, [...here.map(m => ({ ...m, up: m.up + 1 })), { ...mk, up: 1 }]);
                return;
              }
              if (item.attrs.ghost) { walk(item, ipos, depth + 1, null); return; }
              if (first && first.isTextblock) {
                for (const m of [{ ...mk, up: 0 }, ...here]) {
                  decos.push(Decoration.widget(ipos + 2, () => {
                    const s = document.createElement('span');
                    s.className = 'lm' + (m.up ? ' lm-up' : '') + (m.bold ? ' lm-b' : '');
                    if (m.up) s.style.setProperty('--up', m.up);
                    s.contentEditable = 'false';
                    if (m.img) { const im = document.createElement('img'); im.src = m.img; im.alt = ''; im.style.height = m.size + 'em'; s.appendChild(im); }
                    else s.textContent = m.text;
                    return s;
                  }, { side: -1, key: m.key + '|' + m.up + (m.bold ? 'b' : ''), ignoreSelection: true }));
                }
              }
              walk(item, ipos, depth + 1, null);
            });
          } else if (!child.isTextblock && child.childCount) walk(child, cpos, depth, null);
        });
      };
      walk(doc, -1, 0, null);
      return DecorationSet.create(doc, decos);
    };
    return [new Plugin({
      key: new PluginKey('listMarkers'),
      state: {
        init: (_, state) => build(state.doc),
        apply: (tr, old, _o, state) => tr.docChanged || tr.getMeta('listDefaults') ? build(state.doc) : old
      },
      props: { decorations(state) { return this.getState(state); } }
    })];
  }
});

/* ------------------------------------------------------------------ */
const cellAttrs = {
  background: {
    default: null,
    parseHTML: el => el.getAttribute('data-bg') || el.style.backgroundColor || null,
    renderHTML: a => a.background ? { 'data-bg': a.background, style: `background-color:${a.background}` } : {}
  },
  vAlign: {
    default: 'top',
    parseHTML: el => el.getAttribute('data-valign') || el.style.verticalAlign || 'top',
    renderHTML: a => a.vAlign && a.vAlign !== 'top' ? { 'data-valign': a.vAlign, style: `vertical-align:${a.vAlign}` } : {}
  }
};
cellAttrs.borderWidth = {
  default: null,
  parseHTML: el => numOrNull(el.getAttribute('data-bw')),
  renderHTML: a => a.borderWidth == null ? {} : { 'data-bw': a.borderWidth, style: a.borderWidth > 0 ? `border-width:${a.borderWidth}pt;border-style:solid` : 'border-style:hidden' }
};
cellAttrs.borderColor = {
  default: null,
  parseHTML: el => el.getAttribute('data-bc') || null,
  renderHTML: a => a.borderColor ? { 'data-bc': a.borderColor, style: `border-color:${a.borderColor}` } : {}
};
export const KvTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });
export const KvTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });

/* ------------------------------------------------------------------ */
/* Page break                                                          */
/* ------------------------------------------------------------------ */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() { return [{ tag: 'div[data-pagebreak]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'pagebreak', 'data-pagebreak': '1' })]; },
  addCommands() {
    return { setPageBreak: () => ({ chain }) => chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run() };
  },
  addKeyboardShortcuts() { return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }; }
});

/* ------------------------------------------------------------------ */
/* Tables: width, row height                                           */
/* ------------------------------------------------------------------ */
class KvTableView extends TableView {
  constructor(node, cellMinWidth, view, attrs) { super(node, cellMinWidth, view, attrs); this.kv(node); }
  update(node) { const ok = super.update(node); if (ok) this.kv(node); return ok; }
  kv(node) {
    const w = node.attrs.width;
    if (w && (!this.table.style.width || this.table.style.width.endsWith('%'))) this.table.style.width = w + '%';
    else if (!w && this.table.style.width.endsWith('%')) this.table.style.width = '';
    const al = node.attrs.align || 'left';
    this.table.style.marginLeft = al === 'left' ? '0' : 'auto';
    this.table.style.marginRight = al === 'right' ? '0' : 'auto';
  }
}
export const KvTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-width')), renderHTML: a => a.width ? { 'data-width': a.width, style: `width:${a.width}%` } : {} },
      align: {
        default: 'left',
        parseHTML: el => el.getAttribute('data-align') || 'left',
        renderHTML: a => a.align && a.align !== 'left' ? { 'data-align': a.align, style: a.align === 'center' ? 'margin-left:auto;margin-right:auto' : 'margin-left:auto;margin-right:0' } : {}
      }
    };
  }
}).configure({ View: KvTableView, resizable: false, cellMinWidth: 24 });
export const KvTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: { default: null, parseHTML: el => numOrNull(el.getAttribute('data-h')), renderHTML: a => a.height ? { 'data-h': a.height, style: `height:${a.height}mm` } : {} }
    };
  }
});

/** Find the table around the selection: { table, pos, map, rect (selected cell rectangle) } */
export function tableContext(state) {
  const sel = state.selection;
  const $p = sel instanceof CellSelection ? sel.$anchorCell : sel.$from;
  for (let d = $p.depth; d > 0; d--) {
    const n = $p.node(d);
    if (n.type.spec.tableRole === 'table') {
      const pos = $p.before(d), map = TableMap.get(n), start = pos + 1;
      let rect;
      if (sel instanceof CellSelection) rect = map.rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start);
      else {
        let cellPos = null;
        for (let e = $p.depth; e > d; e--) if ($p.node(e).type.spec.tableRole && $p.node(e).type.spec.tableRole.includes('cell')) { cellPos = $p.before(e); break; }
        rect = cellPos == null ? { left: 0, top: 0, right: 1, bottom: 1 } : map.findCell(cellPos - start);
      }
      return { table: n, pos, start, map, rect };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Line shading: colours whole lines (any lines, not only paragraphs)  */
/* The mark only records which text is shaded; full-width bands are    */
/* drawn behind those lines by the layout code (src/shading.js).        */
/* ------------------------------------------------------------------ */
export const LineShade = Mark.create({
  name: 'lineShade',
  inclusive: true,
  addAttributes() { return { color: { default: '#dbe9ee', parseHTML: el => el.getAttribute('data-lshade') } }; },
  parseHTML() { return [{ tag: 'span[data-lshade]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', { 'data-lshade': HTMLAttributes.color }, 0]; }
});

/* ------------------------------------------------------------------ */
/* Formulas                                                            */
/* ------------------------------------------------------------------ */
const mathKey = new PluginKey('mathTools');
const isBold = n => n.marks.some(m => m.type.name === 'bold');   // bold formulas: \boldsymbol
/** Font and boldness of a formula: its own marks first, then the text box it is in (Prezi box formatting). */
function mathLook(n, editor) {
  let host = null; try { host = editor?.options?.element || null; } catch (e) { /* not mounted yet */ }
  const ts = n.marks.find(m => m.type.name === 'textStyle'), box = host?.closest?.('.txt') || null;
  const font = mathFontFromCSS(ts?.attrs?.fontFamily || box?.style?.fontFamily || '');
  const bw = box?.style?.fontWeight;
  return {font, bold: isBold(n) || bw === 'bold' || +bw >= 600};
}
const DOLLAR_RE = /(\\?)\$\$([^$]+?)\$\$|(\\?)\$([^$\s](?:[^$]*?[^$\s\\])?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\]/g;

function cellPosAround(doc, pos) {
  const $p = doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) { const r = $p.node(d).type.spec.tableRole; if (r === 'cell' || r === 'header_cell') return $p.before(d); }
  return null;
}

export const MathNode = Node.create({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addOptions() { return { onEdit: null, onRendered: null, onPreview: null }; },
  addAttributes() {
    return {
      tex: { default: '', parseHTML: el => el.getAttribute('data-tex') || '' },
      display: { default: false, parseHTML: el => el.getAttribute('data-display') === '1' || el.classList.contains('disp') },
      wrap: { default: false, parseHTML: el => el.getAttribute('data-wrap') === '1' }
    };
  },
  parseHTML() { return [{ tag: 'span[data-tex]' }]; },
  renderHTML({ node }) {
    return ['span', { class: 'math' + (node.attrs.display ? ' disp' : '') + (node.attrs.wrap ? ' wrap' : ''), 'data-tex': node.attrs.tex, 'data-display': node.attrs.display ? '1' : '0', ...(node.attrs.wrap ? { 'data-wrap': '1' } : {}) }];
  },
  renderText({ node }) { return node.attrs.display ? `$$${node.attrs.tex}$$` : `$${node.attrs.tex}$`; },
  addNodeView() {
    const ext = this;
    return ({ node, getPos, editor }) => {
      let cur = node;
      const dom = document.createElement('span');
      dom.contentEditable = 'false';
      const paint = () => {
        dom.className = 'math' + (cur.attrs.display ? ' disp' : '') + (cur.attrs.wrap ? ' wrap' : '') + (dom._sel ? ' ProseMirror-selectednode' : '');
        dom.setAttribute('data-tex', cur.attrs.tex);
        const lk = mathLook(cur, editor); dom._lk = lk.font + '|' + lk.bold;
        renderInto(dom, cur.attrs.tex, cur.attrs.display, () => ext.options.onRendered && ext.options.onRendered(), lk.bold, cur.attrs.wrap, lk.font);
      };
      paint();
      // Mouse: click = select the formula; click on its left/right edge = cursor before/after it;
      // press and drag = select text (or table cells) starting at the formula; double click = edit.
      dom.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (e.detail === 3) {                      // triple click inside a table: select the whole cell
          const pos = getPos(), view = editor.view;
          const cell = typeof pos === 'number' ? cellPosAround(view.state.doc, pos) : null;
          if (cell != null) { e.preventDefault(); view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cell))); }
          return;
        }
        if (e.detail > 1) return;
        e.preventDefault();
        const view = editor.view, pos = getPos();
        if (typeof pos !== 'number') return;
        const r = dom.getBoundingClientRect();
        const edge = Math.max(3, Math.min(r.width * 0.22, 9));
        const zone = e.clientX < r.left + edge ? 'before' : e.clientX > r.right - edge ? 'after' : 'node';
        const anchor = e.clientX < r.left + r.width / 2 ? pos : pos + cur.nodeSize;
        // set the selection first, then focus without scrolling (focusing first would jump to the old cursor)
        const doc0 = view.state.doc;
        const first = e.shiftKey ? TextSelection.create(doc0, view.state.selection.anchor, zone === 'before' ? pos : pos + cur.nodeSize)
          : zone === 'node' ? NodeSelection.create(doc0, pos) : TextSelection.create(doc0, zone === 'before' ? pos : pos + cur.nodeSize);
        view.dispatch(view.state.tr.setSelection(first));
        if (!view.hasFocus()) view.dom.focus({ preventScroll: true });
        if (e.shiftKey) return;
        const anchorCell = cellPosAround(view.state.doc, pos);
        const sx = e.clientX, sy = e.clientY;
        let moved = false;
        const mv = ev => {
          if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
          moved = true;
          const hit = view.posAtCoords({ left: ev.clientX, top: ev.clientY });
          if (!hit) return;
          const doc = view.state.doc;
          const headCell = cellPosAround(doc, hit.pos);
          try {
            if (anchorCell != null && headCell != null && headCell !== anchorCell) view.dispatch(view.state.tr.setSelection(CellSelection.create(doc, anchorCell, headCell)));
            else view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, anchor, hit.pos)));
          } catch (err) { /* position not selectable */ }
        };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
      });
      dom.addEventListener('dblclick', e => {
        e.preventDefault(); e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos != null && ext.options.onEdit) ext.options.onEdit(pos, cur);
      });
      return {
        dom,
        update(n) {
          if (n.type !== cur.type) return false;
          const lk = mathLook(n, editor);
          const changed = n.attrs.tex !== cur.attrs.tex || n.attrs.display !== cur.attrs.display || n.attrs.wrap !== cur.attrs.wrap || dom._lk !== lk.font + '|' + lk.bold;
          cur = n;
          if (changed) paint();
          return true;
        },
        selectNode() { dom._sel = true; dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom._sel = false; dom.classList.remove('ProseMirror-selectednode'); },
        ignoreMutation: () => true,
        stopEvent: e => e.type === 'mousedown' || e.type === 'mouseup' || e.type === 'click' || e.type === 'dblclick' || e.type === 'dragstart'
      };
    };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-m': () => { this.options.onEdit && this.options.onEdit(null, null); return true; },
      'Mod-M': () => { this.options.onEdit && this.options.onEdit(null, null); return true; }
    };
  },
  addProseMirrorPlugins() {
    const ext = this;
    const type = this.type;
    const nearMath = state => {
      const sel = state.selection;
      if (!sel.empty || !(sel instanceof TextSelection)) return false;
      const $p = sel.$from;
      return ($p.nodeBefore && $p.nodeBefore.type === type) || ($p.nodeAfter && $p.nodeAfter.type === type);
    };
    return [new Plugin({
      key: mathKey,
      // Pasted text: $…$, $$…$$, \(…\) and \[…\] become formulas immediately
      appendTransaction(trs, oldState, state) {
        const paste = trs.find(tr => tr.getMeta('uiEvent') === 'paste' || tr.getMeta('paste'));
        if (!paste) return null;
        let from = Infinity, to = -Infinity;
        trs.forEach((tr, ti) => tr.steps.forEach((step, si) => {
          step.getMap().forEach((a, b, s0, e0) => {
            let s = s0, en = e0;
            for (let k = si + 1; k < tr.steps.length; k++) { s = tr.steps[k].getMap().map(s, -1); en = tr.steps[k].getMap().map(en, 1); }
            for (let t = ti + 1; t < trs.length; t++) { s = trs[t].mapping.map(s, -1); en = trs[t].mapping.map(en, 1); }
            from = Math.min(from, s); to = Math.max(to, en);
          });
        }));
        if (!(to > from)) return null;
        const hits = [];
        state.doc.nodesBetween(Math.max(0, from), Math.min(state.doc.content.size, to), (n, pos) => {
          if (!n.isText) return;
          DOLLAR_RE.lastIndex = 0; let m;
          while ((m = DOLLAR_RE.exec(n.text))) {
            if (m[1] === '\\' || m[3] === '\\') continue;                 // \$ stays a dollar sign
            const display = m[2] !== undefined || m[6] !== undefined;
            const tex = (m[2] ?? m[4] ?? m[5] ?? m[6] ?? '').trim();
            if (tex) hits.push({ from: pos + m.index, to: pos + m.index + m[0].length, tex, display, marks: n.marks });
          }
        });
        if (!hits.length) return null;
        const tr = state.tr;
        for (const h of hits.reverse()) tr.replaceWith(h.from, h.to, type.create({ tex: h.tex, display: h.display, wrap: true }, null, h.marks));
        return tr;
      },
      props: {
        // $…$ and $$…$$ become formulas the moment the closing $ is typed
        handleTextInput(view, from, to, text) {
          if (text !== '$') return false;
          const $from = view.state.doc.resolve(from);
          if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc') + '$';
          let m = before.match(/(?:^|[^\\])\$\$([^$\ufffc]+?)\$\$$/), display = true, start;
          if (m && m[1].trim()) start = from - (m[1].length + 3);
          else {
            m = before.match(/(?:^|[^\\$])\$([^$\s\ufffc](?:[^$\ufffc]*?[^$\s\\\ufffc])?)\$$/);
            if (!m) return false;
            display = false; start = from - (m[1].length + 1);
          }
          const tex = display ? m[1].trim() : m[1];
          const tr = view.state.tr.replaceWith(start, to, type.create({ tex, display, wrap: true }));
          tr.setSelection(TextSelection.create(tr.doc, start + 1));
          view.dispatch(tr.scrollIntoView());
          return true;
        },
        decorations(state) {
          const sel = state.selection, decos = [];
          // formulas inside a text selection are highlighted exactly like the text around them
          if (!sel.empty && !(sel instanceof NodeSelection)) {
            state.doc.nodesBetween(sel.from, sel.to, (n, pos) => {
              if (n.type === type && pos >= sel.from && pos + n.nodeSize <= sel.to) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'in-sel' }));
            });
          }
          // (the visible cursor next to a formula is drawn as an overlay by the app, so nothing in the text changes)
          return decos.length ? DecorationSet.create(state.doc, decos) : null;
        },
        attributes(state) { return nearMath(state) ? { class: 'math-caret' } : {}; }
      },
      view() {
        return {
          update(view) {
            if (!ext.options.onPreview) return;
            const sel = view.state.selection;
            if (!sel.empty || !view.hasFocus()) return ext.options.onPreview(null);
            const $p = sel.$from;
            if (!$p.parent.isTextblock) return ext.options.onPreview(null);
            const before = $p.parent.textBetween(0, $p.parentOffset, undefined, '\ufffc');
            const m = before.match(/(?:^|[^\\$])\$\$?([^$\s\ufffc][^$\ufffc]*)$/);
            if (!m) return ext.options.onPreview(null);
            ext.options.onPreview({ tex: m[1], coords: view.coordsAtPos(sel.from) });
          },
          destroy() { ext.options.onPreview && ext.options.onPreview(null); }
        };
      }
    })];
  }
});
export { isReady as mathIsReady, mathReady };

/* ------------------------------------------------------------------ */
/* Images: text wrap, free placement by drag, corner resize            */
/* ------------------------------------------------------------------ */
const WRAPS = ['wl', 'wr', 'ctr', 'inl'];
const imgStyle = a => {
  const st = [];
  if (a.width) st.push(`width:${a.width}px`);
  if (a.wrap === 'wl') st.push(`margin-left:${a.dx || 0}px`, `margin-top:calc(.2em + ${a.dy || 0}px)`);
  if (a.wrap === 'wr') st.push(`margin-right:${a.dx || 0}px`, `margin-top:calc(.2em + ${a.dy || 0}px)`);
  return st.join(';');
};
export const KvImage = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addOptions() { return { getScale: () => 1, onChange: null }; },
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      width: { default: null, parseHTML: el => parseFloat(el.style.width) || numOrNull(el.getAttribute('width')) },
      wrap: { default: 'wl', parseHTML: el => el.getAttribute('data-wrap') || WRAPS.find(w => el.classList.contains(w)) || 'wl' },
      dx: { default: 0, parseHTML: el => numOrNull(el.getAttribute('data-dx')) || 0 },
      dy: { default: 0, parseHTML: el => numOrNull(el.getAttribute('data-dy')) || 0 }
    };
  },
  parseHTML() { return [{ tag: 'img[src]' }]; },
  renderHTML({ node }) {
    const a = node.attrs;
    return ['img', { src: a.src, alt: a.alt || '', 'data-wrap': a.wrap, 'data-dx': a.dx || 0, 'data-dy': a.dy || 0, class: a.wrap, style: imgStyle(a) || null }];
  },
  addNodeView() {
    const ext = this;
    return ({ node, getPos, editor }) => {
      let cur = node, selected = false;
      const dom = document.createElement('span');
      dom.draggable = false;
      const img = document.createElement('img');
      img.draggable = false;
      dom.appendChild(img);
      const paint = () => {
        dom.className = 'imgw ' + (cur.attrs.wrap || 'wl') + (selected ? ' ProseMirror-selectednode' : '');
        if (img.getAttribute('src') !== cur.attrs.src) img.src = cur.attrs.src;
        img.alt = cur.attrs.alt || '';
        dom.style.cssText = imgStyle(cur.attrs);
        ext.options.onChange && ext.options.onChange();
      };
      paint();
      const view = () => editor.view;
      img.addEventListener('load', () => {
        if (!cur.attrs.width && img.naturalWidth) {
          const col = view().dom.clientWidth || 600;
          const w = Math.round(Math.min(img.naturalWidth, col * 0.45));
          const pos = getPos();
          if (typeof pos === 'number') view().dispatch(view().state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, width: w }).setMeta('addToHistory', false));
        }
        view().dom.dispatchEvent(new CustomEvent('kv-relayout', { bubbles: true }));
      });
      const setAttrs = attrs => { const pos = getPos(); if (typeof pos === 'number') view().dispatch(view().state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...attrs })); };
      const reselect = () => { const p = getPos(); if (typeof p === 'number') view().dispatch(view().state.tr.setSelection(NodeSelection.create(view().state.doc, p))); };
      // corner handles: resize (keeps proportions)
      const resize = (e, h, size) => {
        const scale = ext.options.getScale() || 1;
        const sx = e.clientX, startW = dom.getBoundingClientRect().width / scale, sign = h.includes('e') ? 1 : -1;
        const maxW = view().dom.clientWidth;
        let w = startW;
        const mv = ev => {
          w = Math.max(16, Math.min(maxW, startW + sign * (ev.clientX - sx) / scale));
          dom.style.width = Math.round(w) + 'px';
          if (size) size.textContent = Math.round(w / (96 / 25.4)) + ' mm';
          ext.options.onChange && ext.options.onChange();
        };
        const up = () => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          if (size) size.textContent = '';
          setAttrs({ width: Math.round(w) }); reselect();
        };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      };

      // body: click selects (nothing else changes); drag moves the picture freely
      const move = e => {
        const v = view(), scale = ext.options.getScale() || 1;
        const r0 = dom.getBoundingClientRect(), ox = e.clientX - r0.left, oy = e.clientY - r0.top;
        const sx = e.clientX, sy = e.clientY;
        let ghost = null, ind = null;
        const wrapped = cur.attrs.wrap === 'wl' || cur.attrs.wrap === 'wr';
        const mv = ev => {
          if (!ghost) {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
            ghost = img.cloneNode(); ghost.className = 'img-ghost';
            ghost.style.width = r0.width + 'px'; ghost.style.height = r0.height + 'px';
            document.body.appendChild(ghost);
            if (!wrapped) { ind = document.createElement('div'); ind.className = 'drop-ind'; document.body.appendChild(ind); }
            dom.classList.add('moving');
            ext.options.onChange && ext.options.onChange('moving');
          }
          ghost.style.left = (ev.clientX - ox) + 'px'; ghost.style.top = (ev.clientY - oy) + 'px';
          if (ind) {
            const hit = v.posAtCoords({ left: ev.clientX, top: ev.clientY });
            if (hit) { const c = v.coordsAtPos(hit.pos); ind.style.left = c.left + 'px'; ind.style.top = c.top + 'px'; ind.style.height = (c.bottom - c.top) + 'px'; }
          }
          const ws = document.getElementById('ws');
          if (ws) { const wr = ws.getBoundingClientRect(); if (ev.clientY < wr.top + 40) ws.scrollTop -= 14; else if (ev.clientY > wr.bottom - 40) ws.scrollTop += 14; }
        };
        const up = ev => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          dom.classList.remove('moving');
          if (!ghost) return;
          ext.options.onChange && ext.options.onChange();
          const gr = ghost.getBoundingClientRect();
          ghost.remove(); if (ind) ind.remove();
          const pos = getPos(); if (typeof pos !== 'number' || ev.type === 'pointercancel') return;
          const er = v.dom.getBoundingClientRect();
          let target, attrs = { ...cur.attrs };
          if (wrapped) {
            // anchor the picture to the line at its new top edge; keep the exact offset from that line
            const y = Math.min(Math.max(gr.top + 2, er.top + 1), er.bottom - 2);
            const hit = v.posAtCoords({ left: er.left + 2, top: y });
            if (!hit) return;
            target = hit.pos;
            const $t = v.state.doc.resolve(target);
            if (!$t.parent.isTextblock) return;
            if (target > pos && target <= pos + cur.nodeSize) target = pos;      // dropped on its own line start
            const c = v.coordsAtPos(target);
            const lineTop = c.top;
            const colW = er.width / scale, w = gr.width / scale;
            const leftX = (gr.left - er.left) / scale;
            const toLeft = leftX + w / 2 < colW / 2;
            attrs.wrap = toLeft ? 'wl' : 'wr';
            attrs.dx = Math.round(Math.max(0, Math.min(colW - w, toLeft ? leftX : colW - leftX - w)));
            attrs.dy = Math.round(Math.max(0, (gr.top - lineTop) / scale));
          } else {
            const hit = v.posAtCoords({ left: ev.clientX, top: ev.clientY });
            if (!hit) return;
            target = hit.pos;
            if (target >= pos && target <= pos + cur.nodeSize) return;
          }
          const tr = v.state.tr;
          const newNode = cur.type.create(attrs);
          tr.delete(pos, pos + cur.nodeSize);
          const at = tr.mapping.map(target);
          tr.insert(at, newNode);
          tr.setSelection(NodeSelection.create(tr.doc, at));
          v.dispatch(tr);
          if (!v.hasFocus()) v.dom.focus({ preventScroll: true });
        };
        addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      };

      dom.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const p = getPos();
        if (typeof p === 'number' && !selected) view().dispatch(view().state.tr.setSelection(NodeSelection.create(view().state.doc, p)));
        if (!view().hasFocus()) view().dom.focus({ preventScroll: true });
        move(e);
      });
      // used by the selection frame (drawn outside the text so it can never move anything)
      dom._kv = {
        img, move, resize, node: () => cur,
        setWrap: w => { setAttrs({ wrap: w, dx: 0, dy: 0 }); reselect(); },
        remove: () => { const pos = getPos(); if (typeof pos === 'number') view().dispatch(view().state.tr.delete(pos, pos + cur.nodeSize)); }
      };
      return {
        dom,
        update(n) { if (n.type !== cur.type) return false; cur = n; paint(); return true; },
        selectNode() { selected = true; dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { selected = false; dom.classList.remove('ProseMirror-selectednode'); },
        stopEvent: e => e.type.startsWith('pointer') || e.type.startsWith('mouse') || e.type.startsWith('drag'),
        ignoreMutation: () => true
      };
    };
  },
  addCommands() {
    return { insertImage: attrs => ({ commands }) => commands.insertContent({ type: this.name, attrs }) };
  }
});

/* ---------- from Matekos Doksi: tabs, list levels, comments, list joining ---------- */
export const TabNode = Node.create({
  name: 'tab',
  priority: 1000,                 // its Tab / Backspace rules come before the general list keys
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  parseHTML() { return [{ tag: 'span.tab' }]; },
  renderHTML() { return ['span', { class: 'tab' }]; },
  renderText() { return '\t'; },
  // the width is set by the tab layout; the editor must not treat that as a change of the text
  addNodeView() { return () => { const dom = document.createElement('span'); dom.className = 'tab'; dom.contentEditable = 'false'; return { dom, ignoreMutation: () => true }; }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({ view: () => ({ update: (view, prev) => {
      if (view.state.doc === prev.doc || !view.dom.querySelector('span.tab')) return;
      layoutTabs(view.dom, opts.getScale ? opts.getScale() : 1);
    } }) })];
  },
  addOptions() { return { getScale: () => 1 }; },
  addKeyboardShortcuts() {
    return {
      // in a list item, right after the symbol: the item moves one level in; anywhere else: a tab
      Tab: () => {
        const ed = this.editor;
        if (ed.isActive('table')) { ed.commands.goToNextCell(1); return true; }       // no new rows from Tab
        const { $from, empty } = ed.state.selection;
        // in a list: right after the symbol, on a selected formula or with several items selected -> one level in
        if (ed.isActive('listItem') && (!empty || $from.parentOffset === 0)) { changeListLevel(ed.view, 1); return true; }
        return ed.commands.insertContent({ type: 'tab' });
      },
      'Shift-Tab': () => { const ed = this.editor; if (ed.isActive('table')) { ed.commands.goToNextCell(-1); return true; } if (!ed.isActive('listItem')) return false; changeListLevel(ed.view, -1); return true; },
      Enter: () => {
        const ed = this.editor, { $from, empty } = ed.state.selection;
        if (!empty || !ed.isActive('listItem') || $from.parent.content.size) return false;
        const li = $from.node($from.depth - 1);
        if (!li || li.type.name !== 'listItem' || li.childCount !== 1 || $from.depth < 4) return false;   // top level: the usual (leaves the list)
        return changeListLevel(ed.view, -1);
      },
      Backspace: () => {
        if (deleteEmptyListItem(this.editor.view)) return true;
        if (unlistFirstItem(this.editor.view)) return true;
        const st = this.editor.state, sel = st.selection;
        if (!sel.empty) return false;
        const $f = sel.$from, d = $f.depth - 1;
        if ($f.parentOffset !== 0 || d < 3) return false;
        if ($f.node(d).type.name !== 'listItem' || $f.index(d) !== 0) return false;
        const L2 = $f.node(d - 1); if (!/List$/.test(L2.type.name) || $f.index(d - 1) !== 0) return false;
        const LI1 = $f.node(d - 2); if (LI1.type.name !== 'listItem' || $f.index(d - 2) !== 1 || !LI1.attrs.sameLine) return false;
        const first = LI1.firstChild; if (!first || !first.isTextblock || first.content.size) return false;
        const inner = L2.firstChild, kids = [];
        inner.forEach(c => kids.push(c));
        if (L2.childCount > 1) { const rest = []; L2.forEach((c, o, i) => { if (i) rest.push(c); }); kids.push(L2.copy(Fragment.from(rest))); }
        LI1.forEach((c, o, i) => { if (i > 1) kids.push(c); });
        const liPos = $f.before(d - 2);
        const tr = st.tr.replaceWith(liPos, liPos + LI1.nodeSize, LI1.type.create({ ...LI1.attrs, sameLine: false }, kids));
        tr.setSelection(TextSelection.create(tr.doc, liPos + 2));
        this.editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
      'Mod-l': () => this.editor.chain().focus().toggleSubscript().run(),
      'Mod-h': () => this.editor.chain().focus().toggleSuperscript().run()
    };
  }
});

export const ListItemAttrs = Extension.create({
  name: 'listItemAttrs',
  addGlobalAttributes() {
    return [{ types: ['listItem'], attributes: {
      sameLine: { default: false, keepOnSplit: false, parseHTML: el => el.getAttribute('data-same') === '1', renderHTML: a => a.sameLine ? { 'data-same': '1' } : {} },
      // an invisible holder item: lets the first item of a list stand one level deeper
      ghost: { default: false, keepOnSplit: false, parseHTML: el => el.hasAttribute('data-ghost'), renderHTML: a => a.ghost ? { 'data-ghost': '1' } : {} }
    } }];
  }
});
const isList = n => n && (n.type.name === 'bulletList' || n.type.name === 'orderedList');
function flatten(list, level, out, pos) {
  list.forEach((li, off) => {
    const liPos = pos + 1 + off, content = [], subs = [];
    let cOff = 0, contentStart = liPos + 1;
    li.forEach((c, o) => { if (isList(c)) subs.push([c, liPos + 1 + o]); else content.push(c); });
    if (!li.attrs.ghost) out.push({ level, type: list.type, attrs: list.attrs, itemAttrs: li.attrs, content, from: liPos, start: contentStart,
      end: subs.length ? subs[0][1] : liPos + li.nodeSize - 1 });
    void cOff;
    for (const [sub, sp] of subs) flatten(sub, level + 1, out, sp);
  });
}
const sameAttrs = (a, b) => ['bulletChar', 'bulletImage', 'bulletSize', 'numStyle', 'gap'].every(k => (a[k] ?? null) === (b[k] ?? null));
function rebuild(items, schema) {
  let i = 0;
  const build = level => {
    const lists = []; let cur = null;
    while (i < items.length && items[i].level >= level) {
      const it = items[i];
      if (it.level === level) {
        if (!cur || cur.type !== it.type || !sameAttrs(cur.attrs, it.attrs)) {
          const attrs = { ...it.attrs };
          if (cur && it.type.name === 'orderedList' && lists.some(l => l.type === it.type && sameAttrs(l.attrs, it.attrs))) { attrs.cont = true; }
          cur = { type: it.type, attrs, items: [] }; lists.push(cur);
        }
        cur.items.push({ attrs: it.itemAttrs, content: [...it.content], src: it });
        i++;
      } else {
        if (!cur) { cur = { type: it.type, attrs: { ...it.attrs }, items: [{ attrs: { ghost: true }, content: [schema.nodes.paragraph.create()] }] }; lists.push(cur); }
        const subs = build(level + 1);
        cur.items[cur.items.length - 1].content.push(...subs);
      }
    }
    return lists.map(l => l.type.create(l.attrs, l.items.map(x => { const n = schema.nodes.listItem.create(x.attrs, x.content.length ? x.content : [schema.nodes.paragraph.create()]); n._src = x.src; return n; })));
  };
  return build(0);
}
/** Change the level of the selected list items by delta (+1 / -1). Returns false when not in a list. */
export function changeListLevel(view, delta) {
  const st = view.state, { $from, $to, from, to } = st.selection;
  let d = 1; while (d <= $from.depth && !isList($from.node(d))) d++;
  if (d > $from.depth) return false;
  const outer = $from.node(d), outerPos = $from.before(d);
  if (to > outerPos + outer.nodeSize) return false;
  const items = []; flatten(outer, 0, items, outerPos);
  // the selected items: their own content (not their nested items) touches the selection
  const sel = items.filter(it => it.end >= from && it.start <= to);
  if (!sel.length) return false;
  for (const it of items) it.newLevel = it.level;
  for (const it of sel) {
    it.newLevel = Math.max(0, it.level + delta);
    // keep the symbol it shows now (a default bullet would otherwise change with the level)
    if (it.newLevel !== it.level && it.type.name === 'bulletList' && !it.attrs.bulletChar && !it.attrs.bulletImage) it.attrs = { ...it.attrs, bulletChar: bulletAt(it.level) };
  }
  // a list cannot skip a level: an item is at most one level deeper than the one before it
  // the items after a moved one keep their level; holder items fill any gap above a deeper first item
  if (items.every(it => it.newLevel === it.level)) return true;
  // an item moving to another level takes the format (numbering / symbol) of the items already on that level
  const moved = new Set(sel.filter(it => it.newLevel !== it.level));
  for (const it of moved) {
    const i = items.indexOf(it);
    let nb = null;
    for (let k = i - 1; k >= 0; k--) { const o = items[k]; if (o.newLevel < it.newLevel) break; if (o.newLevel === it.newLevel && !moved.has(o)) { nb = o; break; } }
    if (!nb) for (let k = i + 1; k < items.length; k++) { const o = items[k]; if (o.newLevel < it.newLevel) break; if (o.newLevel === it.newLevel && !moved.has(o)) { nb = o; break; } }
    if (nb) { it.type = nb.type; it.attrs = { ...nb.attrs }; }
  }
  for (const it of items) it.level = it.newLevel;
  const nodes = rebuild(items, st.schema);
  // selection: same offset inside the same item
  const offA = (() => { const it = items.find(x => x.start <= st.selection.anchor && st.selection.anchor <= x.end); return it ? [items.indexOf(it), st.selection.anchor - it.start] : null; })();
  const offH = (() => { const it = items.find(x => x.start <= st.selection.head && st.selection.head <= x.end); return it ? [items.indexOf(it), st.selection.head - it.start] : null; })();
  const tr = st.tr.replaceWith(outerPos, outerPos + outer.nodeSize, nodes);
  const starts = []; const walk = (n, p) => n.forEach((c, o) => { const cp = p + 1 + o; if (c.type.name === 'listItem') { if (!c.attrs.ghost) starts.push(cp + 1); c.forEach((g, go) => { if (isList(g)) walk(g, cp + 1 + go); }); } });
  let p = outerPos; for (const n of nodes) { walk(n, p); p += n.nodeSize; }
  try {
    const A = offA && starts[offA[0]] != null ? starts[offA[0]] + offA[1] : null, H = offH && starts[offH[0]] != null ? starts[offH[0]] + offH[1] : null;
    if (A != null && H != null) tr.setSelection(TextSelection.create(tr.doc, A, H));
  } catch (e) { /* keep the mapped selection */ }
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Backspace at the start of a list's first item that has inner items: its symbol goes (the text stays as a normal
 *  paragraph above the list) and the inner items keep their levels (they do not move up a level). */
export function unlistFirstItem(view) {
  const st = view.state, sel = st.selection;
  if (!sel.empty) return false;
  const $f = sel.$from;
  if ($f.parentOffset !== 0 || !$f.parent.isTextblock) return false;
  let d = 1; while (d <= $f.depth && !isList($f.node(d))) d++;
  if (d > $f.depth || d + 2 !== $f.depth) return false;                 // the paragraph of a top-level item
  const outer = $f.node(d), outerPos = $f.before(d);
  if ($f.index(d) !== 0 || $f.index(d + 1) !== 0) return false;          // its first item, first paragraph
  const li = outer.firstChild; let hasSub = false; li.forEach(c => { if (isList(c)) hasSub = true; });
  if (!hasSub) return false;                                             // no inner items: the usual behaviour
  const items = []; flatten(outer, 0, items, outerPos);
  if (!items.length || items[0].level !== 0) return false;
  const head = items[0].content, rest = items.slice(1);
  const nodes = [...head, ...(rest.length ? rebuild(rest, st.schema) : [])];
  const tr = st.tr.replaceWith(outerPos, outerPos + outer.nodeSize, nodes);
  try { tr.setSelection(TextSelection.create(tr.doc, outerPos + 1)); } catch (e) { /* mapped */ }
  view.dispatch(tr.scrollIntoView());
  return true;
}
/** Backspace in an empty item of an inner list: the item goes, everything else keeps its level (renumbered). */
export function deleteEmptyListItem(view) {
  const st = view.state, sel = st.selection;
  if (!sel.empty) return false;
  const $f = sel.$from;
  if ($f.parent.content.size || $f.depth < 4) return false;
  const li = $f.node($f.depth - 1);
  if (li.type.name !== 'listItem' || li.childCount !== 1) return false;
  let d = 1; while (d <= $f.depth && !isList($f.node(d))) d++;
  const outer = $f.node(d), outerPos = $f.before(d);
  const items = []; flatten(outer, 0, items, outerPos);
  const k = items.findIndex(it => it.start <= sel.from && sel.from <= it.end);
  if (k < 0 || items[k].level === 0) return false;
  const prev = k - 1;
  items.splice(k, 1);
  const nodes = rebuild(items, st.schema);
  const tr = st.tr.replaceWith(outerPos, outerPos + outer.nodeSize, nodes);
  // cursor: end of the previous item's text
  const starts = []; const walk = (n, p) => n.forEach((c, o) => { const cp = p + 1 + o; if (c.type.name === 'listItem') { starts.push([cp, c]); c.forEach((g, go) => { if (isList(g)) walk(g, cp + 1 + go); }); } });
  let p = outerPos; for (const n of nodes) { walk(n, p); p += n.nodeSize; }
  const t = starts[Math.max(0, prev)];
  if (t) { let endPos = t[0] + 1; t[1].forEach((c, o) => { if (!isList(c)) endPos = t[0] + 1 + o + c.nodeSize - 1; }); try { tr.setSelection(TextSelection.create(tr.doc, endPos)); } catch (e) { /* mapped */ } }
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',                 // several comments may cover the same text
  addAttributes() { return { id: { default: null, parseHTML: el => el.getAttribute('data-cmt'), renderHTML: a => ({ 'data-cmt': a.id }) } }; },
  parseHTML() { return [{ tag: 'span[data-cmt]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', HTMLAttributes, 0]; }
});

export const ListJoin = Extension.create({
  name: 'listJoin',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(trs, oldState, state) {
        if (!trs.some(t => t.docChanged)) return null;
        const joins = [];
        const scan = (n, start) => {          // start: position of n's first child
          let prev = null;
          n.forEach((c, off) => {
            const cp = start + off;
            if (prev && /^(orderedList|bulletList)$/.test(c.type.name) && prev.type === c.type) {
              const a = prev.attrs, b = c.attrs;
              const same = c.type.name === 'orderedList'
                ? (a.numStyle || null) === (b.numStyle || null) && (b.start == null || b.start === 1) && !b.cont
                : (a.bulletChar || '') === (b.bulletChar || '') && (a.bulletImage || '') === (b.bulletImage || '');
              if (same) joins.push(cp);
            }
            prev = c;
            if (!c.isTextblock && !c.isLeaf) scan(c, cp + 1);
          });
        };
        scan(state.doc, 0);
        if (!joins.length) return null;
        const tr = state.tr;
        for (const j of joins.reverse()) { try { tr.join(tr.mapping.map(j)); } catch (e) { /* leave it */ } }
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
      }
    })];
  }
});

/* ---------- formulas: the cursor goes before / after them, and a drag can select a formula at the end of a line --- */
function mathEdgePos(view, el, x) {
  let pos; try { pos = view.posAtDOM(el, 0); } catch (e) { return null; }
  const n = view.state.doc.nodeAt(pos); if (!n || n.type.name !== 'math') return null;
  const r = el.getBoundingClientRect(), f = (x - r.left) / (r.width || 1);
  return {pos, node: n, before: pos, after: pos + n.nodeSize, side: f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'mid', center: r.left + r.width / 2};
}
/** The formula a point is on or just to the right of (on the same line, past the end of the text). */
function mathNear(view, x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('.math');
  if (el && view.dom.contains(el)) return {el, over: true};
  const block = document.elementFromPoint(x, y)?.closest?.('p, h1, h2, h3, li');
  const scope = block && view.dom.contains(block) ? block : null; if (!scope) return null;
  let best = null;
  for (const m of scope.querySelectorAll('.math')) { const r = m.getBoundingClientRect(); if (y >= r.top - 4 && y <= r.bottom + 4 && x >= r.right && (!best || r.right > best.r.right)) best = {el: m, r}; }
  return best ? {el: best.el, over: false} : null;
}
export const MathCaret = Extension.create({
  name: 'mathCaret',
  addProseMirrorPlugins() {
    let drag = null;
    const setSel = (view, anchor, head) => { try { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head))); } catch (e) { /* out of range */ } };
    return [new Plugin({
      key: new PluginKey('mathCaret'),
      props: {
        handleDOMEvents: {
          mousedown(view, e) {
            if (e.button !== 0 || e.detail > 1 || e.shiftKey) return false;
            const near = mathNear(view, e.clientX, e.clientY); if (!near) return false;
            const m = mathEdgePos(view, near.el, e.clientX); if (!m) return false;
            if (near.over && m.side === 'mid') return false;                 // the middle: the formula itself (double click edits)
            const at = near.over && m.side === 'before' ? m.before : m.after;
            e.preventDefault(); view.focus(); setSel(view, at, at);
            drag = {anchor: at};
            const move = ev => {
              if (!drag) return;
              const n2 = mathNear(view, ev.clientX, ev.clientY), m2 = n2 && mathEdgePos(view, n2.el, ev.clientX);
              const head = m2 ? (ev.clientX > m2.center ? m2.after : m2.before) : view.posAtCoords({left: ev.clientX, top: ev.clientY})?.pos;
              if (head != null) setSel(view, drag.anchor, head);
            };
            const up = () => { drag = null; removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
            addEventListener('mousemove', move); addEventListener('mouseup', up);
            return true;
          },
          // a normal drag that reaches a formula at the end of a line: the formula is included
          mousemove(view, e) {
            if (drag || !(e.buttons & 1)) return false;
            const near = mathNear(view, e.clientX, e.clientY); if (!near) return false;
            const m = mathEdgePos(view, near.el, e.clientX); if (!m || e.clientX <= m.center) return false;
            const sel = view.state.selection; if (sel.empty && sel.from !== m.before && sel.from !== m.after) return false;
            if (sel.head < m.after && sel.anchor <= m.before) setTimeout(() => setSel(view, view.state.selection.anchor, m.after), 0);
            return false;
          }
        }
      }
    })];
  }
});

/* ---------- lists: the room for the symbol grows with the widest symbol of the list (big letters, "10.") ------
   Every line of every item then starts at the same place, and the next level's symbol stands exactly where the
   text of this level starts (like a hanging indent of that width). The room is never smaller than the list's own
   setting (0,8 cm by default). */
const CM_PX = 96 / 2.54;
export function neededGapPx(listEl, scale = 1, gapCm = null) {
  let need = 0;
  for (const lm of listEl.querySelectorAll(':scope > li > :first-child > .lm')) {
    const r = document.createRange(); r.selectNodeContents(lm);
    const w = r.getBoundingClientRect().width / (scale || 1), fs = parseFloat(getComputedStyle(lm).fontSize) || 16;
    if (w) need = Math.max(need, w + 0.3 * fs);
  }
  return Math.round(Math.max((gapCm ?? 0.8) * CM_PX, need) * 100) / 100;
}
/** The same for a drawn (not edited) text. */
export function fitListGapsDOM(root, scale = 1) {
  for (const l of root.querySelectorAll('ul, ol')) l.style.setProperty('--gap', neededGapPx(l, scale, numOrNull(l.getAttribute('data-gap'))) + 'px');
}
export const ListGapFit = Extension.create({
  name: 'listGapFit',
  addOptions() { return { getScale: () => 1 }; },
  addProseMirrorPlugins() {
    const ext = this, key = new PluginKey('listGapFit');
    return [new Plugin({
      key,
      state: { init: () => DecorationSet.empty, apply(tr, old) { const m = tr.getMeta(key); return m || old.map(tr.mapping, tr.doc); } },
      props: { decorations(st) { return key.getState(st); } },
      view(view) {
        let raf = 0, sig = '';
        const run = () => {
          raf = 0; if (!view.dom.isConnected) return;
          const sc = ext.options.getScale() || 1, decos = [];
          let stale = false;
          view.state.doc.descendants((n, pos) => {
            if (n.type.name !== 'bulletList' && n.type.name !== 'orderedList') return;
            const dom = view.nodeDOM(pos); if (!dom || !dom.querySelectorAll) return;
            const v = neededGapPx(dom, sc, n.attrs.gap) + 'px';
            if (dom.style.getPropertyValue('--gap').trim() !== v) stale = true;      // a list drawn again (e.g. its setting changed)
            decos.push(Decoration.node(pos, pos + n.nodeSize, { style: `--gap:${v}` }));
          });
          const s = decos.map(d => d.from + d.type.attrs.style).join('|');
          if (s !== sig || stale) { sig = s; view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decos)).setMeta('addToHistory', false)); }
        };
        const later = () => { if (!raf) raf = requestAnimationFrame(run); };
        later();
        return { update(v, prev) { if (v.state.doc !== prev.doc) later(); }, destroy() { cancelAnimationFrame(raf); } };
      }
    })];
  }
});
