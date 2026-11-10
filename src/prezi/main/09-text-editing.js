/* ================================================================== text editing (Matekos Doksi editor) */
setTextHooks({onEdit: (pos, node) => openMath(pos, node), onRendered: onMathRendered, onPreview: p => showPreview(p), getScale: () => scale});
function enterEdit(id, ev) {
  const o = objById(id); if (!isTextLike(o) || o.locked || o.field) return;
  if (sel !== id) { setSel([id]); curAnim = null; }
  editing = id; editBase = hIdx; editNav = false;
  editFlags = [];
  let anyText = false; eachInline(o.doc, n => { if (n.type === 'math' || n.text.trim()) anyText = true; });
  if (anyText) for (const [k, t] of Object.entries(FLAG_MARKS)) if (o[k]) {
    eachInline(o.doc, n => { if (!hasMark(n, t)) (n.marks ||= []).push({type: t}); });
    delete o[k]; editFlags.push(k);
  }
  const el = stage.querySelector(`.obj[data-id="${id}"]`), txt = el.querySelector('.txt');
  if (editFlags.length) txtStyle(txt, o);
  txt.classList.remove('empty'); el.classList.add('editing');
  ed = mountEditor(txt, o.doc, {
    onUpdate: tr => {
      editSoon(!!tr?.getMeta?.('history$'));
      if (isTable(o) && ed && !ed.state.doc.firstChild?.type.name.startsWith('table')) { setTimeout(() => { const id_ = editing; if (!id_) return; stopEditor(); setSel([id_]); deleteSelected(); }, 0); return; }
      measureTexts(); drawSelection(); drawTableHandles();
    },
    onSelection: () => { updateRibbon(); drawTableHandles(); drawMathCaret(); },
    onBlur: () => { drawMathCaret(); showPreview(null); }
  }, kindOf(o));
  ed.view.dom.addEventListener('keydown', ke => { if (ke.key === 'Escape' && !isMathEditorOpen()) { ke.preventDefault(); exitEdit(); } });
  txt.addEventListener('keydown', ke => {                  // on the box, so it runs before the editor's own keys
    // the whole table selected + Delete / Backspace: the table object itself goes (not just the cell contents)
    if (isTable(o) && (ke.key === 'Delete' || ke.key === 'Backspace')) {
      const sel_ = ed.state.selection, whole = sel_.constructor.name === 'AllSelection' || (typeof sel_.isRowSelection === 'function' && sel_.isRowSelection() && sel_.isColSelection());
      if (whole) { ke.preventDefault(); ke.stopPropagation(); stopEditor(); setSel([id]); deleteSelected(); }
    }
  }, true);
  let pos = null;
  if (ev && ev.clientX != null) { const hit = ed.view.posAtCoords({left: ev.clientX, top: ev.clientY}); if (hit) pos = hit.pos; }
  if (pos != null) ed.chain().focus().setTextSelection(pos).run(); else ed.commands.focus('end');
  drawSelection(); renderProps(); updateRibbon();
}
/** Close the editor and keep (or drop) the box. Returns true if something changed. */
function stopEditor() {
  if (!editing) return null;
  const id = editing, json = ed.getJSON();
  clearTimeout(editT); editT = 0;
  ed.destroy(); ed = null; editing = null; showPreview(null);
  $('#tableBar').hidden = true; $('#fcaret')?.remove();
  return {id, json};
}
let editFlags = [];
function exitEdit() {
  keptSel = null;
  const r = stopEditor(); if (!r) return;
  const o = objById(r.id);
  if (!o) { renderAll(); return; }
  const changed = JSON.stringify(r.json) !== JSON.stringify(o.doc);
  o.doc = r.json;
  // formatting that still covers the whole text goes back to the box
  for (const k of editFlags) if (allMarked(o.doc, FLAG_MARKS[k])) { stripMark(o.doc, FLAG_MARKS[k]); o[k] = true; }
  editFlags = [];
  if (isText(o) && isEmptyText(o) && !o.placeholder) {
    const g = groupOf(o.id), list = g ? g.children : tgt().objects; list.splice(list.indexOf(o), 1); if (g) fitGroup(g);
    if (tgt().anims) tgt().anims = tgt().anims.filter(a => a.target !== o.id);
    foldEditSteps(); setSel([]); commit(); return;
  }
  if (changed) { foldEditSteps(); commit(); } else { editNav = false; renderAll(); }
}
/** Run a TipTap command on the selected text box: directly while editing, otherwise on its whole content. */
function withEditor(fn) {
  const o = selObj(); if (!isTextLike(o) || o.locked) return;
  if (o.field) { toast('Automatikus mezőnél csak az egész doboz formázható (betű, szín, igazítás).'); return; }
  if (editing === o.id) { fn(ed.chain().focus()); return; }
  if (mode === 'template' && o.placeholder) { toast('A helykitöltő formázását a menüszalag betű- és igazítás-gombjaival állíthatod.'); return; }
  enterEdit(o.id); ed.commands.selectAll(); fn(ed.chain().focus()); exitEdit();
}
/** Make sure a text box is being edited (for inserting tables / formulas); creates one if needed. */
function ensureEditing() {
  const o = selObj();
  if (editing) return true;
  if (isTextLike(o) && !o.locked && !(mode === 'template' && o.placeholder)) { enterEdit(o.id); ed.commands.focus('end'); return true; }
  const n = addObject({type: 'text', name: nextName('Szöveg'), w: 760, size: 32, color: '#1a1a1a', align: 'left', doc: emptyDoc()});
  renderAll(); enterEdit(n.id); return true;
}

