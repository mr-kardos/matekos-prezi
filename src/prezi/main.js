import '../styles.css';
import './prezi.css';
import JSZip from 'jszip';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { loadFonts } from '../fonts.js';
import { startMathJax, renderInto, mathReady } from '../math.js';
import { openMathEditor, isMathEditorOpen } from '../mathEditor.js';
import { tableContext } from '../editor/extensions.js';
import { svg as svgIcon } from '../icons.js';
import { isTauri, savePresentation, saveExport, openPresentation, openPathFile, watchOpenedFiles, setCurrentPath, autosave, loadAutosave } from '../files.js';
import { Anim } from './anim.js';
import { W, H, uid, clone, emptyDoc, textDoc, T, M, isEmptyText, blockCount, makeBackground, phName, ph, TITLE_PROMPT,
  defaultMaster, defaultTemplates, newSlide as makeSlide, syncPlaceholders as syncPh, migrate } from './model.js';
import { renderStatic, pieceEls, mountEditor, setTextHooks, mathPending } from './textview.js';
import { buildPptx, buildPdf } from './export.js';

const $ = s => document.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = v => Math.round(v * 10) / 10;
const PT = 0.75, MM = 96 / 25.4;
const CLS_COLOR = {entr: '#1f9d55', emph: '#c98a0b', exit: '#c0392b'};
const LS = {left: 'matekosprezi.leftw', panel: 'matekosprezi.panel', badges: 'matekosprezi.badges'};
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

startMathJax();

/* ================================================================== state */
let doc, media = {}, cur = 0, sel = null, curAnim = null;
let mode = 'slides', tcur = 'master';            // 'slides' | 'template' (template builder)
let editing = null, ed = null;                    // id of the text box being edited, its TipTap editor
let history = [], hIdx = -1, dirty = false;
let showBadges = lsGet(LS.badges) !== '0';

const tgt = () => mode === 'slides' ? doc.slides[cur] : tcur === 'master' ? doc.master : doc.templates[tcur];
const objById = id => tgt().objects.find(o => o.id === id);
const selObj = () => sel && objById(sel);
const isText = o => o?.type === 'text', isShape = o => o?.type === 'shape';
const layoutOf = s => doc.templates[s.template] ?? Object.values(doc.templates)[0];
const newSlide = t => makeSlide(doc, t);
const syncPlaceholders = s => syncPh(doc, s);

function blankDoc() {
  media = {bg1: makeBackground()};
  doc = {format: 'mprezi', version: 3, size: {w: W, h: H}, master: defaultMaster('bg1'), templates: defaultTemplates(), slides: []};
}
function demoDoc() {
  blankDoc();
  doc.title = 'Másodfokú egyenletek';
  const s1 = newSlide('cimdia');
  s1.objects[0].doc = textDoc([T('Másodfokú egyenletek')]);
  s1.objects[1].doc = textDoc([T('Általános alak: '), M('ax^2+bx+c=0,\\ a\\neq 0')]);
  const s2 = newSlide('tartalom');
  s2.objects[0].doc = textDoc([T('A megoldóképlet')]);
  s2.objects[1].doc = {type: 'doc', content: [
    {type: 'paragraph', content: [M('x_{1,2}=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}')]},
    {type: 'bulletList', content: [
      {type: 'listItem', content: [{type: 'paragraph', content: [T('Ha '), M('D>0'), T(', két különböző valós gyök van.')]}]},
      {type: 'listItem', content: [{type: 'paragraph', content: [T('Ha '), M('D=0'), T(', egy (kétszeres) valós gyök van.')]}]},
      {type: 'listItem', content: [{type: 'paragraph', content: [T('Ha '), M('D<0'), T(', nincs valós gyök.')]}]}]}]};
  const ell = {id: uid(), name: 'Ellipszis 1', type: 'shape', shape: 'ellipse', x: 860, y: 360, w: 300, h: 160, rot: -8, fill: '#d6eaf8', stroke: '#2f5d8a', strokeWidth: 3};
  s2.objects.push(ell);
  s2.anims = [
    {id: uid(), target: s2.objects[1].id, effect: 'fade', trigger: 'click', byParagraph: true},
    {id: uid(), target: ell.id, effect: 'fly', trigger: 'click'},
    {id: uid(), target: ell.id, effect: 'pulse', trigger: 'after', delay: 200}];
  const s3 = newSlide('csakcim');
  s3.objects[0].doc = textDoc([T('Értéktáblázat')]);
  s3.objects.push({id: uid(), name: 'Táblázat', type: 'text', x: 60, y: 160, w: 760, h: 200, rot: 0, size: 29.33, color: '#1a1a1a', align: 'left', doc: {type: 'doc', content: [
    {type: 'table', content: [
      {type: 'tableRow', content: [['x', '#e8eef5'], ['-1', '#e8eef5'], ['0', '#e8eef5'], ['1', '#e8eef5'], ['2', '#e8eef5']].map(([t, bg]) => ({type: 'tableCell', attrs: {background: bg}, content: [{type: 'paragraph', content: [M(t)]}]}))},
      {type: 'tableRow', content: ['f(x)=x^2', '1', '0', '1', '4'].map(t => ({type: 'tableCell', content: [{type: 'paragraph', content: [M(t)]}]}))}]},
    {type: 'paragraph', content: [T('A függvény grafikonja '), {type: 'text', marks: [{type: 'bold'}], text: 'parabola'}, T('.')]}]}});
  doc.slides = [s1, s2, s3];
}

/* ================================================================== history */
function snapshot() { return JSON.stringify({doc, cur, mode, tcur}); }
function setStatus(t) { $('#status').textContent = t ?? (dirty ? 'Nem mentett módosítások' : ''); }
function resetHistory() { history = [snapshot()]; hIdx = 0; dirty = false; $('#docTitle').value = doc.title || 'Névtelen bemutató'; setStatus(''); }
let autoT = 0;
function saveSoon() { clearTimeout(autoT); autoT = setTimeout(() => autosave({doc: JSON.parse(snapshot()).doc, media, title: doc.title}), 1200); }
function syncEditor() { if (editing && ed) { const o = objById(editing); if (o) o.doc = ed.getJSON(); } }
function commit() {
  syncEditor();
  history = history.slice(0, hIdx + 1); history.push(snapshot());
  if (history.length > 150) history.shift();
  hIdx = history.length - 1; dirty = true; setStatus(); saveSoon();
  renderAll();
}
function restore(i) {
  if (editing) stopEditor();
  hIdx = i; const s = JSON.parse(history[i]); doc = s.doc; mode = s.mode ?? 'slides'; tcur = s.tcur ?? 'master';
  cur = Math.min(s.cur, doc.slides.length - 1); if (mode === 'template' && tcur !== 'master' && !doc.templates[tcur]) tcur = 'master';
  if (sel && !objById(sel)) sel = null; renderAll(); saveSoon();
}
const undo = () => { if (editing) return ed.commands.undo(); if (hIdx > 0) restore(hIdx - 1); };
const redo = () => { if (editing) return ed.commands.redo(); if (hIdx < history.length - 1) restore(hIdx + 1); };

