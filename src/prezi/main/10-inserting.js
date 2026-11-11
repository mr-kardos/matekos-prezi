/* ================================================================== inserting objects */
function nextName(base) { return `${base} ${flatObjects(tgt().objects).filter(o => o.name?.startsWith(base)).length + 1}`; }
function addObject(o) {
  const n = tgt().objects.length % 8;
  o = {id: uid(), x: Math.round(W / 2 - (o.w ?? 400) / 2 + n * 20), y: Math.round(H / 2 - (o.h ?? 60) / 2 + n * 20), w: 400, h: 60, rot: 0, ...o};
  tgt().objects.push(o); setSel([o.id]); curAnim = null; return o;
}
// default shapes are regular: square, circle, equilateral triangle
const SHAPES = {
  rect: {name: 'Téglalap', w: 100, h: 100, fill: '#f8d4d0', stroke: '#da291c', strokeWidth: 3, radius: 0},
  ellipse: {name: 'Ellipszis', w: 100, h: 100, fill: '#f8d4d0', stroke: '#da291c', strokeWidth: 3},
  triangle: {name: 'Háromszög', w: 110, h: Math.round(110 * Math.sqrt(3) / 2), fill: '#f8d4d0', stroke: '#da291c', strokeWidth: 3},
  arrow: {name: 'Nyíl', w: 56, h: 27, fill: '#da291c', stroke: null, strokeWidth: 0},
  line: {name: 'Vonal', w: 300, h: 20, fill: null, stroke: '#da291c', strokeWidth: 4}
};
function addShape(shape) {
  if (editing) exitEdit();
  const {name, ...base} = SHAPES[shape];
  addObject({type: 'shape', shape, name: nextName(name), ...base}); commit();
}
function addText() {
  if (editing) exitEdit();
  const st = stylesOf().body;
  const o = addObject({type: 'text', name: nextName('Szöveg'), w: 620, size: st.size, color: st.color, bold: st.bold || undefined, italic: st.italic || undefined,
    underline: st.underline || undefined, font: st.font || undefined,
    align: 'left', styleRef: 'body', doc: emptyDoc()});
  renderAll(); enterEdit(o.id);
}
function addTable(rows, cols) {
  if (editing) exitEdit();
  const w = Math.min(1100, Math.max(240, cols * 150));
  const o = addObject({type: 'table', name: nextName('Táblázat'), w, h: rows * 50, size: 26.67, color: '#1a1a1a', align: 'left', doc: tableDoc(rows, cols)});
  commit(); enterEdit(o.id);
}
let imageCb = null;
function pickImage(cb) { imageCb = cb; $('#fImage').click(); }
$('#fImage').onchange = e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { const img = new Image(); img.onload = () => {
    const key = 'img' + uid(); media[key] = rd.result;
    if (imageCb) { const cb = imageCb; imageCb = null; cb(key, img); return; }
    if (editing) exitEdit();
    const k = Math.min(1, 800 / img.width, 500 / img.height);
    addObject({type: 'image', name: nextName('Kép'), media: key, w: Math.round(img.width * k), h: Math.round(img.height * k)}); commit();
  }; img.src = rd.result; };
  rd.readAsDataURL(f);
};
function pickImageURL(maxSide, cb) {
  const inp = $('#pickIn');
  inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (!f) return; const rd = new FileReader(); rd.onload = () => cb(rd.result); rd.readAsDataURL(f); };
  inp.click();
}