/* formula dialog (Doksi) and live $ preview */
function openMath(pos, node) {
  if (!editing) { ensureEditing(); }
  closePops(); showPreview(null);
  const sel_ = ed.state.selection;
  if (pos == null && sel_ instanceof NodeSelection && sel_.node.type.name === 'math') { pos = sel_.from; node = sel_.node; }
  const editPos = node ? pos : null;
  let tex = node ? node.attrs.tex : '';
  if (!node && !sel_.empty) tex = ed.state.doc.textBetween(sel_.from, sel_.to, ' ');
  const editor = ed;
  const finish = () => { if (editor && !editor.isDestroyed && !editor.view.hasFocus()) editor.view.dom.focus({preventScroll: true}); };
  openMathEditor({
    tex, editing: !!node, top: $('#app').getBoundingClientRect().bottom + 10, wrap: node ? !!node.attrs.wrap : true,
    onApply: (t, wrap) => {
      if (!editor || editor.isDestroyed) return;
      if (t == null) return finish();
      if (editPos != null) {
        const n = editor.state.doc.nodeAt(editPos);
        if (n && n.type.name === 'math') {
          const tr = editor.state.tr;
          if (!t) tr.delete(editPos, editPos + n.nodeSize); else tr.setNodeMarkup(editPos, undefined, {...n.attrs, tex: t, wrap: !!wrap}, n.marks);
          editor.view.dispatch(tr);
        }
        return finish();
      }
      const marks = (editor.state.storedMarks || editor.state.selection.$from.marks()).map(m => m.toJSON());
      if (t) editor.chain().focus().insertContent({type: 'math', attrs: {tex: t, display: false, wrap: !!wrap}, ...(marks.length ? {marks} : {})}).run(); else finish();
    },
    onDelete: () => {
      const n = editPos != null && editor.state.doc.nodeAt(editPos);
      if (n && n.type.name === 'math') editor.view.dispatch(editor.state.tr.delete(editPos, editPos + n.nodeSize));
      finish();
    }
  });
}
const mprev = $('#mprev');
function showPreview(p) {
  if (!p) { mprev.hidden = true; return; }
  mprev.innerHTML = '<div class="mp-m"></div><div class="mp-hint">Írj $ jelet a képlet lezárásához</div>';
  const box = mprev.firstChild; mprev.hidden = false;
  const place = () => {
    mprev.style.left = Math.max(8, Math.min(p.coords.left - 12, innerWidth - mprev.offsetWidth - 8)) + 'px';
    let top = p.coords.bottom + 8;
    if (top + mprev.offsetHeight > innerHeight - 8) top = p.coords.top - mprev.offsetHeight - 8;
    mprev.style.top = top + 'px';
  };
  renderInto(box, p.tex, false, place); place();
}
// visible text cursor right before / after a formula (browsers often hide it there)
function drawMathCaret() {
  let c = stage.querySelector('#fcaret');
  if (!ed || ed.isDestroyed) { c?.remove(); return; }
  const v = ed.view, s = ed.state.selection, $p = s.$from;
  const near = s.empty && v.hasFocus() && (($p.nodeBefore?.type.name === 'math') || ($p.nodeAfter?.type.name === 'math'));
  if (!near) { c?.remove(); return; }
  try {
    const k = v.coordsAtPos(s.from, $p.nodeAfter?.type.name === 'math' ? 1 : -1), q = toStageRect({left: k.left, top: k.top, width: 0, height: k.bottom - k.top});
    if (!c) { c = document.createElement('div'); c.id = 'fcaret'; stage.appendChild(c); }
    Object.assign(c.style, {left: q.x + 'px', top: q.y + 'px', height: q.h + 'px', borderLeftWidth: 1.5 / scale + 'px'});
  } catch (e) { c?.remove(); }
}

