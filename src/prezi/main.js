import '../styles.css';
import './prezi.css';
import JSZip from 'jszip';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { startMathJax, renderInto, mathReady, activeMathFont } from '../math.js';
import { FONT_SETS, DEFAULT_FONT, applyTextFont, loadTextFamily, allFamilies, familyLabel, familyCSS, familyFromCSS, registerAllFamilies, fontSet } from './fontsets.js';
import { openMathEditor, isMathEditorOpen } from '../mathEditor.js';
import { tableContext } from '../editor/extensions.js';
import { svg as svgIcon } from '../icons.js';
import { isTauri, savePresentation, saveExport, openPresentation, openPathFile, watchOpenedFiles, setCurrentPath, getCurrentPath, getCurrentHandle, setCurrentHandle, currentFileName, autosave, loadAutosave } from '../files.js';
import { Anim } from './anim.js';
import { W, H, uid, clone, emptyDoc, textDoc, tableDoc, T, M, isEmptyText, blockCount, makeBackground, phName, ph, TITLE_PROMPT,
  defaultMaster, defaultTemplates, newSlide as makeSlide, syncPlaceholders as syncPh, migrate,
  flatObjects, findObject, parentGroup, bounds, fitGroup, moveObject, scaleFrom } from './model.js';
import { renderStatic, pieceEls, mountEditor, setTextHooks, mathPending } from './textview.js';
import { buildPptx, buildPdf, slideCanvas } from './export.js';
import { PRESETS, PRESET_ORDER, presetFile } from './presets.js';

const $ = s => document.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = v => Math.round(v * 10) / 10;
const PT = 0.75, MM = 96 / 25.4;
const CLS_COLOR = {entr: '#1f9d55', emph: '#c98a0b', exit: '#c0392b'};
const LS = {right: 'matekosprezi.rightw', left: 'matekosprezi.leftw', panel: 'matekosprezi.panel', badges: 'matekosprezi.badges', sections: 'matekosprezi.sections'};
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };


/* ================================================================== state */
let doc, media = {}, cur = 0, curAnim = null;
let selIds = [];                                  // selected objects (top level of the slide, or one group member being edited)
let sel = null;                                   // the single selected object (null when 0 or several are selected)
let mode = 'slides', tcur = 'master';            // 'slides' | 'template' (template builder)
let editing = null, ed = null;                    // id of the text box being edited, its TipTap editor
let history = [], hIdx = -1, dirty = false;
let showBadges = lsGet(LS.badges) !== '0';

const tgt = () => mode === 'slides' ? doc.slides[cur] : tcur === 'master' ? doc.master : doc.templates[tcur];
const objById = id => id ? findObject(tgt().objects, id) : null;
const selObj = () => sel && objById(sel);
const isText = o => o?.type === 'text', isShape = o => o?.type === 'shape', isTable = o => o?.type === 'table';
const isTextLike = o => isText(o) || isTable(o);
const kindOf = o => isTable(o) ? 'table' : 'text';
const layoutOf = s => doc.templates[s.template] ?? Object.values(doc.templates)[0];
const newSlide = t => makeSlide(doc, t);
const syncPlaceholders = s => syncPh(doc, s);

/** Text styles of the template: headlines (title placeholders) and normal text (body/subtitle placeholders, new text boxes). */
const defaultStyles = () => ({title: {size: 44, color: '#2f5d8a', bold: true, italic: false, underline: false, font: null},
  subtitle: {size: 29.33, color: '#4a5866', bold: false, italic: false, underline: false, font: null},
  body: {size: 29.33, color: '#1a1a1a', bold: false, italic: false, underline: false, font: null}});
const stylesOf = () => { const d = defaultStyles(); doc.styles = {...d, ...(doc.styles || {})}; for (const k in d) doc.styles[k] = {...d[k], ...doc.styles[k]}; return doc.styles; };
const roleOf = o => o.placeholder ? (o.placeholder.startsWith('title') ? 'title' : o.placeholder.startsWith('subtitle') ? 'subtitle' : 'body') : (o.styleRef || null);
function applyStyle(kind, changes) {
  const old = stylesOf()[kind], nw = {...old, ...changes}, k = nw.size / old.size;
  doc.styles[kind] = nw;
  const upd = (o, layoutLevel) => {
    if (roleOf(o) !== kind || (!layoutLevel && (o.phStyled || o.ownStyle))) return;
    if ('size' in changes) o.size = o.placeholder ? Math.round(o.size * k * 100) / 100 : nw.size;
    for (const key of ['color', 'bold', 'italic', 'underline']) if (key in changes) o[key] = nw[key] || undefined;
    if ('font' in changes) o.font = nw.font || undefined;
  };
  for (const g of [doc.master, ...Object.values(doc.templates)]) flatObjects(g.objects).forEach(o => upd(o, true));
  for (const sl of doc.slides) flatObjects(sl.objects).forEach(o => { if (!o.placeholder) upd(o, false); });
  commit();
}
/** Apply a built-in template: master, slide types, text styles (and its font set). The slides keep their content. */
async function applyPreset(key) {
  const P = PRESETS[key]; if (!P) return;
  if (!await confirmBox(`A(z) „${P.label}” sablon lép a mostani helyére (háttér, diatípusok, szövegstílusok). A diák tartalma megmarad. Folytatod?`, 'Sablon alkalmazása')) return;
  if (editing) exitEdit();
  let p;
  const url = key !== 'ures' && presetFile(key);
  if (url) {
    try { const r = await unpackMprezi(await (await fetch(url)).arrayBuffer()); Object.assign(media, r.media); p = {master: r.doc.master, templates: r.doc.templates, styles: r.doc.styles, font: r.doc.font}; }
    catch (e) { toast('A sablonfájl nem olvasható, a beépített minta lesz használva.'); }
  }
  p ??= P.build();
  doc.master = p.master; doc.templates = p.templates; doc.styles = {...defaultStyles(), ...p.styles}; doc.templateName = P.label;
  const first = Object.keys(doc.templates)[0];
  for (const sl of doc.slides) {
    if (!doc.templates[sl.template]) sl.template = doc.templates.tartalom ? 'tartalom' : first;
    for (const o of sl.objects) if (o.placeholder) { delete o.phMoved; delete o.phStyled; }
    syncPlaceholders(sl);
  }
  tcur = 'master'; setSel([]);
  if (p.font && p.font !== (doc.font || DEFAULT_FONT)) { doc.font = p.font; commit(); await restartWithFont(p.font); return; }
  commit(); toast(`Sablon: ${P.label}`);
}
function blankDoc() {
  media = {bg1: makeBackground()};
  const p = PRESETS.ures.build();
  doc = {format: 'mprezi', version: 4, size: {w: W, h: H}, font: activeMathFont() || DEFAULT_FONT, templateName: PRESETS.ures.label,
    styles: {...defaultStyles(), ...p.styles}, master: p.master, templates: p.templates, slides: []};
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
  const vals = [['x', '-1', '0', '1', '2'], ['f(x)=x^2', '1', '0', '1', '4']];
  const tbl = tableDoc(2, 5, (r, c) => [M(vals[r][c])]);
  tbl.content[0].content[0].content.forEach(cell => cell.attrs = {background: '#e8eef5'});
  s3.objects.push({id: uid(), name: 'Táblázat 1', type: 'table', x: 60, y: 160, w: 760, h: 100, rot: 0, size: 29.33, color: '#1a1a1a', align: 'left', doc: tbl});
  s3.objects.push({id: uid(), name: 'Szöveg 1', type: 'text', x: 60, y: 290, w: 760, h: 50, rot: 0, size: 29.33, color: '#1a1a1a', align: 'left',
    doc: textDoc([T('A függvény grafikonja '), {type: 'text', marks: [{type: 'bold'}], text: 'parabola'}, T('.')])});
  doc.slides = [s1, s2, s3];
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

/* ================================================================== history */
function snapshot() { return JSON.stringify({doc, cur, mode, tcur}); }
function setStatus(t) {
  const f = currentFileName(), st = $('#status');
  st.className = 'status ' + (t ? 'msg' : dirty || !f ? 'unsaved' : 'saved');
  st.textContent = t ?? (dirty ? 'Nem mentett' : f ? 'Mentve' : 'Még nincs mentve');
  st.title = f ? 'A bemutató fájlja: ' + f : 'A bemutató még nincs fájlba mentve';
}
function resetHistory() { history = [snapshot()]; hIdx = 0; dirty = false; $('#docTitle').value = doc.title || 'Névtelen bemutató'; setStatus(''); }
let autoT = 0;
const autoValue = () => ({doc: JSON.parse(snapshot()).doc, media, title: doc.title, path: getCurrentPath(), handle: getCurrentHandle(), dirty});
function saveSoon() { clearTimeout(autoT); autoT = setTimeout(() => autosave(autoValue()), 1200); }
/** The math font is chosen when MathJax starts – a different font set restarts the editor with the same presentation. */
async function restartWithFont(key) {
  busy('Betűtípus váltása…');
  try { sessionStorage.setItem('mp.skipHome', '1'); } catch (e) { /* ignore */ }
  clearTimeout(autoT); await autosave(autoValue());
  location.reload();
}
async function switchFont(key) {
  if (!FONT_SETS[key] || key === (doc.font || DEFAULT_FONT)) return;
  if (editing) exitEdit();
  doc.font = key; commit(); await restartWithFont(key);
}
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
  selIds = selIds.filter(id => objById(id)); sel = selIds.length === 1 ? selIds[0] : null; renderAll(); saveSoon();
}
const undo = () => { if (editing) return ed.commands.undo(); if (hIdx > 0) restore(hIdx - 1); };
const redo = () => { if (editing) return ed.commands.redo(); if (hIdx < history.length - 1) restore(hIdx + 1); };

