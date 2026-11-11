/* ================================================================== ribbon */
for (const b of $$('[data-icon]')) b.insertAdjacentHTML('afterbegin', svgIcon(b.dataset.icon));
const styled = o => { if (o.placeholder && mode === 'slides') o.phStyled = true; else if (!o.placeholder && o.styleRef) o.ownStyle = true; };
const inEdit = () => { const o = selObj(); return isTextLike(o) && editing === o.id; };
/** Bold, italic, …: while editing on the selection (marks), otherwise on the whole box. */
/* box formatting vs. formatting of parts: B / I / U / S on a selected (not opened) box apply to all of its text and
   formulas without exception; opening the box turns them into ordinary formatting of the text, so parts can differ */
const FLAG_MARKS = {bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike'};
function eachInline(json, fn) { (function w(n) { if (n.type === 'text' || n.type === 'math') fn(n); (n.content || []).forEach(w); })(json || {}); }
const hasMark = (n, t) => (n.marks || []).some(m => m.type === t);
function stripMark(json, t) { eachInline(json, n => { if (n.marks) { n.marks = n.marks.filter(m => m.type !== t); if (!n.marks.length) delete n.marks; } }); }
function allMarked(json, t) {
  let any = false, all = true;
  eachInline(json, n => { if (n.type === 'text' && !n.text.trim()) return; any = true; if (!hasMark(n, t)) all = false; });
  return any && all;
}
/* Several objects selected: a text formatting step runs on every selected text box, as one undo step. */
const multiTexts = () => !editing && selIds.length > 1 ? selIds.map(objById).filter(o => o && isTextLike(o) && !o.locked) : [];
function onEachText(run) {
  if (multiRun) return false;
  const list = multiTexts(); if (!list.length) return false;
  const keep = [...selIds]; multiRun = true;
  try { list.forEach((o, i) => { sel = o.id; selIds = [o.id]; run(i); if (editing) exitEdit(); }); }
  finally { multiRun = false; selIds = keep; sel = null; }
  pushHistory(); renderAll();
  return true;
}
function boxOrMark(mark, boxKey, force) {
  let all; if (onEachText(i => { if (!i) { const f = selObj(); all = !(f[boxKey] || allMarked(f.doc, mark)); } boxOrMark(mark, boxKey, all); })) return;   // every box like the first one
  const o = selObj(); if (!isTextLike(o)) return;
  if (inEdit()) { const fn = 'toggle' + mark[0].toUpperCase() + mark.slice(1); ed.chain().focus()[fn]().run(); return; }
  const on = force ?? !(o[boxKey] || allMarked(o.doc, mark));  // all of it, or none of it
  stripMark(o.doc, mark); o[boxKey] = on || undefined; styled(o); commit();
}
function setAlign(a) {
  if (onEachText(() => setAlign(a))) return;
  const o = selObj(); if (!isTextLike(o)) return;
  if (inEdit()) { ed.chain().focus().setTextAlign(a).run(); return; }
  o.align = a; styled(o);
  // whole box: paragraph alignments set in the editor give way to the box alignment
  const strip = n => { if (n.attrs?.textAlign) n.attrs.textAlign = null; (n.content || []).forEach(strip); }; strip(o.doc);
  commit();
}
/** List button: text that is already this kind of list loses the list formatting; otherwise it becomes a list. */
function unwrapLists(json, type) {
  const flat = nodes => nodes.flatMap(n => n.type === type ? (n.content || []).flatMap(li => flat(li.content || [])) : [n]);
  return {...json, content: flat(json.content || [])};
}
function listCmd(type) {
  if (onEachText(() => listCmd(type))) return;
  const o = selObj(); if (!isTextLike(o) || o.locked || o.field) return;
  const toggle = type === 'bulletList' ? 'toggleBulletList' : 'toggleOrderedList';
  if (inEdit()) {
    const {from, to} = ed.state.selection; let has = false;
    ed.state.doc.nodesBetween(from, to, n => { if (n.type.name === type) has = true; });
    if (!has) ed.chain().focus()[toggle]().run();
    else for (let i = 0; i < 12 && ed.isActive('listItem'); i++) if (!ed.chain().focus().liftListItem('listItem').run()) break;
    updateRibbon(); return;
  }
  if (JSON.stringify(o.doc).includes(`"type":"${type}"`)) { o.doc = unwrapLists(o.doc, type); commit(); }
  else withEditor(c => c[toggle]().run());
}
/* format painter: text formatting, fill / outline, animations of one object onto another */
let painter = null;
const TEXT_KEYS = ['size', 'color', 'bold', 'italic', 'underline', 'strike', 'align', 'letterSpacing', 'upper', 'font'];
function paintOnto(t) {
  const src = painter.o; painter = null; document.body.classList.remove('painting');
  if (!t || t.id === src.id) { updateRibbon(); return; }
  if (isTextLike(src) && isTextLike(t)) { for (const k of TEXT_KEYS) { if (src[k] == null) delete t[k]; else t[k] = src[k]; } styled(t); }
  if (src.type === 'shape' && t.type === 'shape') { t.fill = src.fill; t.stroke = src.stroke; t.strokeWidth = src.strokeWidth; if (t.shape === 'rect' && src.shape === 'rect') t.radius = src.radius; }
  if (src.type === 'image' && t.type === 'image') t.opacity = src.opacity;
  if (mode === 'slides' && painterAnims.length) {
    const s_ = tgt(); s_.anims = s_.anims.filter(a => a.target !== t.id);
    for (const a of painterAnims) { const c = {...clone(a), id: uid(), target: t.id}; if (c.byParagraph && !(isText(t) && (blockCount(t) > 1 || (c.byParagraph === 'parts' && partCount(t) > 1)))) delete c.byParagraph; s_.anims.push(c); }
  }
  setSel([t.id]); commit(); toast('Formázás átmásolva.');
}
let painterAnims = [];
const COMMANDS = {
  undo, redo,
  bold: () => boxOrMark('bold', 'bold'), italic: () => boxOrMark('italic', 'italic'),
  underline: () => boxOrMark('underline', 'underline'), strike: () => boxOrMark('strike', 'strike'),
  superscript: () => withEditor(c => c.toggleSuperscript().run()), subscript: () => withEditor(c => c.toggleSubscript().run()),
  alignLeft: () => setAlign('left'), alignCenter: () => setAlign('center'), alignRight: () => setAlign('right'), alignJustify: () => setAlign('justify'),
  bulletList: () => listCmd('bulletList'), orderedList: () => listCmd('orderedList'),
  // in a list the buttons do exactly what Tab / Shift+Tab do
  indent: () => withEditor(c => { if (!ed.isActive('listItem')) c.shiftIndent(1).run(); else if (!changeListLevel(ed.view, 1)) c.sinkListItem('listItem').run(); }),
  outdent: () => withEditor(c => { if (!ed.isActive('listItem')) c.shiftIndent(-1).run(); else if (!changeListLevel(ed.view, -1)) c.liftListItem('listItem').run(); }),
  text: addText, math: () => openMath(null, null), image: () => pickImage(null), video: () => insertVideo(),
  rect: () => addShape('rect'), ellipse: () => addShape('ellipse'), triangle: () => addShape('triangle'), arrow: () => addShape('arrow'), line: () => addShape('line'),
  painter: () => {
    if (painter) { painter = null; document.body.classList.remove('painting'); updateRibbon(); return; }
    const o = selObj(); if (!o) { toast('Előbb jelöld ki azt az objektumot, amelynek a formázását másolni szeretnéd.'); return; }
    if (editing) syncEditor();
    painter = {o: clone(o)}; painterAnims = (tgt().anims || []).filter(a => a.target === o.id).map(clone);
    document.body.classList.add('painting'); updateRibbon();
    toast('Kattints arra az objektumra, amelyre a formázást át szeretnéd vinni (Esc: mégse).');
  },
  upper: () => {
    let up; if (onEachText(i => { const f = selObj(); if (!i) up = !f.upper; f.upper = up || undefined; styled(f); })) return;
    const o = selObj(); if (!isTextLike(o)) return;
    if (inEdit() && !ed.state.selection.empty) { (ed.getAttributes('textStyle').textTransform === 'uppercase' ? ed.chain().focus().unsetUppercase() : ed.chain().focus().setUppercase()).run(); updateRibbon(); return; }
    o.upper = !o.upper || undefined; styled(o); commit();
  },
  delete: () => { if (editing) { const id = editing; exitEdit(); if (!objById(id)) return; } deleteSelected(); },
  spell: () => { spellOn = !spellOn; lsSet('matekosprezi.spell', spellOn ? '1' : '0'); drawSpellSoon(); updateRibbon(); },
  marks: () => { showMarks = !showMarks; lsSet('matekosprezi.marks', showMarks ? '1' : '0'); drawMarksSoon(); eyeThumbsSoon(); updateRibbon(); }
};
const ribbon = $('#ribbon');
ribbon.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
$('.bar1').addEventListener('mousedown', e => { if (e.target.closest('[data-cmd]')) e.preventDefault(); });
$('.bar1').addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b && !b.disabled) COMMANDS[b.dataset.cmd]?.(); });
ribbon.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.pop) return showPop(b.dataset.pop, b);
  COMMANDS[b.dataset.cmd]?.();
});
{ const fams = allFamilies(), item = ([f, l]) => `<button class="pitem fitem" data-fam="${f}" style="font-family:${familyCSS(f)}">${l}</button>`;
  $('#fontMath').innerHTML = fams.math.map(item).join(''); $('#fontOther').innerHTML = fams.other.map(item).join(''); }