/* tables (Doksi table tools) */
let tblCtx = null;
function rememberTable() { if (tblCtx || !ed) return; const c = tableContext(ed.state); tblCtx = c ? {pos: c.pos, rect: c.rect} : null; }
function curTable() {
  if (!ed) return null;
  if (tblCtx) { const table = ed.state.doc.nodeAt(tblCtx.pos); if (table && table.type.name === 'table') return {table, pos: tblCtx.pos, start: tblCtx.pos + 1, map: TableMap.get(table), rect: tblCtx.rect}; }
  return tableContext(ed.state);
}
function reselectCells(c) {
  try { const {map, rect, start, table} = c;
    const pa = start + map.positionAt(rect.top, rect.left, table), pb = start + map.positionAt(rect.bottom - 1, rect.right - 1, table);
    if (pa !== pb) ed.view.dispatch(ed.state.tr.setSelection(CellSelection.create(ed.state.doc, pa, pb)));
  } catch (e) { /* ignore */ }
}
function forCells(scope, fn) {
  const c = curTable(); if (!c) return;
  const {map, rect, start, table} = c;
  const r = scope === 'table' ? {left: 0, top: 0, right: map.width, bottom: map.height} : scope === 'cols' ? {left: rect.left, right: rect.right, top: 0, bottom: map.height} : rect;
  const tr = ed.state.tr, seen = new Set();
  for (let row = r.top; row < r.bottom; row++) for (let col = r.left; col < r.right; col++) {
    const rel = map.map[row * map.width + col]; if (seen.has(rel)) continue; seen.add(rel);
    const node = table.nodeAt(rel), attrs = fn(node, row, col);
    if (attrs) tr.setNodeMarkup(start + rel, undefined, {...node.attrs, ...attrs});
  }
  ed.view.dispatch(tr); reselectCells(curTable());
}
function fillTableFields() {
  const c = curTable(); if (!c) return;
  const act = document.activeElement;
  const row = c.table.child(Math.min(c.rect.top, c.table.childCount - 1));
  if (act !== $('#tpRowH')) $('#tpRowH').value = row.attrs.height || '';
  const cell = c.table.nodeAt(c.map.map[c.rect.top * c.map.width + c.rect.left]);
  if (act !== $('#tpColW')) $('#tpColW').value = cell && cell.attrs.colwidth && cell.attrs.colwidth[0] ? Math.round(cell.attrs.colwidth[0] / MM * 10) / 10 : '';
  for (const b of $$('#tableBar [data-talign]')) b.classList.toggle('on', (c.table.attrs.align || 'left') === b.dataset.talign);
}
for (const id of ['#tpRowH', '#tpColW']) {
  $(id).addEventListener('focus', rememberTable);
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); } });
}
function setTableAttrs(attrs) { const c = curTable(); if (!c) return; ed.view.dispatch(ed.state.tr.setNodeMarkup(c.pos, undefined, {...c.table.attrs, ...attrs})); reselectCells(curTable()); }
$('#tpRowH').addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.max(3, +e.target.value), c = curTable(); if (!c) return;
  const tr = ed.state.tr; c.table.forEach((row, o, i) => { if (i >= c.rect.top && i < c.rect.bottom) tr.setNodeMarkup(c.start + o, undefined, {...row.attrs, height: v}); });
  ed.view.dispatch(tr); reselectCells(curTable());
});
$('#tpColW').addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.round(Math.max(5, +e.target.value) * MM);
  forCells('cols', n => n.attrs.colspan === 1 ? {colwidth: v ? [v] : null} : null);
});
let borderScope = 'cells';
$('#popBorders').addEventListener('click', e => {
  const sc = e.target.closest('[data-scope]');
  if (sc) { borderScope = sc.dataset.scope; for (const b of $$('#popBorders [data-scope]')) b.classList.toggle('on', b === sc); return; }
  const bw = e.target.closest('[data-bw]');
  if (bw) forCells(borderScope === 'table' ? 'table' : 'cells', () => ({borderWidth: bw.dataset.bw === '' ? null : +bw.dataset.bw}));
});
function drawTableHandles() {
  let layer = stage.querySelector('#tblHandles');
  const c = ed && !ed.isDestroyed ? tableContext(ed.state) : null;
  if (!c) { layer?.remove(); return; }
  if (!layer) { layer = document.createElement('div'); layer.id = 'tblHandles'; stage.appendChild(layer); }
  const wrap = ed.view.nodeDOM(c.pos); if (!wrap) return;
  const tbl = wrap.tagName === 'TABLE' ? wrap : wrap.querySelector('table'); if (!tbl) return;
  const {map, start, table} = c, tr = toStageRect(tbl.getBoundingClientRect()), cols = [];
  for (let col = 0; col < map.width; col++) {
    let rr = null;
    for (let row = 0; row < map.height && !rr; row++) { const rel = map.map[row * map.width + col], n = table.nodeAt(rel); if (n && n.attrs.colspan === 1) { const dom = ed.view.nodeDOM(start + rel); if (dom) rr = toStageRect(dom.getBoundingClientRect()); } }
    cols.push(rr);
  }
  const rows = []; table.forEach((row, off) => { const dom = ed.view.nodeDOM(start + off); rows.push(dom ? toStageRect(dom.getBoundingClientRect()) : null); });
  const s = ed.state.selection, cs = s instanceof CellSelection, rect = c.rect;
  const colOn = i => cs && s.isColSelection() && i >= rect.left && i < rect.right, rowOn = i => cs && s.isRowSelection() && i >= rect.top && i < rect.bottom;
  const inv = 1 / scale, gap = 18 * inv;
  let h = `<button class="th-btn${cs && s.isColSelection() && s.isRowSelection() ? ' on' : ''}" data-ts="all" title="A teljes táblázat kijelölése" style="left:${tr.x - gap}px;top:${tr.y - gap}px">◢</button>`;
  cols.forEach((r, i) => { if (r) h += `<button class="th-btn${colOn(i) ? ' on' : ''}" data-ts="col" data-i="${i}" title="Oszlop kijelölése" style="left:${r.x + r.w / 2 - 8 * inv}px;top:${tr.y - gap}px">▼</button>`; });
  rows.forEach((r, i) => { if (r && r.h > 0) h += `<button class="th-btn row${rowOn(i) ? ' on' : ''}" data-ts="row" data-i="${i}" title="Sor kijelölése" style="left:${tr.x - gap}px;top:${r.y + r.h / 2 - 8 * inv}px">▶</button>`; });
  if (layer._key !== h) { layer.innerHTML = h; layer._key = h; }
  $('#tableBar').hidden = false; fillTableFields();
  for (const b of $$('#tableBar [data-valign]')) b.classList.toggle('on', (ed.getAttributes('tableCell').vAlign || ed.getAttributes('tableHeader').vAlign || 'top') === b.dataset.valign);
}
function selectTableRange(r0, c0, r1, c1) {
  const c = tableContext(ed.state); if (!c) return;
  const {map, start, table} = c;
  ed.view.dispatch(ed.state.tr.setSelection(CellSelection.create(ed.state.doc, start + map.positionAt(r0, c0, table), start + map.positionAt(r1, c1, table))));
  if (!ed.view.hasFocus()) ed.view.dom.focus({preventScroll: true});
}
stage.addEventListener('mousedown', e => {
  const b = e.target.closest('.th-btn'); if (!b || e.button !== 0 || !ed) return;
  e.preventDefault(); e.stopPropagation();
  const c = tableContext(ed.state); if (!c) return;
  const {map} = c, i = +b.dataset.i, s = ed.state.selection, ext = e.shiftKey && s instanceof CellSelection;
  if (b.dataset.ts === 'all') return selectTableRange(0, 0, map.height - 1, map.width - 1);
  if (b.dataset.ts === 'col') { const a = ext && s.isColSelection() ? Math.min(c.rect.left, i) : i, z = ext && s.isColSelection() ? Math.max(c.rect.right - 1, i) : i; return selectTableRange(0, a, map.height - 1, z); }
  const a = ext && s.isRowSelection() ? Math.min(c.rect.top, i) : i, z = ext && s.isRowSelection() ? Math.max(c.rect.bottom - 1, i) : i;
  selectTableRange(a, 0, z, map.width - 1);
}, true);
$('#tableBar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
$('#tableBar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !ed) return;
  if (b.dataset.pop) { if (/^pop(Borders|Cell)$/.test(b.dataset.pop)) rememberTable(); return showPop(b.dataset.pop, b); }
  if (b.dataset.tbl) return ed.chain().focus()[b.dataset.tbl]().run();
  if (b.dataset.valign) return ed.chain().focus().setCellAttribute('vAlign', b.dataset.valign).run();
  if (b.dataset.talign) return setTableAttrs({align: b.dataset.talign});
});
for (const id of ['#popTblIns', '#popTblDel']) $(id).addEventListener('click', e => {
  const b = e.target.closest('[data-tbl]'); if (!b || !ed) return; closePops();
  if (b.dataset.tbl === 'deleteTable') { const id_ = editing; stopEditor(); setSel([id_]); deleteSelected(); return; }
  ed.chain().focus()[b.dataset.tbl]().run();
});
const tg = $('#tgrid');
for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) { const d = document.createElement('button'); d.className = 'tc'; d.dataset.r = r; d.dataset.c = c; d.setAttribute('aria-label', r + ' × ' + c); tg.appendChild(d); }
const hl = (r, c) => { for (const d of tg.children) d.classList.toggle('on', +d.dataset.r <= r && +d.dataset.c <= c); $('#tlabel').textContent = r ? r + ' × ' + c + ' táblázat' : 'Válassz méretet'; };
tg.addEventListener('pointerover', e => { const d = e.target.closest('.tc'); if (d) hl(+d.dataset.r, +d.dataset.c); });
tg.addEventListener('click', e => { const d = e.target.closest('.tc'); if (!d) return; closePops(); addTable(+d.dataset.r, +d.dataset.c); });
$('#popTable').onopen = () => hl(0, 0);

