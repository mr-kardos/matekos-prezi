/* ================================================================== slideshow preview */
const show = $('#show'), SHOW = show;
let sh = null;
function startShow(i) {
  if (editing) exitEdit(); if (mode === 'template') closeTemplateBuilder();
  show.classList.add('on'); show.requestFullscreen?.().catch(() => {});
  sh = {i, step: 0, busy: null}; loadShowSlide(i, 0, true);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && sh) stopShow(); });
function stopShow() { show.querySelectorAll('video').forEach(v => v.pause()); show.classList.remove('on'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); show.querySelector('.slide')?.remove(); sh = null; }
function showScale(el) { const k = Math.min(innerWidth / W, innerHeight / H); Object.assign(el.style, {transform: `scale(${k})`, left: (innerWidth - W * k) / 2 + 'px', top: (innerHeight - H * k) / 2 + 'px'}); }
function keyEl(root, key) {
  const [id, part] = key.split('#');
  const el = root.querySelector(`.obj[data-id="${id}"]`);
  if (part == null || !el) return el;
  const txt = el.querySelector('.txt');
  return (txt.dataset.parts ? partPieces(txt) : pieceEls(txt))[+part];
}
/** Show / hide an animated piece: an element, or a set of formula parts and text (parts.js). */
const setVis = (e, v) => { if (e.set) setPartVis(e, v === 'hidden' ? 'hidden' : ''); else e.style.visibility = v; };
function loadShowSlide(i, step, animateAuto, withTransition) {
  const old = show.querySelector('.slide');
  show.querySelectorAll('.slide.leaving').forEach(x => x.remove());
  const el = document.createElement('div'); el.className = 'slide';
  renderSlide(doc.slides[i], el, 'show'); showScale(el);
  const t = withTransition && old ? doc.slides[i].transition : null;
  let wait = 0;
  if (t && t.type && t.type !== 'none') { old.classList.add('leaving'); show.append(el); wait = playTransition(old, el, t); }
  else { old?.remove(); show.prepend(el); }
  const list = Anim.expand(doc.slides[i]), groups = Anim.groups(list);
  for (const k of Anim.initiallyHidden(list)) { const e = keyEl(el, k); if (e) setVis(e, 'hidden'); }
  const offset = groups[0]?.auto ? 1 : 0;
  Object.assign(sh, {i, step, el, groups, offset, busy: null});
  const instant = grp => grp.chains.flat().forEach(a => { const e = keyEl(el, a.key); if (!e) return; const c = Anim.EFFECTS[a.effect].cls;
    if (c === 'entr') setVis(e, 'visible'); else if (c === 'exit') setVis(e, 'hidden'); else if (a.effect === 'grow' && !e.set) e.style.transform = 'scale(1.5)'; });
  let g = 0;
  if (offset) { if (animateAuto && step === 0) setTimeout(() => sh && sh.el === el && playGroup(el, groups[0]), wait); else instant(groups[0]); g = 1; }
  for (; g < step + offset; g++) instant(groups[g]);
  info();
  // videos of the slide
  const sl = doc.slides[i], vids = [...el.querySelectorAll('.obj.video video')].map(v => ({v, o: flatObjects(sl.objects).find(q => q.id === v.closest('.obj').dataset.id)})).filter(x => x.o);
  sh.videos = vids;
  for (const x of vids) {
    const from = x.o.trim?.from || 0, to = x.o.trim?.to || x.o.duration || 1e9;
    x.v.addEventListener('loadedmetadata', () => { x.v.currentTime = from; }, {once: true});
    x.v.addEventListener('timeupdate', () => { if (x.v.currentTime >= to) x.v.pause(); });
    x.v.addEventListener('click', e => { e.stopPropagation(); x.played = true; x.v.paused ? x.v.play() : x.v.pause(); });
    if (x.o.start === 'auto' && animateAuto !== false) { x.played = true; setTimeout(() => { if (sh && sh.el === el) x.v.play().catch(() => {}); }, wait + 50); }
  }
}
/** Slide transition in the preview (PowerPoint plays the same effect from the exported file). Returns its duration. */
function playTransition(old, el, t, box) {
  const dur = Math.max(100, t.dur ?? 700), k = box ? 1 : Math.min(innerWidth / W, innerHeight / H), sw = W * k, shh = H * k;
  const show = box || SHOW;
  const opt = {duration: dur, easing: 'ease-in-out', fill: 'both'};
  const from = {r: [sw, 0], l: [-sw, 0], b: [0, shh], t: [0, -shh]}[t.dir] ?? [sw, 0];
  const tr = ([x, y]) => `${x}px ${y}px`;
  const clipFrom = {r: 'inset(0 0 0 100%)', l: 'inset(0 100% 0 0)', b: 'inset(100% 0 0 0)', t: 'inset(0 0 100% 0)'}[t.dir] ?? 'inset(0 0 0 100%)';
  const anims = [];
  switch (t.type) {
    case 'fade': anims.push(el.animate([{opacity: 0}, {opacity: 1}], opt)); break;
    case 'fadeBlack': anims.push(old.animate([{opacity: 1}, {opacity: 0}], {...opt, duration: dur / 2}), el.animate([{opacity: 0}, {opacity: 0, offset: .5}, {opacity: 1}], opt)); break;
    case 'push': anims.push(el.animate([{translate: tr(from)}, {translate: '0px 0px'}], opt), old.animate([{translate: '0px 0px'}, {translate: tr(from.map(v => -v))}], opt)); break;
    case 'cover': anims.push(el.animate([{translate: tr(from)}, {translate: '0px 0px'}], opt)); break;
    case 'pull': show.append(old); anims.push(old.animate([{translate: '0px 0px'}, {translate: tr(from.map(v => -v))}], opt)); break;
    case 'wipe': anims.push(el.animate([{clipPath: clipFrom}, {clipPath: 'inset(0 0 0 0)'}], opt)); break;
    case 'split': { const v = (t.dir || 'vo')[0] !== 'h', out = (t.dir || 'vo')[1] !== 'i';
      const closed = v ? 'inset(0 50% 0 50%)' : 'inset(50% 0 50% 0)';
      if (out) anims.push(el.animate([{clipPath: closed}, {clipPath: 'inset(0 0 0 0)'}], opt));
      else { show.append(old); anims.push(old.animate([{clipPath: 'inset(0 0 0 0)'}, {clipPath: closed}], opt)); } break; }
    case 'zoom': anims.push(el.animate([{opacity: 0, scale: '.3'}, {opacity: 1, scale: '1'}], opt)); break;
  }
  Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => { old.remove(); anims.forEach(a => a.cancel()); });
  return dur;
}
function info() { show.querySelector('.info').textContent = `${sh.i + 1}. dia · ${sh.step}/${sh.groups.length - sh.offset}. lépés · Esc: kilépés` + (sh.num ? ` · ugrás a(z) ${sh.num}. diára: Enter` : ''); }
async function playGroup(root, g) {
  const running = [];
  const p = (async () => { for (const chain of g.chains) await Promise.all(chain.map(a => playEffect(root, a, running))); })();
  sh.busy = {running, p}; await p; if (sh) sh.busy = null;
}
function playEffect(root, a, running) {
  const el = keyEl(root, a.key); if (!el) return;
  const dur = Math.max(1, Anim.durOf(a)), delay = Anim.delayOf(a), opt = {duration: dur, delay, easing: 'ease-out', fill: 'backwards'};
  const after = (anim, fn) => { running.push(anim); return anim.finished.then(fn, () => {}); };
  const wait = () => new Promise(r => { const id = setTimeout(r, delay); running.push({finish: () => { clearTimeout(id); r(); }}); });
  const off = dir => {                        // translation (slide px) that puts the element just outside the slide
    const r = el.getBoundingClientRect(), sr = root.getBoundingClientRect(), k = sr.height / H;
    const x = dir.includes('l') ? -(r.right - sr.left) / k : dir.includes('r') ? (sr.right - r.left) / k : 0;
    const y = dir.includes('t') ? -(r.bottom - sr.top) / k : dir.includes('b') ? (sr.bottom - r.top) / k : 0;
    return `translate(${x}px, ${y}px)`;
  };
  if (el.set) {                                  // a part inside a paragraph: it fades in / out in the preview (PowerPoint plays the chosen effect)
    const E = Anim.EFFECTS[a.effect];
    if (E.cls === 'emph') return wait();
    const inn = E.cls === 'entr';
    if (E.instant) return wait().then(() => setPartVis(el, inn ? '' : 'hidden'));
    if (inn) setPartVis(el, '');
    const as = partEls(el).map(x => x.animate(inn ? [{opacity: 0}, {opacity: 1}] : [{opacity: 1}, {opacity: 0}], inn ? opt : {...opt, fill: 'forwards'}));
    if (!as.length) return wait();
    as.slice(1).forEach(x => running.push(x));
    return after(as[0], () => { if (!inn) { setPartVis(el, 'hidden'); as.forEach(x => x.cancel()); } });
  }
  const FLOAT = H * 0.1;
  switch (a.effect) {
    case 'appear': return wait().then(() => { el.style.visibility = 'visible'; });
    case 'disappear': return wait().then(() => { el.style.visibility = 'hidden'; });
    case 'fade': el.style.visibility = 'visible'; return after(el.animate([{opacity: 0}, {opacity: 1}], opt));
    case 'wipe': el.style.visibility = 'visible'; return after(el.animate([{clipPath: 'inset(-100% 100% -100% -100%)'}, {clipPath: 'inset(-100% -100% -100% -100%)'}], opt));
    case 'fly': el.style.visibility = 'visible'; return after(el.animate([{transform: off(Anim.dirOf(a))}, {transform: 'none'}], opt));
    case 'float': { el.style.visibility = 'visible'; const dy = Anim.dirOf(a) === 'd' ? -FLOAT : FLOAT;
      return after(el.animate([{opacity: 0, transform: `translateY(${dy}px)`}, {opacity: 1, transform: 'none'}], {...opt, easing: 'cubic-bezier(.2,.7,.3,1)'})); }
    case 'floatOut': { const dy = Anim.dirOf(a) === 'd' ? FLOAT : -FLOAT;
      const an = el.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: `translateY(${dy}px)`}], {...opt, easing: 'ease-in', fill: 'forwards'});
      return after(an, () => { el.style.visibility = 'hidden'; an.cancel(); }); }
    case 'pulse': return after(el.animate([{transform: 'scale(1)'}, {transform: 'scale(1.05)'}, {transform: 'scale(1)'}], {...opt, easing: 'ease-in-out', fill: 'none'}));
    case 'grow': { const an = el.animate([{transform: 'scale(1)'}, {transform: 'scale(1.5)'}], {...opt, fill: 'forwards'}); return after(an, () => { el.style.transform = 'scale(1.5)'; an.cancel(); }); }
    case 'spin': return after(el.animate([{transform: (el.style.transform || '') + ' rotate(0deg)'}, {transform: (el.style.transform || '') + ' rotate(360deg)'}], {...opt, fill: 'none'}));
    case 'fadeOut': { const an = el.animate([{opacity: 1}, {opacity: 0}], {...opt, fill: 'forwards'}); return after(an, () => { el.style.visibility = 'hidden'; an.cancel(); }); }
    case 'wipeOut': { const an = el.animate([{clipPath: 'inset(-100% -100% -100% -100%)'}, {clipPath: 'inset(-100% -100% -100% 100%)'}], {...opt, fill: 'forwards'}); return after(an, () => { el.style.visibility = 'hidden'; an.cancel(); }); }
    case 'flyOut': { const an = el.animate([{transform: 'none'}, {transform: off(Anim.dirOf(a))}], {...opt, easing: 'ease-in', fill: 'forwards'}); return after(an, () => { el.style.visibility = 'hidden'; an.cancel(); }); }
  }
}
function showNext() {
  if (sh.busy) { sh.busy.running.forEach(a => a.finish()); return; }
  const pv = sh.videos?.find(x => !x.played && x.o.start !== 'auto');   // "on click" videos play first, like in PowerPoint
  if (pv) { pv.played = true; pv.v.currentTime = pv.o.trim?.from || 0; pv.v.play().catch(() => {}); return; }
  const gi = sh.step + sh.offset;
  if (gi < sh.groups.length) { sh.step++; info(); playGroup(sh.el, sh.groups[gi]); return; }
  if (sh.i < doc.slides.length - 1) loadShowSlide(sh.i + 1, 0, true, true); else stopShow();
}
function showPrev() {
  if (sh.step > 0) loadShowSlide(sh.i, sh.step - 1, false);
  else if (sh.i > 0) { const g = Anim.groups(Anim.expand(doc.slides[sh.i - 1])); loadShowSlide(sh.i - 1, g.length - (g[0]?.auto ? 1 : 0), false); }
}
show.addEventListener('click', () => sh && showNext());
addEventListener('resize', () => { fitStage(); if (sh) showScale(sh.el); closePops(); });

