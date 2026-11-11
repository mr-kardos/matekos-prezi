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
function inCursorColumn(td) {
  if (!editing || !ed || !ed.isActive('table')) return false;
  const {$from} = ed.state.selection;
  for (let d = $from.depth; d > 0; d--) if (/^table(Cell|Header)$/.test($from.node(d).type.name)) {
    const dom = ed.view.nodeDOM($from.before(d)); return !!dom && td.cellIndex === dom.cellIndex && td.closest('table') === dom.closest('table');
  }
  return false;
}
setCellFilter(inCursorColumn);
function drawMarksSoon() { if (eyeRaf) return; eyeRaf = requestAnimationFrame(() => { eyeRaf = 0; drawEye(); }); }
const sigOf = o => o.type + '|' + (o.placeholder || '') + '|' + (o.type === 'text' || o.type === 'table' ? JSON.stringify(o.doc) + (o.field || '')
  : o.type === 'image' || o.type === 'video' ? o.media : o.type === 'shape' ? [o.shape, o.fill, o.stroke, o.strokeWidth].join() : o.type === 'group' ? o.children.map(sigOf).join(';') : '');
const FMT_NAMES = {size: 'betűméret', color: 'szín', bold: 'félkövér', italic: 'dőlt', underline: 'aláhúzás', strike: 'áthúzás', align: 'igazítás', letterSpacing: 'betűköz', upper: 'nagybetűs', font: 'betűtípus'};
/** What the eye mode reports on slide i compared with the slides before / after it:
 *    kind 'pos' – the same object stands a few pixels away there (it would jump at the change of slides); also a
 *                 placeholder of the same layout that was nudged, and the members of a group;
 *    kind 'fmt' – the same text at the same place, but with a different look (size, colour, font, …).
 *  Each entry: {o, q (the object on the other slide), si, kind, d | keys, ox, oy, qx, qy (origins: the groups), ph}. */
function slideIssues(i, sigs = new Map()) {
  const s = doc.slides[i]; if (mode !== 'slides' || !s) return [];
  const sg = o => { let v = sigs.get(o); if (v === undefined) sigs.set(o, v = sigOf(o)); return v; };
  const out = [], seen = new Set();
  const add = it => { const k = it.o.id + it.kind; if (!seen.has(k)) { seen.add(k); out.push(it); } };
  const cmp = (o, q, si, ox, oy, qx, qy, ph) => {
    const d = Math.max(Math.abs((o.x - ox) - (q.x - qx)), Math.abs((o.y - oy) - (q.y - qy)), Math.abs(o.w - q.w), ph ? 0 : Math.abs(o.h - q.h), Math.abs((o.rot || 0) - (q.rot || 0)));
    if (d > 0.5 && d <= 12) add({o, q, si, kind: 'pos', d: Math.round(d * 10) / 10, ox, oy, qx, qy, ph});
    else if (d <= 0.5 && !ph && isTextLike(o)) { const keys = TEXT_KEYS.filter(k => (o[k] ?? null) !== (q[k] ?? null)); if (keys.length) add({o, q, si, kind: 'fmt', keys}); }
    if (o.type === 'group' && q.type === 'group' && o.children.length === q.children.length) o.children.forEach((c, k) => cmp(c, q.children[k], si, o.x, o.y, q.x, q.y, false));
  };
  for (const si of [i - 1, i + 1]) {
    const nb = doc.slides[si]; if (!nb) continue;
    for (const o of s.objects) {
      if (o.hidden) continue;
      let q = nb.objects.find(x => sg(x) === sg(o)), ph = false;
      // a placeholder with other text on the neighbouring slide: its place is still expected to be the same
      if (!q && o.placeholder && s.template === nb.template) { q = nb.objects.find(x => x.placeholder === o.placeholder && x.type === o.type); ph = !!q; }
      if (q) cmp(o, q, si, 0, 0, 0, 0, ph);
    }
  }
  return out;
}
/** The sides on which the text of a drawn text box leaves its slide ('' = none). slideEl: the drawn slide. */
function textOff(objEl_, slideEl) {
  const pm = objEl_.querySelector('.ProseMirror'); if (!pm) return '';
  const sr = slideEl.getBoundingClientRect(); if (!sr.width) return '';
  const tol = 1.5 * sr.width / W; let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
  const take = q => { if (!q.width || !q.height) return; L = Math.min(L, q.left); T = Math.min(T, q.top); R = Math.max(R, q.right); B = Math.max(B, q.bottom); };
  const tw = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT), rg = document.createRange();
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.data.trim() || n.parentElement.closest('.math, .lm')) continue; rg.selectNodeContents(n); for (const q of rg.getClientRects()) take(q); }
  for (const e of pm.querySelectorAll('.math svg, img')) take(e.getBoundingClientRect());
  if (L === Infinity) return '';
  return [L < sr.left - tol && 'bal oldalon', R > sr.right + tol && 'jobb oldalon', T < sr.top - tol && 'felül', B > sr.bottom + tol && 'alul'].filter(Boolean).join(', ');
}
/** Text boxes of a drawn slide whose text leaves the slide: [{o, sides}]. */
function overflowing(s, slideEl) {
  const out = [];
  for (const o of flatObjects(s.objects)) {
    if (!isTextLike(o) || o.hidden) continue;
    const el = slideEl.querySelector(`.obj[data-id="${o.id}"]`); if (!el) continue;
    const sides = textOff(el, slideEl); if (sides) out.push({o, sides});
  }
  return out;
}
/** Green labels at the right edge of every selected text box, paragraph by paragraph: space before / after that is
 *  not 0 (whatever sets it), and a line spacing that differs from the template's (the style the box follows).
 *  In a table that is being edited: the paragraphs of the column the cursor is in, inside their cells. */
