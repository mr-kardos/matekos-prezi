/* ================================================================== rendering */
/** A polygon with rounded corners (radius r, limited by the edges). */
function roundPoly(pts, r) {
  if (!r) return 'M' + pts.map(p => p.map(r1).join(' ')).join(' L') + ' Z';
  const n = pts.length; let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]), rr = Math.min(r, la / 2, lb / 2);
    const s1 = [p[0] + (a[0] - p[0]) * rr / la, p[1] + (a[1] - p[1]) * rr / la], s2 = [p[0] + (b[0] - p[0]) * rr / lb, p[1] + (b[1] - p[1]) * rr / lb];
    d += (i ? ' L' : 'M') + s1.map(r1).join(' ') + ' Q' + p.map(r1).join(' ') + ' ' + s2.map(r1).join(' ');
  }
  return d + ' Z';
}
const DASH = {dash: k => `${r1(k * 3.2)} ${r1(k * 2.2)}`, dot: k => `0.01 ${r1(k * 2)}`, dashdot: k => `${r1(k * 3.2)} ${r1(k * 1.8)} 0.01 ${r1(k * 1.8)}`};
/** Arrow head at (x, y) pointing in direction (ux, uy): returns [svg, how far the line must stop before (x, y)]. */
function head(kind, x, y, ux, uy, sw, color) {
  if (!kind || kind === 'none') return ['', 0];
  const L = Math.max(7, sw * 3.6), Wd = Math.max(6, sw * 3), nx = -uy, ny = ux, bx = x - ux * L, by = y - uy * L;
  const p = (a, b) => `${r1(a)},${r1(b)}`;
  if (kind === 'triangle') return [`<polygon points="${p(x, y)} ${p(bx + nx * Wd / 2, by + ny * Wd / 2)} ${p(bx - nx * Wd / 2, by - ny * Wd / 2)}" fill="${color}"/>`, L * 0.9];
  if (kind === 'arrow') return [`<polyline points="${p(bx + nx * Wd / 2, by + ny * Wd / 2)} ${p(x, y)} ${p(bx - nx * Wd / 2, by - ny * Wd / 2)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`, sw * 0.5];
  if (kind === 'circle') { const rr = Math.max(3.5, sw * 1.8); return [`<circle cx="${r1(x - ux * rr)}" cy="${r1(y - uy * rr)}" r="${r1(rr)}" fill="${color}"/>`, rr]; }
  if (kind === 'diamond') { const rr = Math.max(4.5, sw * 2.2), cx = x - ux * rr, cy = y - uy * rr;
    return [`<polygon points="${p(cx + ux * rr, cy + uy * rr)} ${p(cx + nx * rr * .7, cy + ny * rr * .7)} ${p(cx - ux * rr, cy - uy * rr)} ${p(cx - nx * rr * .7, cy - ny * rr * .7)}" fill="${color}"/>`, rr]; }
  return ['', 0];
}
function shapeSVG(o) {
  const line = o.shape === 'line';
  const sw = o.stroke ? (o.strokeWidth ?? 3) : 0, h2 = sw / 2, {w, h} = o;
  const dash = o.dash && DASH[o.dash] && sw ? ` stroke-dasharray="${DASH[o.dash](sw)}"` : '';
  const cap = line || o.dash === 'dot' || o.dash === 'dashdot' ? ' stroke-linecap="round"' : '';
  const fill = (o.fill || 'none') + (o.fill && o.fillOpacity != null ? `" fill-opacity="${o.fillOpacity}` : ''),
    st = o.stroke ? ` stroke="${o.stroke}" stroke-width="${sw}" stroke-linejoin="round"${cap}${dash}${o.strokeOpacity != null ? ` stroke-opacity="${o.strokeOpacity}"` : ''}` : '';
  const R = Math.max(0, o.radius || 0);
  let body;
  if (o.shape === 'rect') body = `<rect x="${h2}" y="${h2}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" rx="${R}" fill="${fill}"${st}/>`;
  else if (o.shape === 'ellipse') body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - h2)}" ry="${Math.max(0, h / 2 - h2)}" fill="${fill}"${st}/>`;
  else if (o.shape === 'triangle') body = `<path d="${roundPoly([[w / 2, h2 * 1.2], [w - h2 * 1.2, h - h2], [h2 * 1.2, h - h2]], R)}" fill="${fill}"${st}/>`;
  else if (o.shape === 'path' && Array.isArray(o.path)) {
    const straight = o.path.every(([c]) => c === 'M' || c === 'L' || c === 'Z') && o.path.filter(([c]) => c === 'M').length === 1;
    if (R && straight) body = `<path d="${roundPoly(o.path.filter(([c]) => c !== 'Z').map(([, x, y]) => [x * w, y * h]), R)}" fill="${fill}"${st}/>`;
    else body = `<path d="${o.path.map(([c, ...v]) => c + v.map((n, i) => r1(i % 2 ? n * h : n * w)).join(' ')).join(' ')}" fill="${fill}"${st}/>`;
  }
  else if (line) {
    const y = h / 2, x1 = Math.min(h2, w / 2), x2 = Math.max(w / 2, w - h2), c = o.stroke || '#000';
    const [hs, cut1] = head(o.headStart, x1, y, -1, 0, sw, c), [he, cut2] = head(o.headEnd, x2, y, 1, 0, sw, c);
    body = `<line x1="${r1(x1 + cut1)}" y1="${y}" x2="${r1(x2 - cut2)}" y2="${y}" fill="none"${st}/>${hs}${he}`;
  }
  else {
    const hl = Math.min(h * 0.9, w * 0.45), t = h * 0.22, m = h / 2;
    const pts = [[h2, m - t], [w - hl, m - t], [w - hl, h2], [w - h2, m], [w - hl, h - h2], [w - hl, m + t], [h2, m + t]];
    body = `<path d="${roundPoly(pts, R)}" fill="${fill}"${st}/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${body}</svg>`;
}
function txtStyle(t, o) {
  Object.assign(t.style, {fontFamily: o.font ? `${familyCSS(o.font)}, var(--slide-font)` : '', textTransform: o.upper ? 'uppercase' : '',letterSpacing: o.letterSpacing ? o.letterSpacing + 'pt' : '', lineHeight: o.lineHeight || '', fontSize: o.size + 'px', color: o.color, textAlign: o.align, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal',
    textDecorationLine: [o.underline && 'underline', o.strike && 'line-through'].filter(Boolean).join(' ') || 'none'});
}
let measureT = 0;
const onMathRendered = () => { clearTimeout(measureT); measureT = setTimeout(() => { measureTexts(); drawSelection(); drawBadges(); }, 30); };
/** One object as DOM. (ox, oy) = origin of the parent (a group's top-left corner). */
/* automatic fields (template builder): slide number and date */
const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
let renderNum = null;                              // number of the slide being drawn (null: master / layout)
function fieldText(f) {
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  if (f === 'slideNumber') return renderNum == null ? '‹#›' : String(renderNum);
  if (f === 'dateLong') return `${d.getFullYear()}. ${MONTHS[d.getMonth()]} ${d.getDate()}.`;
  if (f === 'dateShort') return `${d.getFullYear()}. ${p2(d.getMonth() + 1)}. ${p2(d.getDate())}.`;
  return '';
}
function objEl(o, rmode, tpl = false, ox = 0, oy = 0) {
  if (o.field) o = {...o, doc: textDoc([T(fieldText(o.field))])};
  const el = document.createElement('div');
  if (o.hidden) el.hidden = true;
  el.className = `obj ${o.type}${tpl ? ' tpl' : ''}${o.placeholder ? ' placeholder' : ''}${o.locked ? ' locked' : ''}${o.shape ? ' s-' + o.shape : ''}`;
  el.dataset.id = o.id;
  Object.assign(el.style, {left: (o.x - ox) + 'px', top: (o.y - oy) + 'px', width: o.w + 'px', height: o.h + 'px'});
  const r = document.createElement('div'); r.className = 'rot';
  if (o.rot) r.style.transform = `rotate(${o.rot}deg)`;
  el.appendChild(r);
  if (o.opacity != null && o.opacity < 1) r.style.opacity = o.opacity;
  if ((o.type === 'image' || o.type === 'video') && o.radius) { r.style.borderRadius = o.radius + 'px'; r.style.overflow = 'hidden'; }
  if (o.type === 'group') { for (const c of o.children) r.appendChild(objEl(c, rmode, tpl, o.x, o.y)); return el; }
  if (o.type === 'text' || o.type === 'table') {
    const empty = isEmptyText(o);
    if (o.placeholder && mode === 'template' && !tpl) { el.classList.add('phbox'); el.dataset.label = phName(o.placeholder); }
    if (!empty) el.classList.add('filled');
    if (empty && rmode !== 'edit') el.style.visibility = 'hidden';
    const t = document.createElement('div'); t.className = 'txt' + (empty && rmode === 'edit' && o.prompt ? ' empty' : ''); t.dataset.prompt = (o.prompt === 'Kattints duplán a cím beírásához' ? 'Cím' : o.prompt) ?? '';
    txtStyle(t, o); r.appendChild(t);
    const parts = rmode === 'show' && !tpl && partsSlide && Anim.splitMode(partsSlide, o)?.mode === 'parts';   // formulas revealed part by part
    if (parts) t.dataset.parts = '1';
    renderStatic(t, parts ? markDoc(o.doc) : o.doc, rmode === 'edit' ? onMathRendered : null, kindOf(o));
  } else if (o.type === 'shape') r.innerHTML = shapeSVG(o);
  else if (o.type === 'video') {
    const {l = 0, t = 0, r: rr = 0, b = 0} = o.crop || {}, fw = 1 / (1 - l - rr), fh = 1 / (1 - t - b);
    const pos = `left:${-l * fw * 100}%;top:${-t * fh * 100}%;width:${fw * 100}%;height:${fh * 100}%`;
    r.innerHTML = rmode === 'show'
      ? `<div class="cropbox"><video src="${media[o.media] ?? ''}" preload="auto" playsinline style="${pos}"></video></div>`
      : `<div class="cropbox"><img src="${media[o.poster] ?? ''}" alt="" draggable="false" style="${pos}"></div>${rmode === 'edit' ? '<span class="vidbadge">▶</span>' : ''}`;
  }
  else if (o.type === 'image') {
    if (o.crop) { const {l = 0, t = 0, r: rr = 0, b = 0} = o.crop, fw = 1 / (1 - l - rr), fh = 1 / (1 - t - b);
      r.innerHTML = `<div class="cropbox"><img src="${media[o.media] ?? ''}" alt="" draggable="false" style="left:${-l * fw * 100}%;top:${-t * fh * 100}%;width:${fw * 100}%;height:${fh * 100}%"></div>`; }
    else r.innerHTML = `<img src="${media[o.media] ?? ''}" alt="" draggable="false">`;
  }
  return el;
}
function paintBackground(clip, src) {
  clip.style.background = src.bgColor || '#ffffff';
  if (src.background && media[src.background]) {
    const bg = document.createElement('img'); bg.src = media[src.background]; bg.className = 'tpl'; bg.alt = ''; bg.draggable = false;
    Object.assign(bg.style, {position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}); clip.appendChild(bg);
  }
}
function paintLayoutBase(clip, L, rmode, withLayoutObjs) {
  paintBackground(clip, L.ownBg ? L : doc.master);
  if (L.showMaster) for (const o of doc.master.objects) clip.appendChild(objEl(o, rmode, true));
  if (withLayoutObjs) for (const o of L.objects) if (!o.placeholder) clip.appendChild(objEl(o, rmode, true));
}
function newClip(el) { el.innerHTML = ''; const c = document.createElement('div'); c.className = 'clip'; el.appendChild(c); return c; }
let partsSlide = null;               // the slide being drawn for the slideshow / an export (objEl marks its formula parts)
function renderSlide(s, el, rmode) {
  const clip = newClip(el), i = doc.slides.indexOf(s);
  renderNum = i >= 0 ? i + 1 : null; partsSlide = rmode === 'show' ? s : null;
  paintLayoutBase(clip, layoutOf(s), rmode, true);
  for (const o of s.objects) clip.appendChild(objEl(o, rmode));
  renderNum = null; partsSlide = null;
  if (rmode === 'show' && clip.querySelector('.txt[data-parts]')) {          // formulas rendered later get their parts then
    new MutationObserver(() => clip.querySelectorAll('.txt[data-parts]').forEach(refreshParts)).observe(clip, {childList: true, subtree: true});
  }
  return clip;
}
function renderTemplate(key, el, rmode) {
  const clip = newClip(el);
  if (key === 'master') { paintBackground(clip, doc.master); for (const o of doc.master.objects) clip.appendChild(objEl(o, rmode)); return clip; }
  const L = doc.templates[key];
  paintLayoutBase(clip, L, rmode, false);
  for (const o of L.objects) clip.appendChild(objEl(o, rmode));
  return clip;
}