/* ================================================================== rendering */
function shapeSVG(o) {
  const sw = o.stroke ? (o.strokeWidth ?? 3) : 0, h2 = sw / 2, {w, h} = o;
  const fill = o.fill || 'none', st = o.stroke ? ` stroke="${o.stroke}" stroke-width="${sw}" stroke-linejoin="round"` : '';
  let body;
  if (o.shape === 'rect') body = `<rect x="${h2}" y="${h2}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" rx="${o.radius ?? 0}" fill="${fill}"${st}/>`;
  else if (o.shape === 'ellipse') body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - h2)}" ry="${Math.max(0, h / 2 - h2)}" fill="${fill}"${st}/>`;
  else {
    const hl = Math.min(h * 0.9, w * 0.45), t = h * 0.22, m = h / 2;
    const pts = [[h2, m - t], [w - hl, m - t], [w - hl, h2], [w - h2, m], [w - hl, h - h2], [w - hl, m + t], [h2, m + t]];
    body = `<polygon points="${pts.map(p => p.map(r1).join(',')).join(' ')}" fill="${fill}"${st}/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${body}</svg>`;
}
function txtStyle(t, o) {
  Object.assign(t.style, {fontSize: o.size + 'px', color: o.color, textAlign: o.align, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal',
    textDecorationLine: [o.underline && 'underline', o.strike && 'line-through'].filter(Boolean).join(' ') || 'none'});
}
let measureT = 0;
const onMathRendered = () => { clearTimeout(measureT); measureT = setTimeout(() => { measureTexts(); drawSelection(); drawBadges(); }, 30); };
function objEl(o, rmode, tpl = false) {
  const el = document.createElement('div');
  el.className = `obj ${o.type}${tpl ? ' tpl' : ''}${o.placeholder ? ' placeholder' : ''}`;
  el.dataset.id = o.id;
  Object.assign(el.style, {left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px'});
  const r = document.createElement('div'); r.className = 'rot';
  if (o.rot) r.style.transform = `rotate(${o.rot}deg)`;
  el.appendChild(r);
  if (o.type === 'text') {
    const empty = isEmptyText(o);
    if (o.placeholder && mode === 'template' && !tpl) { el.classList.add('phbox'); el.dataset.label = phName(o.placeholder); }
    if (!empty) el.classList.add('filled');
    if (empty && rmode !== 'edit') el.style.visibility = 'hidden';
    const t = document.createElement('div'); t.className = 'txt' + (empty && rmode === 'edit' && o.prompt ? ' empty' : ''); t.dataset.prompt = o.prompt ?? '';
    txtStyle(t, o); r.appendChild(t);
    renderStatic(t, o.doc, rmode === 'edit' ? onMathRendered : null);
  } else if (o.type === 'shape') r.innerHTML = shapeSVG(o);
  else if (o.type === 'image') r.innerHTML = `<img src="${media[o.media] ?? ''}" alt="" draggable="false">`;
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
function renderSlide(s, el, rmode) {
  const clip = newClip(el);
  paintLayoutBase(clip, layoutOf(s), rmode, true);
  for (const o of s.objects) clip.appendChild(objEl(o, rmode));
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
function renderStage() {
  const keep = editing && stage.querySelector(`.obj[data-id="${editing}"]`);
  if (mode === 'slides') renderSlide(tgt(), stage, 'edit'); else renderTemplate(tcur, stage, 'edit');
  if (keep) {                                     // the live editor survives re-rendering
    const fresh = stage.querySelector(`.obj[data-id="${editing}"]`), o = objById(editing);
    if (fresh && o) {
      fresh.replaceWith(keep);
      Object.assign(keep.style, {left: o.x + 'px', top: o.y + 'px', width: o.w + 'px'});
      keep.querySelector('.rot').style.transform = o.rot ? `rotate(${o.rot}deg)` : '';
      txtStyle(keep.querySelector('.txt'), o);
    }
  }
  document.body.classList.toggle('tplmode', mode === 'template');
  measureTexts(); drawSelection(); drawBadges(); drawTableHandles();
}
/** Text boxes grow with their content; the measured height is stored in the model (export uses it). */
function measureTexts() {
  for (const el of stage.querySelectorAll('.obj.text:not(.tpl)')) {
    const o = objById(el.dataset.id); if (!o) continue;
    const h = el.firstChild.offsetHeight;
    if (h && Math.abs(h - o.h) > .5) { o.h = h; el.style.height = h + 'px'; }
  }
}
function renderAll() { renderStage(); renderThumbs(); renderProps(); updateRibbon(); }

/* ================================================================== selection frame + animation badges */
function drawSelection() {
  stage.querySelector('#sel')?.remove();
  const o = selObj(); if (!o) return;
  const d = document.createElement('div'); d.id = 'sel';
  if (editing === o.id) d.className = 'editing';
  Object.assign(d.style, {left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px', transform: o.rot ? `rotate(${o.rot}deg)` : ''});
  const hs = o.type === 'text' ? ['nw', 'ne', 'e', 'se', 'sw', 'w'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const pos = {nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50]};
  const cr = {nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew'};
  d.innerHTML = '<div class="stem"></div><div class="h move" data-h="move" title="Mozgatás (Alt: illesztés nélkül)">' + svgIcon('move') + '</div>'
    + hs.map(h => `<div class="h" data-h="${h}" style="left:${pos[h][0]}%;top:${pos[h][1]}%;cursor:${cr[h]}-resize"></div>`).join('');
  stage.appendChild(d);
}
function drawBadges() {
  stage.querySelectorAll('.badges').forEach(b => b.remove());
  if (mode !== 'slides' || !showBadges) return;
  const s = tgt(), rg = Anim.ranges(Anim.expand(s)), map = {};
  for (const a of s.anims) if (rg[a.id]) (map[a.target] ??= []).push({r: rg[a.id], cls: Anim.EFFECTS[a.effect].cls});
  for (const [id, arr] of Object.entries(map)) {
    const o = objById(id); if (!o) continue;
    const b = document.createElement('div'); b.className = 'badges';
    const t = (o.rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
    const bw = o.w * c + o.h * sn, bh = o.w * sn + o.h * c;
    Object.assign(b.style, {left: o.x + o.w / 2 - bw / 2 + 'px', top: o.y + o.h / 2 - bh / 2 + 'px'});
    b.innerHTML = arr.map(({r, cls}) => `<span class="badge ${cls}" title="${Anim.CLASSES[cls]}">${r[0] === r[1] ? r[0] : r[0] + '–' + r[1]}</span>`).join('');
    stage.appendChild(b);
  }
}

/* ================================================================== left panel */
const slidesNav = $('#slides'), mainEl = $('#main');
function setLeftWidth(w) {
  w = Math.max(130, Math.min(420, Math.round(w)));
  mainEl.style.setProperty('--lw', w + 'px');
  mainEl.style.setProperty('--tk', ((w - 46) / W).toFixed(4));
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
function thumbFrame(label, cls) {
  const t = document.createElement('div'); t.className = 'thumb ' + (cls || '');
  t.innerHTML = `<div class="no">${label}</div><div class="frame"><div class="slide"></div></div>`;
  return t;
}
function renderThumbs() { mode === 'slides' ? renderSlideList() : renderTemplateList(); }
function renderSlideList() {
  slidesNav.innerHTML = '<div class="plist" id="plist"></div>';
  const list = $('#plist');
  doc.slides.forEach((s, i) => {
    const t = thumbFrame(i + 1, i === cur ? 'cur' : ''); t.draggable = true;
    renderSlide(s, t.querySelector('.slide'), 'thumb');
    t.onclick = () => gotoSlide(i);
    t.ondragstart = e => e.dataTransfer.setData('text/slide', i);
    t.ondragover = e => { e.preventDefault(); t.classList.add('dragover'); };
    t.ondragleave = () => t.classList.remove('dragover');
    t.ondrop = e => { e.preventDefault(); const from = e.dataTransfer.getData('text/slide'); if (from !== '') moveSlide(+from, i); };
    list.appendChild(t);
    if (i === cur) {
      const a = document.createElement('div'); a.className = 'slide-actions';
      a.innerHTML = `<button class="tb" id="sNew" title="Új dia az aktuális után – elrendezés választása">${svgIcon('plus')}<span>Új dia</span>${svgIcon('chev')}</button>
        <button class="tb" id="sDup" title="Az aktuális dia másolása">${svgIcon('copy')}</button>
        <button class="tb" id="sDel" title="Az aktuális dia törlése" ${doc.slides.length < 2 ? 'disabled' : ''}>${svgIcon('trash')}</button>`;
      list.appendChild(a);
    }
  });
  $('#sNew').onclick = e => showPop('popNewSlide', e.currentTarget);
  $('#sDup').onclick = () => { if (editing) exitEdit(); const s = clone(tgt()); const ids = {};
    s.id = uid(); s.objects.forEach(o => { ids[o.id] = uid(); o.id = ids[o.id]; });
    s.anims.forEach(a => { a.id = uid(); a.target = ids[a.target]; });
    doc.slides.splice(cur + 1, 0, s); cur++; sel = null; commit(); };
  $('#sDel').onclick = () => { if (doc.slides.length < 2) return; if (editing) exitEdit(); doc.slides.splice(cur, 1); cur = Math.min(cur, doc.slides.length - 1); sel = null; commit(); };
  list.querySelector('.slide-actions')?.scrollIntoView({block: 'nearest'});
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
  $('#layoutList').innerHTML = Object.entries(doc.templates).map(([k, L]) => `<button class="pitem${k === tgt().template ? ' on' : ''}" data-k="${k}">${esc(L.name)}</button>`).join('');
};
$('#lgalNew').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; closePops(); if (editing) exitEdit();
  doc.slides.splice(cur + 1, 0, newSlide(b.dataset.k)); cur++; sel = null; commit(); });
$('#layoutList').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; closePops(); if (editing) exitEdit();
  tgt().template = b.dataset.k; syncPlaceholders(tgt()); commit(); });
$('#resetPh').addEventListener('click', () => { closePops(); if (editing) exitEdit();
  for (const q of tgt().objects) if (q.placeholder) { delete q.phMoved; delete q.phStyled; } syncPlaceholders(tgt()); commit(); });

function renderTemplateList() {
  slidesNav.innerHTML = `<div class="plist"><div class="tplbar"><b>Sablonszerkesztő</b><button class="btn primary" id="tClose">Sablon bezárása</button></div>
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
      a.innerHTML = `<button class="tb" id="lAdd" title="Új elrendezés">${svgIcon('plus')}<span>Új elrendezés</span></button>
        <button class="tb" id="lDup" title="Elrendezés másolása">${svgIcon('copy')}</button>
        <button class="tb" id="lDel" title="Elrendezés törlése" ${keys.length < 2 ? 'disabled' : ''}>${svgIcon('trash')}</button>`;
      list.appendChild(a);
    }
  });
  if (tcur === 'master') { const a = document.createElement('div'); a.className = 'slide-actions'; a.innerHTML = `<button class="tb" id="lAdd">${svgIcon('plus')}<span>Új elrendezés</span></button>`; list.appendChild(a); }
  $('#tClose').onclick = closeTemplateBuilder;
  $('#lAdd').onclick = () => { if (editing) exitEdit(); const k = 'l' + uid(); doc.templates[k] = {name: 'Új elrendezés', ownBg: false, background: null, bgColor: '#ffffff', showMaster: true,
    objects: [ph('title', 60, 40, 1160, 33, '#2f5d8a', true, 'left', TITLE_PROMPT)]}; tcur = k; sel = null; commit(); };
  $('#lDup') && ($('#lDup').onclick = () => { if (editing) exitEdit(); const k = 'l' + uid(), c = clone(doc.templates[tcur]); c.name += ' (másolat)'; c.objects.forEach(o => o.id = uid());
    doc.templates[k] = c; tcur = k; sel = null; commit(); });
  $('#lDel') && ($('#lDel').onclick = () => {
    const used = doc.slides.filter(s => s.template === tcur).length;
    if (used && !confirm(`${used} dia használja ezt az elrendezést. Ezek az első elrendezésre váltanak. Törlöd?`)) return;
    if (editing) exitEdit();
    delete doc.templates[tcur]; const first = Object.keys(doc.templates)[0];
    doc.slides.forEach(s => { if (!doc.templates[s.template]) s.template = first; }); tcur = first; sel = null; commit(); });
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
function gotoSlide(i) { if (editing) exitEdit(); cur = i; sel = null; curAnim = null; renderAll(); }
function gotoTemplate(k) { if (editing) exitEdit(); tcur = k; sel = null; renderAll(); }
function openTemplateBuilder() {
  if (editing) exitEdit(); closePops();
  mode = 'template'; tcur = doc.slides[cur] ? doc.slides[cur].template : 'master'; sel = null; renderAll(); fitStage();
}
function closeTemplateBuilder() {
  if (editing) exitEdit(); closePops();
  for (const s of doc.slides) syncPlaceholders(s);
  mode = 'slides'; sel = null; commit(); fitStage();
}

/* ================================================================== pointer interaction on the slide */
const toStage = e => { const r = stage.getBoundingClientRect(); return {x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale}; };
const toStageRect = rr => { const s = stage.getBoundingClientRect(); return {x: (rr.left - s.left) / scale, y: (rr.top - s.top) / scale, w: rr.width / scale, h: rr.height / scale}; };
let action = null, lastDown = null;

stage.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (e.target.closest('#tblHandles')) return;
  const p = toStage(e), h = e.target.closest('.h');
  if (h) { startHandle(h.dataset.h, p, e); return; }
  const oel = e.target.closest('.obj:not(.tpl)');
  if (editing) {
    if (oel?.dataset.id === editing) return;                // the editor handles its own clicks
    exitEdit();
  }
  if (!oel) { select(null); lastDown = null; return; }
  const id = oel.dataset.id, now = performance.now();
  if (lastDown && lastDown.id === id && now - lastDown.t < 450 && oel.classList.contains('text')) {
    lastDown = null; e.preventDefault();
    if (mode === 'template' && objById(id)?.placeholder) { select(id); toast('A helykitöltő mintaszövegét a jobb oldali panelen adhatod meg.'); return; }
    enterEdit(id, e); return;
  }
  lastDown = {id, t: now};
  select(id);
  const o = objById(id);
  action = {type: 'move', p0: p, x0: o.x, y0: o.y, moved: false};
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});
stage.addEventListener('pointermove', e => {
  if (!action) return;
  const p = toStage(e), o = selObj(); if (!o) return;
  if (action.type === 'move') {
    let x = action.x0 + p.x - action.p0.x, y = action.y0 + p.y - action.p0.y;
    if (!action.moved && Math.hypot(p.x - action.p0.x, p.y - action.p0.y) < 2) return;
    action.moved = true;
    [x, y] = e.altKey ? [x, y] : snap(o, x, y);
    o.x = Math.round(x); o.y = Math.round(y);
  } else if (action.type === 'resize') doResize(o, p, e.shiftKey);
  updateObjLive(o);
});
stage.addEventListener('pointerup', () => {
  if (!action) return;
  stage.querySelectorAll('.guide').forEach(g => g.remove());
  const moved = action.moved; action = null;
  if (moved) { const o = selObj(); if (o?.placeholder && mode === 'slides') o.phMoved = true; commit(); }
});
function startHandle(h, p, e) {
  const o = selObj(); if (!o) return;
  if (h === 'move') action = {type: 'move', p0: p, x0: o.x, y0: o.y, moved: false};
  else action = {type: 'resize', h, p0: p, o0: {x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0}, moved: true};
  stage.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
}
/** Resize in the object's rotated frame, keeping the opposite handle fixed. */
function doResize(o, p, keepRatio) {
  const {h, p0, o0} = action, t = o0.rot * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = p.x - p0.x, dy = p.y - p0.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const sx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0, sy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0;
  let w = Math.max(16, o0.w + sx * lx), hh = Math.max(16, o0.h + sy * ly);
  if (o.type === 'text') hh = o0.h;
  else if ((keepRatio || o.type === 'image') && sx && sy) { const k = Math.max(w / o0.w, hh / o0.h); w = o0.w * k; hh = o0.h * k; }
  const cx0 = o0.x + o0.w / 2, cy0 = o0.y + o0.h / 2, ax = -sx * o0.w / 2, ay = -sy * o0.h / 2;
  const Ax = cx0 + ax * c - ay * s, Ay = cy0 + ax * s + ay * c, nx = sx * w / 2, ny = sy * hh / 2;
  const cx = Ax + nx * c - ny * s, cy = Ay + nx * s + ny * c;
  o.w = Math.round(w); o.h = Math.round(hh); o.x = Math.round(cx - w / 2); o.y = Math.round(cy - hh / 2);
}
function snap(o, x, y) {
  stage.querySelectorAll('.guide').forEach(g => g.remove());
  const T_ = 6 / scale, xs = [0, W / 2, W], ys = [0, H / 2, H];
  for (const q of tgt().objects) if (q.id !== o.id) { xs.push(q.x, q.x + q.w / 2, q.x + q.w); ys.push(q.y, q.y + q.h / 2, q.y + q.h); }
  const best = (pos, size, cands) => { let r = null; for (const off of [0, size / 2, size]) for (const c of cands) { const d = c - (pos + off); if (Math.abs(d) < T_ && (!r || Math.abs(d) < Math.abs(r.d))) r = {d, line: c}; } return r; };
  const bx = best(x, o.w, xs), by = best(y, o.h, ys);
  if (bx) { x += bx.d; guide('v', bx.line); }
  if (by) { y += by.d; guide('h', by.line); }
  return [x, y];
}
function guide(dir, v) {
  const g = document.createElement('div'); g.className = 'guide';
  Object.assign(g.style, dir === 'v' ? {left: v + 'px', top: 0, width: 1 / scale + 'px', height: H + 'px'} : {top: v + 'px', left: 0, height: 1 / scale + 'px', width: W + 'px'});
  stage.appendChild(g);
}
function updateObjLive(o) {
  const el = stage.querySelector(`.obj[data-id="${o.id}"]`); if (!el) return;
  if (editing === o.id) {
    Object.assign(el.style, {left: o.x + 'px', top: o.y + 'px', width: o.w + 'px'});
    el.querySelector('.rot').style.transform = o.rot ? `rotate(${o.rot}deg)` : '';
    txtStyle(el.querySelector('.txt'), o);
  } else el.replaceWith(objEl(o, 'edit'));
  if (o.type === 'text') measureTexts();
  drawSelection(); drawBadges(); syncGeometryInputs(o); drawTableHandles();
}
function select(id) {
  if (sel === id) return;
  sel = id; curAnim = null; drawSelection(); renderProps(); updateRibbon();
}

/* ================================================================== text editing (Matekos Doksi editor) */
setTextHooks({onEdit: (pos, node) => openMath(pos, node), onRendered: onMathRendered, onPreview: p => showPreview(p)});
function enterEdit(id, ev) {
  const o = objById(id); if (!isText(o)) return;
  if (sel !== id) { sel = id; curAnim = null; }
  editing = id;
  const el = stage.querySelector(`.obj[data-id="${id}"]`), txt = el.querySelector('.txt');
  txt.classList.remove('empty');
  ed = mountEditor(txt, o.doc, {
    onUpdate: () => { measureTexts(); drawSelection(); drawTableHandles(); },
    onSelection: () => { updateRibbon(); drawTableHandles(); drawMathCaret(); },
    onBlur: () => { drawMathCaret(); showPreview(null); }
  });
  ed.view.dom.addEventListener('keydown', ke => { if (ke.key === 'Escape' && !isMathEditorOpen()) { ke.preventDefault(); exitEdit(); } });
  let pos = null;
  if (ev && ev.clientX != null) { const hit = ed.view.posAtCoords({left: ev.clientX, top: ev.clientY}); if (hit) pos = hit.pos; }
  if (pos != null) ed.chain().focus().setTextSelection(pos).run(); else ed.commands.focus('end');
  drawSelection(); renderProps(); updateRibbon();
}
/** Close the editor and keep (or drop) the box. Returns true if something changed. */
function stopEditor() {
  if (!editing) return null;
  const id = editing, json = ed.getJSON();
  ed.destroy(); ed = null; editing = null; showPreview(null);
  $('#tableBar').hidden = true; $('#fcaret')?.remove();
  return {id, json};
}
function exitEdit() {
  const r = stopEditor(); if (!r) return;
  const o = objById(r.id);
  if (!o) { renderAll(); return; }
  const changed = JSON.stringify(r.json) !== JSON.stringify(o.doc);
  o.doc = r.json;
  if (isEmptyText(o) && !o.placeholder) {
    tgt().objects = tgt().objects.filter(q => q !== o);
    if (tgt().anims) tgt().anims = tgt().anims.filter(a => a.target !== o.id);
    sel = null; commit(); return;
  }
  if (changed) commit(); else renderAll();
}
/** Run a TipTap command on the selected text box: directly while editing, otherwise on its whole content. */
function withEditor(fn) {
  const o = selObj(); if (!isText(o)) return;
  if (editing === o.id) { fn(ed.chain().focus()); return; }
  if (mode === 'template' && o.placeholder) { toast('A helykitöltő formázását a menüszalag betű- és igazítás-gombjaival állíthatod.'); return; }
  enterEdit(o.id); ed.commands.selectAll(); fn(ed.chain().focus()); exitEdit();
}
/** Make sure a text box is being edited (for inserting tables / formulas); creates one if needed. */
function ensureEditing() {
  const o = selObj();
  if (editing) return true;
  if (isText(o) && !(mode === 'template' && o.placeholder)) { enterEdit(o.id); ed.commands.focus('end'); return true; }
  const n = addObject({type: 'text', name: nextName('Szöveg'), w: 760, size: 32, color: '#1a1a1a', align: 'left', doc: emptyDoc()});
  renderAll(); enterEdit(n.id); return true;
}

/* formula dialog (Doksi) and live $ preview */
function openMath(pos, node) {
  if (!editing) { ensureEditing(); }
  closePops(); showPreview(null);
  const sel_ = ed.state.selection;
  if (pos == null && sel_ instanceof NodeSelection && sel_.node.type.name === 'math') { pos = sel_.from; node = sel_.node; }
  const editPos = node ? pos : null;
  let tex = node ? node.attrs.tex : '';
  if (!node && !sel_.empty) tex = ed.state.doc.textBetween(sel_.from, sel_.to, ' ');
  const editor = ed;
  const finish = () => { if (editor && !editor.isDestroyed && !editor.view.hasFocus()) editor.view.dom.focus({preventScroll: true}); };
  openMathEditor({
    tex, editing: !!node, top: $('#app').getBoundingClientRect().bottom + 10,
    onApply: t => {
      if (!editor || editor.isDestroyed) return;
      if (t == null) return finish();
      if (editPos != null) {
        const n = editor.state.doc.nodeAt(editPos);
        if (n && n.type.name === 'math') {
          const tr = editor.state.tr;
          if (!t) tr.delete(editPos, editPos + n.nodeSize); else tr.setNodeMarkup(editPos, undefined, {...n.attrs, tex: t}, n.marks);
          editor.view.dispatch(tr);
        }
        return finish();
      }
      if (t) editor.chain().focus().insertContent({type: 'math', attrs: {tex: t, display: false}}).run(); else finish();
    },
    onDelete: () => {
      const n = editPos != null && editor.state.doc.nodeAt(editPos);
      if (n && n.type.name === 'math') editor.view.dispatch(editor.state.tr.delete(editPos, editPos + n.nodeSize));
      finish();
    }
  });
}
const mprev = $('#mprev');
function showPreview(p) {
  if (!p) { mprev.hidden = true; return; }
  mprev.innerHTML = '<div class="mp-m"></div><div class="mp-hint">Írj $ jelet a képlet lezárásához</div>';
  const box = mprev.firstChild; mprev.hidden = false;
  const place = () => {
    mprev.style.left = Math.max(8, Math.min(p.coords.left - 12, innerWidth - mprev.offsetWidth - 8)) + 'px';
    let top = p.coords.bottom + 8;
    if (top + mprev.offsetHeight > innerHeight - 8) top = p.coords.top - mprev.offsetHeight - 8;
    mprev.style.top = top + 'px';
  };
  renderInto(box, p.tex, false, place); place();
}
// visible text cursor right before / after a formula (browsers often hide it there)
function drawMathCaret() {
  let c = stage.querySelector('#fcaret');
  if (!ed || ed.isDestroyed) { c?.remove(); return; }
  const v = ed.view, s = ed.state.selection, $p = s.$from;
  const near = s.empty && v.hasFocus() && (($p.nodeBefore?.type.name === 'math') || ($p.nodeAfter?.type.name === 'math'));
  if (!near) { c?.remove(); return; }
  try {
    const k = v.coordsAtPos(s.from, $p.nodeAfter?.type.name === 'math' ? 1 : -1), q = toStageRect({left: k.left, top: k.top, width: 0, height: k.bottom - k.top});
    if (!c) { c = document.createElement('div'); c.id = 'fcaret'; stage.appendChild(c); }
    Object.assign(c.style, {left: q.x + 'px', top: q.y + 'px', height: q.h + 'px', borderLeftWidth: 1.5 / scale + 'px'});
  } catch (e) { c?.remove(); }
}

/* tables (Doksi table tools) */
let tblCtx = null;
function rememberTable() { if (tblCtx || !ed) return; const c = tableContext(ed.state); tblCtx = c ? {pos: c.pos, rect: c.rect} : null; }
function curTable() {
  if (!ed) return null;
  if (tblCtx) { const table = ed.state.doc.nodeAt(tblCtx.pos); if (table && table.type.name === 'table') return {table, pos: tblCtx.pos, start: tblCtx.pos + 1, map: TableMap.get(table), rect: tblCtx.rect}; }
  return tableContext(ed.state);
}
function reselectCells(c) {
  try { const {map, rect, start, table} = c;
    const pa = start + map.positionAt(rect.top, rect.left, table), pb = start + map.positionAt(rect.bottom - 1, rect.right - 1, table);
    if (pa !== pb) ed.view.dispatch(ed.state.tr.setSelection(CellSelection.create(ed.state.doc, pa, pb)));
  } catch (e) { /* ignore */ }
}
function forCells(scope, fn) {
  const c = curTable(); if (!c) return;
  const {map, rect, start, table} = c;
  const r = scope === 'table' ? {left: 0, top: 0, right: map.width, bottom: map.height} : scope === 'cols' ? {left: rect.left, right: rect.right, top: 0, bottom: map.height} : rect;
  const tr = ed.state.tr, seen = new Set();
  for (let row = r.top; row < r.bottom; row++) for (let col = r.left; col < r.right; col++) {
    const rel = map.map[row * map.width + col]; if (seen.has(rel)) continue; seen.add(rel);
    const node = table.nodeAt(rel), attrs = fn(node, row, col);
    if (attrs) tr.setNodeMarkup(start + rel, undefined, {...node.attrs, ...attrs});
  }
  ed.view.dispatch(tr); reselectCells(curTable());
}
function fillTableFields() {
  const c = curTable(); if (!c) return;
  const act = document.activeElement;
  if (act !== $('#tpWidth')) $('#tpWidth').value = c.table.attrs.width || 100;
  const row = c.table.child(Math.min(c.rect.top, c.table.childCount - 1));
  if (act !== $('#tpRowH')) $('#tpRowH').value = row.attrs.height || '';
  const cell = c.table.nodeAt(c.map.map[c.rect.top * c.map.width + c.rect.left]);
  if (act !== $('#tpColW')) $('#tpColW').value = cell && cell.attrs.colwidth && cell.attrs.colwidth[0] ? Math.round(cell.attrs.colwidth[0] / MM * 10) / 10 : '';
  for (const b of $$('#tableBar [data-talign]')) b.classList.toggle('on', (c.table.attrs.align || 'left') === b.dataset.talign);
}
for (const id of ['#tpWidth', '#tpRowH', '#tpColW']) {
  $(id).addEventListener('focus', rememberTable);
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); } });
}
function setTableAttrs(attrs) { const c = curTable(); if (!c) return; ed.view.dispatch(ed.state.tr.setNodeMarkup(c.pos, undefined, {...c.table.attrs, ...attrs})); reselectCells(curTable()); }
$('#tpWidth').addEventListener('change', e => {
  const pct = Math.max(10, Math.min(100, +e.target.value || 100)), c = curTable(); if (!c) return;
  const tr = ed.state.tr; tr.setNodeMarkup(c.pos, undefined, {...c.table.attrs, width: pct === 100 ? null : pct});
  const cells = []; let all = true, sum = 0;
  c.table.firstChild.forEach(cell => { const w = cell.attrs.colwidth; if (!w || !w[0]) all = false; else sum += w.reduce((x, y) => x + (y || 0), 0); });
  if (all && sum > 0) {
    const k = (ed.view.dom.clientWidth * pct / 100) / sum;
    c.table.descendants((n, rel) => { if (n.type.spec.tableRole?.includes('cell') && n.attrs.colwidth) cells.push([rel, n]); return !n.type.spec.tableRole?.includes('cell'); });
    for (const [rel, n] of cells) tr.setNodeMarkup(c.start + rel, undefined, {...n.attrs, colwidth: n.attrs.colwidth.map(w => Math.round(w * k))});
  }
  ed.view.dispatch(tr); reselectCells(curTable());
});
$('#tpRowH').addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.max(3, +e.target.value), c = curTable(); if (!c) return;
  const tr = ed.state.tr; c.table.forEach((row, o, i) => { if (i >= c.rect.top && i < c.rect.bottom) tr.setNodeMarkup(c.start + o, undefined, {...row.attrs, height: v}); });
  ed.view.dispatch(tr); reselectCells(curTable());
});
$('#tpColW').addEventListener('change', e => {
  const v = e.target.value === '' ? null : Math.round(Math.max(5, +e.target.value) * MM);
  forCells('cols', n => n.attrs.colspan === 1 ? {colwidth: v ? [v] : null} : null);
});
let borderScope = 'cells';
$('#popBorders').addEventListener('click', e => {
  const sc = e.target.closest('[data-scope]');
  if (sc) { borderScope = sc.dataset.scope; for (const b of $$('#popBorders [data-scope]')) b.classList.toggle('on', b === sc); return; }
  const bw = e.target.closest('[data-bw]');
  if (bw) forCells(borderScope === 'table' ? 'table' : 'cells', () => ({borderWidth: bw.dataset.bw === '' ? null : +bw.dataset.bw}));
});
function drawTableHandles() {
  let layer = stage.querySelector('#tblHandles');
  const c = ed && !ed.isDestroyed ? tableContext(ed.state) : null;
  if (!c) { layer?.remove(); return; }
  if (!layer) { layer = document.createElement('div'); layer.id = 'tblHandles'; stage.appendChild(layer); }
  const wrap = ed.view.nodeDOM(c.pos); if (!wrap) return;
  const tbl = wrap.tagName === 'TABLE' ? wrap : wrap.querySelector('table'); if (!tbl) return;
  const {map, start, table} = c, tr = toStageRect(tbl.getBoundingClientRect()), cols = [];
  for (let col = 0; col < map.width; col++) {
    let rr = null;
    for (let row = 0; row < map.height && !rr; row++) { const rel = map.map[row * map.width + col], n = table.nodeAt(rel); if (n && n.attrs.colspan === 1) { const dom = ed.view.nodeDOM(start + rel); if (dom) rr = toStageRect(dom.getBoundingClientRect()); } }
    cols.push(rr);
  }
  const rows = []; table.forEach((row, off) => { const dom = ed.view.nodeDOM(start + off); rows.push(dom ? toStageRect(dom.getBoundingClientRect()) : null); });
  const s = ed.state.selection, cs = s instanceof CellSelection, rect = c.rect;
  const colOn = i => cs && s.isColSelection() && i >= rect.left && i < rect.right, rowOn = i => cs && s.isRowSelection() && i >= rect.top && i < rect.bottom;
  const inv = 1 / scale, gap = 18 * inv;
  let h = `<button class="th-btn${cs && s.isColSelection() && s.isRowSelection() ? ' on' : ''}" data-ts="all" title="A teljes táblázat kijelölése" style="left:${tr.x - gap}px;top:${tr.y - gap}px">◢</button>`;
  cols.forEach((r, i) => { if (r) h += `<button class="th-btn${colOn(i) ? ' on' : ''}" data-ts="col" data-i="${i}" title="Oszlop kijelölése" style="left:${r.x + r.w / 2 - 8 * inv}px;top:${tr.y - gap}px">▼</button>`; });
  rows.forEach((r, i) => { if (r && r.h > 0) h += `<button class="th-btn row${rowOn(i) ? ' on' : ''}" data-ts="row" data-i="${i}" title="Sor kijelölése" style="left:${tr.x - gap}px;top:${r.y + r.h / 2 - 8 * inv}px">▶</button>`; });
  if (layer._key !== h) { layer.innerHTML = h; layer._key = h; }
  $('#tableBar').hidden = false; fillTableFields();
  for (const b of $$('#tableBar [data-valign]')) b.classList.toggle('on', (ed.getAttributes('tableCell').vAlign || ed.getAttributes('tableHeader').vAlign || 'top') === b.dataset.valign);
}
function selectTableRange(r0, c0, r1, c1) {
  const c = tableContext(ed.state); if (!c) return;
  const {map, start, table} = c;
  ed.view.dispatch(ed.state.tr.setSelection(CellSelection.create(ed.state.doc, start + map.positionAt(r0, c0, table), start + map.positionAt(r1, c1, table))));
  if (!ed.view.hasFocus()) ed.view.dom.focus({preventScroll: true});
}
stage.addEventListener('mousedown', e => {
  const b = e.target.closest('.th-btn'); if (!b || e.button !== 0 || !ed) return;
  e.preventDefault(); e.stopPropagation();
  const c = tableContext(ed.state); if (!c) return;
  const {map} = c, i = +b.dataset.i, s = ed.state.selection, ext = e.shiftKey && s instanceof CellSelection;
  if (b.dataset.ts === 'all') return selectTableRange(0, 0, map.height - 1, map.width - 1);
  if (b.dataset.ts === 'col') { const a = ext && s.isColSelection() ? Math.min(c.rect.left, i) : i, z = ext && s.isColSelection() ? Math.max(c.rect.right - 1, i) : i; return selectTableRange(0, a, map.height - 1, z); }
  const a = ext && s.isRowSelection() ? Math.min(c.rect.top, i) : i, z = ext && s.isRowSelection() ? Math.max(c.rect.bottom - 1, i) : i;
  selectTableRange(a, 0, z, map.width - 1);
}, true);
$('#tableBar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
$('#tableBar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !ed) return;
  if (b.dataset.pop) { if (/^pop(Borders|Cell)$/.test(b.dataset.pop)) rememberTable(); return showPop(b.dataset.pop, b); }
  if (b.dataset.tbl) return ed.chain().focus()[b.dataset.tbl]().run();
  if (b.dataset.valign) return ed.chain().focus().setCellAttribute('vAlign', b.dataset.valign).run();
  if (b.dataset.talign) return setTableAttrs({align: b.dataset.talign});
});
for (const id of ['#popTblIns', '#popTblDel']) $(id).addEventListener('click', e => { const b = e.target.closest('[data-tbl]'); if (!b || !ed) return; closePops(); ed.chain().focus()[b.dataset.tbl]().run(); });
const tg = $('#tgrid');
for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) { const d = document.createElement('button'); d.className = 'tc'; d.dataset.r = r; d.dataset.c = c; d.setAttribute('aria-label', r + ' × ' + c); tg.appendChild(d); }
const hl = (r, c) => { for (const d of tg.children) d.classList.toggle('on', +d.dataset.r <= r && +d.dataset.c <= c); $('#tlabel').textContent = r ? r + ' × ' + c + ' táblázat' : 'Válassz méretet'; };
tg.addEventListener('pointerover', e => { const d = e.target.closest('.tc'); if (d) hl(+d.dataset.r, +d.dataset.c); });
tg.addEventListener('click', e => { const d = e.target.closest('.tc'); if (!d) return; closePops(); ensureEditing(); ed.chain().focus().insertTable({rows: +d.dataset.r, cols: +d.dataset.c, withHeaderRow: false}).run(); });
$('#popTable').onopen = () => hl(0, 0);

/* ================================================================== inserting objects */
function nextName(base) { return `${base} ${tgt().objects.filter(o => o.name?.startsWith(base)).length + 1}`; }
function addObject(o) {
  const n = tgt().objects.length % 8;
  o = {id: uid(), x: 300 + n * 20, y: 200 + n * 20, w: 400, h: 60, rot: 0, ...o};
  tgt().objects.push(o); sel = o.id; return o;
}
function addShape(shape) {
  if (editing) exitEdit();
  const names = {rect: 'Téglalap', ellipse: 'Ellipszis', arrow: 'Nyíl'};
  const base = shape === 'arrow' ? {w: 240, h: 80, fill: '#2f5d8a', stroke: null, strokeWidth: 0} : {w: 260, h: 170, fill: '#d6eaf8', stroke: '#2f5d8a', strokeWidth: 3, radius: 0};
  addObject({type: 'shape', shape, name: nextName(names[shape]), ...base}); commit();
}
function addText() {
  if (editing) exitEdit();
  const o = addObject({type: 'text', name: nextName('Szöveg'), w: 620, size: 32, color: '#1a1a1a', align: 'left', doc: emptyDoc()});
  renderAll(); enterEdit(o.id);
}
let imageCb = null;
function pickImage(cb) { imageCb = cb; $('#fImage').click(); }
$('#fImage').onchange = e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { const img = new Image(); img.onload = () => {
    const key = 'img' + uid(); media[key] = rd.result;
    if (imageCb) { const cb = imageCb; imageCb = null; cb(key, img); return; }
    if (editing) exitEdit();
    const k = Math.min(1, 800 / img.width, 500 / img.height);
    addObject({type: 'image', name: nextName('Kép'), media: key, w: Math.round(img.width * k), h: Math.round(img.height * k)}); commit();
  }; img.src = rd.result; };
  rd.readAsDataURL(f);
};
function pickImageURL(maxSide, cb) {
  const inp = $('#pickIn');
  inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (!f) return; const rd = new FileReader(); rd.onload = () => cb(rd.result); rd.readAsDataURL(f); };
  inp.click();
}

/* ================================================================== right panel */
const props = $('#props');
const fld = (label, html, full) => `<label class="fld${full ? ' full' : ''}">${label}${html}</label>`;
const slider = (id, label, v, min, max, step = 1, dis = '') => `<div class="sl"><span>${label}</span><input type="range" id="${id}R" min="${min}" max="${max}" step="${step}" value="${v}" ${dis}><input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}" ${dis}></div>`;
function panelVisible(v) { mainEl.classList.toggle('noprops', !v); lsSet(LS.panel, v ? '1' : '0'); updateRibbon(); fitStage(); }
function renderProps() {
  const o = selObj(); let h = '';
  const head = t => `<div class="phead2"><b>${t}</b><button class="md-x" id="propsX" title="Panel bezárása" aria-label="Panel bezárása">×</button></div>`;
  if (o) {
    const round = Math.round, rot = o.rot > 180 ? o.rot - 360 : (o.rot || 0);
    h += head(esc(o.name ?? 'Objektum'));
    h += `<section><h3>Elhelyezés</h3>
      ${slider('pX', 'Vízszintes', round(o.x), -round(o.w) + 10, W - 10)}
      ${slider('pY', 'Függőleges', round(o.y), -round(o.h) + 10, H - 10)}
      ${slider('pW', 'Szélesség', round(o.w), 16, W)}
      ${slider('pH', 'Magasság', round(o.h), 16, H, 1, o.type === 'text' ? 'disabled title="A szövegdoboz magassága a tartalomhoz igazodik"' : '')}
      ${slider('pR', 'Elforgatás (°)', round(rot), -180, 180)}
      ${o.type === 'shape' ? slider('pSW', 'Körvonal (px)', o.stroke ? (o.strokeWidth || 0) : 0, 0, 30) : ''}
      ${o.shape === 'rect' ? slider('pRad', 'Lekerekítés', o.radius || 0, 0, Math.round(Math.min(o.w, o.h) / 2)) : ''}
      ${o.type === 'image' ? slider('pOp', 'Átlátszatlanság (%)', round((o.opacity ?? 1) * 100), 10, 100) : ''}
      ${o.placeholder && mode === 'template' ? fld('Helykitöltő mintaszövege (csak szerkesztés közben látszik)', `<input type="text" id="pPrompt" value="${esc(o.prompt ?? '')}">`, true) : ''}
      ${o.placeholder && mode === 'slides' ? `<div class="phint">${esc(phName(o.placeholder))} helykitöltő – helye és formája az elrendezést követi, amíg itt nem módosítod.</div>` : ''}
      </section>`;
  } else if (mode === 'slides') {
    h += head(`${cur + 1}. dia`);
    h += `<section><div class="phint" style="margin:0">Dupla kattintás egy szövegdobozon: szerkesztés. Képlet: írd <b>$…$</b> közé, vagy Ctrl/⌘+M. Bemásolt TeX-kód ($…$, \\(…\\)) magától képletté alakul.</div></section>`;
  } else {
    const isM = tcur === 'master', L = tgt();
    h += head(isM ? 'Mester' : 'Elrendezés');
    h += `<section><div class="fgrid">
      ${isM ? '' : fld('Név', `<input type="text" id="pName" value="${esc(L.name)}">`, true)}
      ${isM ? '' : `<label class="chk full"><input type="checkbox" id="pShowM" ${L.showMaster ? 'checked' : ''}> A mester elemeinek megjelenítése</label>`}
      ${isM ? '' : `<label class="chk full"><input type="checkbox" id="pOwnBg" ${L.ownBg ? 'checked' : ''}> Saját háttér (a mesteré helyett)</label>`}</div></section>`;
    if (isM || L.ownBg) h += `<section><h3>Háttér</h3><div class="fgrid">
      ${fld('Háttérszín', `<input type="color" id="pBgColor" value="${L.bgColor || '#ffffff'}">`)}
      <div class="fld">Háttérkép<div class="imgpick">${L.background ? `<img src="${media[L.background]}" alt="">` : ''}<button class="btn" id="pBgPick">Kép…</button>${L.background ? '<button class="btn" id="pBgClear">Eltávolítás</button>' : ''}</div></div>
      </div><div class="phint">A háttérkép kitölti a diát (1280×720 képpont, 16:9).</div></section>`;
    h += `<section><div class="phint" style="margin:0">${isM ? 'Ami ide kerül (logó, lábléc, díszítés), minden elrendezésen megjelenik.' : 'Helykitöltőt a menüszalag „Helykitöltő” gombjával adhatsz hozzá. Az új diák ezeket kapják meg.'}</div></section>`;
  }
  if (mode === 'slides') h += animSection();
  props.innerHTML = h;
  bindProps(o);
}
function syncGeometryInputs(o) {
  const set = (id, v) => { for (const el of [$('#' + id), $('#' + id + 'R')]) if (el && document.activeElement !== el) el.value = Math.round(v); };
  set('pX', o.x); set('pY', o.y); set('pW', o.w); set('pH', o.h); set('pR', o.rot > 180 ? o.rot - 360 : (o.rot || 0));
}
function bindProps(o) {
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
  on('propsX', 'click', () => panelVisible(false));
  on('pName', 'change', e => { tgt().name = e.target.value.trim() || 'Elrendezés'; commit(); });
  on('pShowM', 'change', e => { tgt().showMaster = e.target.checked; commit(); });
  on('pOwnBg', 'change', e => { const L = tgt(); L.ownBg = e.target.checked; if (L.ownBg && !L.background) { L.background = doc.master.background; L.bgColor = doc.master.bgColor; } commit(); });
  on('pBgColor', 'change', e => { tgt().bgColor = e.target.value; commit(); });
  on('pBgPick', 'click', () => pickImage(key => { tgt().background = key; commit(); }));
  on('pBgClear', 'click', () => { tgt().background = null; commit(); });
  on('pPrompt', 'change', e => { o.prompt = e.target.value; commit(); });
  if (o) {
    const SETTERS = {
      pX: v => { o.x = v; }, pY: v => { o.y = v; }, pW: v => { o.w = Math.max(16, v); }, pH: v => { o.h = Math.max(16, v); },
      pR: v => { o.rot = ((v % 360) + 360) % 360; }, pSW: v => { o.strokeWidth = Math.max(0, v); if (v > 0 && !o.stroke) o.stroke = '#2f5d8a'; if (!v) o.stroke = null; },
      pRad: v => { o.radius = Math.max(0, v); }, pOp: v => { o.opacity = v / 100; }
    };
    for (const [id, set] of Object.entries(SETTERS)) for (const suffix of ['', 'R']) {
      const el = $('#' + id + suffix); if (!el) continue;
      el.addEventListener('input', () => { const v = parseFloat(el.value); if (!isFinite(v)) return; set(v); const twin = $('#' + id + (suffix ? '' : 'R')); if (twin) twin.value = el.value; updateObjLive(o); });
      el.addEventListener('change', () => { if (o.placeholder && mode === 'slides' && /p[XYWHR]$/.test(id)) o.phMoved = true; commit(); });
    }
  }
  bindAnims();
}
function deleteSelected() {
  if (!sel) return;
  tgt().objects = tgt().objects.filter(o => o.id !== sel);
  if (tgt().anims) tgt().anims = tgt().anims.filter(a => a.target !== sel);
  sel = null; commit();
}

/* animations: cards, timeline */
const effectOptions = c0 => Object.entries(Anim.CLASSES).map(([c, label]) => `<optgroup label="${label}">${Object.entries(Anim.EFFECTS)
  .filter(([, e]) => e.cls === c).map(([k, e]) => `<option value="${k}" ${k === c0 ? 'selected' : ''}>${e.label}</option>`).join('')}</optgroup>`).join('');
const secs = ms => String(Math.round(ms / 100) / 10).replace('.', ',');
const rangeLabel = r => r ? (r[0] === r[1] ? r[0] : r[0] + '–' + r[1]) : '0';
function addAnimation(effect, byParagraph) {
  const o = selObj(); if (!o || mode !== 'slides') return;
  if (editing) syncEditor();
  const a = {id: uid(), target: o.id, effect, trigger: 'click'};
  if (byParagraph && isText(o) && blockCount(o) > 1 && !o.rot) a.byParagraph = true;
  tgt().anims.push(a); curAnim = a.id; commit();
}
function timelineHTML(list) {
  const tl = Anim.timeline(list); if (!tl.length) return '';
  const nums = Anim.numbers(list), idx = new Map(list.map((a, i) => [a, i]));
  const Tm = Math.max(1000, ...tl.map(g => g.total)), step = Tm > 6000 ? 2000 : Tm > 3000 ? 1000 : 500;
  let ticks = ''; for (let t = 0; t <= Tm + 1; t += step) ticks += `<span style="left:${Math.min(t, Tm) / Tm * 100}%">${secs(t)}</span>`;
  let h = `<div class="tl"><div class="tl-axis"><span class="tl-lab">mp</span><div class="tl-ticks">${ticks}</div></div>`, click = 0;
  for (const g of tl) {
    h += `<div class="tl-step">${g.auto ? 'A dia megjelenésekor' : `${++click}. kattintás`}<span>${secs(g.total)} mp</span></div>`;
    for (const it of g.items) {
      if (it.a.part > 0 && !it.a.byParagraph) continue;
      const a = it.a, o = objById(a.target), E = Anim.EFFECTS[a.effect], left = it.start / Tm * 100, w = (it.end - it.start) / Tm * 100;
      const name = (o?.name ?? '') + (a.part != null && a.byParagraph ? ` ¶${a.part + 1}` : '');
      h += `<div class="tl-row${a.src === curAnim ? ' cur' : ''}" data-id="${a.src}" title="${esc(name)} – ${E.label}: ${secs(it.start)}–${secs(it.end)} mp">
        <span class="tl-lab"><span class="badge ${E.cls}">${nums[idx.get(a)]}</span>${esc(name)}</span>
        <div class="tl-track"><i class="${E.instant ? 'pt' : ''}" style="left:${left}%;width:${E.instant ? 0 : w}%;--c:${CLS_COLOR[E.cls]}"></i></div></div>`;
    }
  }
  return h + '</div>';
}
function animSection() {
  const s = tgt(), list = Anim.expand(s), rg = Anim.ranges(list), o = selObj();
  const rows = s.anims.map((a, i) => {
    const t = objById(a.target); if (!t) return '';
    const E = Anim.EFFECTS[a.effect], canPara = isText(t) && blockCount(t) > 1;
    return `<div class="anim${a.id === curAnim ? ' cur' : ''}" data-id="${a.id}" style="--c:${CLS_COLOR[E.cls]}">
      <span class="badge ${E.cls}">${rangeLabel(rg[a.id])}</span><span class="name" title="${esc(t.name ?? '')}">${esc(t.name ?? '')}<small>${Anim.CLASSES[E.cls]}</small></span>
      <span class="ctl"><button data-act="up" title="Előrébb a sorban" ${i ? '' : 'disabled'}>▲</button><button data-act="down" title="Hátrébb a sorban" ${i < s.anims.length - 1 ? '' : 'disabled'}>▼</button><button data-act="del" title="Animáció törlése">✕</button></span>
      <select data-k="effect" aria-label="Effektus">${effectOptions(a.effect)}</select>
      <select data-k="trigger" aria-label="Indítás">${Object.entries(Anim.TRIGGERS).map(([k, l]) => `<option value="${k}" ${k === a.trigger ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="times"><label class="fld">Időtartam (mp)<input type="text" inputmode="decimal" data-k="dur" value="${secs(Anim.durOf(a))}" ${E.instant ? 'disabled title="Ez az effektus azonnali"' : ''}></label>
        <label class="fld">Késleltetés (mp)<input type="text" inputmode="decimal" data-k="delay" value="${secs(Anim.delayOf(a))}"></label></div>
      ${canPara ? `<label class="chk opts"><input type="checkbox" data-k="byParagraph" ${a.byParagraph ? 'checked' : ''} ${t.rot ? 'disabled title="Elforgatott szövegdoboznál nem érhető el"' : ''}> Bekezdésenként</label>` : ''}
    </div>`;
  }).join('');
  const dis = o ? '' : 'disabled title="Előbb jelölj ki egy objektumot"';
  return `<section><h3>Animációk</h3>
    <div class="btnrow addrow"><button class="btn" data-add="entr" ${dis} style="--c:${CLS_COLOR.entr}">+ Belépő</button><button class="btn" data-add="emph" ${dis} style="--c:${CLS_COLOR.emph}">+ Kiemelés</button><button class="btn" data-add="exit" ${dis} style="--c:${CLS_COLOR.exit}">+ Kilépő</button></div>
    ${s.anims.length ? `<h4>Idővonal</h4>${timelineHTML(list)}` : ''}
    <div class="anim-list" id="animList">${rows || '<div class="phint" style="margin-top:0">Ezen a dián nincs animáció.</div>'}</div>
    <div class="btnrow"><button class="btn" id="aPlay">Lejátszás innen</button></div></section>`;
}
function bindAnims() {
  const s = tgt();
  props.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addAnimation(Anim.DEFAULT[b.dataset.add], false));
  $('#aPlay')?.addEventListener('click', () => startShow(cur));
  props.querySelector('.tl')?.addEventListener('click', e => {
    const r = e.target.closest('.tl-row'); if (!r) return;
    const a = s.anims.find(x => x.id === r.dataset.id); if (!a) return;
    if (editing && editing !== a.target) exitEdit();
    curAnim = a.id; sel = a.target; drawSelection(); renderProps(); updateRibbon();
    props.querySelector(`.anim[data-id="${a.id}"]`)?.scrollIntoView({block: 'nearest'});
  });
  const list = $('#animList'); if (!list) return;
  list.addEventListener('click', e => {
    const row = e.target.closest('.anim'); if (!row) return;
    const i = s.anims.findIndex(a => a.id === row.dataset.id), act = e.target.closest('button')?.dataset.act;
    if (act === 'up' && i > 0) { [s.anims[i - 1], s.anims[i]] = [s.anims[i], s.anims[i - 1]]; commit(); return; }
    if (act === 'down' && i < s.anims.length - 1) { [s.anims[i + 1], s.anims[i]] = [s.anims[i], s.anims[i + 1]]; commit(); return; }
    if (act === 'del') { s.anims.splice(i, 1); commit(); return; }
    if (!e.target.closest('select, input, label')) { if (editing && editing !== s.anims[i].target) exitEdit(); curAnim = s.anims[i].id; sel = s.anims[i].target; drawSelection(); renderProps(); updateRibbon(); }
  });
  list.addEventListener('change', e => {
    const row = e.target.closest('.anim'), a = s.anims.find(x => x.id === row.dataset.id), k = e.target.dataset.k;
    const num = v => parseFloat(String(v).replace(',', '.'));
    if (k === 'byParagraph') a.byParagraph = e.target.checked || undefined;
    else if (k === 'dur') a.dur = Math.min(60000, Math.max(100, Math.round(num(e.target.value) * 1000) || Anim.EFFECTS[a.effect].dur));
    else if (k === 'delay') a.delay = Math.max(0, Math.round(num(e.target.value) * 1000) || 0);
    else if (k === 'effect') { a.effect = e.target.value; delete a.dur; }
    else a[k] = e.target.value;
    curAnim = a.id; commit();
  });
}

/* ================================================================== ribbon */
for (const b of $$('[data-icon]')) b.insertAdjacentHTML('afterbegin', svgIcon(b.dataset.icon));
const styled = o => { if (o.placeholder && mode === 'slides') o.phStyled = true; };
const inEdit = () => { const o = selObj(); return isText(o) && editing === o.id; };
/** Bold, italic, …: while editing on the selection (marks), otherwise on the whole box. */
function boxOrMark(mark, boxKey) {
  const o = selObj(); if (!isText(o)) return;
  if (inEdit()) { const fn = 'toggle' + mark[0].toUpperCase() + mark.slice(1); ed.chain().focus()[fn]().run(); return; }
  o[boxKey] = !o[boxKey]; styled(o); commit();
}
function setAlign(a) {
  const o = selObj(); if (!isText(o)) return;
  if (inEdit()) { ed.chain().focus().setTextAlign(a).run(); return; }
  o.align = a; styled(o);
  // whole box: paragraph alignments set in the editor give way to the box alignment
  const strip = n => { if (n.attrs?.textAlign) n.attrs.textAlign = null; (n.content || []).forEach(strip); }; strip(o.doc);
  commit();
}
function reorder(fn) { const o = selObj(); if (!o) return; if (editing) syncEditor(); const a = tgt().objects, i = a.indexOf(o); a.splice(i, 1); a.splice(fn(i, a.length), 0, o); commit(); }
const COMMANDS = {
  undo, redo,
  bold: () => boxOrMark('bold', 'bold'), italic: () => boxOrMark('italic', 'italic'),
  underline: () => boxOrMark('underline', 'underline'), strike: () => boxOrMark('strike', 'strike'),
  superscript: () => withEditor(c => c.toggleSuperscript().run()), subscript: () => withEditor(c => c.toggleSubscript().run()),
  alignLeft: () => setAlign('left'), alignCenter: () => setAlign('center'), alignRight: () => setAlign('right'), alignJustify: () => setAlign('justify'),
  bulletList: () => withEditor(c => c.toggleBulletList().run()), orderedList: () => withEditor(c => c.toggleOrderedList().run()),
  indent: () => withEditor(c => ed.isActive('listItem') ? c.sinkListItem('listItem').run() : c.shiftIndent(1).run()),
  outdent: () => withEditor(c => ed.isActive('listItem') ? c.liftListItem('listItem').run() : c.shiftIndent(-1).run()),
  text: addText, math: () => openMath(null, null), image: () => pickImage(null),
  rect: () => addShape('rect'), ellipse: () => addShape('ellipse'), arrow: () => addShape('arrow'),
  toFront: () => reorder((i, n) => n), forward: () => reorder((i, n) => Math.min(n, i + 1)), backward: () => reorder(i => Math.max(0, i - 1)), toBack: () => reorder(() => 0),
  delete: () => { if (editing) stopEditor(); deleteSelected(); },
  badges: () => { showBadges = !showBadges; lsSet(LS.badges, showBadges ? '1' : '0'); drawBadges(); updateRibbon(); },
  panel: () => panelVisible(mainEl.classList.contains('noprops'))
};
const ribbon = $('#ribbon');
ribbon.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
ribbon.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.pop) return showPop(b.dataset.pop, b);
  COMMANDS[b.dataset.cmd]?.();
});
$('#styleSel').addEventListener('change', e => { const v = e.target.value; withEditor(c => (v === 'p' ? c.setParagraph() : c.setHeading({level: +v[1]})).run()); });
const setSize = v => {
  const p = parseFloat(String(v).replace(',', '.')), o = selObj(); if (!isText(o) || !(p > 0 && p < 400)) return;
  if (inEdit() && !ed.state.selection.empty) { ed.chain().focus().setFontSize(p + 'pt').run(); return; }
  o.size = Math.round(p / PT * 100) / 100; styled(o); commit();
};
$('#sizeIn').addEventListener('change', e => setSize(e.target.value));
$('#sizeIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setSize(e.target.value); } });

function updateRibbon() {
  const o = selObj(), edit = inEdit();
  for (const b of $$('[data-k]', ribbon)) {
    const k = b.dataset.k; b.disabled = k === 'any' ? !o : k === 'text' ? !isText(o) : !isShape(o);
  }
  $('#sizeIn').disabled = !isText(o);
  ribbon.querySelector('[data-cmd=undo]').disabled = !edit && hIdx <= 0;
  ribbon.querySelector('[data-cmd=redo]').disabled = !edit && hIdx >= history.length - 1;
  const act = (m, box) => isText(o) && (edit ? ed.isActive(m) : !!o[box]);
  for (const [c, m] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strike']]) ribbon.querySelector(`[data-cmd=${c}]`).classList.toggle('on', act(m, c));
  ribbon.querySelector('[data-cmd=superscript]').classList.toggle('on', edit && ed.isActive('superscript'));
  ribbon.querySelector('[data-cmd=subscript]').classList.toggle('on', edit && ed.isActive('subscript'));
  ribbon.querySelector('[data-cmd=bulletList]').classList.toggle('on', edit && ed.isActive('bulletList'));
  ribbon.querySelector('[data-cmd=orderedList]').classList.toggle('on', edit && ed.isActive('orderedList'));
  for (const [c, a] of [['alignLeft', 'left'], ['alignCenter', 'center'], ['alignRight', 'right'], ['alignJustify', 'justify']])
    ribbon.querySelector(`[data-cmd=${c}]`).classList.toggle('on', isText(o) && (edit && ed.isActive({textAlign: a}) || (!edit || !['left', 'center', 'right', 'justify'].some(x => ed.isActive({textAlign: x}))) && o.align === a));
  if (isText(o)) {
    let size = o.size * PT, color = o.color;
    if (edit) { try { const d = ed.view.domAtPos(ed.state.selection.from), el = d.node.nodeType === 1 ? d.node : d.node.parentElement; if (el && ed.view.dom.contains(el)) { const cs = getComputedStyle(el); size = parseFloat(cs.fontSize) * PT; color = cs.color; } } catch (e) { /* ignore */ } }
    if (document.activeElement !== $('#sizeIn')) $('#sizeIn').value = Math.round(size * 2) / 2;
    $('#colorBar').style.background = color;
    $('#styleSel').value = edit ? (ed.isActive('heading', {level: 1}) ? 'h1' : ed.isActive('heading', {level: 2}) ? 'h2' : ed.isActive('heading', {level: 3}) ? 'h3' : 'p') : 'p';
  }
  $('#styleSel').disabled = !isText(o);
  $('#fillBar').style.background = isShape(o) ? (o.fill || 'transparent') : '#c9d1da';
  $('#strokeBar').style.background = isShape(o) ? (o.stroke || 'transparent') : '#c9d1da';
  ribbon.querySelector('[data-pop=popAnim]').disabled = !o || mode !== 'slides';
  ribbon.querySelector('[data-cmd=badges]').classList.toggle('on', showBadges);
  ribbon.querySelector('[data-cmd=panel]').classList.toggle('on', !mainEl.classList.contains('noprops'));
  $('#bTpl').classList.toggle('primary', mode === 'template');
  $('#bTpl').textContent = mode === 'template' ? 'Sablon bezárása' : 'Sablon';
  if (!edit || !ed?.isActive('table')) $('#tableBar').hidden = true;
}

/* popovers + swatches (Doksi) */
let openPop = null, openAnchor = null;
function showPop(id, anchor) {
  const p = $('#' + id);
  if (openPop === p) return closePops();
  closePops(); if (p.onopen) p.onopen();
  p.hidden = false;
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8)) + 'px';
  let top = r.bottom + 6; if (top + p.offsetHeight > innerHeight - 8) top = Math.max(8, innerHeight - p.offsetHeight - 8);
  p.style.top = top + 'px';
  openPop = p; openAnchor = anchor;
}
function closePops() { if (openPop) { openPop.hidden = true; openPop = null; openAnchor = null; tblCtx = null; } }
document.addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !(openAnchor && openAnchor.contains(e.target))) closePops(); }, true);
for (const p of $$('.pop')) p.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
function swatches(box, colors, onPick, noneLabel) {
  box.innerHTML = colors.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`).join('')
    + '<label class="sw custom" title="Egyéni szín"><input type="color" aria-label="Egyéni szín"></label>'
    + (noneLabel ? `<button class="sw none" data-c="none">${noneLabel}</button>` : '');
  box.addEventListener('click', e => { const b = e.target.closest('button[data-c]'); if (b) { onPick(b.dataset.c); closePops(); } });
  box.querySelector('input').addEventListener('change', e => { onPick(e.target.value); closePops(); });
}
const TEXT_COLORS = ['#111111', '#5d6875', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f5f74', '#2e4a9e', '#7d3c98', '#ad1457'];
swatches($('#swText'), TEXT_COLORS, c => {
  const o = selObj(); if (!isText(o)) return;
  if (inEdit() && !ed.state.selection.empty) { ed.chain().focus().setColor(c).run(); return; }
  o.color = c; styled(o); commit();
});
swatches($('#swHi'), ['#fff176', '#c5f0a4', '#b3ecf5', '#f8bbd0', '#ffd59e', '#e1bee7', '#e0e0e0'], c => withEditor(ch => (c === 'none' ? ch.unsetHighlight() : ch.setHighlight({color: c})).run()), 'Nincs kiemelés');
swatches($('#swCell'), ['#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#d6e4f0'], c => forCells('cells', () => ({background: c === 'none' ? null : c})), 'Nincs kitöltés');
swatches($('#swBorder'), ['#7d8590', '#111111', '#1f5f74', '#2e4a9e', '#c0392b', '#1e8449', '#b7950b'], c => forCells(borderScope === 'table' ? 'table' : 'cells', () => ({borderColor: c === 'none' ? null : c})), 'Alapértelmezett');
swatches($('#swFill'), ['#d6eaf8', '#dbe9ee', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#f6d365', '#2f5d8a', '#1f5f74', '#1e8449', '#c0392b', '#d35400', '#ffffff', '#111111'],
  c => { const o = selObj(); if (isShape(o)) { o.fill = c === 'none' ? null : c; commit(); } }, 'Nincs kitöltés');
swatches($('#swStroke'), TEXT_COLORS, c => { const o = selObj(); if (!isShape(o)) return; o.stroke = c === 'none' ? null : c; if (o.stroke && !o.strokeWidth) o.strokeWidth = 3; commit(); }, 'Nincs körvonal');
$('#bwStroke').innerHTML = [1, 2, 3, 4, 6, 8].map(w => `<button class="pitem" data-w="${w}">${w} px</button>`).join('');
$('#bwStroke').onclick = e => { const b = e.target.closest('button'), o = selObj(); if (!b || !isShape(o)) return; o.strokeWidth = +b.dataset.w; if (!o.stroke) o.stroke = '#2f5d8a'; closePops(); commit(); };
$('#popStroke').onopen = () => { const o = selObj(); for (const b of $('#bwStroke').children) b.classList.toggle('on', isShape(o) && !!o.stroke && +b.dataset.w === o.strokeWidth); };
// bullets, numbering, line height, paragraph spacing (Doksi)
const BUL = ['•', '◦', '▪', '–', '➤', '➔', '✓', '★', '◆', '❖', '☐', '→'];
$('#bulGrid').innerHTML = BUL.map(b => `<button data-bul="${b}" aria-label="${b}">${b}</button>`).join('');
const setBullet = attrs => withEditor(c => { if (!ed.isActive('bulletList')) c.toggleBulletList(); c.updateAttributes('bulletList', attrs).run(); });
$('#popBullet').addEventListener('click', e => {
  const b = e.target.closest('[data-bul]'); if (!b) return; closePops();
  if (b.dataset.bul === 'none') { withEditor(c => { if (ed.isActive('bulletList')) c.toggleBulletList(); c.run(); }); return; }
  setBullet({bulletChar: b.dataset.bul, bulletImage: ''});
});
$('#bulCustomBtn').addEventListener('click', () => { const v = $('#bulCustom').value.trim(); if (v) { closePops(); setBullet({bulletChar: v, bulletImage: ''}); } });
$('#bulPicBtn').addEventListener('click', () => pickImageURL(512, url => { closePops(); setBullet({bulletImage: url, bulletChar: '', bulletSize: +$('#bulPicSize').value || 0.9}); }));
$('#popNum').addEventListener('click', e => { const b = e.target.closest('[data-num]'); if (!b) return; closePops();
  withEditor(c => { if (!ed.isActive('orderedList')) c.toggleOrderedList(); c.updateAttributes('orderedList', {numStyle: b.dataset.num}).run(); }); });
$('#lineList').innerHTML = [1, 1.15, 1.25, 1.5, 2].map(v => `<button class="pitem" data-lh="${v}">${String(v).replace('.', ',')}</button>`).join('');
$('#lineList').addEventListener('click', e => { const b = e.target.closest('[data-lh]'); if (!b) return; closePops(); withEditor(c => c.setParaAttrs({lineHeight: +b.dataset.lh}).run()); });
$('#openPara').addEventListener('click', () => { const a = $('[data-pop="popLine"]'); closePops(); showPop('popPara', a); });
$('#popPara').onopen = () => {
  const a = ed ? (ed.isActive('heading') ? ed.getAttributes('heading') : ed.getAttributes('paragraph')) : {};
  for (const inp of $$('#popPara [data-pf]')) { const k = inp.dataset.pf; if (inp.type === 'checkbox') inp.checked = !!a[k]; else inp.value = a[k] ?? (k === 'lineHeight' ? 1.25 : 0); }
};
$('#popPara').addEventListener('change', e => { const k = e.target.dataset.pf; if (!k) return; const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : +e.target.value); withEditor(c => c.setParaAttrs({[k]: v}).run()); });

/* object order list */
const TYPE_ICON = {text: 'textbox', image: 'image'};
function renderLayers() {
  const list = $('#layerList'), objs = tgt().objects;
  if (!objs.length) { list.innerHTML = '<div class="phint" style="margin:4px">Ezen a dián még nincs objektum.</div>'; return; }
  list.innerHTML = [...objs].reverse().map(o => `<div class="lyr${o.id === sel ? ' on' : ''}" draggable="true" data-id="${o.id}">
    <span class="grip">${svgIcon('grip')}</span>${svgIcon(o.type === 'shape' ? o.shape : TYPE_ICON[o.type])}<span class="lname">${esc(o.name ?? '')}</span></div>`).join('');
}
$('#popLayers').onopen = renderLayers;
const layerList = $('#layerList'); let dragId = null;
layerList.addEventListener('dragstart', e => { const r = e.target.closest('.lyr'); dragId = r?.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); r?.classList.add('dragging'); });
layerList.addEventListener('dragend', () => { dragId = null; layerList.querySelectorAll('.lyr').forEach(r => r.classList.remove('dragging', 'above', 'below')); });
layerList.addEventListener('dragover', e => {
  const r = e.target.closest('.lyr'); if (!r || !dragId) return; e.preventDefault();
  const below = e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2;
  layerList.querySelectorAll('.lyr').forEach(x => x.classList.remove('above', 'below'));
  if (r.dataset.id !== dragId) r.classList.add(below ? 'below' : 'above');
});
layerList.addEventListener('drop', e => {
  e.preventDefault(); const r = e.target.closest('.lyr'); if (!r || !dragId || r.dataset.id === dragId) return;
  if (editing) syncEditor();
  const below = r.classList.contains('below'), order = [...tgt().objects].reverse();
  const moving = order.splice(order.findIndex(o => o.id === dragId), 1)[0];
  order.splice(order.findIndex(o => o.id === r.dataset.id) + (below ? 1 : 0), 0, moving);
  tgt().objects = order.reverse(); sel = moving.id; dragId = null; commit(); renderLayers();
});
layerList.addEventListener('click', e => { const r = e.target.closest('.lyr'); if (r) { if (editing) exitEdit(); select(r.dataset.id); renderLayers(); } });

/* animation gallery, placeholders, template builder */
$('#animGal').innerHTML = Object.entries(Anim.CLASSES).map(([c, label]) => `<div class="acol"><div class="ptitle" style="color:${CLS_COLOR[c]}">${label}</div>${
  Object.entries(Anim.EFFECTS).filter(([, e]) => e.cls === c).map(([k, e]) => `<button class="pitem" data-eff="${k}">${e.label}</button>`).join('')}</div>`).join('');
$('#animGal').onclick = e => { const b = e.target.closest('[data-eff]'); if (!b) return; closePops(); addAnimation(b.dataset.eff, $('#animByPara').checked); };
$('#popAnim').onopen = () => { const o = selObj(), ok = isText(o) && blockCount(o) > 1 && !o.rot; $('#animByPara').disabled = !ok; if (!ok) $('#animByPara').checked = false; };
$('#popPh').addEventListener('click', e => {
  const b = e.target.closest('[data-ph]'); closePops();
  if (!b || mode !== 'template' || tcur === 'master') { if (b && tcur === 'master') toast('Helykitöltő csak elrendezésre tehető.'); return; }
  if (editing) exitEdit();
  const L = tgt(); let key = b.dataset.ph, n = 2;
  while (L.objects.some(o => o.placeholder === key)) key = b.dataset.ph + n++;
  const def = {title: [60, 40, 1160, 33, '#2f5d8a', true, TITLE_PROMPT], subtitle: [240, 380, 800, 22, '#4a5866', false, 'Alcím'], body: [60, 150, 1160, 22, '#1a1a1a', false, 'Szöveg']}[b.dataset.ph];
  const o = ph(key, def[0], def[1] + (n > 2 ? 40 : 0), def[2], def[3], def[4], def[5], 'left', def[6]);
  L.objects.push(o); sel = o.id; commit();
});
$('#bTpl').onclick = () => mode === 'template' ? closeTemplateBuilder() : openTemplateBuilder();

/* ================================================================== slideshow preview */
const show = $('#show');
let sh = null;
function startShow(i) {
  if (editing) exitEdit(); if (mode === 'template') closeTemplateBuilder();
  show.classList.add('on'); show.requestFullscreen?.().catch(() => {});
  sh = {i, step: 0, busy: null}; loadShowSlide(i, 0, true);
}
function stopShow() { show.classList.remove('on'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); show.querySelector('.slide')?.remove(); sh = null; }
function showScale(el) { const k = Math.min(innerWidth / W, innerHeight / H); Object.assign(el.style, {transform: `scale(${k})`, left: (innerWidth - W * k) / 2 + 'px', top: (innerHeight - H * k) / 2 + 'px'}); }
function keyEl(root, key) {
  const [id, part] = key.split('#');
  const el = root.querySelector(`.obj[data-id="${id}"]`);
  return part == null ? el : el && pieceEls(el.querySelector('.txt'))[+part];
}
function loadShowSlide(i, step, animateAuto) {
  show.querySelector('.slide')?.remove();
  const el = document.createElement('div'); el.className = 'slide'; show.prepend(el);
  renderSlide(doc.slides[i], el, 'show'); showScale(el);
  const list = Anim.expand(doc.slides[i]), groups = Anim.groups(list);
  for (const k of Anim.initiallyHidden(list)) { const e = keyEl(el, k); if (e) e.style.visibility = 'hidden'; }
  const offset = groups[0]?.auto ? 1 : 0;
  Object.assign(sh, {i, step, el, groups, offset, busy: null});
  const instant = grp => grp.chains.flat().forEach(a => { const e = keyEl(el, a.key); if (!e) return; const c = Anim.EFFECTS[a.effect].cls;
    if (c === 'entr') e.style.visibility = 'visible'; else if (c === 'exit') e.style.visibility = 'hidden'; else if (a.effect === 'grow') e.style.transform = 'scale(1.5)'; });
  let g = 0;
  if (offset) { if (animateAuto && step === 0) playGroup(el, groups[0]); else instant(groups[0]); g = 1; }
  for (; g < step + offset; g++) instant(groups[g]);
  info();
}
function info() { show.querySelector('.info').textContent = `${sh.i + 1}. dia · ${sh.step}/${sh.groups.length - sh.offset}. lépés · Esc: kilépés`; }
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
  const flyDy = () => { const r = el.getBoundingClientRect(), sr = root.getBoundingClientRect(); return (sr.bottom - r.top) / (sr.height / H); };
  switch (a.effect) {
    case 'appear': return wait().then(() => { el.style.visibility = 'visible'; });
    case 'disappear': return wait().then(() => { el.style.visibility = 'hidden'; });
    case 'fade': el.style.visibility = 'visible'; return after(el.animate([{opacity: 0}, {opacity: 1}], opt));
    case 'wipe': el.style.visibility = 'visible'; return after(el.animate([{clipPath: 'inset(-100% 100% -100% -100%)'}, {clipPath: 'inset(-100% -100% -100% -100%)'}], opt));
    case 'fly': el.style.visibility = 'visible'; return after(el.animate([{transform: `translateY(${flyDy()}px)`}, {transform: 'none'}], opt));
    case 'pulse': return after(el.animate([{transform: 'scale(1)'}, {transform: 'scale(1.05)'}, {transform: 'scale(1)'}], {...opt, easing: 'ease-in-out', fill: 'none'}));
    case 'grow': { const an = el.animate([{transform: 'scale(1)'}, {transform: 'scale(1.5)'}], {...opt, fill: 'forwards'}); return after(an, () => { el.style.transform = 'scale(1.5)'; an.cancel(); }); }
    case 'spin': return after(el.animate([{transform: (el.style.transform || '') + ' rotate(0deg)'}, {transform: (el.style.transform || '') + ' rotate(360deg)'}], {...opt, fill: 'none'}));
    case 'fadeOut': { const an = el.animate([{opacity: 1}, {opacity: 0}], {...opt, fill: 'forwards'}); return after(an, () => { el.style.visibility = 'hidden'; an.cancel(); }); }
    case 'wipeOut': { const an = el.animate([{clipPath: 'inset(-100% -100% -100% -100%)'}, {clipPath: 'inset(-100% -100% -100% 100%)'}], {...opt, fill: 'forwards'}); return after(an, () => { el.style.visibility = 'hidden'; an.cancel(); }); }
    case 'flyOut': { const an = el.animate([{transform: 'none'}, {transform: `translateY(${flyDy()}px)`}], {...opt, easing: 'ease-in', fill: 'forwards'}); return after(an, () => { el.style.visibility = 'hidden'; an.cancel(); }); }
  }
}
function showNext() {
  if (sh.busy) { sh.busy.running.forEach(a => a.finish()); return; }
  const gi = sh.step + sh.offset;
  if (gi < sh.groups.length) { sh.step++; info(); playGroup(sh.el, sh.groups[gi]); return; }
  if (sh.i < doc.slides.length - 1) loadShowSlide(sh.i + 1, 0, true); else stopShow();
}
function showPrev() {
  if (sh.step > 0) loadShowSlide(sh.i, sh.step - 1, false);
  else if (sh.i > 0) { const g = Anim.groups(Anim.expand(doc.slides[sh.i - 1])); loadShowSlide(sh.i - 1, g.length - (g[0]?.auto ? 1 : 0), false); }
}
show.addEventListener('click', () => sh && showNext());
addEventListener('resize', () => { fitStage(); if (sh) showScale(sh.el); closePops(); });

/* ================================================================== files */
const EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg'};
function usedMedia() {
  const keys = new Set();
  if (doc.master.background) keys.add(doc.master.background);
  for (const t of Object.values(doc.templates)) if (t.background) keys.add(t.background);
  for (const g of [doc.master, ...Object.values(doc.templates), ...doc.slides]) for (const o of g.objects) if (o.media) keys.add(o.media);
  return [...keys];
}
async function packMprezi() {
  const z = new JSZip(), files = {};
  for (const k of usedMedia()) {
    const m = media[k]?.match(/^data:([^;]+);base64,(.*)$/); if (!m) continue;
    const name = `media/${k}.${EXT[m[1]] ?? 'bin'}`; z.file(name, m[2], {base64: true}); files[k] = name;
  }
  z.file('manifest.json', JSON.stringify({...doc, app: 'matekos-prezi', media: files}, null, 1));
  return z.generateAsync({type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE'});
}
async function unpackMprezi(buf) {
  const z = await JSZip.loadAsync(buf), m = JSON.parse(await z.file('manifest.json').async('string'));
  if (m.format !== 'mprezi') throw new Error('nem Matekos Prezi bemutató');
  const md = {};
  for (const [k, name] of Object.entries(m.media ?? {})) {
    const ext = name.split('.').pop(), mime = Object.keys(EXT).find(x => EXT[x] === ext) ?? 'application/octet-stream';
    md[k] = `data:${mime};base64,` + await z.file(name).async('base64');
  }
  delete m.media; delete m.app;
  return {doc: migrate(m), media: md};
}
async function doSave(saveAs) {
  if (editing) exitEdit(); closePops();
  try { const msg = await savePresentation(await packMprezi(), doc.title, saveAs); if (/^Elmentve/.test(msg)) dirty = false; setStatus(msg); toast(msg); }
  catch (e) { setStatus('A mentés nem sikerült: ' + (e?.message || e)); }
}
function loadDocument(d, m, name, path) {
  doc = d; media = m; if (name) doc.title = doc.title || name.replace(/\.mprezi$/i, '');
  mode = 'slides'; cur = 0; sel = null; curAnim = null; setCurrentPath(path ?? null);
  resetHistory(); renderAll(); fitStage();
}
async function openResult(r) {
  if (!r) return;
  try { const {doc: d, media: m} = await unpackMprezi(r.data); loadDocument(d, m, r.name, r.path); saveSoon(); toast('Megnyitva: ' + r.name); setStatus('Megnyitva: ' + r.name); }
  catch (e) { toast('A fájl nem nyitható meg: ' + (e?.message || e)); }
}
async function doOpen() { if (editing) exitEdit(); if (dirty && !confirm('A nem mentett módosítások elvesznek. Megnyitsz egy másik bemutatót?')) return; openResult(await openPresentation()); }
function busy(msg) { $('#busyMsg').textContent = msg || ''; $('#busy').hidden = !msg; }
async function doExport(kind) {
  closePops(); if (editing) exitEdit();
  busy('Exportálás előkészítése…');
  try {
    await mathReady; await document.fonts.ready;
    const blob = kind === 'pptx' ? await buildPptx(doc, renderSlide, layoutOf, busy) : await buildPdf(doc, renderSlide, layoutOf, kind === 'pdfSteps' ? 'steps' : 'slides', busy);
    busy('');
    const msg = kind === 'pptx' ? await saveExport(blob, doc.title, 'pptx', 'PowerPoint-bemutató') : await saveExport(blob, (doc.title || 'bemutato') + (kind === 'pdfSteps' ? ' (lépésenként)' : ''), 'pdf', 'PDF');
    setStatus(msg); toast(msg);
  } catch (e) { console.error(e); busy(''); toast('Az exportálás nem sikerült: ' + (e?.message || e)); }
}
$('#bExport').onclick = e => showPop('popExport', e.currentTarget);
$('#expPptx').onclick = () => doExport('pptx');
$('#expPdf').onclick = () => doExport('pdf');
$('#expPdfSteps').onclick = () => doExport('pdfSteps');
$('#bSave').onclick = () => doSave(false);
$('#bOpen').onclick = doOpen;
$('#bPlay').onclick = () => startShow(cur);
$('#zoomSel').onchange = e => { zoom = e.target.value === 'auto' ? 'auto' : +e.target.value; fitStage(); };
$('#docTitle').onchange = e => { doc.title = e.target.value.trim() || 'Névtelen bemutató'; dirty = true; setStatus(); saveSoon(); };
let arm = 0;
$('#bNew').onclick = e => {
  const b = e.currentTarget;
  if (dirty && !arm) { b.textContent = 'Biztosan új? (a mostani elvész)'; arm = setTimeout(() => { arm = 0; b.textContent = 'Új'; }, 2600); return; }
  clearTimeout(arm); arm = 0; b.textContent = 'Új';
  if (editing) stopEditor();
  blankDoc(); doc.slides.push(newSlide('cimdia')); loadDocument(doc, media, null, null); saveSoon();
};
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2800); }

/* ================================================================== keyboard */
let clipboard = null, nudgeT = 0;
addEventListener('keydown', e => {
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey, k = e.key.toLowerCase();
  if (sh) {
    if (['arrowright', 'arrowdown', ' ', 'pagedown', 'enter'].includes(k)) { e.preventDefault(); showNext(); }
    else if (['arrowleft', 'arrowup', 'pageup', 'backspace'].includes(k)) { e.preventDefault(); showPrev(); }
    else if (k === 'escape') stopShow();
    return;
  }
  if (isMathEditorOpen()) return;
  if (mod && k === 's') { e.preventDefault(); doSave(e.shiftKey); return; }
  if (mod && k === 'o') { e.preventDefault(); doOpen(); return; }
  if (k === 'f5') { e.preventDefault(); startShow(cur); return; }
  if (editing) { if (mod && k === 'm') { e.preventDefault(); openMath(null, null); } return; }   // the editor handles the rest
  if (e.target.closest('input, select, textarea')) return;
  if (mod && k === 'm') { e.preventDefault(); openMath(null, null); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && 'biu'.includes(k) && isText(selObj())) { e.preventDefault(); COMMANDS[{b: 'bold', i: 'italic', u: 'underline'}[k]](); return; }
  const o = selObj();
  if (mod && k === 'c' && o) { clipboard = clone(o); return; }
  if (mod && (k === 'v' || k === 'd') && (clipboard || o)) {
    const c = clone(k === 'd' ? o : clipboard); if (!c) return; e.preventDefault();
    c.id = uid(); c.x += 20; c.y += 20; delete c.placeholder; tgt().objects.push(c); sel = c.id; if (k === 'v') clipboard = clone(c); commit(); return;
  }
  if ((k === 'delete' || k === 'backspace') && o) { e.preventDefault(); deleteSelected(); return; }
  if (k === 'escape') { select(null); return; }
  if (k === 'enter' && isText(o) && !(mode === 'template' && o.placeholder)) { e.preventDefault(); enterEdit(o.id); return; }
  if (o && k.startsWith('arrow')) {
    e.preventDefault(); const d = e.shiftKey ? 10 : 1;
    if (k === 'arrowleft') o.x -= d; if (k === 'arrowright') o.x += d; if (k === 'arrowup') o.y -= d; if (k === 'arrowdown') o.y += d;
    if (o.placeholder && mode === 'slides') o.phMoved = true;
    updateObjLive(o); clearTimeout(nudgeT); nudgeT = setTimeout(commit, 400); return;
  }
  if (!mod && !e.altKey) { if (k === 't') addText(); else if (k === 'r') addShape('rect'); else if (k === 'e') addShape('ellipse'); else if (k === 'a') addShape('arrow'); }
});
addEventListener('beforeunload', e => { if (dirty && !isTauri()) e.preventDefault(); });

/* ================================================================== start */
(async function init() {
  if (lsGet(LS.panel) === '0') mainEl.classList.add('noprops');
  const saved = await loadAutosave();
  if (saved?.doc) { try { doc = migrate(saved.doc); media = saved.media || {}; doc.title = saved.title || doc.title; } catch (e) { demoDoc(); } }
  else demoDoc();
  resetHistory(); fitStage(); renderAll();
  loadFonts().then(() => { measureTexts(); drawSelection(); drawBadges(); renderThumbs(); });
  mathReady.then(() => setTimeout(() => { measureTexts(); drawSelection(); drawBadges(); }, 100));
  if (isTauri()) {
    try { const p = await watchOpenedFiles(async path => openResult(await openPathFile(path))); if (p) openResult(await openPathFile(p)); }
    catch (e) { /* not available */ }
  }
})();

// hooks for automated tests
window.mprezi = {get doc() { return doc; }, get media() { return media; }, get editor() { return ed; }, get sel() { return sel; }, set sel(v) { select(v); },
  gotoSlide, enterEdit, exitEdit, commit, renderAll, buildPptx: () => buildPptx(doc, renderSlide, layoutOf, () => {}),
  buildPdf: m => buildPdf(doc, renderSlide, layoutOf, m, () => {}), renderSlide, packMprezi, unpackMprezi, loadDocument, Anim};