/* ================================================================== rendering */
function shapeSVG(o) {
  const line = o.shape === 'line';
  const sw = o.stroke ? (o.strokeWidth ?? 3) : 0, h2 = sw / 2, {w, h} = o;
  const fill = o.fill || 'none', st = o.stroke ? ` stroke="${o.stroke}" stroke-width="${sw}" stroke-linejoin="round"${line ? ' stroke-linecap="round"' : ''}` : '';
  let body;
  if (o.shape === 'rect') body = `<rect x="${h2}" y="${h2}" width="${Math.max(0, w - sw)}" height="${Math.max(0, h - sw)}" rx="${o.radius ?? 0}" fill="${fill}"${st}/>`;
  else if (o.shape === 'ellipse') body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0, w / 2 - h2)}" ry="${Math.max(0, h / 2 - h2)}" fill="${fill}"${st}/>`;
  else if (o.shape === 'triangle') body = `<polygon points="${r1(w / 2)},${r1(h2 * 1.2)} ${r1(w - h2 * 1.2)},${r1(h - h2)} ${r1(h2 * 1.2)},${r1(h - h2)}" fill="${fill}"${st}/>`;
  else if (line) body = `<line x1="${r1(Math.min(h2, w / 2))}" y1="${h / 2}" x2="${r1(Math.max(w / 2, w - h2))}" y2="${h / 2}" fill="none"${st}/>`;
  else {
    const hl = Math.min(h * 0.9, w * 0.45), t = h * 0.22, m = h / 2;
    const pts = [[h2, m - t], [w - hl, m - t], [w - hl, h2], [w - h2, m], [w - hl, h - h2], [w - hl, m + t], [h2, m + t]];
    body = `<polygon points="${pts.map(p => p.map(r1).join(',')).join(' ')}" fill="${fill}"${st}/>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${body}</svg>`;
}
function txtStyle(t, o) {
  Object.assign(t.style, {fontFamily: o.font ? `${familyCSS(o.font)}, var(--slide-font)` : '', textTransform: o.upper ? 'uppercase' : '',letterSpacing: o.letterSpacing ? o.letterSpacing + 'pt' : '', fontSize: o.size + 'px', color: o.color, textAlign: o.align, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal',
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
  if (o.type === 'group') { for (const c of o.children) r.appendChild(objEl(c, rmode, tpl, o.x, o.y)); return el; }
  if (o.type === 'text' || o.type === 'table') {
    const empty = isEmptyText(o);
    if (o.placeholder && mode === 'template' && !tpl) { el.classList.add('phbox'); el.dataset.label = phName(o.placeholder); }
    if (!empty) el.classList.add('filled');
    if (empty && rmode !== 'edit') el.style.visibility = 'hidden';
    const t = document.createElement('div'); t.className = 'txt' + (empty && rmode === 'edit' && o.prompt ? ' empty' : ''); t.dataset.prompt = o.prompt ?? '';
    txtStyle(t, o); r.appendChild(t);
    renderStatic(t, o.doc, rmode === 'edit' ? onMathRendered : null, kindOf(o));
  } else if (o.type === 'shape') r.innerHTML = shapeSVG(o);
  else if (o.type === 'image') { r.innerHTML = `<img src="${media[o.media] ?? ''}" alt="" draggable="false">`; if (o.opacity != null) r.style.opacity = o.opacity; }
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
  const clip = newClip(el), i = doc.slides.indexOf(s);
  renderNum = i >= 0 ? i + 1 : null;
  paintLayoutBase(clip, layoutOf(s), rmode, true);
  for (const o of s.objects) clip.appendChild(objEl(o, rmode));
  renderNum = null;
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
    const h = el.firstChild.offsetHeight;
    if (h && Math.abs(h - o.h) > .5) { o.h = h; el.style.height = h + 'px'; if (groupOf(o.id)) groups = true; }
  }
  if (groups) for (const g of tgt().objects) if (g.type === 'group') {
    fitGroup(g); const ge = stage.querySelector(`.obj[data-id="${g.id}"]`);
    if (ge) { Object.assign(ge.style, {left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px'}); for (const c of g.children) { const ce = ge.querySelector(`.obj[data-id="${c.id}"]`); if (ce) placeEl(ce, c); } }
  }
}
function renderAll() { renderStage(); renderThumbs(); renderProps(); updateRibbon(); }

/* ================================================================== selection frame + animation badges */
const HANDLES_FULL = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], HANDLES_W = ['nw', 'ne', 'e', 'se', 'sw', 'w'];
function drawSelection() {
  stage.querySelectorAll('.self').forEach(x => x.remove());
  const objs = selIds.map(objById).filter(Boolean);
  if (!objs.length) return;
  const frame = (o, cls) => {
    const d = document.createElement('div'); d.className = 'self ' + cls;
    const g = groupOf(o.id);   // a member being edited inside a group: absolute position
    Object.assign(d.style, {left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px', transform: o.rot ? `rotate(${o.rot}deg)` : ''});
    stage.appendChild(d); return d;
  };
  if (objs.length > 1) {                        // several: a thin frame for each and one frame around all
    objs.forEach(o => frame(o, 'multi'));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of objs) { const b = bounds(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const d = frame({x: x0, y: y0, w: x1 - x0, h: y1 - y0}, 'all');
    d.innerHTML = '<div class="stem"></div><div class="h move" data-h="move" title="A kijelöltek mozgatása">' + svgIcon('move') + '</div>';
    return;
  }
  const o = objs[0], d = frame(o, 'one' + (editing === o.id ? ' editing' : '') + (o.locked ? ' locked' : ''));
  d.id = 'sel';
  if (o.locked) return;
  const widthOnly = isTextLike(o) || o.shape === 'line', hs = widthOnly ? HANDLES_W : HANDLES_FULL;
  const pos = {nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50]};
  const cr = {nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew'};
  d.innerHTML = '<div class="stem"></div><div class="h move" data-h="move" title="Mozgatás (Alt: illesztés nélkül)">' + svgIcon('move') + '</div>'
    + (o.shape === 'line' ? ['e', 'w'] : hs).map(h => `<div class="h" data-h="${h}" style="left:${pos[h][0]}%;top:${pos[h][1]}%;cursor:${cr[h]}-resize"></div>`).join('');
}
function drawBadges() {
  stage.querySelectorAll('.badges').forEach(b => b.remove());
  if (mode !== 'slides' || !showBadges) return;
  const s = tgt(), rg = Anim.ranges(Anim.expand(s)), map = {};
  for (const a of s.anims) if (rg[a.id]) (map[a.target] ??= []).push({r: rg[a.id], cls: Anim.EFFECTS[a.effect].cls});
  for (const [id, arr] of Object.entries(map)) {
    const o = objById(id); if (!o || o.hidden) continue;
    const b = document.createElement('div'), bb = bounds(o); b.className = 'badges';
    Object.assign(b.style, {left: bb.x + 'px', top: bb.y + 'px'});
    b.innerHTML = arr.map(({r, cls}) => `<span class="badge ${cls}" title="${Anim.CLASSES[cls]}">${r[0] === r[1] ? r[0] : r[0] + '–' + r[1]}</span>`).join('');
    stage.appendChild(b);
  }
}

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
function renderSlideList() {
  slidesNav.innerHTML = '<div class="plist" id="plist"></div>';
  const list = $('#plist');
  doc.slides.forEach((s, i) => {
    const t = thumbFrame(i + 1, i === cur ? 'cur' : ''); t.draggable = true;
    renderSlide(s, t.querySelector('.slide'), 'thumb');
    if (s.transition) t.querySelector('.no').insertAdjacentHTML('beforeend', `<span class="trmark" title="Diaváltás: ${esc(TRANSITIONS[s.transition.type]?.label ?? '')}">★</span>`);
    t.onclick = () => { gotoSlide(i); slideFocus = true; };
    t.ondragstart = e => e.dataTransfer.setData('text/slide', i);
    t.ondragover = e => { e.preventDefault(); t.classList.add('dragover'); };
    t.ondragleave = () => t.classList.remove('dragover');
    t.ondrop = e => { e.preventDefault(); const from = e.dataTransfer.getData('text/slide'); if (from !== '') moveSlide(+from, i); };
    list.appendChild(t);
    if (i === cur) {
      const a = document.createElement('div'); a.className = 'slide-actions';
      a.innerHTML = `<button class="tb" id="sNew" title="Új dia az aktuális után – elrendezés választása">${svgIcon('plus')}<span>Új dia</span>${svgIcon('chev')}</button>
        <button class="tb" id="sDup" title="Az aktuális dia másolása">${svgIcon('copy')}</button>
        <button class="tb" id="sDel" title="Az aktuális dia törlése" ${doc.slides.length < 2 ? 'disabled' : ''}>${svgIcon('trash')}</button>
        <button class="tb${s.transition ? ' on' : ''}" id="sTrans" title="Diaváltás (áttűnés) erre a diára">${svgIcon('trans')}${svgIcon('chev')}</button>`;
      list.appendChild(a);
    }
  });
  $('#sNew').onclick = e => showPop('popNewSlide', e.currentTarget);
  $('#sTrans').onclick = e => showPop('popTrans', e.currentTarget);
  $('#sDup').onclick = () => { if (editing) exitEdit(); const s = clone(tgt()); const ids = {};
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
      a.innerHTML = `<button class="tb" id="lAdd" title="Új diatípus a sablonba">${svgIcon('plus')}<span>Új dia</span></button>
        <button class="tb" id="lDup" title="Elrendezés másolása">${svgIcon('copy')}</button>
        <button class="tb" id="lDel" title="Elrendezés törlése" ${keys.length < 2 ? 'disabled' : ''}>${svgIcon('trash')}</button>`;
      list.appendChild(a);
    }
  });
  if (tcur === 'master') { const a = document.createElement('div'); a.className = 'slide-actions'; a.innerHTML = `<button class="tb" id="lAdd" title="Új diatípus a sablonba">${svgIcon('plus')}<span>Új dia</span></button>`; list.appendChild(a); }
  $('#tClose').onclick = closeTemplateBuilder;
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
  mode = 'template'; tcur = doc.slides[cur] ? doc.slides[cur].template : 'master'; setSel([]); renderAll(); fitStage();
}
function closeTemplateBuilder() {
  if (editing) exitEdit(); closePops();
  for (const s of doc.slides) syncPlaceholders(s);
  mode = 'slides'; setSel([]); commit(); fitStage();
}

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
  action = {type: 'move', p0: p, starts: objs.map(o => ({o, x: o.x, y: o.y})), moved: false};
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
    if (!e.altKey && action.starts.length === 1) { const [x, y] = snap(lead.o, lead.x + dx, lead.y + dy); dx = x - lead.x; dy = y - lead.y; }
    for (const s of action.starts) moveObject(s.o, Math.round(s.x + dx) - s.o.x, Math.round(s.y + dy) - s.o.y);
    action.starts.forEach(s => updateObjLive(s.o, true)); drawSelection(); drawBadges();
    if (action.starts.length === 1) syncGeometryInputs(lead.o);
    return;
  }
  const o = selObj(); if (!o) return;
  if (action.type === 'resize') doResize(o, p, e.shiftKey);
  updateObjLive(o);
});
stage.addEventListener('pointerup', () => {
  if (!action) return;
  stage.querySelectorAll('.guide, .marquee').forEach(g => g.remove());
  const a = action; action = null;
  if (a.type === 'marquee') { renderProps(); updateRibbon(); return; }
  if (a.editAt && !a.moved) { lastDown = null; enterEdit(a.editAt.id, a.editAt); return; }
  if (a.moved) { for (const s of a.starts ?? [{o: selObj()}]) if (s.o?.placeholder && mode === 'slides') s.o.phMoved = true; commit(); }
});
function startHandle(h, p, e) {
  if (h === 'move') { startMove(p, e); e.stopPropagation(); return; }
  const o = selObj(); if (!o || o.locked) return;
  action = {type: 'resize', h, p0: p, o0: clone(o), moved: true};
  stage.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
}
/** Resize in the object's rotated frame, keeping the opposite handle fixed. Groups scale uniformly. */
function doResize(o, p, keepRatio) {
  const {h, p0, o0} = action, t = (o0.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = p.x - p0.x, dy = p.y - p0.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const sx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0, sy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0;
  let w = Math.max(16, o0.w + sx * lx), hh = Math.max(16, o0.h + sy * ly);
  if (isTextLike(o) || o.shape === 'line') hh = o0.h;
  else if ((keepRatio || o.type === 'image' || o.type === 'group') && sx && sy) { const k = Math.max(w / o0.w, hh / o0.h); w = o0.w * k; hh = o0.h * k; }
  else if (o.type === 'group') { const k = sx ? w / o0.w : hh / o0.h; w = o0.w * k; hh = o0.h * k; }
  const cx0 = o0.x + o0.w / 2, cy0 = o0.y + o0.h / 2, ax = -sx * o0.w / 2, ay = -sy * o0.h / 2;
  const Ax = cx0 + ax * c - ay * s, Ay = cy0 + ax * s + ay * c, nx = sx * w / 2, ny = sy * hh / 2;
  const cx = Ax + nx * c - ny * s, cy = Ay + nx * s + ny * c;
  if (o.type === 'group') { const k = w / o0.w; scaleFrom(o, o0, k, o0.x, o0.y); moveObject(o, Math.round(cx - w / 2) - o.x, Math.round(cy - hh / 2) - o.y); return; }
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

/* ================================================================== text editing (Matekos Doksi editor) */
setTextHooks({onEdit: (pos, node) => openMath(pos, node), onRendered: onMathRendered, onPreview: p => showPreview(p)});
function enterEdit(id, ev) {
  const o = objById(id); if (!isTextLike(o) || o.locked || o.field) return;
  if (sel !== id) { setSel([id]); curAnim = null; }
  editing = id;
  const el = stage.querySelector(`.obj[data-id="${id}"]`), txt = el.querySelector('.txt');
  txt.classList.remove('empty'); el.classList.add('editing');
  ed = mountEditor(txt, o.doc, {
    onUpdate: () => { measureTexts(); drawSelection(); drawTableHandles(); },
    onSelection: () => { updateRibbon(); drawTableHandles(); drawMathCaret(); },
    onBlur: () => { drawMathCaret(); showPreview(null); }
  }, kindOf(o));
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
  if (isText(o) && isEmptyText(o) && !o.placeholder) {
    const g = groupOf(o.id), list = g ? g.children : tgt().objects; list.splice(list.indexOf(o), 1); if (g) fitGroup(g);
    if (tgt().anims) tgt().anims = tgt().anims.filter(a => a.target !== o.id);
    setSel([]); commit(); return;
  }
  if (changed) commit(); else renderAll();
}
/** Run a TipTap command on the selected text box: directly while editing, otherwise on its whole content. */
function withEditor(fn) {
  const o = selObj(); if (!isTextLike(o) || o.locked) return;
  if (o.field) { toast('Automatikus mezőnél csak az egész doboz formázható (betű, szín, igazítás).'); return; }
  if (editing === o.id) { fn(ed.chain().focus()); return; }
  if (mode === 'template' && o.placeholder) { toast('A helykitöltő formázását a menüszalag betű- és igazítás-gombjaival állíthatod.'); return; }
  enterEdit(o.id); ed.commands.selectAll(); fn(ed.chain().focus()); exitEdit();
}
/** Make sure a text box is being edited (for inserting tables / formulas); creates one if needed. */
function ensureEditing() {
  const o = selObj();
  if (editing) return true;
  if (isTextLike(o) && !o.locked && !(mode === 'template' && o.placeholder)) { enterEdit(o.id); ed.commands.focus('end'); return true; }
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
  const row = c.table.child(Math.min(c.rect.top, c.table.childCount - 1));
  if (act !== $('#tpRowH')) $('#tpRowH').value = row.attrs.height || '';
  const cell = c.table.nodeAt(c.map.map[c.rect.top * c.map.width + c.rect.left]);
  if (act !== $('#tpColW')) $('#tpColW').value = cell && cell.attrs.colwidth && cell.attrs.colwidth[0] ? Math.round(cell.attrs.colwidth[0] / MM * 10) / 10 : '';
  for (const b of $$('#tableBar [data-talign]')) b.classList.toggle('on', (c.table.attrs.align || 'left') === b.dataset.talign);
}
for (const id of ['#tpRowH', '#tpColW']) {
  $(id).addEventListener('focus', rememberTable);
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); } });
}
function setTableAttrs(attrs) { const c = curTable(); if (!c) return; ed.view.dispatch(ed.state.tr.setNodeMarkup(c.pos, undefined, {...c.table.attrs, ...attrs})); reselectCells(curTable()); }
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
tg.addEventListener('click', e => { const d = e.target.closest('.tc'); if (!d) return; closePops(); addTable(+d.dataset.r, +d.dataset.c); });
$('#popTable').onopen = () => hl(0, 0);