/* grouping, locking, deleting */
async function groupSelected() {
  if (editing) exitEdit();
  const objs = tgt().objects.filter(o => selIds.includes(o.id));
  if (objs.length < 2) return;
  const lost = (tgt().anims || []).filter(a => objs.some(o => flatObjects([o]).some(q => q.id === a.target))).length;
  if (lost && !await confirmBox(`A csoportosítással a kijelölt objektumok ${lost} animációja törlődik – a csoport ezután egyben animálható. Folytatod?`, 'Csoportosítás')) return;
  const at = tgt().objects.indexOf(objs.at(-1));
  const g = fitGroup({id: uid(), type: 'group', name: nextName('Csoport'), x: 0, y: 0, w: 1, h: 1, rot: 0, children: objs});
  tgt().objects.splice(at, 1, g);
  tgt().objects = tgt().objects.filter(o => !objs.includes(o));
  // members are animated together with the group from now on
  if (tgt().anims) tgt().anims = tgt().anims.filter(a => !objs.some(o => flatObjects([o]).some(q => q.id === a.target)));
  setSel([g.id]); commit();
}
async function ungroupSelected() {
  if (editing) exitEdit();
  const g = selObj(); if (g?.type !== 'group') return;
  const lost = (tgt().anims || []).filter(a => a.target === g.id).length;
  if (lost && !await confirmBox(`A csoport bontásával a csoport ${lost} animációja törlődik. Folytatod?`, 'Csoport bontása')) return;
  const list = tgt().objects, at = list.indexOf(g);
  list.splice(at, 1, ...g.children);
  if (tgt().anims) tgt().anims = tgt().anims.filter(a => a.target !== g.id);
  setSel(g.children.map(c => c.id)); commit();
}
function toggleHidden(id) {
  const o = objById(id); if (!o) return;
  if (editing === id) exitEdit();
  o.hidden = !o.hidden || undefined; if (o.hidden) setSel(selIds.filter(x => x !== id)); commit();
}
function toggleLock(id) {
  const o = objById(id); if (!o) return;
  if (editing === id) exitEdit();
  o.locked = !o.locked || undefined; commit();
}
/* slide transitions */
const TRANSITIONS = {
  none: {label: 'Nincs'}, fade: {label: 'Áttűnés'}, fadeBlack: {label: 'Áttűnés feketén át'},
  push: {label: 'Eltolás', dirs: 'side'}, cover: {label: 'Takarás', dirs: 'side'}, pull: {label: 'Felfedés', dirs: 'side'},
  wipe: {label: 'Törlés', dirs: 'side'}, split: {label: 'Szétválás', dirs: 'split'}, zoom: {label: 'Nagyítás'}
};
const TR_DIRS = {side: {r: 'jobbról', l: 'balról', b: 'alulról', t: 'felülről'}, split: {vo: 'függőlegesen kifelé', vi: 'függőlegesen befelé', ho: 'vízszintesen kifelé', hi: 'vízszintesen befelé'}};
/** Transition menu under the current slide in the left panel. */
function renderTransMenu() {
  const t = tgt().transition || {type: 'none'}, T_ = TRANSITIONS[t.type] || TRANSITIONS.none;
  $('#transList').innerHTML = Object.entries(TRANSITIONS).map(([k, v]) => `<button class="pitem${k === t.type ? ' on' : ''}" data-tr="${k}">${v.label}</button>`).join('');
  const dirs = T_.dirs ? TR_DIRS[T_.dirs] : null, dir = dirs ? (dirs[t.dir] ? t.dir : Object.keys(dirs)[0]) : null;
  $('#transDirs').innerHTML = dirs ? `<div class="psep"></div><div class="ptitle">Irány</div><div class="trdirs">${Object.entries(dirs).map(([k, l]) => `<button class="pitem${k === dir ? ' on' : ''}" data-trdir="${k}">${l}</button>`).join('')}</div>` : '';
  $('#transDur').value = secs(t.dur ?? 700); $('#transDur').disabled = t.type === 'none';
  $('#transPlay').disabled = t.type === 'none';
}
$('#popTrans').onopen = renderTransMenu;
$('#popTrans').addEventListener('click', e => {
  const s_ = tgt(), b = e.target.closest('[data-tr], [data-trdir]'); if (!b) return;
  if (b.dataset.tr) { if (b.dataset.tr === 'none') delete s_.transition; else s_.transition = {type: b.dataset.tr, dur: s_.transition?.dur ?? 700}; }
  else (s_.transition ||= {type: 'fade', dur: 700}).dir = b.dataset.trdir;
  commit(); renderTransMenu(); previewTransition();
});
$('#transDur').addEventListener('change', e => { const v = parseFloat(String(e.target.value).replace(',', '.')), s_ = tgt();
  if (v > 0 && s_.transition) { s_.transition.dur = Math.round(Math.min(10, v) * 1000); commit(); previewTransition(); } });
$('#transAll').onclick = async () => {
  closePops(); const s_ = tgt();
  if (!await confirmBox('Ez a diaváltás kerüljön minden diára?', 'Minden diára')) return;
  for (const sl of doc.slides) { if (s_.transition) sl.transition = clone(s_.transition); else delete sl.transition; } commit();
};
$('#transPlay').onclick = () => { closePops(); if (cur === 0) { startShow(0); return; } startShow(cur - 1); setTimeout(() => sh && loadShowSlide(cur, 0, true, true), 350); };
/** Dragging a table's frame up/down: the rows share the new height evenly (each row at least as tall as its content). */
function setTableHeight(o) {
  const rows = o.doc.content?.[0]?.content?.length || 1, mm = Math.max(3, Math.round(o.h / rows / MM * 10) / 10);
  if (editing === o.id && ed) {
    const c = tableContext(ed.state) || (() => { const t = ed.state.doc.firstChild; return t && {table: t, pos: 0, start: 1}; })();
    if (!c) return;
    const tr = ed.state.tr; c.table.forEach((row, off) => tr.setNodeMarkup(c.start + off, undefined, {...row.attrs, height: mm}));
    ed.view.dispatch(tr); syncEditor();
  } else for (const row of o.doc.content[0].content) row.attrs = {...(row.attrs || {}), height: mm};
}
function deleteSelected() {
  const ids = selIds.filter(id => !objById(id)?.locked); if (!ids.length) return;
  for (const id of ids) {
    const g = groupOf(id), list = g ? g.children : tgt().objects, o = objById(id);
    if (o) list.splice(list.indexOf(o), 1);
    if (g) { if (g.children.length) fitGroup(g); else tgt().objects.splice(tgt().objects.indexOf(g), 1); }
  }
  if (tgt().anims) tgt().anims = tgt().anims.filter(a => objById(a.target));
  setSel([]); commit();
}

