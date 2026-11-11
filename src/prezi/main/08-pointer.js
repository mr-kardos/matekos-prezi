/* ================================================================== pointer interaction on the slide */
const toStage = e => { const r = stage.getBoundingClientRect(); return {x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale}; };
const toStageRect = rr => { const s = stage.getBoundingClientRect(); return {x: (rr.left - s.left) / scale, y: (rr.top - s.top) / scale, w: rr.width / scale, h: rr.height / scale}; };
let action = null, lastDown = null, slideFocus = false;
/** The top-level object element under an event target (members of a group resolve to the group). */
const topObjEl = t => { let el = t.closest('.obj:not(.tpl)'); while (el && el.parentElement?.closest('.obj:not(.tpl)')) el = el.parentElement.closest('.obj:not(.tpl)'); return el; };

stage.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  slideFocus = false;
  if (e.target.closest('#tblHandles')) return;
  const p = toStage(e), h = e.target.closest('.h');
  if (h) { startHandle(h.dataset.h, p, e); return; }
  if (editing) {
    const edEl = stage.querySelector(`.obj[data-id="${editing}"]`);
    if (edEl && edEl.contains(e.target)) return;            // the editor handles its own clicks
    exitEdit();
  }
  const oel = topObjEl(e.target), multi = e.shiftKey || e.ctrlKey || e.metaKey;
  if (painter) { e.preventDefault(); paintOnto(oel ? objById(oel.dataset.id) : null); return; }
  if (!oel) {                                              // empty area: rubber-band selection
    if (!multi) setSel([]);
    action = {type: 'marquee', p0: p, base: [...selIds]};
    stage.setPointerCapture(e.pointerId); drawSelection(); renderProps(); updateRibbon();
    return;
  }
  const id = oel.dataset.id, o = objById(id), now = performance.now();
  if (multi) {                                             // add to / remove from the selection
    setSel(selIds.includes(id) ? selIds.filter(x => x !== id) : [...selIds, id]);
    curAnim = null; lastDown = null; drawSelection(); renderProps(); updateRibbon(); e.preventDefault(); return;
  }
  if (isTable(o)) { e.preventDefault(); select(id); enterEdit(id, e); return; }   // tables: always ready to edit
  if (lastDown && lastDown.id === id && now - lastDown.t < 450) {
    lastDown = null; e.preventDefault();
    // double click: edit the text box (also a text box inside a group)
    let tEl = e.target.closest('.obj.text:not(.tpl)');
    if (tEl && o.type === 'group') { select(tEl.dataset.id); enterEdit(tEl.dataset.id, e); return; }
    if (isText(o)) {
      if (mode === 'template' && o.placeholder) { toast('A helykitöltő mintaszövegét a jobb oldali panelen adhatod meg.'); return; }
      if (o.field) { toast('Automatikus mező – a tartalma magától frissül. A formázását a menüszalaggal állíthatod.'); return; }
      enterEdit(id, e); return;
    }
  }
  const wasSelected = selIds.length === 1 && sel === id;
  lastDown = {id, t: now};
  if (!selIds.includes(id)) select(id);
  startMove(p, e);
  // a text box that is already selected: a click (without dragging) puts the cursor in it
  if (wasSelected && isText(o) && !o.locked && !o.field && !(mode === 'template' && o.placeholder) && action) action.editAt = {clientX: e.clientX, clientY: e.clientY, id};
});
function startMove(p, e) {
  const objs = selIds.map(objById).filter(o => o && !o.locked);
  if (!objs.length) return;
  const bs = objs.map(bounds), x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  action = {type: 'move', p0: p, starts: objs.map(o => ({o, x: o.x, y: o.y})), moved: false, skip: snapSkip(objs.map(o => o.id)),
    box: {x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0}};
  stage.setPointerCapture(e.pointerId); e.preventDefault();
}
stage.addEventListener('pointermove', e => {
  if (!action) return;
  const p = toStage(e);
  if (action.type === 'marquee') {
    let m = stage.querySelector('.marquee'); if (!m) { m = document.createElement('div'); m.className = 'marquee'; stage.appendChild(m); }
    const x0 = Math.min(p.x, action.p0.x), y0 = Math.min(p.y, action.p0.y), x1 = Math.max(p.x, action.p0.x), y1 = Math.max(p.y, action.p0.y);
    Object.assign(m.style, {left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px'});
    const hit = tgt().objects.filter(o => !o.locked && !o.hidden).filter(o => { const b = bounds(o); return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0; }).map(o => o.id);
    setSel([...action.base, ...hit]); drawSelection();
    return;
  }
  if (action.type === 'move') {
    let dx = p.x - action.p0.x, dy = p.y - action.p0.y;
    if (!action.moved && Math.hypot(dx, dy) < 2) return;
    action.moved = true;
    const lead = action.starts[0];
    if (!e.altKey) { const [sx, sy] = snapBox({...action.box, x: action.box.x + dx, y: action.box.y + dy}, action.skip); dx += sx; dy += sy; }   // Alt: no snapping
    else clearGuides();
    for (const s of action.starts) moveObject(s.o, Math.round(s.x + dx) - s.o.x, Math.round(s.y + dy) - s.o.y);
    action.starts.forEach(s => updateObjLive(s.o, true)); drawSelection(); drawBadges();
    if (action.starts.length === 1) syncGeometryInputs(lead.o);
    return;
  }
  const o = selObj(); if (!o) return;
  if (action.type === 'resize') doResize(o, p, e.shiftKey, e.altKey);
  updateObjLive(o);
});
stage.addEventListener('pointerup', () => {
  if (!action) return;
  stage.querySelectorAll('.guide, .marquee').forEach(g => g.remove());
  const a = action; action = null;
  if (a.type === 'marquee') { renderProps(); updateRibbon(); return; }
  if (a.editAt && !a.moved) { lastDown = null; enterEdit(a.editAt.id, a.editAt); return; }
  if (a.type === 'resize' && isTable(selObj()) && Math.abs(selObj().h - a.o0.h) > 1) setTableHeight(selObj());
  if (a.moved) { for (const s of a.starts ?? [{o: selObj()}]) if (s.o?.placeholder && mode === 'slides') s.o.phMoved = true; commit(); }
});
function startHandle(h, p, e) {
  if (h === 'move') { startMove(p, e); e.stopPropagation(); return; }
  const o = selObj(); if (!o || o.locked) return;
  action = {type: 'resize', h, p0: p, o0: clone(o), moved: true};
  stage.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
}
/* picture cropping: the frame's handles cut the picture, the picture itself stays where it is */
let cropping = null;
function fullRect(o) {
  const {l = 0, t = 0, r = 0, b = 0} = o.crop || {}, fw = o.w / (1 - l - r), fh = o.h / (1 - t - b);
  return {x: o.x - l * fw, y: o.y - t * fh, w: fw, h: fh};
}
function startCrop() {
  const o = selObj(); if ((o?.type !== 'image' && o?.type !== 'video') || o.locked) return;
  if (o.rot) { toast('Elforgatott kép nem vágható körbe – előbb állítsd 0°-ra.'); return; }
  cropping = o.id; drawSelection(); updateImgBar();
}
function endCrop() { if (!cropping) return; cropping = null; stage.querySelectorAll('.cropghost').forEach(x => x.remove()); commit(); updateImgBar(); }
function drawCropGhost() {
  stage.querySelectorAll('.cropghost').forEach(x => x.remove());
  const o = cropping && objById(cropping); if (!o) return;
  const F = fullRect(o), g = document.createElement('div'); g.className = 'cropghost';
  Object.assign(g.style, {left: F.x + 'px', top: F.y + 'px', width: F.w + 'px', height: F.h + 'px'});
  g.innerHTML = `<img src="${media[o.type === 'video' ? o.poster : o.media]}" alt="">`; stage.insertBefore(g, stage.firstChild.nextSibling);
}
/* ---------- videos ---------- */
const fmtT = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), sec = t - m * 60; return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(1).replace('.', ','); };
const parseT = v => { v = String(v).trim().replace(',', '.'); if (!v) return NaN; const p = v.split(':').map(Number); return p.length === 2 ? p[0] * 60 + p[1] : p[0]; };
function videoInfo(url, at = 0.1) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
    v.onerror = () => rej(new Error('Ezt a videót a program nem tudja lejátszani (MP4 / WebM ajánlott).'));
    v.onloadedmetadata = () => { v.currentTime = Math.min(at, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const c = document.createElement('canvas'); c.width = v.videoWidth || 640; c.height = v.videoHeight || 360;
      try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (e) { /* no picture */ }
      res({w: c.width, h: c.height, duration: v.duration || 0, poster: c.toDataURL('image/jpeg', 0.85)});
    };
  });
}
async function insertVideo(given, at) {
  const f = given || await pickFile('Videó', ['mp4', 'm4v', 'webm', 'mov']); if (!f) return;
  busy('Videó betöltése…');
  try {
    const ext = f.name.split('.').pop().toLowerCase(), mime = {mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime'}[ext] || 'video/mp4';
    const url = await new Promise(res => { const rd = new FileReader(); rd.onload = () => res(rd.result.replace(/^data:[^;]*;/, `data:${mime};`)); rd.readAsDataURL(new Blob([f.data])); });
    const info = await videoInfo(url);
    if (editing) exitEdit();
    const vk = 'vid' + uid(), pk = 'img' + uid(); media[vk] = url; media[pk] = info.poster;
    const k = Math.min(1, 800 / info.w, 450 / info.h);
    const o = addObject({type: 'video', name: nextName('Videó'), media: vk, poster: pk, w: Math.round(info.w * k), h: Math.round(info.h * k), start: 'click', duration: info.duration, trim: {from: 0, to: info.duration}});
    if (at) { o.x = Math.round(Math.max(0, Math.min(W - o.w, at.x - o.w / 2))); o.y = Math.round(Math.max(0, Math.min(H - o.h, at.y - o.h / 2))); }
    commit();
    if (f.data.byteLength > 80e6) toast('Nagy videó: a bemutató fájlja is ekkora lesz.');
  } catch (e) { toast(e.message || 'A videó nem tölthető be.'); }
  busy('');
}
function updateVidBar() {
  const o = selObj(), show = o?.type === 'video' && !o.locked && !editing;
  $('#vidBar').hidden = !show; if (!show) { stopVidPreview(); return; }
  $('#vidStart').value = o.start || 'click';
  drawTimeline(o);
  $('#vidCrop').classList.toggle('on', cropping === o.id); $('#vidUncrop').disabled = !o.crop;
}
/** Simple timeline: the whole video, the kept part in red, two handles for its start and end. */
function drawTimeline(o, cur) {
  const d = o.duration || 1, from = o.trim?.from || 0, to = o.trim?.to ?? d;
  $('#vtlSel').style.left = from / d * 100 + '%'; $('#vtlSel').style.width = (to - from) / d * 100 + '%';
  $('#vtlA').style.left = from / d * 100 + '%'; $('#vtlB').style.left = to / d * 100 + '%';
  $('#vtlA').title = 'Eleje: ' + fmtT(from); $('#vtlB').title = 'Vége: ' + fmtT(to);
  $('#vtlPh').hidden = cur == null; if (cur != null) $('#vtlPh').style.left = cur / d * 100 + '%';
  $('#vidLen').textContent = `${fmtT(from)} – ${fmtT(to)}  (${fmtT(to - from)})`;
}
let tlDrag = null;
for (const hEl of ['#vtlA', '#vtlB']) $(hEl).addEventListener('pointerdown', e => {
  const o = selObj(); if (o?.type !== 'video') return;
  e.preventDefault(); e.stopPropagation(); stopVidPreview(); e.target.setPointerCapture(e.pointerId);
  tlDrag = {end: e.target.dataset.end, o, rect: $('#vidTl .vtl-track').getBoundingClientRect()};
});
document.addEventListener('pointermove', e => {
  if (!tlDrag) return;
  const {o, rect, end} = tlDrag, d = o.duration || 1, t = Math.max(0, Math.min(d, (e.clientX - rect.left) / rect.width * d));
  const tr = {from: o.trim?.from || 0, to: o.trim?.to ?? d};
  if (end === 'from') tr.from = Math.min(t, tr.to - 0.2); else tr.to = Math.max(t, tr.from + 0.2);
  tr.from = Math.max(0, Math.round(tr.from * 10) / 10); tr.to = Math.min(d, Math.round(tr.to * 10) / 10);
  o.trim = tr; drawTimeline(o, end === 'from' ? tr.from : tr.to);
});
document.addEventListener('pointerup', async () => {
  if (!tlDrag) return; const {o} = tlDrag; tlDrag = null;
  try { const info = await videoInfo(media[o.media], (o.trim?.from || 0) + 0.05); const pk = 'img' + uid(); media[pk] = info.poster; o.poster = pk; } catch (e) { /* keep the picture */ }
  commit();
});
let vidPrev = null;
function stopVidPreview() {
  if (!vidPrev) return; const {v, img} = vidPrev; vidPrev = null;
  v.pause(); if (v.isConnected) v.replaceWith(img); $('#vidPlay .lbl').textContent = '▶ Előnézet';
  const o = selObj(); if (o?.type === 'video') drawTimeline(o);
}
$('#vidPlay').onclick = () => {
  if (vidPrev) { stopVidPreview(); return; }
  const o = selObj(); if (o?.type !== 'video') return;
  const box = stage.querySelector(`.obj[data-id="${o.id}"] .cropbox`); if (!box) return;
  const img = box.querySelector('img'), v = document.createElement('video');
  v.src = media[o.media]; v.style.cssText = img.style.cssText; v.className = 'vidprev'; v.playsInline = true;
  img.replaceWith(v); vidPrev = {v, img, o}; $('#vidPlay .lbl').textContent = '❚❚ Szünet';
  const from = o.trim?.from || 0, to = o.trim?.to ?? o.duration;
  v.onloadedmetadata = () => { v.currentTime = from; v.play().catch(stopVidPreview); };
  v.ontimeupdate = () => { drawTimeline(o, v.currentTime); if (v.currentTime >= to) stopVidPreview(); };
};
$('#vidCrop').onclick = () => cropping ? endCrop() : startCrop();
$('#vidUncrop').onclick = () => { const o = selObj(); if (!o?.crop) return; Object.assign(o, fullRect(o)); delete o.crop; cropping = null; commit(); };
/* ---------- lines: arrow heads ---------- */
function updateLineBar() {
  const o = selObj(), show = o?.shape === 'line' && !o.locked;
  $('#lineBar').hidden = !show; if (!show) return;
  $('#headStart').value = o.headStart || 'none'; $('#headEnd').value = o.headEnd || 'none';
}
$('#lineBar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
for (const id of ['headStart', 'headEnd']) $('#' + id).onchange = e => { const o = selObj(); if (o?.shape !== 'line') return; o[id] = e.target.value === 'none' ? undefined : e.target.value; commit(); };
$('#lineSwap').onclick = () => { const o = selObj(); if (o?.shape !== 'line') return; [o.headStart, o.headEnd] = [o.headEnd, o.headStart]; if (!o.headStart) delete o.headStart; if (!o.headEnd) delete o.headEnd; commit(); };
function updateImgBar() {
  updateVidBar(); updateLineBar();
  const o = selObj(), show = o?.type === 'image' && !o.locked && !editing;
  $('#imgBar').hidden = !show; if (!show) { if (cropping && (!o || o.id !== cropping)) { cropping = null; stage.querySelectorAll('.cropghost').forEach(x => x.remove()); } return; }
  $('#imgCrop').classList.toggle('on', cropping === o.id);
  $('#imgUncrop').disabled = !o.crop;
}
$('#imgBar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
$('#imgCrop').onclick = () => cropping ? endCrop() : startCrop();
$('#imgUncrop').onclick = () => { const o = selObj(); if (!o?.crop) return; Object.assign(o, fullRect(o)); delete o.crop; cropping = null; commit(); };
/** The new picture fills the frame without distortion: the extra part is cropped off (can be undone with Eredeti kép). */
function coverCrop(o, iw, ih) {
  const A = o.w / o.h, B = iw / ih;
  if (Math.abs(A - B) < 0.005) { delete o.crop; return; }
  const c = B > A ? {l: (1 - A / B) / 2, t: 0, r: (1 - A / B) / 2, b: 0} : {l: 0, t: (1 - B / A) / 2, r: 0, b: (1 - B / A) / 2};
  for (const k in c) c[k] = Math.round(c[k] * 10000) / 10000;
  o.crop = c;
}
$('#imgReplace').onclick = () => { const o = selObj(); if (o?.type !== 'image') return; pickImage((key, img) => { o.media = key; coverCrop(o, img.naturalWidth || img.width, img.naturalHeight || img.height); commit(); }); };
/** Resize in the object's rotated frame, keeping the opposite handle fixed. Groups scale uniformly. */
function doResize(o, p, keepRatio, noSnap) {
  if (cropping === o.id) {                                       // crop: the frame moves over the fixed picture
    const {h, p0, o0} = action, F = fullRect(o0), dx = p.x - p0.x, dy = p.y - p0.y;
    let x0 = o0.x, y0 = o0.y, x1 = o0.x + o0.w, y1 = o0.y + o0.h;
    if (h.includes('w')) x0 = Math.min(x1 - 10, Math.max(F.x, x0 + dx)); if (h.includes('e')) x1 = Math.max(x0 + 10, Math.min(F.x + F.w, x1 + dx));
    if (h.includes('n')) y0 = Math.min(y1 - 10, Math.max(F.y, y0 + dy)); if (h.includes('s')) y1 = Math.max(y0 + 10, Math.min(F.y + F.h, y1 + dy));
    Object.assign(o, {x: x0, y: y0, w: x1 - x0, h: y1 - y0});
    const c = {l: (x0 - F.x) / F.w, t: (y0 - F.y) / F.h, r: (F.x + F.w - x1) / F.w, b: (F.y + F.h - y1) / F.h};
    for (const k_ in c) c[k_] = Math.max(0, Math.round(c[k_] * 10000) / 10000);
    if (c.l + c.t + c.r + c.b > 0.0001) o.crop = c; else delete o.crop;
    return;
  }
  const {h, p0, o0} = action, t = (o0.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = p.x - p0.x, dy = p.y - p0.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const sx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0, sy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0;
  let w = Math.max(16, o0.w + sx * lx), hh = Math.max(16, o0.h + sy * ly);
  if (isText(o) || o.shape === 'line') hh = o0.h;
  else if ((keepRatio || o.type === 'group' || o.type === 'image' || o.type === 'video') && sx && sy) { const k = Math.max(w / o0.w, hh / o0.h); w = o0.w * k; hh = o0.h * k; }
  else if (o.type === 'group') { const k = sx ? w / o0.w : hh / o0.h; w = o0.w * k; hh = o0.h * k; }
  // the dragged edges snap to the same lines as moving does (unrotated objects; Alt: no snapping)
  clearGuides();
  if (!noSnap && !((o0.rot || 0) % 360)) {
    const {xs, ys} = snapLines(action.skip ||= snapSkip([o.id]));
    const fixedH = isText(o) || o.shape === 'line', oneScale = o.type === 'group' || ((keepRatio || o.type === 'image' || o.type === 'video') && sx && sy);
    const hx = sx ? nearLine(sx > 0 ? o0.x + w : o0.x + o0.w - w, xs) : null;
    const hy = sy && !fixedH ? nearLine(sy > 0 ? o0.y + hh : o0.y + o0.h - hh, ys) : null;
    if (oneScale) {                                               // one scale factor: the nearer line wins
      if (hx && (!hy || Math.abs(hx.d) <= Math.abs(hy.d))) { w += sx * hx.d; hh = o0.h * w / o0.w; guide('v', hx.line); }
      else if (hy) { hh += sy * hy.d; w = o0.w * hh / o0.h; guide('h', hy.line); }
    } else {
      if (hx) { w += sx * hx.d; guide('v', hx.line); }
      if (hy) { hh += sy * hy.d; guide('h', hy.line); }
    }
  }
  const cx0 = o0.x + o0.w / 2, cy0 = o0.y + o0.h / 2, ax = -sx * o0.w / 2, ay = -sy * o0.h / 2;
  const Ax = cx0 + ax * c - ay * s, Ay = cy0 + ax * s + ay * c, nx = sx * w / 2, ny = sy * hh / 2;
  const cx = Ax + nx * c - ny * s, cy = Ay + nx * s + ny * c;
  if (o.type === 'group') { const k = w / o0.w; scaleFrom(o, o0, k, o0.x, o0.y); moveObject(o, Math.round(cx - w / 2) - o.x, Math.round(cy - hh / 2) - o.y); return; }
  o.w = Math.round(w); o.h = Math.round(hh); o.x = Math.round(cx - w / 2); o.y = Math.round(cy - hh / 2);
}
/** Lines objects can snap to: the slide's edges and middle, and the edges and middles of the other objects. */
function snapLines(skip) {
  const xs = [0, W / 2, W], ys = [0, H / 2, H];
  for (const q of tgt().objects) if (!skip.has(q.id) && !q.hidden) { const b = bounds(q); xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
  return {xs, ys};
}
const nearLine = (v, cands) => { const T_ = 6 / scale; let r = null; for (const c of cands) { const d = c - v; if (Math.abs(d) < T_ && (!r || Math.abs(d) < Math.abs(r.d))) r = {d, line: c}; } return r; };
const clearGuides = () => stage.querySelectorAll('.guide').forEach(g => g.remove());
const snapSkip = ids => new Set([...ids, ...ids.map(id => groupOf(id)?.id).filter(Boolean)]);
/** Snap a box (the bounds of everything that is being moved): the correction [dx, dy]; draws the guides. */
function snapBox(b, skip) {
  clearGuides();
  const {xs, ys} = snapLines(skip);
  const best = (pos, size, cands) => { let r = null; for (const off of [0, size / 2, size]) { const h = nearLine(pos + off, cands); if (h && (!r || Math.abs(h.d) < Math.abs(r.d))) r = h; } return r; };
  const bx = best(b.x, b.w, xs), by = best(b.y, b.h, ys);
  if (bx) guide('v', bx.line);
  if (by) guide('h', by.line);
  return [bx ? bx.d : 0, by ? by.d : 0];
}
function guide(dir, v) {
  const g = document.createElement('div'); g.className = 'guide';
  Object.assign(g.style, dir === 'v' ? {left: v + 'px', top: 0, width: 1 / scale + 'px', height: H + 'px'} : {top: v + 'px', left: 0, height: 1 / scale + 'px', width: W + 'px'});
  stage.appendChild(g);
}
/** Redraw one object after a geometry / style change (without a full re-render). */
function updateObjLive(o, quiet) {
  const el = stage.querySelector(`.obj[data-id="${o.id}"]`); if (!el) return;
  const g = groupOf(o.id);
  if (editing === o.id) { placeEl(el, o); txtStyle(el.querySelector('.txt'), o); }
  else if (g) { const ge = stage.querySelector(`.obj[data-id="${g.id}"]`); fitGroup(g); ge?.replaceWith(objEl(g, 'edit')); }
  else el.replaceWith(objEl(o, 'edit'));
  if (isTextLike(o) || g) measureTexts();
  if (!quiet) { drawSelection(); drawBadges(); syncGeometryInputs(o); drawTableHandles(); }
}
function select(id) {
  if (sel === id && selIds.length === 1) return;
  setSel(id ? [id] : []); curAnim = null; drawSelection(); renderProps(); updateRibbon();
}