/* ================================================================== inserting objects */
function nextName(base) { return `${base} ${flatObjects(tgt().objects).filter(o => o.name?.startsWith(base)).length + 1}`; }
function addObject(o) {
  const n = tgt().objects.length % 8;
  o = {id: uid(), x: Math.round(W / 2 - (o.w ?? 400) / 2 + n * 20), y: Math.round(H / 2 - (o.h ?? 60) / 2 + n * 20), w: 400, h: 60, rot: 0, ...o};
  tgt().objects.push(o); setSel([o.id]); curAnim = null; return o;
}
// default shapes are regular: square, circle, equilateral triangle
const SHAPES = {
  rect: {name: 'Téglalap', w: 100, h: 100, fill: '#d6eaf8', stroke: '#2f5d8a', strokeWidth: 3, radius: 0},
  ellipse: {name: 'Ellipszis', w: 100, h: 100, fill: '#d6eaf8', stroke: '#2f5d8a', strokeWidth: 3},
  triangle: {name: 'Háromszög', w: 110, h: Math.round(110 * Math.sqrt(3) / 2), fill: '#d6eaf8', stroke: '#2f5d8a', strokeWidth: 3},
  arrow: {name: 'Nyíl', w: 80, h: 27, fill: '#2f5d8a', stroke: null, strokeWidth: 0},
  line: {name: 'Vonal', w: 300, h: 20, fill: null, stroke: '#2f5d8a', strokeWidth: 4}
};
function addShape(shape) {
  if (editing) exitEdit();
  const {name, ...base} = SHAPES[shape];
  addObject({type: 'shape', shape, name: nextName(name), ...base}); commit();
}
function addText() {
  if (editing) exitEdit();
  const st = stylesOf().body;
  const o = addObject({type: 'text', name: nextName('Szöveg'), w: 620, size: st.size, color: st.color, bold: st.bold || undefined, italic: st.italic || undefined,
    underline: st.underline || undefined, font: st.font || undefined,
    align: 'left', styleRef: 'body', doc: emptyDoc()});
  renderAll(); enterEdit(o.id);
}
function addTable(rows, cols) {
  if (editing) exitEdit();
  const w = Math.min(1100, Math.max(240, cols * 150));
  const o = addObject({type: 'table', name: nextName('Táblázat'), w, h: rows * 50, size: 26.67, color: '#1a1a1a', align: 'left', doc: tableDoc(rows, cols)});
  commit(); enterEdit(o.id);
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

/* grouping, locking, deleting */
function groupSelected() {
  const objs = tgt().objects.filter(o => selIds.includes(o.id));
  if (objs.length < 2) return;
  if (editing) exitEdit();
  const at = tgt().objects.indexOf(objs.at(-1));
  const g = fitGroup({id: uid(), type: 'group', name: nextName('Csoport'), x: 0, y: 0, w: 1, h: 1, rot: 0, children: objs});
  tgt().objects.splice(at, 1, g);
  tgt().objects = tgt().objects.filter(o => !objs.includes(o));
  // members are animated together with the group from now on
  if (tgt().anims) tgt().anims = tgt().anims.filter(a => !objs.some(o => flatObjects([o]).some(q => q.id === a.target)));
  setSel([g.id]); commit();
}
function ungroupSelected() {
  const g = selObj(); if (g?.type !== 'group') return;
  if (editing) exitEdit();
  const list = tgt().objects, at = list.indexOf(g);
  list.splice(at, 1, ...g.children);
  if (tgt().anims) tgt().anims = tgt().anims.filter(a => a.target !== g.id);
  setSel(g.children.map(c => c.id)); commit();
}
function toggleHidden(id) {
  const o = objById(id); if (!o) return;
  if (editing === id) exitEdit();
  o.hidden = !o.hidden || undefined; if (o.hidden) setSel(selIds.filter(x => x !== id)); commit();
}
function toggleLock(id) {
  const o = objById(id); if (!o) return;
  if (editing === id) exitEdit();
  o.locked = !o.locked || undefined; commit();
}
/* slide transitions */
const TRANSITIONS = {
  none: {label: 'Nincs'}, fade: {label: 'Áttűnés'}, fadeBlack: {label: 'Áttűnés feketén át'},
  push: {label: 'Eltolás', dirs: 'side'}, cover: {label: 'Takarás', dirs: 'side'}, pull: {label: 'Felfedés', dirs: 'side'},
  wipe: {label: 'Törlés', dirs: 'side'}, split: {label: 'Szétválás', dirs: 'split'}, zoom: {label: 'Nagyítás'}
};
const TR_DIRS = {side: {r: 'jobbról', l: 'balról', b: 'alulról', t: 'felülről'}, split: {vo: 'függőlegesen kifelé', vi: 'függőlegesen befelé', ho: 'vízszintesen kifelé', hi: 'vízszintesen befelé'}};
/** Transition menu under the current slide in the left panel. */
function renderTransMenu() {
  const t = tgt().transition || {type: 'none'}, T_ = TRANSITIONS[t.type] || TRANSITIONS.none;
  $('#transList').innerHTML = Object.entries(TRANSITIONS).map(([k, v]) => `<button class="pitem${k === t.type ? ' on' : ''}" data-tr="${k}">${v.label}</button>`).join('');
  const dirs = T_.dirs ? TR_DIRS[T_.dirs] : null, dir = dirs ? (dirs[t.dir] ? t.dir : Object.keys(dirs)[0]) : null;
  $('#transDirs').innerHTML = dirs ? `<div class="psep"></div><div class="ptitle">Irány</div><div class="trdirs">${Object.entries(dirs).map(([k, l]) => `<button class="pitem${k === dir ? ' on' : ''}" data-trdir="${k}">${l}</button>`).join('')}</div>` : '';
  $('#transDur').value = secs(t.dur ?? 700); $('#transDur').disabled = t.type === 'none';
  $('#transPlay').disabled = t.type === 'none';
}
$('#popTrans').onopen = renderTransMenu;
$('#popTrans').addEventListener('click', e => {
  const s_ = tgt(), b = e.target.closest('[data-tr], [data-trdir]'); if (!b) return;
  if (b.dataset.tr) { if (b.dataset.tr === 'none') delete s_.transition; else s_.transition = {type: b.dataset.tr, dur: s_.transition?.dur ?? 700}; }
  else (s_.transition ||= {type: 'fade', dur: 700}).dir = b.dataset.trdir;
  commit(); renderTransMenu();
});
$('#transDur').addEventListener('change', e => { const v = parseFloat(String(e.target.value).replace(',', '.')), s_ = tgt();
  if (v > 0 && s_.transition) { s_.transition.dur = Math.round(Math.min(10, v) * 1000); commit(); } });
$('#transAll').onclick = async () => {
  closePops(); const s_ = tgt();
  if (!await confirmBox('Ez a diaváltás kerüljön minden diára?', 'Minden diára')) return;
  for (const sl of doc.slides) { if (s_.transition) sl.transition = clone(s_.transition); else delete sl.transition; } commit();
};
$('#transPlay').onclick = () => { closePops(); if (cur === 0) { startShow(0); return; } startShow(cur - 1); setTimeout(() => sh && loadShowSlide(cur, 0, true, true), 350); };
function deleteSelected() {
  const ids = selIds.filter(id => !objById(id)?.locked); if (!ids.length) return;
  for (const id of ids) {
    const g = groupOf(id), list = g ? g.children : tgt().objects, o = objById(id);
    if (o) list.splice(list.indexOf(o), 1);
    if (g) { if (g.children.length) fitGroup(g); else tgt().objects.splice(tgt().objects.indexOf(g), 1); }
  }
  if (tgt().anims) tgt().anims = tgt().anims.filter(a => objById(a.target));
  setSel([]); commit();
}

/* ================================================================== right panel */
const props = $('#props');
const fld = (label, html, full) => `<label class="fld${full ? ' full' : ''}">${label}${html}</label>`;
const slider = (id, label, v, min, max, step = 1, dis = '') => `<div class="sl"><span>${label}</span><input type="range" id="${id}R" min="${min}" max="${max}" step="${step}" value="${v}" ${dis}><input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}" ${dis}></div>`;
function panelVisible(v) { mainEl.classList.toggle('noprops', !v); document.body.classList.toggle('noprops-on', !v); lsSet(LS.panel, v ? '1' : '0'); fitStage(); }
$('#panelOpen').onclick = () => panelVisible(true);
let secState = {}; try { secState = JSON.parse(lsGet(LS.sections) || '{}'); } catch (e) { secState = {}; }
const section = (key, title, body) => `<section class="psec${secState[key] ? ' closed' : ''}" data-sec="${key}">
  <button class="psec-h" data-sec-toggle="${key}" aria-expanded="${!secState[key]}">${svgIcon('chev')}<span>${title}</span></button><div class="psec-b">${body}</div></section>`;
const TYPE_LABEL = {text: 'Szöveg', table: 'Táblázat', image: 'Kép', group: 'Csoport'};
const typeIcon = o => o.type === 'shape' ? o.shape : o.type === 'group' ? 'group' : o.type === 'table' ? 'table' : o.type === 'image' ? 'image' : 'textbox';

function alignBar(n) {
  const b = (k, ic, t, dis) => `<button class="tb" data-align="${k}" title="${t}" ${dis ? 'disabled' : ''}>${svgIcon(ic)}</button>`;
  return `<div class="alignbar"><span class="albl">${n > 1 ? 'Igazítás egymáshoz' : 'Igazítás a diához'}</span>
    ${b('l', 'alObjL', 'Balra')}${b('c', 'alObjC', 'Vízszintesen középre')}${b('r', 'alObjR', 'Jobbra')}${b('t', 'alObjT', 'Fel')}${b('m', 'alObjM', 'Függőlegesen középre')}${b('b', 'alObjB', 'Le')}
    ${b('dh', 'distH', 'Egyenletes elosztás vízszintesen (legalább 3 objektum)', n < 3)}${b('dv', 'distV', 'Egyenletes elosztás függőlegesen (legalább 3 objektum)', n < 3)}</div>`;
}
function groupBar() {
  const multiTop = tgt().objects.filter(o => selIds.includes(o.id)).length > 1, one = selObj();
  if (!multiTop && one?.type !== 'group') return '';
  return `<div class="grpbar">${multiTop ? `<button class="btn" data-arr="group" title="A kijelöltek csoportosítása (Ctrl/⌘+G)">${svgIcon('group')}Csoportosítás</button>` : ''}
    ${one?.type === 'group' ? `<button class="btn" data-arr="ungroup" title="A csoport szétbontása (Ctrl/⌘+Shift+G)">${svgIcon('ungroup')}Szétbontás</button>` : ''}</div>`;
}
function positionBody() {
  const objs = selIds.map(objById).filter(Boolean);
  if (objs.length > 1) return `${groupBar()}${alignBar(objs.length)}<div class="phint" style="margin:8px 0 0">${objs.length} objektum kijelölve – húzd bármelyiket a közös mozgatáshoz.</div>`;
  const o = objs[0];
  if (!o) return '<div class="phint" style="margin:0">Jelölj ki egy objektumot a dián vagy a Rétegek listában. Több objektum: Shift+kattintás, vagy húzz keretet az üres területen.</div>';
  const round = Math.round, rot = o.rot > 180 ? o.rot - 360 : (o.rot || 0), lk = o.locked ? 'disabled' : '';
  const colors = o.type === 'shape' ? `<div class="colbtns">
      <button class="btn colbtn" data-pop="popFill" ${o.shape === 'line' || o.locked ? 'disabled' : ''} title="Kitöltés színe"><i class="dot fill${o.fill ? '' : ' none'}" style="--c:${o.fill || 'transparent'}"></i>Kitöltés</button>
      <button class="btn colbtn" data-pop="popStroke" ${lk} title="Körvonal színe és vastagsága"><i class="dot ring${o.stroke ? '' : ' none'}" style="--c:${o.stroke || 'transparent'}"></i>${o.shape === 'line' ? 'Vonal' : 'Körvonal'}</button></div>` : '';
  return `${colors}${groupBar()}${o.locked ? '' : alignBar(1)}${o.locked ? `<div class="phint lockhint">${svgIcon('lock')} Zárolva – a Rétegek résznél oldható fel.</div>` : ''}
    ${slider('pX', 'Vízszintes', round(o.x), -round(o.w) + 10, W - 10, 1, lk)}
    ${slider('pY', 'Függőleges', round(o.y), -round(o.h) + 10, H - 10, 1, lk)}
    ${slider('pW', 'Szélesség', round(o.w), 16, W, 1, lk)}
    ${slider('pH', 'Magasság', round(o.h), 16, H, 1, isTextLike(o) || o.shape === 'line' ? 'disabled title="A magasság a tartalomhoz igazodik"' : lk)}
    ${slider('pR', 'Elforgatás (°)', round(rot), -180, 180, 1, o.type === 'group' ? 'disabled title="Csoport nem forgatható – a tagjai igen"' : lk)}
    ${o.type === 'shape' ? slider('pSW', o.shape === 'line' ? 'Vastagság (px)' : 'Körvonal (px)', o.stroke ? (o.strokeWidth || 0) : 0, o.shape === 'line' ? 1 : 0, 30, 1, lk) : ''}
    ${o.shape === 'rect' ? slider('pRad', 'Lekerekítés', o.radius || 0, 0, Math.round(Math.min(o.w, o.h) / 2), 1, lk) : ''}
    ${o.type === 'image' ? slider('pOp', 'Átlátszatlanság (%)', round((o.opacity ?? 1) * 100), 10, 100, 1, lk) : ''}
    ${o.placeholder && mode === 'template' ? fld('Helykitöltő mintaszövege (csak szerkesztés közben látszik)', `<input type="text" id="pPrompt" value="${esc(o.prompt ?? '')}">`, true) : ''}
    ${o.placeholder && mode === 'slides' ? `<div class="phint">${esc(phName(o.placeholder))} helykitöltő – helye és formája az elrendezést követi, amíg itt nem módosítod.</div>` : ''}`;
}
function layersBody() {
  const objs = tgt().objects, one = selObj(), top = one && tgt().objects.includes(one);
  const dis = top && !one.locked ? '' : 'disabled';
  const multiTop = tgt().objects.filter(o => selIds.includes(o.id)).length > 1;
  const rows = [...objs].reverse().map(o => `<div class="lyr${selIds.includes(o.id) ? ' on' : ''}${o.locked ? ' isl' : ''}${o.hidden ? ' ish' : ''}" draggable="true" data-id="${o.id}">
    <span class="grip">${svgIcon('grip')}</span>${svgIcon(typeIcon(o))}<span class="lname">${esc(o.name ?? TYPE_LABEL[o.type] ?? '')}${o.type === 'group' ? ` <small>(${o.children.length})</small>` : ''}</span>
    <button class="lk eye${o.hidden ? ' on' : ''}" data-hide="${o.id}" title="${o.hidden ? 'Megjelenítés' : 'Elrejtés (a dián, a lejátszásban és az exportban sem látszik)'}">${svgIcon(o.hidden ? 'eyeOff' : 'eye')}</button>
    <button class="lk${o.locked ? ' on' : ''}" data-lock="${o.id}" title="${o.locked ? 'Feloldás' : 'Zárolás: nem mozdítható, nem jelölhető ki a dián'}">${svgIcon(o.locked ? 'lock' : 'unlock')}</button></div>`).join('');
  return `<div class="layers" id="layerList">${rows || '<div class="phint" style="margin:4px 0">Ezen a dián még nincs objektum.</div>'}</div>
    <div class="phint">Legfelül az előtérben lévő. Húzással átrendezhető; Shift+kattintás: több kijelölése.</div>`;
}
function renderProps() {
  const o = selObj(); let h = '';
  const title = selIds.length > 1 ? `${selIds.length} objektum` : o ? esc(o.name ?? TYPE_LABEL[o.type] ?? 'Objektum') : mode === 'slides' ? `${cur + 1}. dia` : tcur === 'master' ? 'Mester' : 'Elrendezés';
  h += `<div class="phead2"><b>${title}</b><button class="tb" id="propsX" title="Jobb oldali panel bezárása">${svgIcon('panel')}</button></div>`;
  if (mode === 'template' && !selIds.length) {
    h += `<section class="presetbox"><div class="pbhead"><b>Kész sablonok</b><span>Jelenleg: ${esc(doc.templateName || 'Saját')}</span></div>
      <div class="pbgrid">${PRESET_ORDER.map(k => { const P = PRESETS[k], sw = P.swatch || ['#ffffff', '#d8d8d8'];
        return `<button class="pbcard${(doc.templateName || '') === P.label ? ' on' : ''}" data-preset="${k}" title="${esc(P.note)}"><i style="--a:${sw[0]};--b:${sw[1]}"></i><span>${P.label}${k === 'ures' ? ' (új, üres)' : ''}</span></button>`; }).join('')}</div>
      <div class="pbnote">Válassz kész sablont, és szabd tovább lent és a dián – a módosítások ebbe a fájlba mentődnek. Új bemutató mindig az Üres sablonnal indul.</div></section>`;
    const isM = tcur === 'master', L = tgt();
    h += `<section><div class="fgrid">
      ${isM ? '' : fld('Név', `<input type="text" id="pName" value="${esc(L.name)}">`, true)}
      ${isM ? '' : `<label class="chk full"><input type="checkbox" id="pShowM" ${L.showMaster ? 'checked' : ''}> A mester elemeinek megjelenítése</label>`}
      ${isM ? '' : `<label class="chk full"><input type="checkbox" id="pOwnBg" ${L.ownBg ? 'checked' : ''}> Saját háttér (a mesteré helyett)</label>`}</div>`;
    if (isM || L.ownBg) h += `<div class="fgrid" style="margin-top:10px">
      <div class="fld">Háttérszín<button class="btn colbtn" id="pBgColor"><i class="dot fill" style="--c:${L.bgColor || '#ffffff'}"></i>${L.bgColor || '#ffffff'}</button></div>
      <div class="fld">Háttérkép<div class="imgpick">${L.background ? `<img src="${media[L.background]}" alt="">` : ''}<button class="btn" id="pBgPick">Kép…</button>${L.background ? '<button class="btn" id="pBgClear">Eltávolítás</button>' : ''}</div></div></div>`;
    h += `<div class="phint">${isM ? 'Ami a mesterre kerül (logó, lábléc, díszítés), minden elrendezésen megjelenik.' : 'Helykitöltőt a menüszalag „Helykitöltő” gombjával adhatsz hozzá.'}</div></section>`;
    const st = stylesOf(), fams = allFamilies();
    const famSel = (k, v) => `<select class="stfont" data-st="${k}" title="Betűtípus"><option value="">Alapbetűtípus</option>${[...fams.math, ...fams.other].map(([f, l]) => `<option value="${f}" ${f === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const row = (k, label, hint) => `<div class="strow"><div class="sthead"><b>${label}</b><span class="phint">${hint}</span></div>
      <div class="stctl"><input type="number" class="stsize" data-st="${k}" min="8" max="120" step="0.5" value="${Math.round(st[k].size * 0.75 * 2) / 2}" title="Betűméret (pt)"><span class="unit">pt</span>
        <button class="btn colbtn stcolor" data-st="${k}" title="Betűszín"><i class="dot fill" style="--c:${st[k].color}"></i>Szín</button>
        <button class="tb${st[k].bold ? ' on' : ''}" data-stt="bold" data-st="${k}" title="Félkövér"><b>B</b></button><button class="tb${st[k].italic ? ' on' : ''}" data-stt="italic" data-st="${k}" title="Dőlt"><i>I</i></button><button class="tb${st[k].underline ? ' on' : ''}" data-stt="underline" data-st="${k}" title="Aláhúzott"><u>U</u></button>
        ${famSel(k, st[k].font)}</div></div>`;
    h += `<section><div class="fgrid">${fld('Alapbetűtípus (szöveg és képletek)', `<select id="pBaseFont">${Object.entries(FONT_SETS).map(([k2, f]) => `<option value="${k2}" ${k2 === (doc.font || DEFAULT_FONT) ? 'selected' : ''}>${f.label}</option>`).join('')}</select>`, true)}</div>
      <div class="phint">Az új szövegdobozok és a képletek ezt használják. Csak képletbarát betűtípus lehet.</div></section>`;
    h += section('styles', 'Szövegstílusok', row('title', 'Címek', 'cím-helykitöltők') + row('subtitle', 'Alcímek', 'alcím-helykitöltők') + row('body', 'Szöveg', 'szöveg-helykitöltők, új szövegdobozok')
      + '<div class="phint">A méretváltozás arányosan hat (a címdia nagyobb címe nagyobb marad). A diákon egyenként átformázott dobozok megtartják a saját formájukat.</div>');
  }
  h += section('pos', 'Megjelenés és elhelyezés', positionBody());
  h += section('layers', 'Rétegek', layersBody());
  if (mode === 'slides') h += section('anim', 'Animációk', animBody());
  props.innerHTML = h;
  bindProps(o);
}
props.addEventListener('click', e => {
  const t = e.target.closest('[data-sec-toggle]'); if (!t) return;
  const k = t.dataset.secToggle; secState[k] = !secState[k]; lsSet(LS.sections, JSON.stringify(secState));
  const sec = t.closest('.psec'); sec.classList.toggle('closed', !!secState[k]); t.setAttribute('aria-expanded', String(!secState[k]));
});
function syncGeometryInputs(o) {
  if (o.id !== sel) return;
  const set = (id, v) => { for (const el of [$('#' + id), $('#' + id + 'R')]) if (el && document.activeElement !== el) el.value = Math.round(v); };
  set('pX', o.x); set('pY', o.y); set('pW', o.w); set('pH', o.h); set('pR', o.rot > 180 ? o.rot - 360 : (o.rot || 0));
}
function bindProps(o) {
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
  on('propsX', 'click', () => panelVisible(false));
  on('pName', 'change', e => { tgt().name = e.target.value.trim() || 'Elrendezés'; commit(); });
  on('pShowM', 'change', e => { tgt().showMaster = e.target.checked; commit(); });
  on('pOwnBg', 'change', e => { const L = tgt(); L.ownBg = e.target.checked; if (L.ownBg && !L.background) { L.background = doc.master.background; L.bgColor = doc.master.bgColor; } commit(); });
  on('pBgColor', 'click', e => pickAnyColor(e.currentTarget, 'Háttérszín', tgt().bgColor || '#ffffff', c => { tgt().bgColor = c === 'none' ? '#ffffff' : c; commit(); }));
  props.querySelectorAll('.stsize').forEach(inp => inp.onchange = () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (v > 0) applyStyle(inp.dataset.st, {size: Math.round(v / 0.75 * 100) / 100}); });
  props.querySelectorAll('.stcolor').forEach(b => b.onclick = () => pickAnyColor(b, b.dataset.st === 'title' ? 'Címek színe' : 'Szöveg színe', stylesOf()[b.dataset.st].color, c => { if (c !== 'none') applyStyle(b.dataset.st, {color: c}); }));
  props.querySelectorAll('[data-stt]').forEach(b => b.onclick = () => applyStyle(b.dataset.st, {[b.dataset.stt]: !stylesOf()[b.dataset.st][b.dataset.stt]}));
  props.querySelectorAll('.stfont').forEach(sel_ => sel_.onchange = () => applyStyle(sel_.dataset.st, {font: sel_.value || null}));
  on('pBaseFont', 'change', e => switchFont(e.target.value));
  props.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => applyPreset(b.dataset.preset));
  on('pBgPick', 'click', () => pickImage(key => { tgt().background = key; commit(); }));
  on('pBgClear', 'click', () => { tgt().background = null; commit(); });
  on('pPrompt', 'change', e => { o.prompt = e.target.value; commit(); });
  if (o) {
    let o0 = null;
    const SETTERS = {
      pX: v => moveObject(o, v - o.x, 0), pY: v => moveObject(o, 0, v - o.y),
      pW: v => { if (o.type === 'group') { o0 ??= clone(o); scaleFrom(o, o0, Math.max(16, v) / o0.w, o0.x, o0.y); } else o.w = Math.max(16, v); },
      pH: v => { if (o.type === 'group') { o0 ??= clone(o); scaleFrom(o, o0, Math.max(16, v) / o0.h, o0.x, o0.y); } else o.h = Math.max(16, v); },
      pR: v => { o.rot = ((v % 360) + 360) % 360; }, pSW: v => { o.strokeWidth = Math.max(0, v); if (v > 0 && !o.stroke) o.stroke = '#2f5d8a'; if (!v && o.shape !== 'line') o.stroke = null; },
      pRad: v => { o.radius = Math.max(0, v); }, pOp: v => { o.opacity = v / 100; }
    };
    for (const [id, set] of Object.entries(SETTERS)) for (const suffix of ['', 'R']) {
      const el = $('#' + id + suffix); if (!el) continue;
      el.addEventListener('input', () => { const v = parseFloat(el.value); if (!isFinite(v)) return; set(v); const twin = $('#' + id + (suffix ? '' : 'R')); if (twin) twin.value = el.value; updateObjLive(o); });
      el.addEventListener('change', () => { o0 = null; if (o.placeholder && mode === 'slides' && /p[XYWHR]$/.test(id)) o.phMoved = true; commit(); });
    }
  }
  // layers
  props.querySelectorAll('[data-arr]').forEach(b => b.onclick = () => ({group: groupSelected, ungroup: ungroupSelected})[b.dataset.arr]());
  props.querySelectorAll('[data-align]').forEach(b => b.onclick = () => alignObjects(b.dataset.align));
  props.querySelectorAll('.colbtn[data-pop]').forEach(b => b.onclick = () => showPop(b.dataset.pop, b));
  bindLayers();
  if (mode === 'slides') bindAnims();
}
/** Align the selected objects to each other (one object: to the slide), or distribute them evenly. */
function alignObjects(how) {
  const objs = selIds.map(objById).filter(o => o && !o.locked); if (!objs.length) return;
  if (editing) syncEditor();
  const bs = objs.map(bounds);
  let X0 = Math.min(...bs.map(b => b.x)), Y0 = Math.min(...bs.map(b => b.y)), X1 = Math.max(...bs.map(b => b.x + b.w)), Y1 = Math.max(...bs.map(b => b.y + b.h));
  if (objs.length === 1) { X0 = 0; Y0 = 0; X1 = W; Y1 = H; }
  if (how === 'dh' || how === 'dv') {
    const hz = how === 'dh', idx = objs.map((o, i) => i).sort((a, b) => hz ? bs[a].x - bs[b].x : bs[a].y - bs[b].y);
    const total = idx.reduce((t, i) => t + (hz ? bs[i].w : bs[i].h), 0), gap = ((hz ? X1 - X0 : Y1 - Y0) - total) / (objs.length - 1);
    let pos = hz ? X0 : Y0;
    for (const i of idx) { const d = Math.round(pos - (hz ? bs[i].x : bs[i].y)); moveObject(objs[i], hz ? d : 0, hz ? 0 : d); pos += (hz ? bs[i].w : bs[i].h) + gap; }
  } else objs.forEach((o, i) => {
    const b = bs[i], dx = how === 'l' ? X0 - b.x : how === 'c' ? (X0 + X1) / 2 - (b.x + b.w / 2) : how === 'r' ? X1 - (b.x + b.w) : 0;
    const dy = how === 't' ? Y0 - b.y : how === 'm' ? (Y0 + Y1) / 2 - (b.y + b.h / 2) : how === 'b' ? Y1 - (b.y + b.h) : 0;
    moveObject(o, Math.round(dx), Math.round(dy));
  });
  for (const o of objs) if (o.placeholder && mode === 'slides') o.phMoved = true;
  commit();
}
function reorder(fn) { const o = selObj(); if (!o || !tgt().objects.includes(o)) return; if (editing) syncEditor(); const a = tgt().objects, i = a.indexOf(o); a.splice(i, 1); a.splice(fn(i, a.length), 0, o); commit(); }
let dragId = null;
function bindLayers() {
  const list = $('#layerList'); if (!list) return;
  list.addEventListener('dragstart', e => { const r = e.target.closest('.lyr'); dragId = r?.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId || ''); r?.classList.add('dragging'); });
  list.addEventListener('dragend', () => { dragId = null; list.querySelectorAll('.lyr').forEach(r => r.classList.remove('dragging', 'above', 'below')); });
  list.addEventListener('dragover', e => {
    const r = e.target.closest('.lyr'); if (!r || !dragId) return; e.preventDefault();
    const below = e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2;
    list.querySelectorAll('.lyr').forEach(x => x.classList.remove('above', 'below'));
    if (r.dataset.id !== dragId) r.classList.add(below ? 'below' : 'above');
  });
  list.addEventListener('drop', e => {
    e.preventDefault(); const r = e.target.closest('.lyr'); if (!r || !dragId || r.dataset.id === dragId) return;
    if (editing) syncEditor();
    const below = r.classList.contains('below'), order = [...tgt().objects].reverse();
    const moving = order.splice(order.findIndex(o => o.id === dragId), 1)[0];
    order.splice(order.findIndex(o => o.id === r.dataset.id) + (below ? 1 : 0), 0, moving);
    tgt().objects = order.reverse(); setSel([moving.id]); dragId = null; commit();
  });
  list.addEventListener('click', e => {
    const lk = e.target.closest('[data-lock]'); if (lk) { toggleLock(lk.dataset.lock); return; }
    const hd = e.target.closest('[data-hide]'); if (hd) { toggleHidden(hd.dataset.hide); return; }
    const r = e.target.closest('.lyr'); if (!r) return;
    if (editing) exitEdit();
    const id = r.dataset.id;
    if (e.shiftKey || e.ctrlKey || e.metaKey) setSel(selIds.includes(id) ? selIds.filter(x => x !== id) : [...selIds, id]); else setSel([id]);
    curAnim = null; drawSelection(); renderProps(); updateRibbon();
  });
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
  if (groupOf(o.id)) return toast('Csoport tagja nem animálható külön – az egész csoportot animáld.');
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
function animBody() {
  const s = tgt(), list = Anim.expand(s), rg = Anim.ranges(list), o = selObj();
  const rows = s.anims.map((a, i) => {
    const t = objById(a.target); if (!t) return '';
    const E = Anim.EFFECTS[a.effect], canPara = isText(t) && blockCount(t) > 1;
    return `<div class="anim${a.id === curAnim ? ' cur' : ''}" data-id="${a.id}" style="--c:${CLS_COLOR[E.cls]}">
      <span class="badge ${E.cls}">${rangeLabel(rg[a.id])}</span><span class="name" title="${esc(t.name ?? '')}">${esc(t.name ?? '')}<small>${Anim.CLASSES[E.cls]}</small></span>
      <span class="ctl"><button data-act="up" title="Előrébb a sorban" ${i ? '' : 'disabled'}>▲</button><button data-act="down" title="Hátrébb a sorban" ${i < s.anims.length - 1 ? '' : 'disabled'}>▼</button><button data-act="del" title="Animáció törlése">✕</button></span>
      <select data-k="effect" aria-label="Effektus">${effectOptions(a.effect)}</select>
      ${E.dirs ? `<select data-k="dir" aria-label="Irány">${Object.entries(Anim.DIRS[E.dirs]).map(([k, l]) => `<option value="${k}" ${k === Anim.dirOf(a) ? 'selected' : ''}>Irány: ${l}</option>`).join('')}</select>` : ''}
      <select data-k="trigger" aria-label="Indítás">${Object.entries(Anim.TRIGGERS).map(([k, l]) => `<option value="${k}" ${k === a.trigger ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="times"><label class="fld">Időtartam (mp)<input type="text" inputmode="decimal" data-k="dur" value="${secs(Anim.durOf(a))}" ${E.instant ? 'disabled title="Ez az effektus azonnali"' : ''}></label>
        <label class="fld">Késleltetés (mp)<input type="text" inputmode="decimal" data-k="delay" value="${secs(Anim.delayOf(a))}"></label></div>
      ${canPara ? `<label class="chk opts"><input type="checkbox" data-k="byParagraph" ${a.byParagraph ? 'checked' : ''} ${t.rot ? 'disabled title="Elforgatott szövegdoboznál nem érhető el"' : ''}> Bekezdésenként</label>` : ''}
    </div>`;
  }).join('');
  const dis = o ? '' : 'disabled title="Előbb jelölj ki egy objektumot (vagy csoportot)"';
  return `${o ? `<div class="btnrow addrow"><button class="btn" data-add="entr" style="--c:${CLS_COLOR.entr}">+ Belépő</button><button class="btn" data-add="emph" style="--c:${CLS_COLOR.emph}">+ Kiemelés</button><button class="btn" data-add="exit" style="--c:${CLS_COLOR.exit}">+ Kilépő</button></div>`
      : '<div class="phint" style="margin:0 0 8px">Animáció hozzáadásához jelölj ki egy objektumot (vagy csoportot).</div>'}
    ${s.anims.length ? `<h4>Idővonal</h4>${timelineHTML(list)}` : ''}
    <div class="anim-list" id="animList">${rows || '<div class="phint" style="margin-top:0">Ezen a dián nincs animáció.</div>'}</div>
    <div class="btnrow"><button class="btn" id="aPlay">Lejátszás innen</button><label class="chk"><input type="checkbox" id="aBadges" ${showBadges ? 'checked' : ''}> Sorszámok a dián</label></div>`;
}
function bindAnims() {
  const s = tgt();
  props.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addAnimation(Anim.DEFAULT[b.dataset.add], false));
  $('#aPlay')?.addEventListener('click', () => startShow(cur));
  $('#aBadges')?.addEventListener('change', e => { showBadges = e.target.checked; lsSet(LS.badges, showBadges ? '1' : '0'); drawBadges(); });
  props.querySelector('.tl')?.addEventListener('click', e => {
    const r = e.target.closest('.tl-row'); if (!r) return;
    const a = s.anims.find(x => x.id === r.dataset.id); if (!a) return;
    if (editing && editing !== a.target) exitEdit();
    curAnim = a.id; setSel([a.target]); drawSelection(); renderProps(); updateRibbon();
    props.querySelector(`.anim[data-id="${a.id}"]`)?.scrollIntoView({block: 'nearest'});
  });
  const list = $('#animList'); if (!list) return;
  list.addEventListener('click', e => {
    const row = e.target.closest('.anim'); if (!row) return;
    const i = s.anims.findIndex(a => a.id === row.dataset.id), act = e.target.closest('button')?.dataset.act;
    if (act === 'up' && i > 0) { [s.anims[i - 1], s.anims[i]] = [s.anims[i], s.anims[i - 1]]; commit(); return; }
    if (act === 'down' && i < s.anims.length - 1) { [s.anims[i + 1], s.anims[i]] = [s.anims[i], s.anims[i + 1]]; commit(); return; }
    if (act === 'del') { s.anims.splice(i, 1); commit(); return; }
    if (!e.target.closest('select, input, label')) { if (editing && editing !== s.anims[i].target) exitEdit(); curAnim = s.anims[i].id; setSel([s.anims[i].target]); drawSelection(); renderProps(); updateRibbon(); }
  });
  list.addEventListener('change', e => {
    const row = e.target.closest('.anim'), a = s.anims.find(x => x.id === row.dataset.id), k = e.target.dataset.k;
    const num = v => parseFloat(String(v).replace(',', '.'));
    if (k === 'byParagraph') a.byParagraph = e.target.checked || undefined;
    else if (k === 'dur') a.dur = Math.min(60000, Math.max(100, Math.round(num(e.target.value) * 1000) || Anim.EFFECTS[a.effect].dur));
    else if (k === 'delay') a.delay = Math.max(0, Math.round(num(e.target.value) * 1000) || 0);
    else if (k === 'effect') { a.effect = e.target.value; delete a.dur; delete a.dir; }
    else a[k] = e.target.value;
    curAnim = a.id; commit();
  });
}

/* ================================================================== ribbon */
for (const b of $$('[data-icon]')) b.insertAdjacentHTML('afterbegin', svgIcon(b.dataset.icon));
const styled = o => { if (o.placeholder && mode === 'slides') o.phStyled = true; else if (!o.placeholder && o.styleRef) o.ownStyle = true; };
const inEdit = () => { const o = selObj(); return isTextLike(o) && editing === o.id; };
/** Bold, italic, …: while editing on the selection (marks), otherwise on the whole box. */
function boxOrMark(mark, boxKey) {
  const o = selObj(); if (!isTextLike(o)) return;
  if (inEdit()) { const fn = 'toggle' + mark[0].toUpperCase() + mark.slice(1); ed.chain().focus()[fn]().run(); return; }
  o[boxKey] = !o[boxKey]; styled(o); commit();
}
function setAlign(a) {
  const o = selObj(); if (!isTextLike(o)) return;
  if (inEdit()) { ed.chain().focus().setTextAlign(a).run(); return; }
  o.align = a; styled(o);
  // whole box: paragraph alignments set in the editor give way to the box alignment
  const strip = n => { if (n.attrs?.textAlign) n.attrs.textAlign = null; (n.content || []).forEach(strip); }; strip(o.doc);
  commit();
}
/** List button: text that is already this kind of list loses the list formatting; otherwise it becomes a list. */
function unwrapLists(json, type) {
  const flat = nodes => nodes.flatMap(n => n.type === type ? (n.content || []).flatMap(li => flat(li.content || [])) : [n]);
  return {...json, content: flat(json.content || [])};
}
function listCmd(type) {
  const o = selObj(); if (!isTextLike(o) || o.locked || o.field) return;
  const toggle = type === 'bulletList' ? 'toggleBulletList' : 'toggleOrderedList';
  if (inEdit()) {
    const {from, to} = ed.state.selection; let has = false;
    ed.state.doc.nodesBetween(from, to, n => { if (n.type.name === type) has = true; });
    if (!has) ed.chain().focus()[toggle]().run();
    else for (let i = 0; i < 12 && ed.isActive('listItem'); i++) if (!ed.chain().focus().liftListItem('listItem').run()) break;
    updateRibbon(); return;
  }
  if (JSON.stringify(o.doc).includes(`"type":"${type}"`)) { o.doc = unwrapLists(o.doc, type); commit(); }
  else withEditor(c => c[toggle]().run());
}
const COMMANDS = {
  undo, redo,
  bold: () => boxOrMark('bold', 'bold'), italic: () => boxOrMark('italic', 'italic'),
  underline: () => boxOrMark('underline', 'underline'), strike: () => boxOrMark('strike', 'strike'),
  superscript: () => withEditor(c => c.toggleSuperscript().run()), subscript: () => withEditor(c => c.toggleSubscript().run()),
  alignLeft: () => setAlign('left'), alignCenter: () => setAlign('center'), alignRight: () => setAlign('right'), alignJustify: () => setAlign('justify'),
  bulletList: () => listCmd('bulletList'), orderedList: () => listCmd('orderedList'),
  indent: () => withEditor(c => ed.isActive('listItem') ? c.sinkListItem('listItem').run() : c.shiftIndent(1).run()),
  outdent: () => withEditor(c => ed.isActive('listItem') ? c.liftListItem('listItem').run() : c.shiftIndent(-1).run()),
  text: addText, math: () => openMath(null, null), image: () => pickImage(null),
  rect: () => addShape('rect'), ellipse: () => addShape('ellipse'), triangle: () => addShape('triangle'), arrow: () => addShape('arrow'), line: () => addShape('line'),
  upper: () => {
    const o = selObj(); if (!isTextLike(o)) return;
    if (inEdit() && !ed.state.selection.empty) { (ed.getAttributes('textStyle').textTransform === 'uppercase' ? ed.chain().focus().unsetUppercase() : ed.chain().focus().setUppercase()).run(); updateRibbon(); return; }
    o.upper = !o.upper || undefined; styled(o); commit();
  },
  delete: () => { if (editing) { const id = editing; exitEdit(); if (!objById(id)) return; } deleteSelected(); }
};
const ribbon = $('#ribbon');
ribbon.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
ribbon.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.pop) return showPop(b.dataset.pop, b);
  COMMANDS[b.dataset.cmd]?.();
});
{ const fams = allFamilies(), item = ([f, l]) => `<button class="pitem fitem" data-fam="${f}" style="font-family:${familyCSS(f)}">${l}</button>`;
  $('#fontMath').innerHTML = fams.math.map(item).join(''); $('#fontOther').innerHTML = fams.other.map(item).join(''); }
/** Font in effect at the cursor / for the box (family key, '' = base font of the template). */
function currentFamily() {
  const o = selObj(); if (!isTextLike(o)) return null;
  if (inEdit()) { const ff = ed.getAttributes('textStyle').fontFamily; if (ff) return familyFromCSS(ff); }
  return o.font || '';
}
$('#popFont').onopen = () => { const f = currentFamily(); for (const b of $$('#popFont [data-fam]')) b.classList.toggle('on', b.dataset.fam === f); };
$('#popFont').addEventListener('click', e => {
  const b = e.target.closest('[data-fam]'); if (!b) return; closePops();
  const o = selObj(), fam = b.dataset.fam; if (!isTextLike(o)) return;
  if (inEdit() && !ed.state.selection.empty) { (fam ? ed.chain().focus().setFontFamily('MP ' + fam) : ed.chain().focus().unsetFontFamily()).run(); updateRibbon(); return; }
  const strip = n => { (n.marks || []).forEach(m => { if (m.type === 'textStyle' && m.attrs) m.attrs.fontFamily = null; }); (n.content || []).forEach(strip); };
  if (inEdit()) ed.commands.setContent((j => (strip(j), j))(ed.getJSON()), {emitUpdate: false}); else strip(o.doc);
  o.font = fam || undefined; styled(o); commit();
});
/** Remove explicit font sizes from the text (they would override the box size – e.g. on pasted text and formulas). */
function stripFontSizes(json) {
  const walk = n => { if (n.marks) { n.marks.forEach(m => { if (m.type === 'textStyle' && m.attrs) m.attrs.fontSize = null; });
    n.marks = n.marks.filter(m => m.type !== 'textStyle' || Object.values(m.attrs || {}).some(v => v != null)); if (!n.marks.length) delete n.marks; }
    (n.content || []).forEach(walk); };
  walk(json); return json;
}
const setSize = v => {
  const p = parseFloat(String(v).replace(',', '.')), o = selObj(); if (!isTextLike(o) || !(p > 0 && p < 400)) return;
  if (inEdit() && !ed.state.selection.empty) { ed.chain().focus().setFontSize(p + 'pt').run(); return; }
  if (inEdit()) { ed.commands.setContent(stripFontSizes(ed.getJSON()), {emitUpdate: false}); }
  else stripFontSizes(o.doc);
  o.size = Math.round(p / PT * 100) / 100; styled(o); commit();
};
$('#sizeIn').addEventListener('change', e => setSize(e.target.value));
$('#sizeIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); setSize(e.target.value); } });

function updateRibbon() {
  const o = selObj(), edit = inEdit();
  for (const b of $$('[data-k]', ribbon)) {
    const k = b.dataset.k; b.disabled = k === 'any' ? !selIds.length : k === 'text' ? !isTextLike(o) || !!o.locked : !isShape(o) || !!o.locked;
  }
  $('#sizeIn').disabled = !isTextLike(o);
  ribbon.querySelector('[data-cmd=undo]').disabled = !edit && hIdx <= 0;
  ribbon.querySelector('[data-cmd=redo]').disabled = !edit && hIdx >= history.length - 1;
  const act = (m, box) => isTextLike(o) && (edit ? ed.isActive(m) : !!o[box]);
  for (const [c, m] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strike']]) ribbon.querySelector(`[data-cmd=${c}]`).classList.toggle('on', act(m, c));
  ribbon.querySelector('[data-cmd=superscript]').classList.toggle('on', edit && ed.isActive('superscript'));
  ribbon.querySelector('[data-cmd=subscript]').classList.toggle('on', edit && ed.isActive('subscript'));
  ribbon.querySelector('[data-cmd=bulletList]').classList.toggle('on', edit && ed.isActive('bulletList'));
  ribbon.querySelector('[data-cmd=orderedList]').classList.toggle('on', edit && ed.isActive('orderedList'));
  for (const [c, a] of [['alignLeft', 'left'], ['alignCenter', 'center'], ['alignRight', 'right'], ['alignJustify', 'justify']])
    ribbon.querySelector(`[data-cmd=${c}]`).classList.toggle('on', isTextLike(o) && (edit && ed.isActive({textAlign: a}) || (!edit || !['left', 'center', 'right', 'justify'].some(x => ed.isActive({textAlign: x}))) && o.align === a));
  if (isTextLike(o)) {
    let size = o.size * PT, color = o.color;
    if (edit) { try { const d = ed.view.domAtPos(ed.state.selection.from), el = d.node.nodeType === 1 ? d.node : d.node.parentElement; if (el && ed.view.dom.contains(el)) { const cs = getComputedStyle(el); size = parseFloat(cs.fontSize) * PT; color = cs.color; } } catch (e) { /* ignore */ } }
    if (document.activeElement !== $('#sizeIn')) $('#sizeIn').value = Math.round(size * 2) / 2;
    $('#colorBar').style.background = color;
    const fam = currentFamily(); $('#fontLabel').textContent = fam ? familyLabel(fam).replace(/ \(.*\)$/, '') : 'Alap: ' + fontSet(doc.font).label;
    ribbon.querySelector('[data-cmd=upper]').classList.toggle('on', edit ? ed.getAttributes('textStyle').textTransform === 'uppercase' || !!o.upper : !!o.upper);
  }
  if (!isTextLike(o)) $('#fontLabel').textContent = 'Betűtípus';
  $('#bTpl').classList.toggle('primary', mode === 'template');
  $('#tplName').textContent = doc.templateName || 'Saját';
  $('#bTpl').querySelector('.tpll').textContent = mode === 'template' ? 'Bezárás · Sablon:' : 'Sablon:';
  if (!edit || !ed?.isActive('table')) $('#tableBar').hidden = true;
}

/* popovers + swatches (Doksi) */
let openPop = null, openAnchor = null;
function showPop(id, anchor) {
  const p = $('#' + id);
  if (openPop === p) return closePops();
  closePops(); if (p.onopen) p.onopen();
  if (p.querySelector('.cpicker')) { refreshPickers(); p.querySelectorAll('.cpicker').forEach(b => { b._reset?.(); b._mark?.(currentColorFor(b.id)); }); }
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
/** The colour currently in effect for a picker (marked in red in the palette). */
function currentColorFor(id) {
  const o = selObj();
  const hex = c => { if (!c) return null; const m = String(c).match(/\d+(\.\d+)?/g); return c.startsWith('#') ? c : m ? '#' + m.slice(0, 3).map(v => (+v | 0).toString(16).padStart(2, '0')).join('') : c; };
  try {
    if (id === 'swText') { if (inEdit()) { const d = ed.view.domAtPos(ed.state.selection.from), el = d.node.nodeType === 1 ? d.node : d.node.parentElement; return hex(getComputedStyle(el).color); } return o?.color; }
    if (id === 'swHi') return inEdit() ? ed.getAttributes('highlight').color || 'none' : null;
    if (id === 'swFill') return o?.fill || 'none';
    if (id === 'swStroke') return o?.stroke || 'none';
    if (id === 'swCell') return ed ? (ed.getAttributes('tableCell').background || ed.getAttributes('tableHeader').background || 'none') : null;
    if (id === 'swBorder') return ed ? (ed.getAttributes('tableCell').borderColor || ed.getAttributes('tableHeader').borderColor || 'none') : null;
  } catch (e) { return null; }
  return null;
}
/* colour pickers: defaults + the colours saved in this presentation + custom colour, eyedropper */
const BASE_COLORS = ['#ffffff', '#d8d8d8', '#000000', '#da291c'];
const pickers = [];
function swatches(box, colors, onPick, noneLabel) {
  const all = [...BASE_COLORS, ...colors.filter(c => !BASE_COLORS.includes(c.toLowerCase()))];
  box.className = 'cpicker';
  box.innerHTML = `<div class="swg">${all.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}" aria-label="${c}"></button>`).join('')}</div>
    <div class="libwrap"><div class="ptitle">Ennek a bemutatónak a színei</div><div class="swg lib"></div></div>
    <div class="ccust"><button class="tb eyed" title="Pipetta: szín felvétele a képernyőről">${svgIcon('eyedrop')}</button>
      <label class="sw custom" title="Egyéni szín választása"><input type="color" aria-label="Egyéni szín"></label>
      <span class="chex">#000000</span><span class="sp"></span>
      <button class="btn cok" disabled>OK</button><button class="btn csave" disabled title="Hozzáadás ennek a bemutatónak a színeihez">Mentés</button></div>
    ${noneLabel ? `<button class="sw none" data-c="none">${noneLabel}</button>` : ''}`;
  const inp = box.querySelector('input[type=color]'), hex = box.querySelector('.chex'), ok = box.querySelector('.cok'), save = box.querySelector('.csave');
  // the last custom colour stays available, so "Mentés" also works after "OK" (when the picker is opened again)
  const pending = c => { inp.value = c; hex.textContent = c; hex.style.setProperty('--c', c); box._chosen = true; ok.disabled = save.disabled = false; };
  box.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) { doc.colors = (doc.colors || []).filter(c => c !== del.dataset.del); commit(); refreshPickers(); e.stopPropagation(); return; }
    const b = e.target.closest('button[data-c]'); if (b) { onPick(b.dataset.c); closePops(); }
  });
  inp.addEventListener('input', () => pending(inp.value));
  inp.addEventListener('change', () => pending(inp.value));
  ok.onclick = () => { onPick(inp.value); closePops(); };
  save.onclick = () => { const c = inp.value.toLowerCase(); doc.colors = [...new Set([...(doc.colors || []), c])]; onPick(c); closePops(); commit(); };
  box.querySelector('.eyed').onclick = () => eyedrop(c => { pending(c); });
  box._reset = () => { ok.disabled = save.disabled = !box._chosen; hex.textContent = inp.value; hex.style.setProperty('--c', inp.value); };
  box._mark = cur_ => { const c = (cur_ || 'none').toLowerCase(); box.querySelectorAll('button[data-c]').forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === c)); };
  pickers.push(box);
}
/* a general colour popover (template background, text styles) */
let anyColorCb = null;
function pickAnyColor(anchor, title, current, cb) { anyColorCb = cb; $('#anyColorTitle').textContent = title; anyCur = current; showPop('popAnyColor', anchor); }
let anyCur = null;
function refreshPickers() {
  const lib = doc.colors || [];
  for (const box of pickers) {
    box.querySelector('.libwrap').hidden = !lib.length;
    box.querySelector('.lib').innerHTML = lib.map(c => `<span class="libsw"><button class="sw" data-c="${c}" style="background:${c}" title="${c}"></button><button class="del" data-del="${c}" title="Törlés a bemutató színei közül">×</button></span>`).join('');
  }
}
/** Pick a colour from the screen: the browser's eyedropper where available, otherwise from a picture of the slide. */
async function eyedrop(done) {
  if (window.EyeDropper) {
    const pop = openPop, anchor = openAnchor;
    try { const r = await new window.EyeDropper().open(); if (pop && anchor) { showPop(pop.id, anchor); } done(r.sRGBHex); } catch (e) { /* cancelled */ }
    return;
  }
  if (mode !== 'slides') { toast('A pipetta itt nem érhető el.'); return; }
  const pop = openPop, anchor = openAnchor; closePops();
  busy('Pipetta előkészítése…');
  let canvas;
  try { canvas = await slideCanvas(doc, tgt(), renderSlide, layoutOf); } catch (e) { busy(''); toast('A pipetta nem indítható.'); return; }
  busy('');
  toast('Kattints a dián a felvenni kívánt színre (Esc: mégse).');
  const veil = document.createElement('div'); veil.className = 'eyeveil'; document.body.appendChild(veil);
  const finish = c => { veil.remove(); removeEventListener('keydown', esc, true); if (pop && anchor) showPop(pop.id, anchor); if (c) done(c); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
  addEventListener('keydown', esc, true);
  veil.onclick = e => {
    const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    if (x < 0 || y < 0 || x >= W || y >= H) return finish(null);
    const k = canvas.width / W, d = canvas.getContext('2d').getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data;
    finish('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
  };
}
const TEXT_COLORS = ['#111111', '#5d6875', '#c0392b', '#d35400', '#b7950b', '#1e8449', '#117a65', '#1f5f74', '#2e4a9e', '#7d3c98', '#ad1457'];
swatches($('#swText'), TEXT_COLORS, c => {
  const o = selObj(); if (!isTextLike(o)) return;
  if (inEdit() && !ed.state.selection.empty) { ed.chain().focus().setColor(c).run(); return; }
  o.color = c; styled(o); commit();
});
swatches($('#swAny'), TEXT_COLORS, c => { const cb = anyColorCb; anyColorCb = null; cb?.(c); });
$('#popAnyColor').onopen = () => $('#swAny')._mark(anyCur);
swatches($('#swHi'), ['#fff176', '#c5f0a4', '#b3ecf5', '#f8bbd0', '#ffd59e', '#e1bee7', '#e0e0e0'], c => withEditor(ch => (c === 'none' ? ch.unsetHighlight() : ch.setHighlight({color: c})).run()), 'Nincs kiemelés');
swatches($('#swCell'), ['#e8eef5', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#d6e4f0'], c => forCells('cells', () => ({background: c === 'none' ? null : c})), 'Nincs kitöltés');
swatches($('#swBorder'), ['#7d8590', '#111111', '#1f5f74', '#2e4a9e', '#c0392b', '#1e8449', '#b7950b'], c => forCells(borderScope === 'table' ? 'table' : 'cells', () => ({borderColor: c === 'none' ? null : c})), 'Alapértelmezett');
swatches($('#swFill'), ['#d6eaf8', '#dbe9ee', '#eaf4e4', '#fdf3d7', '#f9e1e1', '#ece6f5', '#eeeeee', '#f6d365', '#2f5d8a', '#1f5f74', '#1e8449', '#c0392b', '#d35400'],
  c => { const o = selObj(); if (isShape(o)) { o.fill = c === 'none' ? null : c; commit(); } }, 'Nincs kitöltés');
swatches($('#swStroke'), TEXT_COLORS, c => { const o = selObj(); if (!isShape(o)) return; o.stroke = c === 'none' ? (o.shape === 'line' ? o.stroke : null) : c; if (o.stroke && !o.strokeWidth) o.strokeWidth = 3; commit(); }, 'Nincs körvonal');
$('#bwStroke').innerHTML = [1, 2, 3, 4, 6, 8].map(w => `<button class="pitem" data-w="${w}">${w} px</button>`).join('');
$('#bwStroke').onclick = e => { const b = e.target.closest('button'), o = selObj(); if (!b || !isShape(o)) return; o.strokeWidth = +b.dataset.w; if (!o.stroke) o.stroke = '#2f5d8a'; closePops(); commit(); };
$('#popStroke').onopen = () => { const o = selObj(); for (const b of $('#bwStroke').children) b.classList.toggle('on', isShape(o) && !!o.stroke && +b.dataset.w === o.strokeWidth); };
/* font size list, letter spacing */
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 96];
$('#sizeGrid').innerHTML = SIZES.map(v => `<button class="pitem" data-size="${v}">${v}</button>`).join('');
$('#popSize').onopen = () => { const cur_ = parseFloat($('#sizeIn').value); for (const b of $('#sizeGrid').children) b.classList.toggle('on', +b.dataset.size === cur_); };
$('#sizeGrid').onclick = e => { const b = e.target.closest('[data-size]'); if (!b) return; closePops(); $('#sizeIn').value = b.dataset.size; setSize(b.dataset.size); };
function setSpacing(v, final) {
  const o = selObj(); if (!isTextLike(o) || !isFinite(v)) return;
  v = Math.round(v * 10) / 10;
  if (inEdit() && !ed.state.selection.empty) { if (final) (v ? ed.chain().focus().setLetterSpacing(v + 'pt') : ed.chain().focus().unsetLetterSpacing()).run(); return; }
  o.letterSpacing = v || undefined;
  if (final) { styled(o); commit(); } else updateObjLive(o);
}
const spR = $('#spacingR'), spN = $('#spacingIn');
spR.oninput = () => { spN.value = spR.value; setSpacing(+spR.value, false); };
spR.onchange = () => setSpacing(+spR.value, true);
spN.onchange = () => { const v = parseFloat(String(spN.value).replace(',', '.')); if (!isFinite(v)) return; spR.value = v; setSpacing(v, true); };
$('#spacingReset').onclick = () => { spR.value = spN.value = 0; setSpacing(0, true); };
$('#popSpacing').onopen = () => {
  const o = selObj(); let v = o?.letterSpacing || 0;
  if (inEdit()) { const ls = ed.getAttributes('textStyle').letterSpacing; if (ls) v = parseFloat(ls); }
  spR.value = spN.value = v;
};
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
$('#popLine').onopen = () => {
  const o = selObj(); let v = 1.25;
  if (inEdit()) { const a = ed.isActive('heading') ? ed.getAttributes('heading') : ed.getAttributes('paragraph'); if (a.lineHeight) v = +a.lineHeight; }
  else if (isText(o)) { const lh = new Set(); (function w(n) { if (n.type === 'paragraph' || n.type === 'heading') lh.add(+(n.attrs?.lineHeight || 1.25)); (n.content || []).forEach(w); })(o.doc); v = lh.size === 1 ? [...lh][0] : null; }
  for (const b of $('#lineList').children) b.classList.toggle('on', +b.dataset.lh === v);
};
$('#popNum').onopen = () => { const st = inEdit() && ed.isActive('orderedList') ? (ed.getAttributes('orderedList').numStyle || 'decimal') : null;
  for (const b of $$('#popNum [data-num]')) b.classList.toggle('on', b.dataset.num === st); };
$('#popBullet').onopen = () => { const a = inEdit() && ed.isActive('bulletList') ? ed.getAttributes('bulletList') : null;
  for (const b of $$('#popBullet [data-bul]')) b.classList.toggle('on', !!a && !a.bulletImage && b.dataset.bul === (a.bulletChar || '•')); };
$('#popBorders').onopen = () => { const bw = ed ? (ed.getAttributes('tableCell').borderWidth ?? ed.getAttributes('tableHeader').borderWidth ?? '') : '';
  for (const b of $$('#popBorders [data-bw]')) b.classList.toggle('on', String(b.dataset.bw) === String(bw ?? '')); };
$('#lineList').addEventListener('click', e => { const b = e.target.closest('[data-lh]'); if (!b) return; closePops(); withEditor(c => c.setParaAttrs({lineHeight: +b.dataset.lh}).run()); });
$('#popPara').onopen = () => {
  const a = ed ? (ed.isActive('heading') ? ed.getAttributes('heading') : ed.getAttributes('paragraph')) : {};
  for (const inp of $$('#popPara [data-pf]')) { const k = inp.dataset.pf; if (inp.type === 'checkbox') inp.checked = !!a[k]; else inp.value = a[k] ?? (k === 'lineHeight' ? 1.25 : 0); }
};
$('#popPara').addEventListener('change', e => { const k = e.target.dataset.pf; if (!k) return; const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : +e.target.value); withEditor(c => c.setParaAttrs({[k]: v}).run()); });

/* animation gallery, placeholders, template builder */
$('#popPh').addEventListener('click', e => {
  const f = e.target.closest('[data-field]');
  if (f) {
    closePops(); if (mode !== 'template') return; if (editing) exitEdit();
    const isNum = f.dataset.field === 'slideNumber';
    const o = {id: uid(), name: isNum ? 'Diaszám' : 'Dátum', type: 'text', field: f.dataset.field, x: isNum ? 1100 : 900, y: 664, w: isNum ? 120 : 300, h: 30, rot: 0,
      size: 21.33, color: '#6b7785', align: 'right', doc: emptyDoc()};
    tgt().objects.push(o); setSel([o.id]); commit(); return;
  }
  const b = e.target.closest('[data-ph]'); closePops();
  if (!b || mode !== 'template' || tcur === 'master') { if (b && tcur === 'master') toast('Helykitöltő csak elrendezésre tehető (a diaszám és a dátum a mesterre is).'); return; }
  if (editing) exitEdit();
  const L = tgt(); let key = b.dataset.ph, n = 2;
  while (L.objects.some(o => o.placeholder === key)) key = b.dataset.ph + n++;
  const def = {title: [60, 40, 1160, 33, '#2f5d8a', true, TITLE_PROMPT], subtitle: [240, 380, 800, 22, '#4a5866', false, 'Alcím'], body: [60, 150, 1160, 22, '#1a1a1a', false, 'Szöveg']}[b.dataset.ph];
  const o = ph(key, def[0], def[1] + (n > 2 ? 40 : 0), def[2], def[3], def[4], def[5], 'left', def[6]);
  L.objects.push(o); setSel([o.id]); commit();
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
  for (const k of Anim.initiallyHidden(list)) { const e = keyEl(el, k); if (e) e.style.visibility = 'hidden'; }
  const offset = groups[0]?.auto ? 1 : 0;
  Object.assign(sh, {i, step, el, groups, offset, busy: null});
  const instant = grp => grp.chains.flat().forEach(a => { const e = keyEl(el, a.key); if (!e) return; const c = Anim.EFFECTS[a.effect].cls;
    if (c === 'entr') e.style.visibility = 'visible'; else if (c === 'exit') e.style.visibility = 'hidden'; else if (a.effect === 'grow') e.style.transform = 'scale(1.5)'; });
  let g = 0;
  if (offset) { if (animateAuto && step === 0) setTimeout(() => sh && sh.el === el && playGroup(el, groups[0]), wait); else instant(groups[0]); g = 1; }
  for (; g < step + offset; g++) instant(groups[g]);
  info();
}
/** Slide transition in the preview (PowerPoint plays the same effect from the exported file). Returns its duration. */
function playTransition(old, el, t) {
  const dur = Math.max(100, t.dur ?? 700), k = Math.min(innerWidth / W, innerHeight / H), sw = W * k, shh = H * k;
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
  const off = dir => {                        // translation (slide px) that puts the element just outside the slide
    const r = el.getBoundingClientRect(), sr = root.getBoundingClientRect(), k = sr.height / H;
    const x = dir.includes('l') ? -(r.right - sr.left) / k : dir.includes('r') ? (sr.right - r.left) / k : 0;
    const y = dir.includes('t') ? -(r.bottom - sr.top) / k : dir.includes('b') ? (sr.bottom - r.top) / k : 0;
    return `translate(${x}px, ${y}px)`;
  };
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
  try { const msg = await savePresentation(await packMprezi(), doc.title, saveAs); if (/^Elmentve/.test(msg)) { dirty = false; saveSoon(); } setStatus(msg); toast(msg); setTimeout(() => setStatus(), 2500); }
  catch (e) { setStatus('A mentés nem sikerült: ' + (e?.message || e)); }
}
function loadDocument(d, m, name, path, handle) {
  setCurrentHandle(handle ?? null);
  doc = d; media = m; if (name) doc.title = doc.title || name.replace(/\.mprezi$/i, '');
  doc.font = FONT_SETS[doc.font] ? doc.font : DEFAULT_FONT;
  if (doc.font !== activeMathFont()) { setCurrentPath(path ?? null); resetHistory(); restartWithFont(doc.font); return; }
  mode = 'slides'; cur = 0; setSel([]); curAnim = null; setCurrentPath(path ?? null);
  resetHistory(); renderAll(); fitStage();
}
async function openResult(r) {
  if (!r) return;
  sessionOpen = true; showHome(false);
  try { const {doc: d, media: m} = await unpackMprezi(r.data); loadDocument(d, m, r.name, r.path, r.handle); saveSoon(); toast('Megnyitva: ' + r.name); setStatus('Megnyitva: ' + r.name); }
  catch (e) { toast('A fájl nem nyitható meg: ' + (e?.message || e)); }
}
async function doOpen() {
  if (editing) exitEdit();
  if (dirty && $('#home').hidden && !await confirmBox('A nem mentett módosítások elvesznek. Megnyitsz egy másik bemutatót?', 'Megnyitás')) return;
  const r = await openPresentation(); if (r) { showHome(false); openResult(r); }
}
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
$('#bFile').onclick = e => showPop('popFile', e.currentTarget);
$('#expPptx2').onclick = () => doExport('pptx');
$('#expPdf2').onclick = () => doExport('pdf');
$('#expPdfSteps2').onclick = () => doExport('pdfSteps');
$('#fNew').onclick = () => { closePops(); newPresentation(); };
$('#fOpen').onclick = () => { closePops(); doOpen(); };
$('#fSaveAs').onclick = () => { closePops(); doSave(true); };
document.querySelector('.splitdd').onclick = e => showPop('popSave', e.currentTarget);
$('#bSave').onclick = () => doSave(false);

$('#bPlay').onclick = () => startShow(cur);
$('#zoomSel').onchange = e => { zoom = e.target.value === 'auto' ? 'auto' : +e.target.value; fitStage(); };
$('#docTitle').onchange = e => { doc.title = e.target.value.trim() || 'Névtelen bemutató'; dirty = true; setStatus(); saveSoon(); };
async function newPresentation() {
  if (!await confirmBox(dirty ? 'Új bemutatót kezdesz. A mostani nem mentett módosításai elvesznek. Folytatod?' : 'Új, üres bemutatót kezdesz. Folytatod?', 'Új bemutató')) return false;
  if (editing) stopEditor();
  blankDoc(); doc.slides.push(newSlide('cimdia')); loadDocument(doc, media, null, null); saveSoon(); sessionOpen = true; showHome(false); return true;
}
/* home screen (as in Matekos Doksi) */
function showHome(show) {
  $('#home').hidden = !show;
  if (show) { const f = currentFileName(); $('#homeResume').hidden = !(sessionOpen || f); $('#homeResume').textContent = f ? `Folytatás: ${f}` : 'Vissza a megnyitott bemutatóhoz'; }
  else fitStage();
}
$('#homeNew').onclick = newPresentation;
$('#homeOpen').onclick = doOpen;
$('#homeResume').onclick = () => { sessionOpen = true; showHome(false); };
let sessionOpen = false;            // a presentation was opened / created / continued in this session
$('#fHome').onclick = () => { closePops(); sessionOpen = true; if (editing) exitEdit(); clearTimeout(autoT); autosave(autoValue()); showHome(true); };
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
  if (isMathEditorOpen() || !$('#cfm').hidden) return;
  if (!$('#home').hidden) return;
  if (mod && k === 's') { e.preventDefault(); doSave(e.shiftKey); return; }
  if (mod && k === 'o') { e.preventDefault(); doOpen(); return; }
  if (k === 'f5') { e.preventDefault(); startShow(cur); return; }
  if (editing) { if (mod && k === 'm') { e.preventDefault(); openMath(null, null); } return; }   // the editor handles the rest
  if (e.target.closest('input, select, textarea')) return;
  if (mod && k === 'm') { e.preventDefault(); openMath(null, null); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && 'biu'.includes(k) && isTextLike(selObj())) { e.preventDefault(); COMMANDS[{b: 'bold', i: 'italic', u: 'underline'}[k]](); return; }
  if (mod && k === 'a') { e.preventDefault(); setSel(tgt().objects.filter(q => !q.locked).map(q => q.id)); drawSelection(); renderProps(); updateRibbon(); return; }
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelected() : groupSelected(); return; }
  const o = selObj();
  if (mod && k === 'c' && o) { clipboard = clone(o); return; }
  if (mod && (k === 'v' || k === 'd') && (clipboard || o)) {
    const c = clone(k === 'd' ? o : clipboard); if (!c) return; e.preventDefault();
    const reid = q => { q.id = uid(); if (q.children) q.children.forEach(reid); }; reid(c);
    moveObject(c, 20, 20); delete c.placeholder; delete c.locked; tgt().objects.push(c); setSel([c.id]); if (k === 'v') clipboard = clone(c); commit(); return;
  }
  if ((k === 'delete' || k === 'backspace') && selIds.length) { e.preventDefault(); deleteSelected(); return; }
  if (k === 'escape') { select(null); return; }
  if (k === 'enter' && isTextLike(o) && !o.locked && !(mode === 'template' && o.placeholder)) { e.preventDefault(); enterEdit(o.id); return; }
  if ((k === 'arrowup' || k === 'arrowdown') && mode === 'slides' && (!selIds.length || slideFocus)) {
    e.preventDefault(); const to = cur + (k === 'arrowup' ? -1 : 1);
    if (to >= 0 && to < doc.slides.length) { gotoSlide(to); slideFocus = true; }
    return;
  }
  if (selIds.length && k.startsWith('arrow')) {
    e.preventDefault(); const d = e.shiftKey ? 10 : 1;
    const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
    for (const q of selIds.map(objById)) { if (!q || q.locked) continue; moveObject(q, dx, dy); if (q.placeholder && mode === 'slides') q.phMoved = true; updateObjLive(q, true); }
    drawSelection(); drawBadges(); if (o) syncGeometryInputs(o);
    clearTimeout(nudgeT); nudgeT = setTimeout(commit, 400); return;
  }
  if (!mod && !e.altKey) { if (k === 't') addText(); else if (k === 'r') addShape('rect'); else if (k === 'e') addShape('ellipse'); else if (k === 'a') addShape('arrow'); else if (k === 'l') addShape('line'); }
});
addEventListener('beforeunload', e => { if (dirty && !isTauri()) e.preventDefault(); });

/* ================================================================== start */
(async function init() {
  if (lsGet(LS.panel) === '0') { mainEl.classList.add('noprops'); document.body.classList.add('noprops-on'); }
  const saved = await loadAutosave();
  let fontKey = FONT_SETS[saved?.doc?.font] ? saved.doc.font : DEFAULT_FONT;
  startMathJax(FONT_SETS[fontKey].math);
  loadTextFamily('bonum');                         // the logo
  const fontLoad = applyTextFont(fontKey);
  registerAllFamilies();
  if (saved?.doc) { try { doc = migrate(saved.doc); media = saved.media || {}; doc.title = saved.title || doc.title; } catch (e) { demoDoc(); } }
  else demoDoc();
  doc.font = fontKey;
  resetHistory();
  if (saved?.path) setCurrentPath(saved.path);
  if (saved?.handle) setCurrentHandle(saved.handle);
  if (saved?.dirty) { dirty = true; setStatus(); }
  fitStage(); renderAll();
  if (sessionStorage.getItem('mp.skipHome')) sessionOpen = true; else showHome(true);
  sessionStorage.removeItem('mp.skipHome');
  fontLoad.then(() => { measureTexts(); drawSelection(); drawBadges(); renderThumbs(); });
  mathReady.then(() => setTimeout(() => { measureTexts(); drawSelection(); drawBadges(); }, 100));
  if (isTauri()) {
    try { const p = await watchOpenedFiles(async path => openResult(await openPathFile(path))); if (p) openResult(await openPathFile(p)); }
    catch (e) { /* not available */ }
  }
})();

// hooks for automated tests
window.mprezi = {snapshotTest: async () => { const c = await slideCanvas(doc, tgt(), renderSlide, layoutOf); return [...c.getContext('2d').getImageData(640, 5, 1, 1).data]; }, get doc() { return doc; }, get media() { return media; }, get editor() { return ed; }, get sel() { return sel; }, set sel(v) { select(v); }, get selIds() { return selIds; }, setSel: ids => { setSel(ids); drawSelection(); renderProps(); updateRibbon(); }, groupSelected, ungroupSelected, addShape, addTable, toggleLock,
  gotoSlide, enterEdit, exitEdit, commit, renderAll, buildPptx: () => buildPptx(doc, renderSlide, layoutOf, () => {}),
  buildPdf: m => buildPdf(doc, renderSlide, layoutOf, m, () => {}), renderSlide, packMprezi, unpackMprezi, loadDocument, Anim};
