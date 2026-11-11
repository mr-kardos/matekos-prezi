/* ================================================================== comments (Matekos Doksi)
   attached to selected text (a mark), to objects (o.cmt) or to a slide / layout (no selection); listed in the
   order of the presentation; drawn on a layer over the slide, never in the slideshow or the exports */
const cmtDate = t => new Date(t).toLocaleString('hu-HU', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
const cmtList = () => doc ? (doc.comments ||= []) : [];
const idsOf = v => String(v || '').split(' ').filter(Boolean);
const addId = (v, id) => (v ? v + ' ' : '') + id;
function stripCommentMarks(json, id = null) {
  (function w(n) { if (n.marks) { n.marks = n.marks.filter(m => m.type !== 'comment' || (id && m.attrs?.id !== id)); if (!n.marks.length) delete n.marks; } (n.content || []).forEach(w); })(json || {});
}
function textCommentIds(json) { const out = []; (function w(n) { for (const m of n.marks || []) if (m.type === 'comment' && m.attrs?.id && !out.includes(m.attrs.id)) out.push(m.attrs.id); (n.content || []).forEach(w); })(json || {}); return out; }
/** Where each comment is: id -> {si (slide index, or -1 for master/layouts), tk (template key), oid, order} */
function commentPlaces() {
  const at = {}; let order = 0;
  const put = (id, p) => { if (!at[id]) at[id] = {...p, order: order++}; };
  const scan = (g, si, tk) => {
    for (const id of idsOf(g.cmt)) put(id, {si, tk, oid: null});
    for (const o of flatObjects(g.objects)) { for (const id of idsOf(o.cmt)) put(id, {si, tk, oid: o.id}); for (const id of textCommentIds(o.doc)) put(id, {si, tk, oid: o.id, text: true}); }
  };
  if (editing) syncEditor();
  doc.slides.forEach((sl, si) => scan(sl, si, null));
  scan(doc.master, -1, 'master'); for (const [k, L] of Object.entries(doc.templates)) scan(L, -1, k);
  return at;
}
let cmtMode = false, activeCmt = null, cmtHidden = lsGet('matekosprezi.cmthide') === '1', cmtSel = null, cmtRaf = 0;
let cmtFilter = lsGet('matekosprezi.cmtfilter') === 'open' ? 'open' : 'all';      // 'open': resolved comments are not listed
/** The name written on new comments and replies (asked once, kept by the app). Null (and a hint) while it is missing. */
function cmtAuthor() {
  const inp = $('#cmtAuthor'), name = inp.value.trim().slice(0, 40);
  if (!name) { toast('Írd be a neved – ez kerül a megjegyzéseidre.'); inp.focus(); return null; }
  lsSet('matekosprezi.author', name); return name;
}
/** Comments in the order of the presentation (slides first, then master and layouts; lost ones last). */
function orderedComments(at = commentPlaces()) {
  return [...cmtList()].sort((a, b) => ((at[a.id]?.si ?? 1e6) - (at[b.id]?.si ?? 1e6)) || ((at[a.id]?.order ?? 1e9) - (at[b.id]?.order ?? 1e9)));
}
/** Jump to the next / previous unresolved comment (dir = 1 / -1), going round at the ends. */
function stepOpenComment(dir) {
  const open = orderedComments().filter(c => !c.done);
  if (!open.length) { toast('Nincs nyitott megjegyzés.'); return; }
  const i = open.findIndex(c => c.id === activeCmt);
  const c = open[i < 0 ? (dir > 0 ? 0 : open.length - 1) : (i + dir + open.length) % open.length];
  showCommentPlace(c.id); renderComments(); focusCard(c.id);
}
/** Open comments per slide index (for the marks on the slide thumbnails). */
function openCommentsBySlide() {
  const at = commentPlaces(), n = {};
  for (const c of cmtList()) if (!c.done && at[c.id] && at[c.id].si >= 0) n[at[c.id].si] = (n[at[c.id].si] || 0) + 1;
  return n;
}
const cmtOpen = () => cmtMode && !mainEl.classList.contains('noprops');
function commentsOn(v) {
  cmtMode = v; mainEl.classList.toggle('cmtmode', v); $('#bCmt').classList.toggle('primary', v);
  if (v) panelVisible(true);
  renderComments(); if (doc && mode === 'slides') renderThumbs();
}
function renderComments() {
  const at = commentPlaces(), all = orderedComments(at), nOpen = all.filter(c => !c.done).length;
  const list = cmtFilter === 'open' ? all.filter(c => !c.done) : all;
  $('#cmtCount').textContent = all.length ? `${nOpen} nyitott / ${all.length}` : '';
  for (const b of $$('#cmtPanel [data-cflt]')) b.classList.toggle('on', b.dataset.cflt === cmtFilter);
  $('#cmtPrev').disabled = $('#cmtNext').disabled = !nOpen;
  const who = x => x.by ? `<span class="cav" style="--c:${avatarColor(x.by)}">${svgIcon('user')}</span><b class="cby">${esc(x.by)}</b>` : '';
  const where = p => !p ? 'a helye törölve' : p.si >= 0 ? `${p.si + 1}. dia` : p.tk === 'master' ? 'mester' : (doc.templates[p.tk]?.name || 'diatípus');
  $('#cmtList').innerHTML = list.length ? list.map(c => `<div class="cmtcard${c.done ? ' done' : ''}${c.id === activeCmt ? ' act' : ''}${at[c.id] ? '' : ' lost'}" data-cid="${c.id}">
      <div class="ctop"><span class="cdate">${who(c)}${cmtDate(c.at)} · ${where(at[c.id])}</span>
        <button class="tb mini${c.done ? ' on' : ''}" data-cact="done" title="${c.done ? 'Mégsem megoldott' : 'Megoldva'}">${svgIcon('tick')}</button>
        <button class="tb mini" data-cact="del" title="Megjegyzés törlése">${svgIcon('xmark')}</button></div>
      <div class="ctext">${esc(c.text).replace(/\n/g, '<br>')}</div>
      ${(c.replies || []).map(r => `<div class="creply"><span class="cdate">${who(r)}${cmtDate(r.at)}</span><div>${esc(r.text).replace(/\n/g, '<br>')}</div></div>`).join('')}
      <div class="crow"><input type="text" class="cin" placeholder="Válasz…"><button class="btn mini" data-cact="reply">Válasz</button></div>
    </div>`).join('') : all.length ? '<div class="phint" style="padding:6px 2px">Nincs nyitott megjegyzés – minden meg van oldva. A „Mind” gombbal a megoldottak is látszanak.</div>' : '<div class="phint" style="padding:6px 2px">Még nincs megjegyzés. Jelölj ki szöveget vagy objektumot (vagy semmit: akkor a diához kerül), írd be a megjegyzést fent, és kattints a „Megjegyzés hozzáadása” gombra.</div>';
  drawComments();
}
function addComment() {
  const text = $('#cmtText').value.trim();
  if (!text) { toast('Írd be a megjegyzés szövegét.'); $('#cmtText').focus(); return; }
  const by = cmtAuthor(); if (!by) return;
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const s0 = cmtSel || (editing && ed && !ed.state.selection.empty ? {oid: editing, from: ed.state.selection.from, to: ed.state.selection.to} : null);
  if (s0 && objById(s0.oid)) {                                      // selected text in a text box
    if (editing !== s0.oid) { if (editing) exitEdit(); enterEdit(s0.oid); }
    ed.chain().setTextSelection({from: s0.from, to: s0.to}).setMark('comment', {id}).run(); syncEditor();
  } else if (selIds.length) { for (const oid of selIds) { const o = objById(oid); if (o) o.cmt = addId(o.cmt, id); } }   // objects
  else { const g = tgt(); g.cmt = addId(g.cmt, id); }                                                                   // the slide
  cmtList().push({id, text, by, at: Date.now(), done: false, replies: []});
  $('#cmtText').value = ''; cmtSel = null; activeCmt = id;
  commit(); renderComments(); focusCard(id);
}
function removeCommentAnchors(id) {
  if (editing) exitEdit();
  const drop = x => { const r = idsOf(x.cmt).filter(v => v !== id).join(' '); if (r) x.cmt = r; else delete x.cmt; };
  for (const g of [doc.master, ...Object.values(doc.templates), ...doc.slides]) { drop(g); for (const o of flatObjects(g.objects)) { drop(o); if (o.doc) stripCommentMarks(o.doc, id); } }
}
function focusCard(id) {
  activeCmt = id;
  for (const c of $$('#cmtList .cmtcard')) c.classList.toggle('act', c.dataset.cid === id);
  $(`#cmtList [data-cid="${id}"]`)?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  drawComments();
}
function showCommentPlace(id) {
  const p = commentPlaces()[id]; activeCmt = id; if (!p) { drawComments(); return; }
  if (p.si >= 0) { if (mode !== 'slides') closeTemplateBuilder(); if (cur !== p.si) gotoSlide(p.si); }
  else { if (mode !== 'template') openTemplateBuilder(); if (tcur !== p.tk) { tcur = p.tk; setSel([]); renderAll(); } }
  if (p.oid && objById(p.oid)) { setSel([p.oid]); renderAll(); }
  drawComments();
}
function setCmtHidden(v) {
  cmtHidden = v; lsSet('matekosprezi.cmthide', v ? '1' : '0'); if (doc && mode === 'slides') renderThumbs();
  $('#cmtHide').classList.toggle('on', v);
  $('#cmtHide').title = v ? 'A megjegyzések jelölése el van rejtve a dián, amíg a panel zárva van – kattints a megjelenítéshez' : 'A megjegyzések jelölése a dián akkor is látszik, ha a panel zárva van – kattints az elrejtéshez';
  drawComments();
}
/** Purple marks on the slide being edited: commented text, objects, and a flag for the slide itself. */
function drawComments() {
  if (cmtRaf) return;
  cmtRaf = requestAnimationFrame(() => {
    cmtRaf = 0;
    let layer = $('#cmtLayer'); if (!layer) { layer = document.createElement('div'); layer.id = 'cmtLayer'; stageWrap.appendChild(layer); }
    if (!cmtList().length || (cmtHidden && !cmtOpen()) || sh) { layer.innerHTML = ''; return; }
    const wr = stageWrap.getBoundingClientRect(), done = new Set(cmtList().filter(c => c.done).map(c => c.id)), known = new Set(cmtList().map(c => c.id));
    const cls = ids => (ids.every(i => done.has(i)) ? ' done' : '') + (ids.includes(activeCmt) ? ' act' : '');
    const box = (q, extra) => `<div class="cmt-hl${extra}" style="left:${q.left - wr.left}px;top:${q.top - wr.top}px;width:${q.width}px;height:${q.height}px"></div>`;
    const out = [];
    for (const el of stage.querySelectorAll('.obj[data-id]')) {
      const o = objById(el.dataset.id), ids = idsOf(o?.cmt).filter(i => known.has(i)); if (!ids.length) continue;
      const q = (el.querySelector('.rot') || el).getBoundingClientRect(); if (q.width) out.push(box(q, ' obj' + cls(ids)));
    }
    for (const sp of stage.querySelectorAll('[data-cmt]')) {
      const ids = idsOf(sp.dataset.cmt).filter(i => known.has(i)); if (!ids.length) continue;
      for (const q of sp.getClientRects()) if (q.width && q.height) out.push(box(q, cls(ids)));
    }
    const sIds = idsOf(tgt()?.cmt).filter(i => known.has(i));
    if (sIds.length) { const sr = stage.getBoundingClientRect(); out.push(`<div class="cmt-flag${cls(sIds)}" style="left:${sr.right - wr.left - 8}px;top:${sr.top - wr.top + 8}px" title="Megjegyzés a diához">${svgIcon('comment')}<b>${sIds.length}</b></div>`); }
    layer.innerHTML = out.join('');
  });
}
function setSel(ids) { selIds = [...new Set(ids.filter(Boolean))]; sel = selIds.length === 1 ? selIds[0] : null; }

/** In-app confirmation dialog (works the same in the browser and in the desktop app). */
function confirmBox(msg, yes = 'Igen') {
  return new Promise(res => {
    const box = $('#cfm'); $('#cfmMsg').textContent = msg; $('#cfmYes').textContent = yes; box.hidden = false; $('#cfmYes').focus();
    const done = v => { box.hidden = true; removeEventListener('keydown', key, true); $('#cfmYes').onclick = $('#cfmNo').onclick = null; res(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); } };
    addEventListener('keydown', key, true);
    $('#cfmYes').onclick = () => done(true); $('#cfmNo').onclick = () => done(false);
  });
}
const slideIsBlank = s => s.objects.every(o => o.placeholder && isEmptyText(o));

