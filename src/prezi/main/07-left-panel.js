/* ================================================================== left panel */
const slidesNav = $('#slides'), mainEl = $('#main');
function setLeftWidth(w) {
  w = Math.max(130, Math.min(420, Math.round(w)));
  mainEl.style.setProperty('--lw', w + 'px'); document.body.style.setProperty('--lw', w + 'px');
  mainEl.style.setProperty('--tk', ((w - 64) / W).toFixed(4));
  return w;
}
setLeftWidth(+lsGet(LS.left) || 176);
$('#lsplit').addEventListener('pointerdown', e => {
  e.preventDefault(); const sp = e.currentTarget; sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
  const x0 = e.clientX, w0 = slidesNav.getBoundingClientRect().width;
  const mv = ev => { setLeftWidth(w0 + ev.clientX - x0); fitStage(); };
  const up = ev => { sp.releasePointerCapture(ev.pointerId); sp.classList.remove('drag'); sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up);
    lsSet(LS.left, String(setLeftWidth(w0 + ev.clientX - x0))); fitStage(); };
  sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
});
function setRightWidth(w) {
  w = Math.max(240, Math.min(560, Math.round(w)));
  mainEl.style.setProperty('--rw', w + 'px'); document.body.style.setProperty('--rw', w + 'px');
  return w;
}
setRightWidth(+lsGet(LS.right) || 300);
$('#rsplit').addEventListener('pointerdown', e => {
  e.preventDefault(); const sp = e.currentTarget; sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
  const x0 = e.clientX, w0 = $('#props').getBoundingClientRect().width;
  const mv = ev => { setRightWidth(w0 - (ev.clientX - x0)); fitStage(); };
  const up = ev => { sp.releasePointerCapture(ev.pointerId); sp.classList.remove('drag'); sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up);
    lsSet(LS.right, String(setRightWidth(w0 - (ev.clientX - x0)))); fitStage(); };
  sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
});
// buttons under the slides must not take the focus (an input losing it would re-render the list and swallow the click)
slidesNav.addEventListener('mousedown', e => { if (e.target.closest('.slide-actions button')) e.preventDefault(); });
function thumbFrame(label, cls) {
  const t = document.createElement('div'); t.className = 'thumb ' + (cls || '');
  t.innerHTML = `<div class="no">${label}</div><div class="frame"><div class="slide"></div></div>`;
  return t;
}
function renderThumbs() {
  const st = slidesNav.querySelector('.plist')?.scrollTop ?? 0, same = renderThumbs.mode === mode;
  mode === 'slides' ? renderSlideList() : renderTemplateList();
  const pl = slidesNav.querySelector('.plist'); if (pl && same) pl.scrollTop = st;
  renderThumbs.mode = mode;
}
let thumbCache = new Map();          // slide id -> {sig, el}: thumbnails that are still up to date
function renderSlideList() {
  slidesNav.innerHTML = `<div class="phead2 lhead"><b>Diák</b><button class="tb" id="slidesX" title="Bal oldali panel bezárása">${svgIcon('panelL')}</button></div><div class="plist" id="plist"></div>`;
  $('#slidesX').onclick = () => slidesVisible(false);
  const list = $('#plist');
  const cmtN = cmtHidden && !cmtOpen() ? {} : openCommentsBySlide();
  const tplSig = {}, used = new Set(), keep = new Map();
  doc.slides.forEach((s, i) => {
    const t = thumbFrame(i + 1, i === cur ? 'cur' : ''); t.draggable = true; t.dataset.i = i;
    // a slide whose content, layout and number are unchanged keeps its drawn thumbnail
    const sig = i + '|' + (tplSig[s.template] ??= JSON.stringify([doc.master, doc.templates[s.template], doc.font, doc.styles])) + '|' + JSON.stringify(s);
    const old = thumbCache.get(s.id);
    if (old && old.sig === sig && !used.has(old.el)) { t.querySelector('.slide').replaceWith(old.el); used.add(old.el); keep.set(s.id, old); }
    else { const sl = t.querySelector('.slide'); renderSlide(s, sl, 'thumb'); used.add(sl); if (s.id) keep.set(s.id, {sig, el: sl}); }
    if (s.transition) t.querySelector('.no').insertAdjacentHTML('beforeend', `<span class="trmark" title="Diaváltás: ${esc(TRANSITIONS[s.transition.type]?.label ?? '')}">★</span>`);
    if (cmtN[i]) t.querySelector('.frame').insertAdjacentHTML('beforeend', `<span class="cmtmark" title="${cmtN[i]} nyitott megjegyzés ezen a dián – kattints a megnyitásához">${svgIcon('comment')}${cmtN[i]}</span>`);
    t.onclick = e => {
      if (e.target.closest('.cmtmark')) {                     // straight to the slide's first open comment
        if (cur !== i) gotoSlide(i);
        if (!cmtOpen()) commentsOn(true);
        const at = commentPlaces(), c = orderedComments(at).find(x => !x.done && at[x.id]?.si === i);
        if (c) { showCommentPlace(c.id); renderComments(); focusCard(c.id); }
        return;
      }
      gotoSlide(i); slideFocus = true;
    };
    t.ondragstart = e => e.dataTransfer.setData('text/slide', WIN + ':' + i);
    t.ondragover = e => { e.preventDefault(); const r = t.getBoundingClientRect(), below = e.clientY > r.top + r.height / 2;
      list.querySelectorAll('.thumb.above, .thumb.below').forEach(x => x !== t && x.classList.remove('above', 'below'));
      t.classList.toggle('above', !below); t.classList.toggle('below', below); };
    t.ondragleave = () => t.classList.remove('above', 'below');
    t.ondragend = () => list.querySelectorAll('.thumb.above, .thumb.below').forEach(x => x.classList.remove('above', 'below'));
    t.ondrop = e => {
      const from = e.dataTransfer.getData('text/slide'), below = t.classList.contains('below'); t.classList.remove('above', 'below');
      if (!from.startsWith(WIN + ':')) return; e.preventDefault(); e.stopPropagation();
      const f = +from.split(':')[1]; let to = i + (below ? 1 : 0); if (f < to) to--; moveSlide(f, to);
    };
    list.appendChild(t);
    if (i === cur) {
      const a = document.createElement('div'); a.className = 'slide-actions';
      a.innerHTML = `<button class="tb" id="sNew" title="Új dia az aktuális után – elrendezés választása">${svgIcon('plus')}</button>
        <button class="tb" id="sDup" title="Az aktuális dia másolása">${svgIcon('copy')}</button>
        <button class="tb" id="sDel" title="Az aktuális dia törlése" ${doc.slides.length < 2 ? 'disabled' : ''}>${svgIcon('trash')}</button>
        <button class="tb${s.transition ? ' on' : ''}" id="sTrans" title="Diaváltás (áttűnés) erre a diára">${svgIcon('trans')}${svgIcon('chev')}</button>`;
      list.appendChild(a);
    }
  });
  thumbCache = keep;
  if (showMarks) eyeThumbsSoon();
  $('#sNew').onclick = e => showPop('popNewSlide', e.currentTarget);
  $('#sTrans').onclick = e => showPop('popTrans', e.currentTarget);
  $('#sDup').onclick = () => { if (editing) exitEdit(); const s = clone(tgt()); const ids = {};
    delete s.cmt; for (const o of flatObjects(s.objects)) { delete o.cmt; if (o.doc) stripCommentMarks(o.doc); }   // comments stay with the original
    s.id = uid(); s.objects.forEach(o => { ids[o.id] = uid(); o.id = ids[o.id]; });
    s.anims.forEach(a => { a.id = uid(); a.target = ids[a.target]; });
    doc.slides.splice(cur + 1, 0, s); cur++; setSel([]); commit(); };
  $('#sDel').onclick = () => deleteSlide();
  requestAnimationFrame(() => list.querySelector('.slide-actions')?.scrollIntoView({block: 'nearest'}));
}
function layoutThumb(k, L, cls = 'lthumb') {
  const b = document.createElement('button'); b.className = cls; b.title = L.name; b.dataset.k = k;
  b.innerHTML = `<div class="frame"><div class="slide"></div></div><span>${esc(L.name)}</span>`;
  renderTemplate(k, b.querySelector('.slide'), 'edit');
  return b;
}
$('#popNewSlide').onopen = () => {
  const gal = $('#lgalNew'); gal.innerHTML = '';
  for (const [k, L] of Object.entries(doc.templates)) gal.appendChild(layoutThumb(k, L));
};
$('#lgalNew').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; closePops(); if (editing) exitEdit();
  doc.slides.splice(cur + 1, 0, newSlide(b.dataset.k)); cur++; setSel([]); commit(); });