/** Font in effect at the cursor / for the box (family key, '' = base font of the template). */
function currentFamily() {
  const o = selObj(); if (!isTextLike(o)) return null;
  if (inEdit()) { const ff = ed.getAttributes('textStyle').fontFamily; if (ff) return familyFromCSS(ff); }
  return o.font || '';
}
$('#popFont').onopen = () => { const f = currentFamily(); for (const b of $$('#popFont [data-fam]')) b.classList.toggle('on', b.dataset.fam === f); };
$('#popFont').addEventListener('click', e => { const b = e.target.closest('[data-fam]'); if (!b) return; closePops(); setFamily(b.dataset.fam); });
function setFamily(fam) {
  if (onEachText(() => setFamily(fam))) return;
  const o = selObj(); if (!isTextLike(o)) return;
  if (inEdit() && !ed.state.selection.empty) { (fam ? ed.chain().focus().setFontFamily('MP ' + fam) : ed.chain().focus().unsetFontFamily()).run(); updateRibbon(); return; }
  const strip = n => { (n.marks || []).forEach(m => { if (m.type === 'textStyle' && m.attrs) m.attrs.fontFamily = null; }); (n.content || []).forEach(strip); };
  if (inEdit()) ed.commands.setContent((j => (strip(j), j))(ed.getJSON()), {emitUpdate: false}); else strip(o.doc);
  o.font = fam || undefined; styled(o); commit();
}
/** Remove explicit font sizes from the text (they would override the box size – e.g. on pasted text and formulas). */
function stripFontSizes(json) {
  const walk = n => { if (n.marks) { n.marks.forEach(m => { if (m.type === 'textStyle' && m.attrs) m.attrs.fontSize = null; });
    n.marks = n.marks.filter(m => m.type !== 'textStyle' || Object.values(m.attrs || {}).some(v => v != null)); if (!n.marks.length) delete n.marks; }
    (n.content || []).forEach(walk); };
  walk(json); return json;
}
const setSize = v => {
  if (onEachText(() => setSize(v))) return;
  const p = parseFloat(String(v).replace(',', '.')), o = selObj(); if (!isTextLike(o) || !(p > 0 && p < 400)) return;
  if (inEdit() && !ed.state.selection.empty) { ed.chain().focus().setFontSize(p + 'pt').run(); return; }
  if (inEdit()) { ed.commands.setContent(stripFontSizes(ed.getJSON()), {emitUpdate: false}); }
  else stripFontSizes(o.doc);
  o.size = Math.round(p / PT * 100) / 100; styled(o); commit();
};
$('#sizeIn').addEventListener('change', e => setSize(e.target.value));
$('#sizeIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setSize(e.target.value); } });

function updateRibbon() {
  drawMarksSoon();
  const o = selObj() || multiTexts()[0] || null, edit = inEdit();     // several selected: the text buttons show the first text box
  for (const b of $$('[data-k]', ribbon)) {
    const k = b.dataset.k; b.disabled = k === 'any' ? !selIds.length : k === 'text' ? !isTextLike(o) || !!o.locked : !isShape(o) || !!o.locked;
  }
  $('#sizeIn').disabled = !isTextLike(o);
  updateImgBar();
  $('.bar1 [data-cmd=undo]').disabled = !edit && hIdx <= 0;
  $('.bar1 [data-cmd=redo]').disabled = !edit && hIdx >= history.length - 1;
  ribbon.querySelector('[data-cmd=painter]').classList.toggle('on', !!painter);
  ribbon.querySelector('[data-cmd=spell]')?.classList.toggle('on', spellOn); ribbon.querySelector('[data-cmd=marks]')?.classList.toggle('on', showMarks);
  const act = (m, box) => isTextLike(o) && (edit ? ed.isActive(m) : !!o[box]);
  for (const [c, m] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strike']]) ribbon.querySelector(`[data-cmd=${c}]`).classList.toggle('on', act(m, c));
  ribbon.querySelector('[data-cmd=superscript]').classList.toggle('on', edit && ed.isActive('superscript'));
  ribbon.querySelector('[data-cmd=subscript]').classList.toggle('on', edit && ed.isActive('subscript'));
  ribbon.querySelector('[data-cmd=bulletList]').classList.toggle('on', edit && ed.isActive('bulletList'));
  ribbon.querySelector('[data-cmd=orderedList]').classList.toggle('on', edit && ed.isActive('orderedList'));
  for (const [c, a] of [['alignLeft', 'left'], ['alignCenter', 'center'], ['alignRight', 'right'], ['alignJustify', 'justify']])
    ribbon.querySelector(`[data-cmd=${c}]`).classList.toggle('on', isTextLike(o) && (edit && ed.isActive({textAlign: a}) || (!edit || !['left', 'center', 'right', 'justify'].some(x => ed.isActive({textAlign: x}))) && o.align === a));
  if (isTextLike(o)) {
    let size = o.size * PT, color = o.color;
    if (edit) { try { const d = ed.view.domAtPos(ed.state.selection.from), el = d.node.nodeType === 1 ? d.node : d.node.parentElement; if (el && ed.view.dom.contains(el)) { const cs = getComputedStyle(el); size = parseFloat(cs.fontSize) * PT; color = cs.color; } } catch (e) { /* ignore */ } }
    if (document.activeElement !== $('#sizeIn')) $('#sizeIn').value = Math.round(size * 2) / 2;
    $('#colorBar').style.background = color;
    const fam = currentFamily(); $('#fontLabel').textContent = fam ? familyLabel(fam).replace(/ \(.*\)$/, '') : fontSet(doc.font).label;
    ribbon.querySelector('[data-cmd=upper]').classList.toggle('on', edit ? ed.getAttributes('textStyle').textTransform === 'uppercase' || !!o.upper : !!o.upper);
  }
  if (!isTextLike(o)) $('#fontLabel').textContent = 'Betűtípus';
  $('#bTpl').classList.toggle('primary', mode === 'template');
  $('#tplName').textContent = tplLabel();
  $('#bTpl').querySelector('.tpll').textContent = mode === 'template' ? 'Bezárás · Sablon:' : 'Sablon:';
  if (!edit || !ed?.isActive('table')) $('#tableBar').hidden = true;
}

/* popovers + swatches (Doksi) */
let openPop = null, openAnchor = null;
function showPop(id, anchor) {
  const p = $('#' + id);
  if (openPop === p) return closePops();
  closePops(); if (p.onopen) p.onopen();
  if (p.querySelector('.cpicker')) { refreshPickers(); p.querySelectorAll('.cpicker').forEach(b => { b._reset?.(); b._mark?.(currentColorFor(b.id)); }); }
  p.hidden = false;
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8)) + 'px';
  let top = r.bottom + 6; if (top + p.offsetHeight > innerHeight - 8) top = Math.max(8, innerHeight - p.offsetHeight - 8);
  p.style.top = top + 'px';
  openPop = p; openAnchor = anchor;
}
/* a popup that grows while open (e.g. the transition options) stays inside the window */
const popRO = new ResizeObserver(es => { for (const en of es) { const p = en.target; if (p.hidden) continue; const r = p.getBoundingClientRect(); if (r.bottom > innerHeight - 8) p.style.top = Math.max(8, innerHeight - r.height - 8) + 'px'; if (r.right > innerWidth - 8) p.style.left = Math.max(8, innerWidth - r.width - 8) + 'px'; } });
for (const p of $$('.pop')) popRO.observe(p);
function closePops() { if (openPop) { const p_ = openPop; openPop.hidden = true; openPop = null; openAnchor = null; tblCtx = null; p_.onclose?.(); } }
document.addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !(openAnchor && openAnchor.contains(e.target))) closePops(); }, true);
for (const p of $$('.pop')) p.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
/** The colour currently in effect for a picker (marked in red in the palette). */
function currentColorFor(id) {
  const o = selObj();
  const hex = c => { if (!c) return null; const m = String(c).match(/\d+(\.\d+)?/g); return c.startsWith('#') ? c : m ? '#' + m.slice(0, 3).map(v => (+v | 0).toString(16).padStart(2, '0')).join('') : c; };
  try {
    if (id === 'swText') { if (inEdit()) { const d = ed.view.domAtPos(ed.state.selection.from), el = d.node.nodeType === 1 ? d.node : d.node.parentElement; return hex(getComputedStyle(el).color); } return o?.color; }
    if (id === 'swHi') return inEdit() ? ed.getAttributes('highlight').color || 'none' : null;
    if (id === 'swFill') return o?.fill || 'none';
    if (id === 'swStroke') return o?.stroke || 'none';
    if (id === 'swCell') return ed ? (ed.getAttributes('tableCell').background || ed.getAttributes('tableHeader').background || 'none') : null;
    if (id === 'swBorder') return ed ? (ed.getAttributes('tableCell').borderColor || ed.getAttributes('tableHeader').borderColor || 'none') : null;
  } catch (e) { return null; }
  return null;
}
/* colour pickers: defaults + the colours saved in this presentation + custom colour, eyedropper */
const BASE_COLORS = ['#ffffff', '#d8d8d8', '#000000', '#da291c'];
const pickers = [];
function swatches(box, colors, onPick, noneLabel) {
  const all = [...BASE_COLORS, ...colors.filter(c => !BASE_COLORS.includes(c.toLowerCase()))];
  box.className = 'cpicker';
  box.innerHTML = `<div class="swg">${all.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`).join('')}</div>
    <div class="libwrap"><div class="ptitle">Ennek a bemutatónak a színei</div><div class="swg lib"></div></div>
    <div class="ccust"><button class="tb eyed" title="Pipetta: szín felvétele a képernyőről">${svgIcon('eyedrop')}</button>
      <label class="sw custom" title="Egyéni szín választása"><input type="color" aria-label="Egyéni szín"></label>
      <span class="chex">#000000</span><span class="sp"></span>
      <button class="btn cok" disabled>OK</button><button class="btn csave" disabled title="Hozzáadás ennek a bemutatónak a színeihez">Mentés</button></div>
    ${noneLabel ? `<button class="sw none" data-c="none">${noneLabel}</button>` : ''}`;
  const inp = box.querySelector('input[type=color]'), hex = box.querySelector('.chex'), ok = box.querySelector('.cok'), save = box.querySelector('.csave');
  // the last custom colour stays available, so "Mentés" also works after "OK" (when the picker is opened again)
  const pending = c => { inp.value = c; hex.textContent = c; hex.style.setProperty('--c', c); box._chosen = true; ok.disabled = save.disabled = false; };
  box.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { doc.colors = (doc.colors || []).filter(c => c !== del.dataset.del); commit(); refreshPickers(); e.stopPropagation(); return; }
    const b = e.target.closest('button[data-c]'); if (b) { onPick(b.dataset.c); closePops(); }
  });
  inp.addEventListener('input', () => pending(inp.value));
  inp.addEventListener('change', () => pending(inp.value));
  ok.onclick = () => { onPick(inp.value); closePops(); };
  save.onclick = () => { const c = inp.value.toLowerCase(); doc.colors = [...new Set([...(doc.colors || []), c])]; onPick(c); closePops(); commit(); };
  box.querySelector('.eyed').onclick = () => eyedrop(c => { pending(c); });
  box._reset = () => { ok.disabled = save.disabled = !box._chosen; hex.textContent = inp.value; hex.style.setProperty('--c', inp.value); };
  box._mark = cur_ => { const c = (cur_ || 'none').toLowerCase(); box.querySelectorAll('button[data-c]').forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === c)); };
  pickers.push(box);
}
/* a general colour popover (template background, text styles) */
let anyColorCb = null;
function pickAnyColor(anchor, title, current, cb) { anyColorCb = cb; $('#anyColorTitle').textContent = title; anyCur = current; showPop('popAnyColor', anchor); }
let anyCur = null;
function refreshPickers() {
  const lib = doc.colors || [];
  for (const box of pickers) {
    box.querySelector('.libwrap').hidden = !lib.length;
    box.querySelector('.lib').innerHTML = lib.map(c => `<span class="libsw"><button class="sw" data-c="${c}" style="background:${c}" title="${c}"></button><button class="del" data-del="${c}" title="Törlés a bemutató színei közül">×</button></span>`).join('');
  }
}
/** Pick a colour from the screen: the browser's eyedropper where available, otherwise from a picture of the slide. */
async function eyedrop(done) {
  if (window.EyeDropper) {
    const pop = openPop, anchor = openAnchor;
    try { const r = await new window.EyeDropper().open(); if (pop && anchor) { showPop(pop.id, anchor); } done(r.sRGBHex); } catch (e) { /* cancelled */ }
    return;
  }
  if (mode !== 'slides') { toast('A pipetta itt nem érhető el.'); return; }
  const pop = openPop, anchor = openAnchor; closePops();
  busy('Pipetta előkészítése…');
  let canvas;
  try { canvas = await slideCanvas(doc, tgt(), renderSlide, layoutOf); } catch (e) { busy(''); toast('A pipetta nem indítható.'); return; }
  busy('');
  toast('Kattints a dián a felvenni kívánt színre (Esc: mégse).');
  const veil = document.createElement('div'); veil.className = 'eyeveil'; document.body.appendChild(veil);
  const finish = c => { veil.remove(); removeEventListener('keydown', esc, true); if (pop && anchor) showPop(pop.id, anchor); if (c) done(c); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
  addEventListener('keydown', esc, true);
  veil.onclick = e => {
    const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    if (x < 0 || y < 0 || x >= W || y >= H) return finish(null);
    const k = canvas.width / W, d = canvas.getContext('2d').getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data;
    finish('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
  };
}
const TEXT_COLORS = ['#111111', '#5d6875', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f5f74', '#2e4a9e', '#7d3c98', '#ad1457'];
swatches($('#swText'), TEXT_COLORS, function textColor(c) {
  if (onEachText(() => textColor(c))) return;
  const o = selObj(); if (!isTextLike(o)) return;
  if (inEdit() && !ed.state.selection.empty) { ed.chain().focus().setColor(c).run(); return; }
  eachInline(o.doc, n => (n.marks || []).forEach(m => { if (m.type === 'textStyle' && m.attrs) m.attrs.color = null; }));
  o.color = c; styled(o); commit();
});
swatches($('#swAny'), TEXT_COLORS, c => { const cb = anyColorCb; anyColorCb = null; cb?.(c); });
$('#popAnyColor').onopen = () => $('#swAny')._mark(anyCur);
swatches($('#swHi'), ['#fff176', '#c5f0a4', '#b3ecf5', '#f8bbd0', '#ffd59e', '#e1bee7', '#e0e0e0'], c => withEditor(ch => (c === 'none' ? ch.unsetHighlight() : ch.setHighlight({color: c})).run()), 'Nincs kiemelés');
swatches($('#swCell'), ['#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#d6e4f0'], c => forCells('cells', () => ({background: c === 'none' ? null : c})), 'Nincs kitöltés');
swatches($('#swBorder'), ['#7d8590', '#111111', '#1f5f74', '#2e4a9e', '#c0392b', '#1e8449', '#b7950b'], c => forCells(borderScope === 'table' ? 'table' : 'cells', () => ({borderColor: c === 'none' ? null : c})), 'Alapértelmezett');
swatches($('#swFill'), ['#d6eaf8', '#dbe9ee', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#f6d365', '#2f5d8a', '#1f5f74', '#1e8449', '#c0392b', '#d35400'],
  c => { const o = selObj(); if (isShape(o)) { o.fill = c === 'none' ? null : c; commit(); } }, 'Nincs kitöltés');
swatches($('#swStroke'), TEXT_COLORS, c => { const o = selObj(); if (!isShape(o)) return; o.stroke = c === 'none' ? (o.shape === 'line' ? o.stroke : null) : c; if (o.stroke && !o.strokeWidth) o.strokeWidth = 3; commit(); }, 'Nincs körvonal');
function setStrokeW(v, final) {
  const o = selObj(); if (!isShape(o) || !(v > 0)) return;
  o.strokeWidth = Math.round(v * 10) / 10; if (!o.stroke) o.stroke = '#da291c';
  if (final) commit(); else updateObjLive(o);
}
$('#bwR').oninput = () => { $('#bwIn').value = $('#bwR').value; setStrokeW(+$('#bwR').value, false); };
$('#bwR').onchange = () => setStrokeW(+$('#bwR').value, true);
$('#bwIn').onchange = () => { const v = parseFloat(String($('#bwIn').value).replace(',', '.')); if (v > 0) { $('#bwR').value = v; setStrokeW(v, true); } };
$('#dashStroke').onclick = e => { const b = e.target.closest('[data-dash]'), o = selObj(); if (!b || !isShape(o)) return; o.dash = b.dataset.dash || undefined; if (!o.stroke) { o.stroke = '#2f5d8a'; o.strokeWidth ||= 3; } closePops(); commit(); };
$('#popStroke').onopen = () => {
  const o_ = selObj(); for (const b of $$('#dashStroke [data-dash]')) b.classList.toggle('on', isShape(o_) && (o_.dash || '') === b.dataset.dash); const o = selObj(); $('#bwR').value = $('#bwIn').value = isShape(o) && o.stroke ? (o.strokeWidth ?? 3) : 3; };
/* font size list, letter spacing */
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 96];
$('#sizeGrid').innerHTML = SIZES.map(v => `<button class="pitem" data-size="${v}">${v}</button>`).join('');
$('#popSize').onopen = () => { const cur_ = parseFloat($('#sizeIn').value); for (const b of $('#sizeGrid').children) b.classList.toggle('on', +b.dataset.size === cur_); };
$('#sizeGrid').onclick = e => { const b = e.target.closest('[data-size]'); if (!b) return; closePops(); $('#sizeIn').value = b.dataset.size; setSize(b.dataset.size); };
function setSpacing(v, final) {
  const o = selObj(); if (!isTextLike(o) || !isFinite(v)) return;
  v = Math.round(v * 10) / 10;
  if (inEdit() && !ed.state.selection.empty) { if (final) (v ? ed.chain().focus().setLetterSpacing(v + 'pt') : ed.chain().focus().unsetLetterSpacing()).run(); return; }
  o.letterSpacing = v || undefined;
  if (final) { styled(o); commit(); } else updateObjLive(o);
}
const spR = $('#spacingR'), spN = $('#spacingIn');
spR.oninput = () => { spN.value = spR.value; setSpacing(+spR.value, false); };
spR.onchange = () => setSpacing(+spR.value, true);
spN.onchange = () => { const v = parseFloat(String(spN.value).replace(',', '.')); if (!isFinite(v)) return; spR.value = v; setSpacing(v, true); };
$('#popSpacing').onopen = () => {
  const o = selObj(); let v = o?.letterSpacing || 0;
  if (inEdit()) { const ls = ed.getAttributes('textStyle').letterSpacing; if (ls) v = parseFloat(ls); }
  spR.value = spN.value = v;
};
// bullets, numbering, line spacing, tab stops (as in Matekos Doksi)
const BUL = ['•', '◦', '▪', '–', '➤', '➔', '✓', '★', '◆', '❖', '☐', '→'];
$('#bulGrid').innerHTML = BUL.map(b => `<button data-bul="${b}" aria-label="${b}">${b}</button>`).join('')
  + `<button data-bulimg="matekos" title="Matekos végtelen" aria-label="Matekos végtelen"><img src="${MATEKOS_BULLET}" alt="" style="height:.7em"></button>`;
/* a change of symbol / numbering on only some items starts a new list for exactly those items */
function listAround(state, typeName) {
  const {$from, $to} = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === typeName) {
      const pos = $from.before(d);
      if ($to.pos > pos + n.nodeSize) return null;
      let b = n.childCount - 1;
      const $t = state.doc.resolve(Math.min($to.pos, pos + n.nodeSize - 1));
      for (let e = $t.depth; e > 0; e--) if ($t.node(e) === n) { b = $t.index(e); break; }
      return {node: n, pos, a: $from.index(d), b};
    }
  }
  return null;
}
function applyListAttrs(typeName, attrs) {
  withEditor(() => {
    if (!ed.isActive(typeName)) ed.chain().focus()[typeName === 'bulletList' ? 'toggleBulletList' : 'toggleOrderedList']().run();
    const st = ed.state, r = listAround(st, typeName);
    if (!r) return;
    const {node, pos, a, b} = r, ordered = typeName === 'orderedList';
    const own = ordered && 'start' in attrs ? {cont: false} : {};          // a start number set here: numbering starts again
    if (a === 0 && b === node.childCount - 1) { ed.chain().focus().updateAttributes(typeName, {...attrs, ...own}).run(); return; }
    const items = []; node.forEach(c => items.push(c));
    const parts = [];
    if (a > 0) parts.push(node.type.create(node.attrs, items.slice(0, a)));
    parts.push(node.type.create({...node.attrs, ...(ordered ? {start: 1, cont: false} : {}), ...attrs}, items.slice(a, b + 1)));
    if (b < items.length - 1) parts.push(node.type.create({...node.attrs, ...(ordered ? {cont: true} : {})}, items.slice(b + 1)));
    ed.view.dispatch(st.tr.replaceWith(pos, pos + node.nodeSize, parts)); ed.view.focus();
  });
}
const setBullet = attrs => applyListAttrs('bulletList', attrs);
$('#popBullet').addEventListener('click', e => {
  if (e.target.closest('[data-bulimg]')) { closePops(); setBullet({bulletImage: MATEKOS_BULLET, bulletChar: '', bulletSize: 0.7}); return; }
  const b = e.target.closest('[data-bul]'); if (!b) return; closePops();
  if (b.dataset.bul === 'none') { withEditor(c => { if (ed.isActive('bulletList')) c.toggleBulletList(); c.run(); }); return; }
  setBullet({bulletChar: b.dataset.bul, bulletImage: ''});
});
$('#popBullet').onopen = () => { const a = inEdit() && ed.isActive('bulletList') ? ed.getAttributes('bulletList') : null;
  $('#bulPicOk').disabled = !(bulPicPending || (a && a.bulletImage)); if (a && a.bulletImage) $('#bulPicSize').value = a.bulletSize || 0.9;
  for (const b of $$('#popBullet [data-bul]')) b.classList.toggle('on', !!a && !a.bulletImage && b.dataset.bul === (a.bulletChar || '•')); };
$('#bulCustomBtn').addEventListener('click', () => { const v = $('#bulCustom').value.trim(); if (v) { closePops(); setBullet({bulletChar: v, bulletImage: ''}); } });
$('#bulCustom').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#bulCustomBtn').click(); } });
let bulPicPending = null;                 // a chosen picture, used only when OK is pressed
$('#bulPicBtn').addEventListener('click', () => pickImageURL(512, url => { bulPicPending = url; $('#bulPicPrev').innerHTML = `<img src="${url}" alt="">`; $('#bulPicOk').disabled = false; }));
$('#bulPicOk').addEventListener('click', () => {
  const a = inEdit() && ed.isActive('bulletList') ? ed.getAttributes('bulletList') : {};
  const url = bulPicPending || a.bulletImage; if (!url) return;
  closePops(); setBullet({bulletImage: url, bulletChar: '', bulletSize: +$('#bulPicSize').value || 0.9}); bulPicPending = null; $('#bulPicPrev').innerHTML = '';
});
$('#popNum').addEventListener('click', e => {
  const b = e.target.closest('[data-num]'); if (!b) return; closePops();
  if (b.dataset.num === 'none') { withEditor(c => { if (ed.isActive('orderedList')) c.toggleOrderedList(); c.run(); }); return; }
  applyListAttrs('orderedList', {numStyle: b.dataset.num});
});
$('#numStartOk').addEventListener('click', () => { const v = parseInt($('#numStart').value, 10); if (!(v >= 0)) return; closePops(); applyListAttrs('orderedList', {start: v}); });
$('#numStart').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#numStartOk').click(); } });
$('#popNum').onopen = () => { const on = inEdit() && ed.isActive('orderedList'), a = on ? ed.getAttributes('orderedList') : {};
  const st = on ? (a.numStyle || 'decimal') : null;
  for (const b of $$('#popNum [data-num]')) b.classList.toggle('on', b.dataset.num === st);
  $('#numStart').value = on ? (a.start ?? 1) : 1; };
/* line spacing: in the paragraph popup */
const LH = [1, 1.15, 1.25, 1.5, 2, 2.5];
$('#lineList').innerHTML = LH.map(v => `<button class="pitem" data-lh="${v}">${String(v).replace('.', ',')}</button>`).join('');
function lineOpen() {
  const o = selObj(); let v = o?.lineHeight || 1.25;
  if (inEdit()) { const a = ed.isActive('heading') ? ed.getAttributes('heading') : ed.getAttributes('paragraph'); if (a.lineHeight) v = +a.lineHeight; }
  else if (isTextLike(o)) { const lh = new Set(); (function w(n) { if (n.type === 'paragraph' || n.type === 'heading') lh.add(+(n.attrs?.lineHeight || o.lineHeight || 1.25)); (n.content || []).forEach(w); })(o.doc || {}); if (lh.size === 1) v = [...lh][0]; }
  for (const b of $('#lineList').children) b.classList.toggle('on', +b.dataset.lh === v);
  $('#lhIn').value = String(v).replace('.', ',');
}
$('#lhOk').onclick = () => { const v = parseFloat(String($('#lhIn').value).replace(',', '.')); if (!(v >= 0.5 && v <= 5)) return; closePops(); withEditor(c => c.setParaAttrs({lineHeight: Math.round(v * 100) / 100}).run()); };
$('#lhIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#lhOk').click(); } });
$('#lineList').addEventListener('click', e => { const b = e.target.closest('[data-lh]'); if (!b) return; closePops(); withEditor(c => c.setParaAttrs({lineHeight: +b.dataset.lh}).run()); });
/* tab stops of the selected paragraphs */
const curTabs = () => { if (!inEdit()) { const o = selObj(); let t = null; (function w(n) { if (!t && (n.type === 'paragraph' || n.type === 'heading') && n.attrs?.tabStops) t = n.attrs.tabStops; (n.content || []).forEach(w); })(o?.doc || {}); try { return t ? JSON.parse(t) : []; } catch (e) { return []; } }
  const a = ed.isActive('heading') ? ed.getAttributes('heading') : ed.getAttributes('paragraph'); try { return a.tabStops ? JSON.parse(a.tabStops) : []; } catch (e) { return []; } };
const AL = {left: 'balra', center: 'középre', right: 'jobbra'}, LD = {dot: ', pontozott', line: ', vonallal'};
function showTabs() {
  const t = curTabs();
  $('#tabList').innerHTML = t.length ? t.map((x, i) => `<div class="tabrow"><span>${String(x.pos).replace('.', ',')} cm – ${AL[x.align] || 'balra'}${LD[x.leader] || ''}</span><button class="tb mini" data-deltab="${i}" title="Tabulátor törlése">✕</button></div>`).join('')
    : '<div class="phint" style="margin:2px 0 4px">Nincs saját tabulátor.</div>';
}
function setTabs(list) { list.sort((a, b) => a.pos - b.pos); withEditor(c => c.setParaAttrs({tabStops: list.length ? JSON.stringify(list) : null}).run()); showTabs(); }
$('#tabAdd').addEventListener('click', () => { const v = parseFloat(String($('#tabPos').value).replace(',', '.')); if (!(v > 0 && v < 60)) return; setTabs([...curTabs().filter(x => x.pos !== v), {pos: v, align: $('#tabAlign').value, ...($('#tabLeader').value ? {leader: $('#tabLeader').value} : {})}]); $('#tabPos').value = ''; });
$('#tabPos').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#tabAdd').click(); } });
$('#popTabs').onopen = showTabs;
$('#tabRightMargin').addEventListener('click', () => {     // a right tab exactly at the right edge of the text
  const o = selObj(); const pm = o && stage.querySelector(`.obj[data-id="${o.id}"] .ProseMirror`); if (!pm) return;
  const v = Math.round(pm.clientWidth / (96 / 2.54) * 100) / 100;
  setTabs([...curTabs().filter(x => Math.abs(x.pos - v) > 0.01), {pos: v, align: 'right', ...($('#tabLeader').value ? {leader: $('#tabLeader').value} : {})}]);
});
$('#tabList').addEventListener('click', e => { const b = e.target.closest('[data-deltab]'); if (!b) return; const t = curTabs(); t.splice(+b.dataset.deltab, 1); setTabs(t); });
$('#popBorders').onopen = () => { const bw = ed ? (ed.getAttributes('tableCell').borderWidth ?? ed.getAttributes('tableHeader').borderWidth ?? '') : '';
  for (const b of $$('#popBorders [data-bw]')) b.classList.toggle('on', String(b.dataset.bw) === String(bw ?? '')); };
$('#popPara').onopen = () => {
  lineOpen();
  const a = ed ? (ed.isActive('heading') ? ed.getAttributes('heading') : ed.getAttributes('paragraph')) : {};
  for (const inp of $$('#popPara [data-pf]')) { const k = inp.dataset.pf; if (inp.type === 'checkbox') inp.checked = !!a[k]; else inp.value = a[k] ?? (k === 'lineHeight' ? 1.25 : 0); }
  let hang = a.hang || (a.firstLine < 0 ? -a.firstLine : 0);
  // in a list: the hanging indent is the room after the symbol (as wide as the list's widest symbol needs)
  const L = inEdit() && ed.isActive('listItem') ? listDomAtCursor() : null;
  if (L) hang = Math.round((gapCmOf(L) + (+a.hang || 0)) * 100) / 100;
  $('#pfFirstKind').value = hang ? 'hang' : a.firstLine > 0 ? 'first' : 'none';
  $('#pfFirstVal').value = hang ? String(hang) : (a.firstLine || '');
  $('#pfFirstVal').title = L ? 'A listajel utáni hely (a szöveg minden sora innen indul); legalább akkora, amekkora a lista legszélesebb jelének kell.' : '';
};
/** The innermost list around the cursor: {dom, pos, node}. */
function listDomAtCursor() {
  const {$from} = ed.state.selection;
  for (let d = $from.depth; d > 0; d--) { const n = $from.node(d); if (n.type.name === 'bulletList' || n.type.name === 'orderedList') { const pos = $from.before(d); return {dom: ed.view.nodeDOM(pos), pos, node: n}; } }
  return null;
}
const gapCmOf = L => { const v = getComputedStyle(L.dom).getPropertyValue('--gap').trim(); const n = parseFloat(v) || 0; return v.endsWith('cm') ? n : n / (96 / 2.54); };
function applyFirstLine() {
  const kind = $('#pfFirstKind').value, v = Math.max(0, parseFloat(String($('#pfFirstVal').value).replace(',', '.')) || 0);
  // in a list, a hanging indent is the list's room after the symbol (for the whole list, every line)
  if (inEdit() && ed.isActive('listItem') && kind !== 'first') {
    const L = listDomAtCursor(); if (!L) return;
    const tr = ed.state.tr.setNodeMarkup(L.pos, undefined, {...L.node.attrs, gap: kind === 'none' || !v ? null : Math.round(v * 100) / 100});
    ed.state.doc.nodesBetween(L.pos, L.pos + L.node.nodeSize, (n, pos) => { if ((n.type.name === 'paragraph' || n.type.name === 'heading') && n.attrs.hang) tr.setNodeMarkup(pos, undefined, {...n.attrs, hang: null}); });
    ed.view.dispatch(tr); setTimeout(() => $('#popPara').onopen?.(), 80); return;
  }
  withEditor(() => {
    const {state} = ed, tr = state.tr, {from, to} = state.selection;
    state.doc.nodesBetween(from, to, (n, pos) => {
      if (n.type.name !== 'paragraph' && n.type.name !== 'heading') return;
      const inList = state.doc.resolve(pos).parent.type.name === 'listItem', a = n.attrs;
      const oldHang = a.firstLine < 0 ? -a.firstLine : 0, base = Math.max(0, (a.indentLeft || 0) - oldHang) || null;
      let na;
      if (kind === 'none' || !v) na = {firstLine: null, hang: null, indentLeft: base};
      else if (kind === 'first') na = {firstLine: v, hang: null, indentLeft: base};
      else if (inList && n.type.name === 'paragraph') na = {hang: v, firstLine: null, indentLeft: base};   // list: more room after the symbol
      else na = {firstLine: -v, hang: null, indentLeft: (base || 0) + v};
      tr.setNodeMarkup(pos, undefined, {...a, ...na});
    });
    ed.view.dispatch(tr);
  });
}
$('#pfFirstKind').addEventListener('change', applyFirstLine);
$('#pfFirstVal').addEventListener('change', applyFirstLine);
$('#popPara').addEventListener('change', e => { const k = e.target.dataset.pf; if (!k) return; const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : +e.target.value); withEditor(c => c.setParaAttrs({[k]: v}).run()); });

/* animation gallery, placeholders, template builder */
$('#popPh').addEventListener('click', e => {
  const f = e.target.closest('[data-field]');
  if (f) {
    closePops(); if (mode !== 'template') return; if (editing) exitEdit();
    const isNum = f.dataset.field === 'slideNumber';
    const o = {id: uid(), name: isNum ? 'Diaszám' : 'Dátum', type: 'text', field: f.dataset.field, x: isNum ? 1100 : 900, y: 664, w: isNum ? 120 : 300, h: 30, rot: 0,
      size: 21.33, color: '#6b7785', align: 'right', doc: emptyDoc()};
    tgt().objects.push(o); setSel([o.id]); commit(); return;
  }
  const b = e.target.closest('[data-ph]'); closePops();
  if (!b || mode !== 'template' || tcur === 'master') { if (b && tcur === 'master') toast('Helykitöltő csak elrendezésre tehető (a diaszám és a dátum a mesterre is).'); return; }
  if (editing) exitEdit();
  const L = tgt(); let key = b.dataset.ph, n = 2;
  while (L.objects.some(o => o.placeholder === key)) key = b.dataset.ph + n++;
  const def = {title: [60, 40, 1160, 33, '#2f5d8a', true, TITLE_PROMPT], subtitle: [240, 380, 800, 22, '#4a5866', false, 'Alcím'], body: [60, 150, 1160, 22, '#1a1a1a', false, 'Szöveg']}[b.dataset.ph];
  const o = ph(key, def[0], def[1] + (n > 2 ? 40 : 0), def[2], def[3], def[4], def[5], 'left', def[6]);
  L.objects.push(o); setSel([o.id]); commit();
});
$('#bTpl').onclick = () => { if (cmtMode) commentsOn(false); mode === 'template' ? closeTemplateBuilder() : openTemplateBuilder(); };

