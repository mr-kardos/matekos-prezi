/* ================================================================== spell checking, eye mode, right-click menu */
/* spelling: red wavy lines on a layer over the slide, for every text box (not part of the text, never exported) */
let spellOn = lsGet('matekosprezi.spell') !== '0', spellRaf = 0, spellT = 0;
function drawSpellSoon(delay = 0) { clearTimeout(spellT); spellT = setTimeout(() => { if (!spellRaf) spellRaf = requestAnimationFrame(() => { spellRaf = 0; drawSpell(); }); }, delay); }
function drawSpell() {
  let layer = $('#spellLayer'); if (!layer) { layer = document.createElement('div'); layer.id = 'spellLayer'; stageWrap.appendChild(layer); }
  if (!spellOn || sh) { layer.innerHTML = ''; return; }
  if (!spellReady()) { loadSpell().then(() => drawSpellSoon()).catch(() => {}); layer.innerHTML = ''; return; }
  const wr = stageWrap.getBoundingClientRect(), out = [], rg = document.createRange();
  for (const pm of stage.querySelectorAll('.obj .ProseMirror')) {
    const tw = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT, {acceptNode: nd => nd.parentElement.closest('.math, .lm, .tab, a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
    for (let nd = tw.nextNode(); nd; nd = tw.nextNode()) {
      WORD.lastIndex = 0; let m;
      while ((m = WORD.exec(nd.data))) {
        if (wordOk(m[0])) continue;
        rg.setStart(nd, m.index); rg.setEnd(nd, m.index + m[0].length);
        for (const q of rg.getClientRects()) if (q.width > 0) out.push(`<div style="left:${q.left - wr.left}px;top:${q.bottom - wr.top - 3}px;width:${q.width}px"></div>`);
      }
    }
  }
  layer.innerHTML = out.join('');
}
/** The word under the pointer (in any text box): {word, node, start, end} or null. */
function wordAt(x, y) {
  const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
  const n = r && r.startContainer; if (!n || n.nodeType !== 3 || !n.parentElement.closest('#stage .ProseMirror') || n.parentElement.closest('.math, .lm')) return null;
  WORD.lastIndex = 0; let m;
  while ((m = WORD.exec(n.data))) if (r.startOffset >= m.index && r.startOffset <= m.index + m[0].length) return {word: m[0], node: n, start: m.index, end: m.index + m[0].length};
  return null;
}
let spellTarget = null;
function openSpellPopup(e, w) {
  const objEl = w.node.parentElement.closest('.obj[data-id]'); if (!objEl) return false;
  spellTarget = {word: w.word, oid: objEl.dataset.id, x: e.clientX, y: e.clientY};
  const sg = suggestions(w.word);
  $('#spellList').innerHTML = sg.length ? sg.map(s2 => `<button class="pitem" data-sug="${esc(s2)}"><b>${esc(s2)}</b></button>`).join('') : '<div class="phint">Nincs javaslat.</div>';
  $('#spellWord').textContent = `„${w.word}”`;
  closePops();
  const p = $('#popSpell'); p.hidden = false;
  p.style.left = Math.min(e.clientX, innerWidth - p.offsetWidth - 8) + 'px'; p.style.top = Math.min(e.clientY + 6, innerHeight - p.offsetHeight - 8) + 'px';
  openPop = p; openAnchor = null;
  return true;
}
$('#popSpell').addEventListener('click', e => {
  const t = spellTarget; if (!t) return;
  const sug = e.target.closest('[data-sug]');
  if (sug) {
    if (editing !== t.oid) { if (editing) exitEdit(); select(t.oid); enterEdit(t.oid); }
    const w = wordAt(t.x, t.y);
    if (w && w.word === t.word) {
      const from = ed.view.posAtDOM(w.node, w.start), to = from + w.word.length;
      const marks = ed.state.doc.resolve(from + 1).marks();
      ed.view.dispatch(ed.state.tr.replaceWith(from, to, ed.state.schema.text(sug.dataset.sug, marks)));
    }
  } else if (e.target.closest('#spellAdd')) addToDictionary(t.word);
  else if (e.target.closest('#spellIgnore')) ignoreWord(t.word);
  else return;
  closePops(); spellTarget = null; drawSpellSoon();
});

/* eye mode: formatting marks (as in Matekos Doksi), plus objects that would jump at the change of slides */
let showMarks = lsGet('matekosprezi.marks') === '1', eyeRaf = 0;
// in an edited table: the paragraph formats of the column the cursor is in
setCellFilter(td => {
  if (!editing || !ed || !ed.isActive('table')) return false;
  const {$from} = ed.state.selection;
  for (let d = $from.depth; d > 0; d--) if (/^table(Cell|Header)$/.test($from.node(d).type.name)) {
    const dom = ed.view.nodeDOM($from.before(d)); return !!dom && td.cellIndex === dom.cellIndex && td.closest('table') === dom.closest('table');
  }
  return false;
});
function drawMarksSoon() { if (eyeRaf) return; eyeRaf = requestAnimationFrame(() => { eyeRaf = 0; drawEye(); }); }
const sigOf = o => o.type + '|' + (o.placeholder || '') + '|' + (o.type === 'text' || o.type === 'table' ? JSON.stringify(o.doc) + (o.field || '')
  : o.type === 'image' || o.type === 'video' ? o.media : o.type === 'shape' ? [o.shape, o.fill, o.stroke, o.strokeWidth].join() : o.type === 'group' ? o.children.map(sigOf).join(';') : '');
/** Objects of the slide that stand on the slide before / after too – but a few pixels away (they would jump). */
function jumpers() {
  if (mode !== 'slides' || !doc.slides[cur]) return [];
  const out = [];
  for (const si of [cur - 1, cur + 1]) {
    const nb = doc.slides[si]; if (!nb) continue;
    for (const o of doc.slides[cur].objects) {
      const s1 = sigOf(o), q = nb.objects.find(x => sigOf(x) === s1); if (!q) continue;
      const d = Math.max(Math.abs(o.x - q.x), Math.abs(o.y - q.y), Math.abs(o.w - q.w), Math.abs(o.h - q.h), Math.abs((o.rot || 0) - (q.rot || 0)));
      if (d > 0.5 && d <= 12) out.push({o, q, si, d: Math.round(d * 10) / 10});
    }
  }
  return out;
}
function drawEye() {
  let layer = stage.querySelector(':scope > #marksLayer'); if (!layer) { layer = document.createElement('div'); layer.id = 'marksLayer'; stage.appendChild(layer); }
  if (!showMarks || sh) { layer.innerHTML = ''; return; }
  let html = '';
  for (const pm of stage.querySelectorAll('.obj .ProseMirror')) { const tmp = document.createElement('div'); try { drawMarks(tmp, pm, stage, scale); } catch (e) { /* skip */ } html += tmp.innerHTML; }
  for (const j of jumpers()) html += `<span class="mk-jump" style="left:${j.o.x}px;top:${j.o.y}px;width:${j.o.w}px;height:${j.o.h}px"><i>${String(j.d).replace('.', ',')} px eltérés a(z) ${j.si + 1}. diához képest – ugrani fog</i></span>`;
  layer.innerHTML = html;
}

/* the app's own right-click menu (the system / web view menu is switched off) */
let ctxActions = [];
/** The icon in front of a menu item (by its text). */
const CTX_ICONS = [[/^Kivágás/, 'cut'], [/^Beillesztés/, 'paste'], [/^Mindent/, 'selAll'], [/^TeX-kód/, 'copy'], [/másolás|^Másolás/i, 'copy'], [/kettőzés/i, 'copy'],
  [/^Megjegyzés/, 'comment'], [/^Bekezdés/, 'para'], [/^Tabulátor/, 'tabstop'], [/^Formátummásoló/, 'painter'], [/^Szint beljebb/, 'indent'], [/^Szint kijjebb/, 'outdent'],
  [/Számozás|Kezdő szám/, 'num'], [/beszúrása/, 'tblAdd'], [/^(Sor|Oszlop) törlése/, 'tblDel'], [/egyesítése/, 'merge'], [/törlése$|^Törlés/, 'trash'],
  [/^Előtérbe/, 'arrFront'], [/^Előrébb/, 'arrForward'], [/^Hátrébb/, 'arrBackward'], [/^Háttérbe/, 'arrBack'], [/^Csoportosítás/, 'group'], [/^Csoport bontása/, 'ungroup'],
  [/^Zárolás/, 'lock'], [/^Feloldás/, 'unlock'], [/^Szöveg szerkesztése/, 'textbox'], [/^Igazítás/, 'move'], [/^Szerkesztés/, 'sigma'], [/Sortörés|Egy sorban/, 'wrapL'],
  [/^Új dia/, 'plus'], [/^Sablonszerkesztő/, 'master']];
const ctxIcon = label => (CTX_ICONS.find(([re]) => re.test(label)) || [0, 'para'])[1];
function duplicateSel() {
  if (editing) exitEdit();
  const S = tgt(), objs = selIds.map(objById).filter(Boolean); if (!objs.length) return;
  const ids = [];
  for (const o of objs) {
    const c = clone(o), map = new Map(); reid(c, map);          // new ids; comments stay with the original
    moveObject(c, 20, 20); delete c.placeholder; delete c.locked;
    const g = groupOf(o.id); (g ? g.children : S.objects).push(c); if (g) fitGroup(g);
    if (mode === 'slides' && S.anims) S.anims.push(...S.anims.filter(a => map.has(a.target)).map(a => ({...clone(a), id: uid(), target: map.get(a.target)})));
    ids.push(c.id);
  }
  setSel(ids); commit();
}
async function pasteFromClipboard(plain) {
  try {
    const dt = new DataTransfer();
    if (!plain && navigator.clipboard.read) {
      for (const it of await navigator.clipboard.read()) for (const ty of it.types) {
        const bl = await it.getType(ty);
        if (ty.startsWith('image/')) dt.items.add(new File([bl], 'kep.' + ty.split('/')[1], {type: ty})); else dt.setData(ty, await bl.text());
      }
    } else dt.setData('text/plain', await navigator.clipboard.readText());
    if (plain) dt.clearData('text/html');
    document.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  } catch (e) { toast('A beillesztéshez használd a Ctrl/⌘+V-t.'); }
}
function openComment() { if (!cmtOpen()) commentsOn(true); setTimeout(() => $('#cmtText').focus(), 60); }
function ctxItems(e, t) {
  const items = [], add = (label, fn, hint = '', on = true) => items.push({label, fn, hint, on}), sep = title => items.push({sep: true, title});
  const exec = c => () => { if (editing) ed.view.focus(); document.execCommand(c); };
  const thumb = t.closest('#plist .thumb[data-i]');
  if (thumb && mode === 'slides') {
    const i = +thumb.dataset.i; if (i !== cur) gotoSlide(i);
    sep('Dia');
    add('Új dia utána…', () => $('#sNew')?.click());
    add('Dia kettőzése', () => $('#sDup')?.click());
    add('Dia másolása', exec('copy'), 'Ctrl/⌘+C');
    add('Dia törlése', () => $('#sDel')?.click(), '', doc.slides.length > 1);
    add('Megjegyzés a diához', () => { setSel([]); openComment(); });
    return items;
  }
  if (!t.closest('#stage, #stageWrap, #work')) return items;
  const inEditor = editing && ed && ed.view.dom.contains(t);
  if (inEditor) {
    const mathEl = t.closest('.math');
    if (mathEl) {
      let p = null; try { p = ed.view.posAtDOM(mathEl, 0); } catch (err) { /* none */ }
      const n = p != null ? ed.state.doc.nodeAt(p) : null;
      if (n && n.type.name === 'math') {
        sep('Képlet');
        add('Szerkesztés…', () => openMath(p, n), 'dupla kattintás');
        add('TeX-kód másolása', () => navigator.clipboard.writeText(n.attrs.tex).then(() => toast('TeX-kód a vágólapon')));
        add(n.attrs.wrap ? 'Egy sorban maradjon' : 'Sortörés a doboz szélén', () => ed.view.dispatch(ed.state.tr.setNodeMarkup(p, undefined, {...n.attrs, wrap: !n.attrs.wrap})));
        add('Képlet törlése', () => ed.view.dispatch(ed.state.tr.delete(p, p + n.nodeSize)));
        return items;
      }
    }
    const hasSel = !ed.state.selection.empty;
    add('Kivágás', exec('cut'), 'Ctrl/⌘+X', hasSel);
    add('Másolás', exec('copy'), 'Ctrl/⌘+C', hasSel);
    add('Beillesztés', () => { ed.view.focus(); pasteFromClipboard(false); }, 'Ctrl/⌘+V');
    add('Beillesztés formázás nélkül', () => { ed.view.focus(); pasteFromClipboard(true); });
    add('Mindent kijelöl', () => { ed.view.focus(); ed.commands.selectAll(); }, 'Ctrl/⌘+A');
    sep();
    add('Megjegyzés hozzáadása', openComment, '', hasSel);
    add('Bekezdés beállításai…', () => showPop('popPara', $('[data-pop="popPara"]')));
    add('Tabulátorok…', () => showPop('popTabs', $('[data-pop="popTabs"]')));
    add('Formátummásoló', () => COMMANDS.painter());
    if (ed.isActive('listItem')) {
      sep('Lista');
      add('Szint beljebb', () => changeListLevel(ed.view, 1), 'Tab');
      add('Szint kijjebb', () => changeListLevel(ed.view, -1), 'Shift+Tab');
      if (ed.isActive('orderedList')) { add('Számozás újrakezdése', () => applyListAttrs('orderedList', {start: 1})); add('Kezdő szám…', () => showPop('popNum', $('[data-pop="popNum"]'))); }
    }
    if (ed.isActive('table')) {
      const tc = c => () => ed.chain().focus()[c]().run();
      sep('Táblázat');
      add('Sor beszúrása fölé', tc('addRowBefore')); add('Sor beszúrása alá', tc('addRowAfter'));
      add('Oszlop beszúrása balra', tc('addColumnBefore')); add('Oszlop beszúrása jobbra', tc('addColumnAfter'));
      add('Sor törlése', tc('deleteRow')); add('Oszlop törlése', tc('deleteColumn'));
      add('Cellák egyesítése / felosztása', tc('mergeOrSplit'));
    }
    return items;
  }
  const objEl = t.closest('.obj[data-id]');
  if (objEl && !t.closest('.self')) { const id = objEl.closest('#stage > .obj[data-id]')?.dataset.id || objEl.dataset.id; if (!selIds.includes(id) && objById(id) && !objById(id).locked) { select(id); } }
  const o = selObj();
  if (selIds.length && (objEl || t.closest('.self'))) {
    add('Kivágás', exec('cut'), 'Ctrl/⌘+X'); add('Másolás', exec('copy'), 'Ctrl/⌘+C');
    add('Beillesztés', () => pasteFromClipboard(false), 'Ctrl/⌘+V');
    add('Kettőzés', duplicateSel, 'Ctrl/⌘+D', !!o); add('Törlés', () => deleteSelected(), 'Delete');
    if (o && tgt().objects.includes(o)) {
      sep('Elrendezés');
      add('Előtérbe', () => reorder((i, n) => n - 1)); add('Előrébb', () => reorder((i, n) => Math.min(n - 1, i + 1)));
      add('Hátrébb', () => reorder(i => Math.max(0, i - 1))); add('Háttérbe', () => reorder(() => 0));
    }
    if (selIds.length > 1) add('Csoportosítás', groupSelected, 'Ctrl/⌘+G');
    if (o?.type === 'group') add('Csoport bontása', ungroupSelected, 'Ctrl/⌘+Shift+G');
    if (o) add(o.locked ? 'Feloldás' : 'Zárolás', () => toggleLock(o.id));
    sep();
    add('Megjegyzés hozzáadása', openComment);
    if (o && isTextLike(o) && !o.locked) add('Szöveg szerkesztése', () => enterEdit(o.id), 'Enter');
    for (const j of jumpers().filter(j => j.o.id === o?.id)) add(`Igazítás a(z) ${j.si + 1}. dián lévőhöz`, () => { Object.assign(o, {x: j.q.x, y: j.q.y, w: j.q.w, h: j.q.h, rot: j.q.rot}); commit(); }, `${String(j.d).replace('.', ',')} px`);
    return items;
  }
  add('Beillesztés', () => pasteFromClipboard(false), 'Ctrl/⌘+V');
  add('Mindent kijelöl', () => { setSel(tgt().objects.filter(q => !q.locked).map(q => q.id)); drawSelection(); renderProps(); updateRibbon(); }, 'Ctrl/⌘+A');
  sep();
  add(mode === 'slides' ? 'Megjegyzés a diához' : 'Megjegyzés ehhez az elrendezéshez', () => { setSel([]); renderAll(); openComment(); });
  if (mode === 'slides') { add('Új dia utána…', () => $('#sNew')?.click()); add('Sablonszerkesztő', () => openTemplateBuilder()); }
  return items;
}
document.addEventListener('contextmenu', e => {
  const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  if (t && t.closest('input, textarea, select')) return;                    // text fields keep the system's copy / paste menu
  e.preventDefault();                                                       // never the web view's own menu
  if (!t || sh) return;
  if (spellOn && spellReady()) { const w = wordAt(e.clientX, e.clientY); if (w && !wordOk(w.word) && openSpellPopup(e, w)) return; }
  // a right-click in the edited text outside the selection moves the cursor there first
  if (editing && ed && ed.view.dom.contains(t) && !t.closest('.math')) {
    const hit = ed.view.posAtCoords({left: e.clientX, top: e.clientY}), s0 = ed.state.selection;
    if (hit && (s0.empty || hit.pos < s0.from || hit.pos > s0.to)) ed.commands.setTextSelection(hit.pos);
  }
  const items = ctxItems(e, t); if (!items.length) return;
  ctxActions = items;
  const m = $('#ctxMenu');
  m.innerHTML = items.map((it, i) => it.sep ? (it.title ? `<div class="psep"></div><div class="ctitle">${it.title}</div>` : '<div class="psep"></div>') : `<button class="pitem" data-ci="${i}"${it.on ? '' : ' disabled'}><span class="cico">${svgIcon(ctxIcon(it.label))}</span><span class="clbl">${it.label}</span><span class="phint">${it.hint || ''}</span></button>`).join('').replace(/^<div class="psep"><\/div>/, '');
  closePops(); m.hidden = false;
  m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 6) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 6) + 'px';
  openPop = m; openAnchor = null;
}, true);
$('#ctxMenu').addEventListener('mousedown', e => e.preventDefault());
$('#ctxMenu').addEventListener('click', e => { const b = e.target.closest('[data-ci]'); if (!b) return; const it = ctxActions[+b.dataset.ci]; closePops(); it?.fn?.(); });

/* "a new version is out": checked once at start-up (see src/updates.js and update.json) */
async function runUpdateCheck(url) {
  const u = await checkForUpdate(url); if (!u) return false;
  $('#updVer').textContent = u.version + ` (most: ${APP_VERSION})`;
  $('#updMsg').innerHTML = esc(u.message || '').replace(/\n/g, '<br>');
  $('#updBox').hidden = false;
  $('#updLater').onclick = () => { $('#updBox').hidden = true; };
  $('#updGo').onclick = () => { $('#updBox').hidden = true; if (u.url) openLink(u.url); };
  return true;
}
setTimeout(() => runUpdateCheck(), 2500);