function renderTemplateList() {
  slidesNav.innerHTML = `<div class="phead2 lhead"><b>Sablonszerkesztő</b><button class="tb" id="slidesX" title="Bal oldali panel bezárása">${svgIcon('panelL')}</button></div><div class="plist"><div class="tplbar"><button class="btn primary" id="tClose">Sablonszerkesztő bezárása</button></div>
    <div class="phint" style="margin:0 0 10px">A mester elemei minden elrendezésen megjelennek. Az elrendezésekből készülnek az új diák.</div><div id="tlist"></div></div>`;
  const list = $('#tlist');
  const m = thumbFrame('<span class="tname">Mester</span>', 'master' + (tcur === 'master' ? ' cur' : ''));
  renderTemplate('master', m.querySelector('.slide'), 'edit');
  m.onclick = () => gotoTemplate('master'); list.appendChild(m);
  const keys = Object.keys(doc.templates);
  keys.forEach(k => {
    const L = doc.templates[k], t = thumbFrame(`<span class="tname">${esc(L.name)}</span>`, 'layout' + (tcur === k ? ' cur' : ''));
    t.draggable = true;
    renderTemplate(k, t.querySelector('.slide'), 'edit');
    t.onclick = () => gotoTemplate(k);
    t.ondragstart = e => e.dataTransfer.setData('text/layout', k);
    t.ondragover = e => { e.preventDefault(); t.classList.add('dragover'); };
    t.ondragleave = () => t.classList.remove('dragover');
    t.ondrop = e => { e.preventDefault(); const from = e.dataTransfer.getData('text/layout'); if (from && from !== k) moveLayout(from, k); };
    list.appendChild(t);
    if (tcur === k) {
      const a = document.createElement('div'); a.className = 'slide-actions';
      a.innerHTML = `<button class="tb" id="lAdd" title="Új diatípus a sablonba">${svgIcon('plus')}<span>Új dia</span></button>
        <button class="tb" id="lDup" title="Elrendezés másolása">${svgIcon('copy')}</button>
        <button class="tb" id="lDel" title="Elrendezés törlése" ${keys.length < 2 ? 'disabled' : ''}>${svgIcon('trash')}</button>`;
      list.appendChild(a);
    }
  });
  if (tcur === 'master') { const a = document.createElement('div'); a.className = 'slide-actions'; a.innerHTML = `<button class="tb" id="lAdd" title="Új diatípus a sablonba">${svgIcon('plus')}<span>Új dia</span></button>`; list.appendChild(a); }
  $('#tClose').onclick = closeTemplateBuilder;
  $('#slidesX').onclick = () => slidesVisible(false);
  $('#lAdd').onclick = () => { if (editing) exitEdit(); const k = 'l' + uid(); doc.templates[k] = {name: 'Új dia', ownBg: false, background: null, bgColor: '#ffffff', showMaster: true,
    objects: [ph('title', 60, 40, 1160, 33, '#2f5d8a', true, 'left', TITLE_PROMPT)]}; tcur = k; setSel([]); commit(); };
  $('#lDup') && ($('#lDup').onclick = () => { if (editing) exitEdit(); const k = 'l' + uid(), c = clone(doc.templates[tcur]); c.name += ' (másolat)'; c.objects.forEach(o => o.id = uid());
    doc.templates[k] = c; tcur = k; setSel([]); commit(); });
  $('#lDel') && ($('#lDel').onclick = async () => {
    const used = doc.slides.filter(s => s.template === tcur).length;
    if (!await confirmBox(used ? `${used} dia használja ezt az elrendezést. Ezek az első elrendezésre váltanak. Törlöd?` : 'Biztosan törlöd ezt az elrendezést?', 'Elrendezés törlése')) return;
    if (editing) exitEdit();
    delete doc.templates[tcur]; const first = Object.keys(doc.templates)[0];
    doc.slides.forEach(s => { if (!doc.templates[s.template]) s.template = first; }); tcur = first; setSel([]); commit(); });
}
async function deleteSlide() {
  if (doc.slides.length < 2) return;
  if (editing) exitEdit();
  if (!slideIsBlank(tgt()) && !await confirmBox(`Biztosan törlöd a(z) ${cur + 1}. diát a tartalmával együtt?`, 'Dia törlése')) return;
  doc.slides.splice(cur, 1); cur = Math.min(cur, doc.slides.length - 1); setSel([]); commit();
}
function moveLayout(from, to) {
  const e = Object.entries(doc.templates), i = e.findIndex(x => x[0] === from), j = e.findIndex(x => x[0] === to);
  const [it] = e.splice(i, 1); e.splice(j, 0, it); doc.templates = Object.fromEntries(e); commit();
}
function moveSlide(from, to) {
  if (from === to) return renderThumbs();
  if (editing) exitEdit();
  const [s] = doc.slides.splice(from, 1); doc.slides.splice(to, 0, s); cur = to; commit();
}
function gotoSlide(i) { if (editing) exitEdit(); cur = i; setSel([]); curAnim = null; renderAll(); }
function gotoTemplate(k) { if (editing) exitEdit(); tcur = k; setSel([]); renderAll(); }
function openTemplateBuilder() {
  if (editing) exitEdit(); closePops();
  mode = 'template'; mainEl.classList.add('tplmode'); tcur = doc.slides[cur] ? doc.slides[cur].template : 'master'; setSel([]); renderAll(); fitStage();
}
function closeTemplateBuilder() {
  if (editing) exitEdit(); closePops();
  for (const s of doc.slides) syncPlaceholders(s);
  mode = 'slides'; mainEl.classList.remove('tplmode'); setSel([]); commit(); fitStage();
}

