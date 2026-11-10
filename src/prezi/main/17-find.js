/* ================================================================== find & replace */
let findPos = -1;
function findRegex() { const q = $('#findIn').value; if (!q) return null; return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $('#findCase').checked ? 'g' : 'gi'); }
/** All matches in the presentation: [{si, id, n (match index inside the object)}] */
function findAll() {
  const re = findRegex(), out = []; if (!re) return out;
  doc.slides.forEach((sl, si) => { for (const o of flatObjects(sl.objects)) if (isTextLike(o) && !o.field) {
    // text matches: n = index among the box's text matches; formulas: mk = index among the box's formulas (their TeX code is searched)
    let n = 0, k = 0; (function walk(x) {
      if (x.type === 'text') for (const _ of x.text.matchAll(re)) out.push({si, id: o.id, n: n++});
      else if (x.type === 'math') { if (String(x.attrs?.tex ?? '').search(re) >= 0) out.push({si, id: o.id, mk: k}); k++; }
      (x.content || []).forEach(walk); })(o.doc || {}); } });
  return out;
}
const mathTexs = json => { const out = []; (function walk(x) { if (x.type === 'math') out.push(String(x.attrs?.tex ?? '')); (x.content || []).forEach(walk); })(json || {}); return out; };
function findNext() {
  if (editing) syncEditor();
  const all = findAll(); if (!all.length) { $('#findInfo').textContent = 'Nincs találat.'; return; }
  findPos = (findPos + 1) % all.length; const m = all[findPos];
  $('#findInfo').textContent = `${findPos + 1}. találat / ${all.length}`;
  if (mode !== 'slides') return;
  if (cur !== m.si) { if (editing) exitEdit(); gotoSlide(m.si); }
  if (editing !== m.id) { if (editing) exitEdit(); select(m.id); enterEdit(m.id); }
  if (m.mk != null) {                                           // inside a formula: shown, never replaced
    let k = 0, at = null;
    ed.state.doc.descendants((node, pos) => { if (at == null && node.type.name === 'math' && k++ === m.mk) at = pos; });
    if (at != null) { ed.commands.setNodeSelection(at); ed.commands.scrollIntoView(); }
    $('#findInfo').textContent += ' – képletben (a csere a képleteket nem módosítja)';
    drawFind(); return;
  }
  const re = findRegex(); let n = 0, hit = null;
  ed.state.doc.descendants((node, pos) => { if (hit || !node.isText) return; for (const x of node.text.matchAll(re)) { if (n++ === m.n) { hit = {from: pos + x.index, to: pos + x.index + x[0].length}; break; } } });
  if (hit) { ed.commands.setTextSelection(hit); ed.commands.scrollIntoView(); }
  drawFind();
}
function replaceOne() {
  const re = findRegex(); if (!re || !editing || !ed || ed.state.selection instanceof NodeSelection) { findNext(); return; }
  const {from, to} = ed.state.selection, txt = ed.state.doc.textBetween(from, to);
  if (from !== to && new RegExp('^(?:' + re.source + ')$', re.flags.replace('g', '')).test(txt)) { ed.chain().focus().insertContentAt({from, to}, $('#replIn').value).run(); syncEditor(); findPos--; }
  findNext();
}
function replaceAll() {
  const re = findRegex(); if (!re) return; if (editing) exitEdit();
  let count = 0; const rep = $('#replIn').value, inMath = findAll().filter(m => m.mk != null).length;
  const fix = list => { for (const o of flatObjects(list)) if (isTextLike(o) && !o.field && o.doc) (function walk(x) {
    if (x.type === 'text') { const t = x.text.replace(re, () => { count++; return rep; }); if (t !== x.text) x.text = t; } (x.content || []).forEach(walk);
    if (x.content) x.content = x.content.filter(c => c.type !== 'text' || c.text); })(o.doc); };
  for (const sl of doc.slides) fix(sl.objects);
  $('#findInfo').textContent = (count ? `${count} csere történt.` : inMath ? 'A szövegben nincs találat.' : 'Nincs találat.') + (inMath ? ` ${inMath} képlet változatlan maradt (bennük csak keresni lehet).` : ''); findPos = -1;
  if (count) commit();
}
/** Find: every match on the slide highlighted, the current one stronger (as in Matekos Doksi). */
let findRaf = 0;
function drawFind() {
  if (findRaf) return;
  findRaf = requestAnimationFrame(() => {
    findRaf = 0;
    let layer = $('#findLayer'); if (!layer) { layer = document.createElement('div'); layer.id = 'findLayer'; stageWrap.appendChild(layer); }
    const re = !$('#popFind').hidden && findRegex();
    if (!re || sh) { layer.innerHTML = ''; return; }
    const wr = stageWrap.getBoundingClientRect(), all = findAll(), curM = findPos >= 0 ? all[findPos] : null, out = [];
    for (const el of stage.querySelectorAll('.obj[data-id]')) {
      const pm = el.querySelector('.ProseMirror'); if (!pm || el.querySelector('.obj[data-id]')) continue;
      let n = 0;
      const tw = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT, {acceptNode: nd => nd.parentElement.closest('.math, .lm') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
      for (let nd = tw.nextNode(); nd; nd = tw.nextNode()) {
        for (const m of nd.data.matchAll(re)) {
          if (!m[0]) continue;
          const r = document.createRange(); r.setStart(nd, m.index); r.setEnd(nd, m.index + m[0].length);
          const cur_ = curM && curM.id === el.dataset.id && curM.si === (mode === 'slides' ? cur : -1) && curM.n === n;
          for (const q of r.getClientRects()) if (q.width) out.push(`<div class="find-hit${cur_ ? ' cur' : ''}" style="left:${q.left - wr.left}px;top:${q.top - wr.top}px;width:${q.width}px;height:${q.height}px"></div>`);
          n++;
        }
      }
      // formulas whose TeX code matches: the whole formula is marked
      const fs = [...pm.querySelectorAll('.math')], texs = mathTexs(editing === el.dataset.id && ed ? ed.getJSON() : objById(el.dataset.id)?.doc);
      if (fs.length === texs.length) fs.forEach((f, k) => {
        if (texs[k].search(re) < 0) return;
        const cur_ = curM && curM.id === el.dataset.id && curM.si === (mode === 'slides' ? cur : -1) && curM.mk === k;
        for (const q of f.getClientRects()) if (q.width) out.push(`<div class="find-hit${cur_ ? ' cur' : ''}" style="left:${q.left - wr.left}px;top:${q.top - wr.top}px;width:${q.width}px;height:${q.height}px"></div>`);
      });
    }
    layer.innerHTML = out.join('');
  });
}
$('#findNext').onclick = findNext; $('#findRepl').onclick = replaceOne; $('#findAll').onclick = replaceAll;
$('#findIn').addEventListener('input', () => { findPos = -1; const n = findAll().length; $('#findInfo').textContent = $('#findIn').value ? `${n} találat` : ''; drawFind(); });
$('#findCase').addEventListener('change', () => $('#findIn').dispatchEvent(new Event('input')));
$('#popFind').onclose = () => { findPos = -1; drawFind(); };
$('#findIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } });
$('#replIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });

