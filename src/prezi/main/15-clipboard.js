/* ================================================================== clipboard, drag & drop */
// Objects and slides travel through the system clipboard as text ("MPREZI-CLIP:" + JSON, pictures included),
// so they can be pasted into another slide, another presentation or another Matekos Prezi window.
const CLIP = 'MPREZI-CLIP:', WIN = uid();
function mediaOf(objs, extra = []) { const keys = new Set(extra.filter(Boolean)); for (const o of flatObjects(objs)) if (o.media) keys.add(o.media); return Object.fromEntries([...keys].filter(k => media[k]).map(k => [k, media[k]])); }
function clipObjects(ids) {
  const objs = ids.map(objById).filter(Boolean).map(clone), all = new Set(flatObjects(objs).map(o => o.id));
  return {kind: 'objects', win: WIN, slide: tgt().id ?? tcur, objects: objs, anims: (tgt().anims || []).filter(a => all.has(a.target)).map(clone), media: mediaOf(objs)};
}
function clipSlide(i) {
  const sl = clone(doc.slides[i]), L = doc.templates[sl.template];
  return {kind: 'slide', win: WIN, slides: [sl], layouts: L ? {[sl.template]: clone(L)} : {}, media: mediaOf([...sl.objects, ...(L ? L.objects : [])], [L?.background])};
}
const clipText = d => CLIP + JSON.stringify(d);
function readClip(text) { if (!text || !text.startsWith(CLIP)) return null; try { return JSON.parse(text.slice(CLIP.length)); } catch (e) { return null; } }
const reid = (o, map) => { const n = uid(); map.set(o.id, n); o.id = n; delete o.cmt; if (o.doc) stripCommentMarks(o.doc); if (o.children) o.children.forEach(c => reid(c, map)); };
/** Paste / drop clipboard data. `at`: slide point to place the objects (drop), else +20 px when pasted onto the same slide. */
function pasteData(d, at) {
  if (editing) exitEdit();
  Object.assign(media, d.media || {});
  if (d.kind === 'slide') {
    if (mode !== 'slides') { toast('Diát a diaszerkesztőben lehet beilleszteni.'); return; }
    let at_ = cur + 1;
    for (const sl of d.slides) {
      const map = new Map(); sl.id = uid(); sl.objects.forEach(o => reid(o, map));
      sl.anims = (sl.anims || []).filter(a => map.has(a.target)).map(a => ({...a, id: uid(), target: map.get(a.target)}));
      if (!doc.templates[sl.template]) {
        const L = d.layouts?.[sl.template];
        if (L) { let k = sl.template; while (doc.templates[k]) k += '_'; L.objects.forEach(o => reid(o, new Map())); doc.templates[k] = L; sl.template = k; }
        else sl.template = Object.keys(doc.templates)[0];
      }
      doc.slides.splice(at_++, 0, sl);
    }
    cur = at_ - 1; setSel([]); commit(); toast(d.slides.length > 1 ? `${d.slides.length} dia beillesztve.` : 'Dia beillesztve.'); return;
  }
  if (d.kind !== 'objects' || !d.objects?.length) return;
  const map = new Map(), objs = d.objects;
  objs.forEach(o => { reid(o, map); delete o.placeholder; delete o.locked; });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of objs) { const b = bounds(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  const taken = objs.some(o => tgt().objects.some(q => Math.abs(q.x - o.x) < 1 && Math.abs(q.y - o.y) < 1 && q.type === o.type));
  const dx = at ? at.x - (x0 + x1) / 2 : (taken ? 20 : 0), dy = at ? at.y - (y0 + y1) / 2 : dx;
  for (const o of objs) { moveObject(o, dx, dy); tgt().objects.push(o); }
  if (mode === 'slides') tgt().anims.push(...(d.anims || []).filter(a => map.has(a.target)).map(a => ({...a, id: uid(), target: map.get(a.target)})));
  setSel(objs.map(o => o.id)); curAnim = null; commit();
}
function addImageFromDataURL(url, at) {
  const img = new Image();
  img.onload = () => {
    if (editing) exitEdit();
    const key = 'img' + uid(); media[key] = url;
    const k = Math.min(1, 800 / img.width, 500 / img.height), w = Math.round(img.width * k), h = Math.round(img.height * k);
    const o = addObject({type: 'image', name: nextName('Kép'), media: key, w, h});
    if (at) { o.x = Math.round(Math.max(0, Math.min(W - w, at.x - w / 2))); o.y = Math.round(Math.max(0, Math.min(H - h, at.y - h / 2))); }
    commit();
  };
  img.src = url;
}
const fileToURL = f => new Promise(res => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(f); });
function addTextBox(text, at) {
  if (editing) exitEdit();
  const st = stylesOf().body, paras = text.replace(/\r/g, '').split('\n');
  const o = addObject({type: 'text', name: nextName('Szöveg'), w: 620, size: st.size, color: st.color, align: 'left', styleRef: 'body',
    doc: {type: 'doc', content: paras.map(t => t ? {type: 'paragraph', content: [{type: 'text', text: t}]} : {type: 'paragraph'})}});
  if (at) { o.x = Math.round(at.x - 310); o.y = Math.round(at.y - 20); }
  commit();
}
/** One editable text box per PowerPoint text box (their order kept, placed under each other). */
async function pastePowerPointText(html, text) {
  if (editing) exitEdit();
  const dom = new DOMParser().parseFromString(html, 'text/html');
  let parts = [...dom.body.querySelectorAll('div, td')].filter(el => !el.querySelector('div, td') && el.textContent.trim());
  // PowerPoint puts each text box in its own block; fall back to the whole text
  const blocks = parts.length ? [...new Set(parts.map(el => el.closest('[style*="position"], v\\:shape, div[class]') || el))] : [];
  const htmls = blocks.length ? blocks.map(b => b.outerHTML) : [html];
  const ids = [];
  for (const [i, h] of htmls.entries()) {
    addTextBox('');
    const o = selObj(); o.y += i * 70; ids.push(o.id);
    renderAll(); enterEdit(o.id); ed.view.pasteHTML(h); exitEdit();
  }
  setSel(ids.filter(id => objById(id))); drawSelection(); renderProps(); updateRibbon();
}
const clipTarget = e => !sh && $('#home').hidden && $('#cfm').hidden && !isMathEditorOpen() && !e.target.closest?.('input, textarea, select, math-field');
document.addEventListener('copy', e => {
  if (!clipTarget(e) || editing) return;
  let d = null;
  if (slideFocus && mode === 'slides' && !selIds.length) d = clipSlide(cur);
  else if (selIds.length) d = clipObjects(selIds);
  if (!d) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', clipText(d)); toast(d.kind === 'slide' ? 'Dia másolva.' : 'Másolva.');
});
document.addEventListener('cut', e => {
  if (!clipTarget(e) || editing) return;
  if (slideFocus && mode === 'slides' && !selIds.length) {
    if (doc.slides.length < 2) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', clipText(clipSlide(cur)));
    doc.slides.splice(cur, 1); cur = Math.min(cur, doc.slides.length - 1); commit(); toast('Dia kivágva.'); return;
  }
  if (!selIds.length) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', clipText(clipObjects(selIds))); deleteSelected();
});
document.addEventListener('paste', async e => {
  if (!clipTarget(e)) return;
  const cd = e.clipboardData, text = cd.getData('text/plain'), d = readClip(text);
  const files = [...cd.files].filter(f => f.type.startsWith('image/'));
  const vids = [...cd.files].filter(f => f.type.startsWith('video/') || /\.(mp4|m4v|webm|mov)$/i.test(f.name));
  if (d) { e.preventDefault(); e.stopPropagation(); pasteData(d); return; }
  if (vids.length) { e.preventDefault(); e.stopPropagation(); for (const f of vids) await insertVideo({data: await f.arrayBuffer(), name: f.name}); return; }
  // text boxes copied in PowerPoint arrive as text + a picture of them: they become editable text boxes
  const html = cd.getData('text/html');
  if (html && /PowerPoint|office:powerpoint|urn:schemas-microsoft-com/i.test(html) && text.trim()) {
    e.preventDefault(); e.stopPropagation(); pastePowerPointText(html, text); return;
  }
  if (files.length) { e.preventDefault(); e.stopPropagation(); for (const f of files) addImageFromDataURL(await fileToURL(f)); return; }
  if (editing) return;                                           // the text editor pastes text itself
  if (text && text.trim()) {
    e.preventDefault(); addTextBox('');
    const o = selObj(); renderAll(); enterEdit(o.id); requestAnimationFrame(() => ed?.view.pasteText(text));
  }
}, true);
// drag & drop: pictures, text, and objects / slides from another Matekos Prezi window
const dropPoint = e => { const r = stage.getBoundingClientRect(); return {x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale}; };
work.addEventListener('dragover', e => { if ([...e.dataTransfer.types].some(t => t === 'Files' || t === 'text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
work.addEventListener('drop', async e => {
  const dt = e.dataTransfer, text = dt.getData('text/plain'), d = readClip(text), at = dropPoint(e);
  const files = [...dt.files].filter(f => f.type.startsWith('image/'));
  const vids = [...dt.files].filter(f => f.type.startsWith('video/') || /\.(mp4|m4v|webm|mov)$/i.test(f.name));
  if (!d && !files.length && !vids.length && !text) return;
  e.preventDefault();
  if (vids.length) { for (const f of vids) await insertVideo({data: await f.arrayBuffer(), name: f.name}, at); return; }
  if (d) { if (d.win === WIN && d.kind === 'objects' && d.slide === (tgt().id ?? tcur)) return; pasteData(d, d.kind === 'objects' ? at : null); return; }
  if (files.length) { for (const f of files) addImageFromDataURL(await fileToURL(f), at); return; }
  if (text.trim()) addTextBox(text, at);
});
slidesNav.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/plain')) e.preventDefault(); });
slidesNav.addEventListener('drop', e => { const d = readClip(e.dataTransfer.getData('text/plain')); if (!d || d.win === WIN) return; e.preventDefault(); pasteData(d); });
document.addEventListener('dragstart', e => {
  const row = e.target.closest?.('.lyr[data-id]');
  if (row) { e.dataTransfer.setData('text/plain', clipText(clipObjects(selIds.includes(row.dataset.id) ? selIds : [row.dataset.id]))); e.dataTransfer.effectAllowed = 'copyMove'; return; }
  const th = e.target.closest?.('#plist .thumb[data-i]');
  if (th && mode === 'slides') { e.dataTransfer.setData('text/plain', clipText(clipSlide(+th.dataset.i))); e.dataTransfer.effectAllowed = 'copy'; }
});

/* comments panel: wiring */
$('#bCmt').onclick = () => { if (mode === 'template' && !cmtOpen()) closeTemplateBuilder(); commentsOn(!cmtOpen()); };
$('#cmtClose').onclick = () => panelVisible(false);
$('#cmtHide').onclick = () => setCmtHidden(!cmtHidden);
setCmtHidden(cmtHidden);
$('#cmtAdd').addEventListener('mousedown', e => e.preventDefault());
$('#cmtText').addEventListener('focus', () => { cmtSel = editing && ed && !ed.state.selection.empty ? {oid: editing, from: ed.state.selection.from, to: ed.state.selection.to} : null; });
$('#cmtAdd').addEventListener('click', addComment);
/** Every reviewer has a colour of their own (from the name), shown behind the profile icon. */
function avatarColor(name) { let h = 0; for (const ch of String(name).trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)) % 360; return `hsl(${h} 55% 45%)`; }
const paintAvatar = () => { const a = $('#cmtAvatar'), n = $('#cmtAuthor').value.trim(); a.innerHTML = svgIcon('user'); a.style.setProperty('--c', n ? avatarColor(n) : 'var(--ink-2)'); };
$('#cmtAuthor').value = lsGet('matekosprezi.author') || ''; paintAvatar();
$('#cmtAuthor').addEventListener('input', paintAvatar);
$('#cmtAuthor').addEventListener('change', e => { const n = e.target.value.trim().slice(0, 40); e.target.value = n; lsSet('matekosprezi.author', n); paintAvatar(); });
$('#cmtAuthor').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#cmtText').focus(); } });
$('#cmtPrev').onclick = () => stepOpenComment(-1);
$('#cmtNext').onclick = () => stepOpenComment(1);
for (const b of $$('#cmtPanel [data-cflt]')) b.onclick = () => { cmtFilter = b.dataset.cflt; lsSet('matekosprezi.cmtfilter', cmtFilter); renderComments(); };
$('#cmtText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); } });
$('#cmtList').addEventListener('click', e => {
  const card = e.target.closest('.cmtcard'); if (!card) return;
  const id = card.dataset.cid, c = cmtList().find(x => x.id === id); if (!c) return;
  const act = e.target.closest('[data-cact]');
  if (act?.dataset.cact === 'del') { removeCommentAnchors(id); doc.comments = cmtList().filter(x => x.id !== id); if (activeCmt === id) activeCmt = null; commit(); renderComments(); return; }
  if (act?.dataset.cact === 'done') { c.done = !c.done; commit(); renderComments(); return; }
  if (act?.dataset.cact === 'reply') {
    const inp = card.querySelector('.cin'), t = inp.value.trim(); if (!t) { inp.focus(); return; }
    const by = cmtAuthor(); if (!by) return;
    (c.replies ||= []).push({text: t, by, at: Date.now()}); commit(); renderComments(); focusCard(id); return;
  }
  if (e.target.closest('input')) return;
  focusCard(id); showCommentPlace(id);
});
$('#cmtList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('cin')) { e.preventDefault(); e.target.closest('.cmtcard').querySelector('[data-cact=reply]').click(); } });
// a click on commented text or a commented object: its comment in the panel (one click is enough – it is read
// before the click re-draws the slide)
stage.addEventListener('pointerdown', e => {
  if (!cmtOpen() || e.button !== 0) return;
  const known = new Set(cmtList().map(c => c.id));
  const tx = e.target.closest?.('[data-cmt]'), ob = e.target.closest?.('.obj[data-id]');
  const ids = [...(tx ? idsOf(tx.dataset.cmt) : []), ...(ob ? idsOf(objById(ob.dataset.id)?.cmt) : [])].filter(i => known.has(i));
  if (ids.length) setTimeout(() => focusCard(ids[0]), 0);
}, true);
/* the selected text stays visible while a box of the ribbon, a popup or the comments panel has the focus */
let keptSel = null, keptRaf = 0;
function drawKept() {
  if (keptRaf) return;
  keptRaf = requestAnimationFrame(() => {
    keptRaf = 0;
    let layer = $('#keepLayer'); if (!layer) { layer = document.createElement('div'); layer.id = 'keepLayer'; stageWrap.appendChild(layer); }
    if (!keptSel || !editing || !ed || keptSel.oid !== editing) { layer.innerHTML = ''; return; }
    const wr = stageWrap.getBoundingClientRect(), out = [];
    try {
      const a = ed.view.domAtPos(keptSel.from), b2 = ed.view.domAtPos(keptSel.to), rg = document.createRange();
      rg.setStart(a.node, a.offset); rg.setEnd(b2.node, b2.offset);
      for (const q of rg.getClientRects()) if (q.width > 0 && q.height > 0) out.push(`<div style="left:${q.left - wr.left}px;top:${q.top - wr.top}px;width:${q.width}px;height:${q.height}px"></div>`);
    } catch (e) { /* positions changed */ }
    layer.innerHTML = out.join('');
  });
}
document.addEventListener('focusin', e => {
  const t = e.target;
  if (ed && ed.view.dom.contains(t)) { if (keptSel) { keptSel = null; drawKept(); } return; }
  if (!t.matches?.('input, textarea, select')) return;
  if (editing && ed && !ed.state.selection.empty) { keptSel = {oid: editing, from: ed.state.selection.from, to: ed.state.selection.to}; drawKept(); }
});
document.addEventListener('focusout', e => { if (e.target.matches?.('input, textarea, select')) setTimeout(() => { const a = document.activeElement; if (keptSel && !(a && a.matches?.('input, textarea, select'))) { keptSel = null; drawKept(); } }, 150); });
addEventListener('resize', drawComments);
work.addEventListener('scroll', drawComments, {passive: true});