const stage = $('#stage'), stageWrap = $('#stageWrap'), work = $('#work');
let scale = 1, zoom = 'auto';
function fitStage() {
  const r = work.getBoundingClientRect();
  scale = zoom === 'auto' ? Math.max(0.15, Math.min((r.width - 56) / W, (r.height - 56) / H)) : zoom / 100;
  Object.assign(stageWrap.style, {width: W * scale + 'px', height: H * scale + 'px'});
  stage.style.transform = `scale(${scale})`;
  stage.style.setProperty('--inv', 1 / scale);
  drawTableHandles(); drawMathCaret();
}
const groupOf = id => parentGroup(tgt().objects, id) || null;
/** Position of an element relative to its parent group. */
function placeEl(el, o) {
  const g = groupOf(o.id);
  Object.assign(el.style, {left: (o.x - (g ? g.x : 0)) + 'px', top: (o.y - (g ? g.y : 0)) + 'px', width: o.w + 'px'});
  if (o.type !== 'text' && o.type !== 'table') el.style.height = o.h + 'px';
  el.querySelector(':scope > .rot').style.transform = o.rot ? `rotate(${o.rot}deg)` : '';
}
function renderStage() {
  const keep = editing && stage.querySelector(`.obj[data-id="${editing}"]`);
  if (mode === 'slides') renderSlide(tgt(), stage, 'edit'); else renderTemplate(tcur, stage, 'edit');
  if (keep) {                                     // the live editor survives re-rendering
    const fresh = stage.querySelector(`.obj[data-id="${editing}"]`), o = objById(editing);
    if (fresh && o) { fresh.replaceWith(keep); keep.classList.add('editing'); placeEl(keep, o); txtStyle(keep.querySelector('.txt'), o); }
  }
  document.body.classList.toggle('tplmode', mode === 'template');
  measureTexts(); drawSelection(); drawBadges(); drawTableHandles();
}
/** Text boxes and tables grow with their content; the measured height is stored in the model (export uses it). */
function measureTexts() {
  let groups = false;
  for (const el of stage.querySelectorAll('.obj.text:not(.tpl), .obj.table:not(.tpl)')) {
    const o = objById(el.dataset.id); if (!o) continue;
    if (action?.type === 'resize' && o.type === 'table' && o.id === sel) { el.style.height = o.h + 'px'; continue; }   // dragging its height
    const h = el.firstChild.offsetHeight;
    if (h && Math.abs(h - o.h) > .5) { o.h = h; el.style.height = h + 'px'; if (groupOf(o.id)) groups = true; }
  }
  if (groups) for (const g of tgt().objects) if (g.type === 'group') {
    fitGroup(g); const ge = stage.querySelector(`.obj[data-id="${g.id}"]`);
    if (ge) { Object.assign(ge.style, {left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px'}); for (const c of g.children) { const ce = ge.querySelector(`.obj[data-id="${c.id}"]`); if (ce) placeEl(ce, c); } }
  }
}
function renderAll() { renderStage(); renderThumbs(); renderProps(); updateRibbon(); drawComments(); drawFind(); if (cmtOpen()) renderComments(); }