function spacingLabels() {
  const objs = flatObjects([...new Set([...selIds, ...(editing ? [editing] : [])])].map(objById).filter(Boolean)).filter(o => isTextLike(o) && !o.hidden);
  if (!objs.length) return '';
  const sr = stage.getBoundingClientRect(), X = v => (v - sr.left) / scale, Y = v => (v - sr.top) / scale;
  const num = v => String(Math.round(v * 10) / 10).replace('.', ',');
  let html = '';
  for (const o of objs) {
    const el = stage.querySelector(`.obj[data-id="${o.id}"]`), pm = el?.querySelector('.ProseMirror'); if (!pm) continue;
    const right = X(el.getBoundingClientRect().right), inside = right > W - 110;      // no room beside the slide's edge: inside the box
    const tplLine = +(stylesOf()[roleOf(o) || 'body']?.line) || 1.25;
    for (const b of pm.querySelectorAll('p, h1, h2, h3')) {
      const cell = b.closest('td, th');
      if (cell && !inCursorColumn(cell)) continue;               // in a table: only the column the cursor is in
      const cs = getComputedStyle(b), before = (parseFloat(cs.paddingTop) || 0) * PT, after = (parseFloat(cs.paddingBottom) || 0) * PT;
      const line = +b.getAttribute('data-lh') || +o.lineHeight || 1.25, notes = [];
      if (Math.abs(before) > 0.05) notes.push(`előtte ${num(before)} pt`);
      if (Math.abs(after) > 0.05) notes.push(`utána ${num(after)} pt`);
      if (Math.abs(line - tplLine) > 0.001) notes.push(`sorköz ${String(Math.round(line * 100) / 100).replace('.', ',')}`);
      if (!notes.length) continue;
      const br = b.getBoundingClientRect(), y = Math.abs(after) > 0.05 ? Y(br.bottom) - 14 : Y(br.top) + 1;
      const cr = cell ? X(cell.getBoundingClientRect().right) : 0;                       // a cell's labels stand inside the cell, at its right edge
      html += `<span class="mk-dev${cell || inside ? ' in' : ''}" style="left:${cell ? cr - 3 : inside ? right - 3 : right + 6}px;top:${Math.max(Y(br.top) + 1, y)}px">${notes.join(' · ')}</span>`;
    }
  }
  return html;
}
let eyeIssues = [];
function drawEye() {
  let layer = stage.querySelector(':scope > #marksLayer'); if (!layer) { layer = document.createElement('div'); layer.id = 'marksLayer'; stage.appendChild(layer); }
  eyeIssues = [];
  if (!showMarks || sh) { layer.innerHTML = ''; return; }
  let html = '';
  for (const pm of stage.querySelectorAll('.obj .ProseMirror')) { const tmp = document.createElement('div'); try { drawMarks(tmp, pm, stage, scale); } catch (e) { /* skip */ } html += tmp.innerHTML; }
  const box = o => { const b = bounds(o); return `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`; };
  eyeIssues = slideIssues(cur);
  eyeIssues.forEach((j, k) => {
    const txt = j.kind === 'pos' ? `${String(j.d).replace('.', ',')} px eltérés a(z) ${j.si + 1}. diához képest – ugrani fog` : `Más a formázása, mint a(z) ${j.si + 1}. dián (${j.keys.map(x => FMT_NAMES[x] || x).join(', ')})`;
    html += `<span class="mk-jump${j.kind === 'fmt' ? ' mk-fmt' : ''}" style="${box(j.o)}"><i data-fix="${k}" title="Kattints: ${j.kind === 'pos' ? 'az objektum pontosan oda kerül, ahol a másik dián áll' : 'a formázása olyan lesz, mint a másik dián'}">${txt} · javítás</i></span>`;
  });
  html += spacingLabels();
  if (mode === 'slides' && doc.slides[cur]) for (const v of overflowing(doc.slides[cur], stage)) html += `<span class="mk-over" style="${box(v.o)}"><i>A szöveg lelóg a diáról (${v.sides})</i></span>`;
  layer.innerHTML = html;
}
/** A click on a mark's "javítás": the object takes the place / the look it has on the neighbouring slide. */
function fixIssue(k) {
  const j = eyeIssues[k]; if (!j) return;
  if (editing) exitEdit();
  const {o, q} = j;
  if (j.kind === 'fmt') { for (const key of j.keys) { if (q[key] == null) delete o[key]; else o[key] = q[key]; } styled(o); }
  else {
    moveObject(o, (q.x - j.qx) - (o.x - j.ox), (q.y - j.qy) - (o.y - j.oy));
    if (o.type !== 'group') { o.w = q.w; if (!j.ph && !isText(o)) o.h = q.h; if (q.rot) o.rot = q.rot; else delete o.rot; }
    const g = groupOf(o.id); if (g) fitGroup(g);
  }
  commit(); toast(j.kind === 'fmt' ? 'A formázás egységes lett.' : 'Az objektum a helyére került.');
}
addEventListener('pointerdown', e => {
  const b = e.target instanceof Element && e.target.closest('#marksLayer [data-fix]'); if (!b) return;
  e.preventDefault(); e.stopPropagation(); fixIssue(+b.dataset.fix);
}, true);
/* the same reports as a number on the slide thumbnails (while the eye mode is on) */
let eyeThumbT = 0;
function eyeThumbsSoon() { clearTimeout(eyeThumbT); eyeThumbT = setTimeout(eyeThumbs, 300); }
function eyeThumbs() {
  for (const m of $$('#plist .eyemark')) m.remove();
  if (!showMarks || mode !== 'slides') return;
  const sigs = new Map();
  for (const t of $$('#plist .thumb[data-i]')) {
    const i = +t.dataset.i, s = doc.slides[i], sl = t.querySelector('.slide'); if (!s || !sl) continue;
    const js = slideIssues(i, sigs), ov = overflowing(s, sl), n = js.length + ov.length; if (!n) continue;
    const what = [js.some(j => j.kind === 'pos') && 'ugró objektum', js.some(j => j.kind === 'fmt') && 'eltérő formázás', ov.length && 'a diáról lelógó szöveg'].filter(Boolean).join(', ');
    t.querySelector('.frame').insertAdjacentHTML('beforeend', `<span class="eyemark" title="${n} jelzés: ${what}">${svgIcon('eye')}${n}</span>`);
  }
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
    for (const j of slideIssues(cur).filter(j => j.o.id === o?.id)) add(j.kind === 'pos' ? `Igazítás a(z) ${j.si + 1}. dián lévőhöz` : `Formázás, mint a(z) ${j.si + 1}. dián`, () => { eyeIssues = [j]; fixIssue(0); }, j.kind === 'pos' ? `${String(j.d).replace('.', ',')} px` : '');
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
