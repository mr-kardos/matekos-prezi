// Export: PowerPoint (.pptx with working animations) and vector PDF.
// Every slide is rendered off-screen exactly like the editor, then
//  - text boxes become SVG pictures: every glyph at the position the browser laid it out, drawn as an outline
//    from the same TeX Gyre Bonum files; formulas are MathJax SVG; underline/strike, highlights, table fills
//    and table borders are drawn as shapes;
//  - shapes become SVG, images stay images; each SVG gets a PNG copy for viewers without SVG support;
//  - master/layout layers are placed behind the slide's own objects;
//  - animations become PowerPoint's own timing tree (preset effects).
import JSZip from 'jszip';
import { parse as parseFont } from 'opentype.js';
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { familyFiles, fontSet, familyFromCSS } from './fontsets.js';
import { Anim } from './anim.js';
import { pieceEls, mathPending } from './textview.js';
import { PPTX_SKELETON } from './pptx-skeleton.js';
import { W, H, flatObjects } from './model.js';

const EMU = 9525, e = v => Math.round(v * EMU);
const xesc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = v => Math.round(v * 100) / 100;

/* ---------- fonts (the very files the app displays with) ---------- */
const FAMS = new Map();       // text family -> {r, b, i, bi} parsed fonts
let BASE = null;
async function family(fam) {
  if (!FAMS.has(fam)) { const f = await familyFiles(fam); FAMS.set(fam, {r: parseFont(f.r), b: parseFont(f.b), i: parseFont(f.i), bi: parseFont(f.bi)}); }
  return FAMS.get(fam);
}
/** Parse every text family the presentation uses (base font, box fonts, fonts of selected text). */
async function prepareFonts(doc) {
  BASE = fontSet(doc.font || 'bonum').text;
  const used = new Set([BASE]);
  JSON.stringify(doc).replace(/MP ([a-z0-9]+)/g, (_, f) => { used.add(f); return _; }).replace(/"font":"([a-z0-9]+)"/g, (_, f) => { used.add(f); return _; });
  for (const f of used) { try { await family(f); } catch (e) { /* missing family: base font is used */ } }
}
const fontsFor = cs => FAMS.get(familyFromCSS(cs.fontFamily)) || FAMS.get(BASE);
const fontKey = cs => (parseInt(cs.fontWeight) >= 600 ? 'b' : '') + (/italic|oblique/.test(cs.fontStyle) ? 'i' : '') || 'r';
const ascCache = new Map();
/** Distance from a text range's top edge to its baseline, as laid out by this browser (cached per font). */
function ascentOffset(cs) {
  const k = `${cs.fontWeight}|${cs.fontStyle}|${cs.fontSize}`;
  if (ascCache.has(k)) return ascCache.get(k);
  const box = document.createElement('div');
  Object.assign(box.style, {position: 'fixed', left: '-9999px', top: '0', fontFamily: cs.fontFamily, fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle, fontSize: cs.fontSize, lineHeight: 'normal', whiteSpace: 'nowrap'});
  box.innerHTML = 'H<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
  document.body.appendChild(box);
  const r = document.createRange(); r.setStart(box.firstChild, 0); r.setEnd(box.firstChild, 1);
  const v = box.lastChild.getBoundingClientRect().bottom - r.getClientRects()[0].top;
  box.remove(); ascCache.set(k, v); return v;
}
function cmdsToD(cmds) {
  return cmds.map(c => c.type === 'Z' ? 'Z' : c.type === 'Q' ? `Q${n2(c.x1)} ${n2(c.y1)} ${n2(c.x)} ${n2(c.y)}`
    : c.type === 'C' ? `C${n2(c.x1)} ${n2(c.y1)} ${n2(c.x2)} ${n2(c.y2)} ${n2(c.x)} ${n2(c.y)}` : `${c.type}${n2(c.x)} ${n2(c.y)}`).join('');
}
const transparent = c => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
function decorations(node, stop) {
  let u = false, s = false;
  for (let el = node.parentElement; el; el = el.parentElement) {
    const t = getComputedStyle(el).textDecorationLine;
    if (t.includes('underline')) u = true; if (t.includes('line-through')) s = true;
    if (el === stop) break;
  }
  return {u, s};
}

/** SVG body for everything inside `roots` (elements), relative to (ox, oy). */
function textBody(roots, stop, ox, oy) {
  let back = '', body = '', lines = '';
  const R = rr => ({x: rr.left - ox, y: rr.top - oy, w: rr.width, h: rr.height});
  for (const root of roots) {
    // backgrounds (highlight, shaded paragraphs, table cells) and borders (tables)
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.closest('.math') && !el.classList.contains('math')) continue;
      const cs = getComputedStyle(el);
      if (!transparent(cs.backgroundColor) && el !== stop && !el.classList.contains('math')) {
        for (const rr of el.getClientRects()) { const q = R(rr); back += `<rect x="${n2(q.x)}" y="${n2(q.y)}" width="${n2(q.w)}" height="${n2(q.h)}" fill="${cs.backgroundColor}"/>`; }
      }
      if (el.tagName === 'TD' || el.tagName === 'TH') {
        const q = R(el.getBoundingClientRect());
        const side = (w, st, col, x, y, ww, hh) => { const t = parseFloat(w); if (t > 0 && st !== 'none' && st !== 'hidden') lines += `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(ww || t)}" height="${n2(hh || t)}" fill="${col}"/>`; };
        side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor, q.x - parseFloat(cs.borderLeftWidth) / 2, q.y - parseFloat(cs.borderTopWidth) / 2, q.w + parseFloat(cs.borderLeftWidth) / 2 + parseFloat(cs.borderRightWidth) / 2, parseFloat(cs.borderTopWidth));
        side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor, q.x - parseFloat(cs.borderLeftWidth) / 2, q.y + q.h - parseFloat(cs.borderBottomWidth) / 2, q.w + parseFloat(cs.borderLeftWidth) / 2 + parseFloat(cs.borderRightWidth) / 2, parseFloat(cs.borderBottomWidth));
        side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor, q.x - parseFloat(cs.borderLeftWidth) / 2, q.y, parseFloat(cs.borderLeftWidth), q.h);
        side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor, q.x + q.w - parseFloat(cs.borderRightWidth) / 2, q.y, parseFloat(cs.borderRightWidth), q.h);
      }
    }
    // glyphs
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: nd => nd.parentElement.closest('.math') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
    const range = document.createRange();
    for (let nd = walker.nextNode(); nd; nd = walker.nextNode()) {
      const cs = getComputedStyle(nd.parentElement), size = parseFloat(cs.fontSize), font = fontsFor(cs)[fontKey(cs)], upper = cs.textTransform === 'uppercase';
      const asc = ascentOffset(cs), dec = decorations(nd, stop), upm = font.unitsPerEm;
      let off = 0, d = '', bars = '';
      for (const ch of nd.data) {
        const len = ch.length; range.setStart(nd, off); range.setEnd(nd, off + len); off += len;
        if (ch === '\u200b' || ch === '\n' || ch === '\ufeff') continue;
        const rect = range.getClientRects()[0]; if (!rect || (!rect.width && ch.trim())) continue;
        const x = rect.left - ox, base = rect.top + asc - oy;
        if (ch.trim()) {
          const g = upper ? ch.toUpperCase() : ch;
          d += cmdsToD((g.length > 1 ? font.getPath(g, x, base, size) : font.charToGlyph(g).getPath(x, base, size)).commands);
        }
        const th = Math.max(0.6, 0.06 * size);
        if (dec.u) bars += `<rect x="${n2(x)}" y="${n2(base - font.tables.post.underlinePosition / upm * size - th / 2)}" width="${n2(rect.width)}" height="${n2(th)}"/>`;
        if (dec.s) bars += `<rect x="${n2(x)}" y="${n2(base - (font.tables.os2.yStrikeoutPosition || 0.29 * upm) / upm * size - th / 2)}" width="${n2(rect.width)}" height="${n2(th)}"/>`;
      }
      if (d || bars) body += `<g fill="${cs.color}">${d ? `<path d="${d}"/>` : ''}${bars}</g>`;
    }
    // pictures inside the text (e.g. picture list bullets)
    for (const im of root.querySelectorAll('img')) {
      if (im.closest('.math') || !im.src) continue;
      const r = im.getBoundingClientRect(); if (!r.width) continue;
      body += `<image href="${im.src}" xlink:href="${im.src}" x="${n2(r.left - ox)}" y="${n2(r.top - oy)}" width="${n2(r.width)}" height="${n2(r.height)}" preserveAspectRatio="none"/>`;
    }
    // formulas
    for (const sp of root.querySelectorAll('.math')) {
      const color = getComputedStyle(sp).color;
      // a formula that may break into lines is several pictures (one per line piece)
      for (const svg of sp.querySelectorAll('mjx-container > svg')) {
        const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal; if (!r.width || !vb.width) continue;
        const inner = svg.innerHTML.replace(/ data-[\w-]+="[^"]*"/g, '').replace(/currentColor/g, color);
        body += `<g transform="translate(${n2(r.left - ox)},${n2(r.top - oy)}) scale(${r.width / vb.width},${r.height / vb.height}) translate(${-vb.x},${-vb.y})">${inner}</g>`;
      }
    }
  }
  return back + body + lines;
}
const wrapSVG = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n2(w)}" height="${n2(h)}" viewBox="0 0 ${n2(w)} ${n2(h)}">${body}</svg>`;

/** Pieces of one rendered slide, back to front: {key, name, svg|raster, x, y, w, h, rot}. Groups give their members. */
function slidePieces(s, el, model) {
  const pieces = [], clip = el.querySelector('.clip');
  let n = 0;
  const visit = (child, tplLayer, gOp = 1) => {
    if (child.tagName === 'IMG') { pieces.push({key: 'bg' + n++, name: 'Háttér', raster: child.src, x: 0, y: 0, w: W, h: H, rot: 0}); return; }
    if (!child.classList.contains('obj') || child.style.visibility === 'hidden' || child.hidden) return;
    const o = model.get(child.dataset.id); if (!o) return;
    const tpl = tplLayer || child.classList.contains('tpl');
    if (o.type === 'group') { for (const c of child.querySelector(':scope > .rot').children) visit(c, tpl, gOp * (o.opacity ?? 1)); return; }
    const key = tpl ? 'tpl-' + o.id + '-' + n++ : o.id, name = o.name || o.type;
    const box = child.getBoundingClientRect(), ox = box.left, oy = box.top;
    const op = (o.opacity ?? 1) * gOp, opacity = op < 0.999 ? Math.round(op * 1000) / 1000 : null;
    if (o.type === 'video') { pieces.push({key, name, raster: MEDIA(o.poster) || child.querySelector('img')?.src, video: MEDIA(o.media), start: o.start || 'click', trim: o.trim, duration: o.duration,
      x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0, opacity, crop: o.crop || null, radius: o.radius || 0}); return; }
    if (o.type === 'image') { pieces.push({key, name, radius: o.radius || 0, raster: child.querySelector('img').src, x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0, opacity, crop: o.crop || null}); return; }
    if (o.type === 'shape') { pieces.push({key, name, svg: wrapSVG(o.w, o.h, child.querySelector('svg').innerHTML), x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0, opacity}); return; }
    const txt = child.querySelector('.txt');
    if (!tpl && o.type === 'text' && Anim.splitsByParagraph(s, o)) {
      pieceEls(txt).forEach((p, i) => {
        const pr = p.getBoundingClientRect(), y0 = Math.max(0, pr.top - oy - 6), y1 = Math.min(o.h, pr.bottom - oy + 6);
        pieces.push({key: `${o.id}#${i}`, name: `${name} – ${i + 1}. bekezdés`, svg: wrapSVG(o.w, y1 - y0, textBody([p], txt, ox, oy + y0)), x: o.x, y: o.y + y0, w: o.w, h: y1 - y0, rot: 0, opacity});
      });
    } else {
      const pad = o.type === 'table' ? 4 : 0;            // table borders reach half a line width outside the box
      pieces.push({key, name, svg: wrapSVG(o.w + 2 * pad, o.h + 2 * pad, textBody([txt], txt, ox - pad, oy - pad)), x: o.x - pad, y: o.y - pad, w: o.w + 2 * pad, h: o.h + 2 * pad, rot: o.rot || 0, opacity});
    }
  };
  for (const child of clip.children) visit(child, false);
  return pieces;
}

/** Render every slide off-screen and collect its pieces. */
async function collect(doc, renderSlide, layoutOf, onProgress, only = null) {
  await prepareFonts(doc);
  const host = document.createElement('div');
  Object.assign(host.style, {position: 'fixed', left: '-20000px', top: '0', width: W + 'px', height: H + 'px', overflow: 'hidden'});
  document.body.appendChild(host);
  const model = new Map();
  for (const g of [doc.master, ...Object.values(doc.templates)]) for (const o of flatObjects(g.objects)) model.set(o.id, o);
  const out = [];
  try {
    for (const [si, s] of (only ? [[0, only]] : doc.slides.entries())) {
      onProgress?.(si + 1, doc.slides.length);
      for (const o of flatObjects(s.objects)) model.set(o.id, o);
      const el = document.createElement('div'); el.className = 'slide'; host.innerHTML = ''; host.appendChild(el);
      renderSlide(s, el, 'show');
      el.querySelectorAll('.rot').forEach(r => r.style.transform = 'none');      // rotation goes into the picture frame
      for (let t = 0; t < 200 && mathPending(el); t++) await new Promise(r => setTimeout(r, 50));
      await document.fonts.ready;
      await new Promise(r => requestAnimationFrame(() => r()));
      const L = layoutOf(s), bgSrc = L.ownBg ? L : doc.master;
      out.push({s, pieces: slidePieces(s, el, model), bg: bgSrc.bgColor || '#ffffff'});
    }
  } finally { host.remove(); }
  return out;
}

/* ---------- PPTX ---------- */
const geomXML = p => p.radius ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.min(50000, p.radius / Math.min(p.w, p.h) * 100000))}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
/** A video: poster picture + the video file (plays in PowerPoint's slideshow; trimmed like in Prezi). */
function videoXML(p, spid, rImg, rVid, rMed) {
  const rot = p.rot ? ` rot="${Math.round(p.rot * 60000)}"` : '', d = p.duration || 0, from = p.trim?.from || 0, to = p.trim?.to ?? d;
  const trim = from > 0.01 || to < d - 0.01 ? `<p14:trim st="${Math.round(from * 1000)}" end="${Math.round(Math.max(0, d - to) * 1000)}"/>` : '';
  return `<p:pic><p:nvPicPr><p:cNvPr id="${spid}" name="${xesc(p.name)}"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>`
    + `<p:nvPr><a:videoFile r:link="${rVid}"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DA1C2BB2C6F}"><p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="${rMed}">${trim}</p14:media></p:ext></p:extLst></p:nvPr></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rImg}">${p.opacity != null ? `<a:alphaModFix amt="${Math.round(p.opacity * 100000)}"/>` : ''}</a:blip>${p.crop ? `<a:srcRect l="${Math.round((p.crop.l || 0) * 100000)}" t="${Math.round((p.crop.t || 0) * 100000)}" r="${Math.round((p.crop.r || 0) * 100000)}" b="${Math.round((p.crop.b || 0) * 100000)}"/>` : ''}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm${rot}><a:off x="${e(p.x)}" y="${e(p.y)}"/><a:ext cx="${e(p.w)}" cy="${e(p.h)}"/></a:xfrm>${geomXML(p)}</p:spPr></p:pic>`;
}
function picXML(p, spid, rImg, rSvg) {
  const ext = rSvg ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${rSvg}"/></a:ext></a:extLst>` : '';
  const rot = p.rot ? ` rot="${Math.round(p.rot * 60000)}"` : '';
  return `<p:pic><p:nvPicPr><p:cNvPr id="${spid}" name="${xesc(p.name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rImg}">${p.opacity != null ? `<a:alphaModFix amt="${Math.round(p.opacity * 100000)}"/>` : ''}${ext}</a:blip>${p.crop ? `<a:srcRect l="${Math.round((p.crop.l || 0) * 100000)}" t="${Math.round((p.crop.t || 0) * 100000)}" r="${Math.round((p.crop.r || 0) * 100000)}" b="${Math.round((p.crop.b || 0) * 100000)}"/>` : ''}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm${rot}><a:off x="${e(p.x)}" y="${e(p.y)}"/><a:ext cx="${e(p.w)}" cy="${e(p.h)}"/></a:xfrm>${geomXML(p)}</p:spPr></p:pic>`;
}
/** Off-slide position for fly in / fly out (PowerPoint formula strings). */
function flyEnds(dir) {
  return {x: dir.includes('l') ? '0-#ppt_w/2' : dir.includes('r') ? '1+#ppt_w/2' : '#ppt_x',
          y: dir.includes('t') ? '0-#ppt_h/2' : dir.includes('b') ? '1+#ppt_h/2' : '#ppt_y'};
}
/* ---------- slide transitions (PowerPoint's own; exact duration via the PowerPoint 2010 extension) ---------- */
const TR_DIR = {r: 'l', l: 'r', b: 'u', t: 'd'};    // "from the right" = moves to the left
function transitionXML(t) {
  if (!t || !t.type || t.type === 'none') return '';
  const dur = Math.max(100, Math.min(10000, Math.round(t.dur ?? 700))), spd = dur <= 500 ? 'fast' : dur <= 750 ? 'med' : 'slow';
  const d = TR_DIR[t.dir] ?? 'l';
  const el = {
    fade: '<p:fade/>', fadeBlack: '<p:fade thruBlk="1"/>', zoom: '<p:zoom/>',
    push: `<p:push dir="${d}"/>`, wipe: `<p:wipe dir="${d}"/>`, cover: `<p:cover dir="${d}"/>`, pull: `<p:pull dir="${d}"/>`,
    split: `<p:split orient="${(t.dir || 'vo')[0] === 'h' ? 'horz' : 'vert'}" dir="${(t.dir || 'vo')[1] === 'i' ? 'in' : 'out'}"/>`
  }[t.type];
  if (!el) return '';
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14">`
    + `<p:transition spd="${spd}" p14:dur="${dur}">${el}</p:transition></mc:Choice><mc:Fallback><p:transition spd="${spd}">${el}</p:transition></mc:Fallback></mc:AlternateContent>`;
}
function timingXML(list, spidOf, videoSpids = []) {
  if (!list.length) return '';
  let id = 2;
  const tgt = k => `<p:tgtEl><p:spTgt spid="${spidOf[k]}"/></p:tgtEl>`;
  const setVis = (k, val, delay) => `<p:set><p:cBhvr><p:cTn id="${++id}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${tgt(k)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
  const prop = (k, attr, from, to, dur) => `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${++id}" dur="${dur}" fill="hold"/>${tgt(k)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
  const filt = (k, tr, f, dur, extra = '') => `<p:animEffect transition="${tr}" filter="${f}"><p:cBhvr><p:cTn id="${++id}" dur="${dur}"${extra}/>${tgt(k)}</p:cBhvr></p:animEffect>`;
  const scale = (k, by, dur, extra = '') => `<p:animScale><p:cBhvr><p:cTn id="${++id}" dur="${dur}"${extra} fill="hold"/>${tgt(k)}</p:cBhvr><p:by x="${by}" y="${by}"/></p:animScale>`;
  const behaviours = (a, d) => {
    const k = a.key;
    switch (a.effect) {
      case 'play': return `<p:cmd type="call" cmd="playFrom(${(a.from || 0).toFixed(1)})"><p:cBhvr><p:cTn id="${++id}" dur="${d}" fill="hold"/>${tgt(k)}</p:cBhvr></p:cmd>`;
      case 'appear': return setVis(k, 'visible', 0);
      case 'fade': return setVis(k, 'visible', 0) + filt(k, 'in', 'fade', d);
      case 'wipe': return setVis(k, 'visible', 0) + filt(k, 'in', 'wipe(left)', d);
      case 'fly': { const v = flyEnds(Anim.dirOf(a)); return setVis(k, 'visible', 0) + prop(k, 'ppt_x', v.x, '#ppt_x', d) + prop(k, 'ppt_y', v.y, '#ppt_y', d); }
      case 'float': { const up = Anim.dirOf(a) !== 'd'; return setVis(k, 'visible', 0) + filt(k, 'in', 'fade', d) + prop(k, 'ppt_x', '#ppt_x', '#ppt_x', d) + prop(k, 'ppt_y', up ? '#ppt_y+.1' : '#ppt_y-.1', '#ppt_y', d); }
      case 'floatOut': { const up = Anim.dirOf(a) !== 'd'; return filt(k, 'out', 'fade', d) + prop(k, 'ppt_x', '#ppt_x', '#ppt_x', d) + prop(k, 'ppt_y', '#ppt_y', up ? '#ppt_y-.1' : '#ppt_y+.1', d) + setVis(k, 'hidden', d - 1); }
      case 'pulse': return filt(k, 'out', 'fade', d, ' tmFilter="0, 0; .2, .5; .8, .5; 1, 0"') + scale(k, 105000, Math.max(1, Math.round(d / 2)), ' autoRev="1"');
      case 'grow': return scale(k, 150000, d);
      case 'spin': return `<p:animRot by="21600000"><p:cBhvr><p:cTn id="${++id}" dur="${d}" fill="hold"/>${tgt(k)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
      case 'disappear': return setVis(k, 'hidden', 0);
      case 'fadeOut': return filt(k, 'out', 'fade', d) + setVis(k, 'hidden', d - 1);
      case 'wipeOut': return filt(k, 'out', 'wipe(left)', d) + setVis(k, 'hidden', d - 1);
      case 'flyOut': { const v = flyEnds(Anim.dirOf(a)); return prop(k, 'ppt_x', '#ppt_x', v.x, d) + prop(k, 'ppt_y', '#ppt_y', v.y, d) + setVis(k, 'hidden', d - 1); }
    }
  };
  const nodeType = {click: 'clickEffect', with: 'withEffect', after: 'afterEffect'};
  let body = '';
  for (const g of Anim.groups(list)) {
    let t = 0, chains = '';
    for (const chain of g.chains) {
      let effs = '', end = 0;
      for (const a of chain) {
        const E = Anim.EFFECTS[a.effect], P = Anim.preset(a), d = Math.max(1, Anim.durOf(a)), delay = Anim.delayOf(a);
        end = Math.max(end, delay + Anim.durOf(a));
        effs += `<p:par><p:cTn id="${++id}" presetID="${P.id}" presetClass="${E.cls}" presetSubtype="${P.sub}" fill="hold" nodeType="${nodeType[a.trigger]}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${behaviours(a, d)}</p:childTnLst></p:cTn></p:par>`;
      }
      chains += `<p:par><p:cTn id="${++id}" fill="hold"><p:stCondLst><p:cond delay="${t}"/></p:stCondLst><p:childTnLst>${effs}</p:childTnLst></p:cTn></p:par>`;
      t += end;
    }
    const start = g.auto ? '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' : '<p:cond delay="indefinite"/>';
    body += `<p:par><p:cTn id="${++id}" fill="hold"><p:stCondLst>${start}</p:stCondLst><p:childTnLst>${chains}</p:childTnLst></p:cTn></p:par>`;
  }
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>`
    + `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn>`
    + `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>`
    + `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>`
    + videoSpids.map(sp => `<p:video><p:cMediaNode vol="80000"><p:cTn id="${++id}" display="0" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${sp}"/></p:tgtEl></p:cMediaNode></p:video>`).join('')
    + `</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
}
async function svgToPng(svg, w, h, k = 2) {
  const img = new Image(), url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
  await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(h * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  return new Promise(ok => c.toBlob(ok, 'image/png'));
}
const dataUrlParts = u => { const m = u.match(/^data:([^;]+);base64,(.*)$/); return {mime: m[1], b64: m[2]}; };
const EXT = {'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif'};
let MEDIA = () => null;
/** The page tells the exporter where the media files (videos) are. */
export function setMediaLookup(fn) { MEDIA = fn; }
const VEXT = {'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v'};

export async function buildPptx(doc, renderSlide, layoutOf, onProgress) {
  const slides = await collect(doc, renderSlide, layoutOf, (i, n) => onProgress?.(`Diák előkészítése… ${i}/${n}`));
  const zip = new JSZip();
  for (const [p, c] of Object.entries(PPTX_SKELETON)) zip.file(p, p === 'docProps/app.xml' ? c.replace('{SLIDES}', slides.length) : c);
  let media = 0, sldIds = '', presRels = '', ctOver = ''; const vidTypes = new Set();
  const rasterFile = new Map();
  for (const [si, {s, pieces, bg}] of slides.entries()) {
    onProgress?.(`PowerPoint-fájl írása… ${si + 1}/${slides.length}`);
    let rels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`;
    let rid = 1, tree = '', spid = 1; const spidOf = {};
    const rel = target => { const r = 'rId' + ++rid; rels += `<Relationship Id="${r}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${target}"/>`; return r; };
    const videos = [];
    for (const p of pieces) {
      let rImg, rSvg;
      if (p.video) {
        const vm = p.video.match(/^data:([^;]+);base64,(.*)$/); if (!vm) continue;
        const vext = VEXT[vm[1]] || 'mp4', vf = `media${++media}.${vext}`; zip.file(`ppt/media/${vf}`, vm[2], {base64: true}); vidTypes.add(vext);
        const pm = p.raster && dataUrlParts(p.raster), pf = `img${++media}.${EXT[pm?.mime] || 'png'}`;
        if (pm && EXT[pm.mime]) zip.file(`ppt/media/${pf}`, pm.b64, {base64: true});
        rImg = rel(pf);
        const rVid = 'rId' + ++rid; rels += `<Relationship Id="${rVid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="../media/${vf}"/>`;
        const rMed = 'rId' + ++rid; rels += `<Relationship Id="${rMed}" Type="http://schemas.microsoft.com/office/2007/relationships/media" Target="../media/${vf}"/>`;
        spidOf[p.key] = ++spid; tree += videoXML(p, spid, rImg, rVid, rMed);
        videos.push(p); continue;
      }
      if (p.svg) {
        const m = ++media; zip.file(`ppt/media/mp${m}.svg`, p.svg); zip.file(`ppt/media/mp${m}.png`, await svgToPng(p.svg, p.w, p.h));
        rImg = rel(`mp${m}.png`); rSvg = rel(`mp${m}.svg`);
      } else {
        let f = rasterFile.get(p.raster);
        if (!f) {
          const {mime, b64} = dataUrlParts(p.raster), ext = EXT[mime];
          f = `img${++media}.${ext || 'png'}`;
          if (ext) zip.file(`ppt/media/${f}`, b64, {base64: true});
          else zip.file(`ppt/media/${f}`, await svgToPng(wrapSVG(p.w, p.h, `<image href="${p.raster}" width="${p.w}" height="${p.h}"/>`), p.w, p.h));
          rasterFile.set(p.raster, f);
        }
        rImg = rel(f);
      }
      spidOf[p.key] = ++spid; tree += picXML(p, spid, rImg, rSvg);
    }
    // videos: "on click" = the next click plays it (before the animations), "automatically" = right after the slide appears
    const plays = videos.map((p, i) => ({key: p.key, id: 'v' + i, effect: 'play', trigger: p.start === 'auto' ? (i === 0 ? 'after' : 'with') : 'click',
      dur: Math.max(1, Math.round(((p.trim?.to ?? p.duration) - (p.trim?.from || 0)) * 1000)), delay: 0, from: p.trim?.from || 0}));
    const list = [...plays.filter(x => x.trigger !== 'click'), ...plays.filter(x => x.trigger === 'click'), ...Anim.expand(s).filter(a => spidOf[a.key])];
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`
      + `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg.replace('#', '').toUpperCase()}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${tree}</p:spTree></p:cSld>`
      + `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXML(s.transition)}${timingXML(list, spidOf, videos.map(p => spidOf[p.key]))}</p:sld>`;
    zip.file(`ppt/slides/slide${si + 1}.xml`, xml);
    zip.file(`ppt/slides/_rels/slide${si + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
    sldIds += `<p:sldId id="${256 + si}" r:id="rIdS${si + 1}"/>`;
    presRels += `<Relationship Id="rIdS${si + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${si + 1}.xml"/>`;
    ctOver += `<Override PartName="/ppt/slides/slide${si + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }
  const S = PPTX_SKELETON;
  zip.file('ppt/presentation.xml', S['ppt/presentation.xml'].replace(/<p:sldIdLst>.*?<\/p:sldIdLst>/, `<p:sldIdLst>${sldIds}</p:sldIdLst>`));
  zip.file('ppt/_rels/presentation.xml.rels', S['ppt/_rels/presentation.xml.rels'].replace(/<Relationship Id="rId2"[^>]*slides\/slide1.xml"\/>/, '').replace('</Relationships>', presRels + '</Relationships>'));
  const vidDefaults = [...vidTypes].map(x => `<Default Extension="${x}" ContentType="${{mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4'}[x]}"/>`).join('');
  zip.file('[Content_Types].xml', S['[Content_Types].xml'].replace('</Types>', vidDefaults + ctOver + '</Types>'));
  return zip.generateAsync({type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE'});
}

/* ---------- PDF ---------- */
/** Visible pieces (and grown pieces) after every click step: [initial, after click 1, …]. */
function stepStates(s) {
  const list = Anim.expand(s), groups = Anim.groups(list);
  const vis = {}, grow = {};
  for (const k of Anim.initiallyHidden(list)) vis[k] = false;
  const apply = g => g.chains.flat().forEach(a => { const c = Anim.EFFECTS[a.effect].cls;
    if (c === 'entr') vis[a.key] = true; else if (c === 'exit') vis[a.key] = false; else if (a.effect === 'grow') grow[a.key] = true; });
  const states = []; let gi = 0;
  if (groups[0]?.auto) apply(groups[gi++]);
  states.push({vis: {...vis}, grow: {...grow}});
  for (; gi < groups.length; gi++) { apply(groups[gi]); states.push({vis: {...vis}, grow: {...grow}}); }
  return states;
}
let clipN = 0;
function pageSVG(pieces, bg, st) {
  let body = `<rect width="${W}" height="${H}" fill="${bg}"/>`;
  for (const p of pieces) {
    if (st.vis[p.key] === false) continue;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2, k = st.grow[p.key] ? 1.5 : 1;
    const tf = `translate(${n2(cx)},${n2(cy)}) rotate(${p.rot || 0}) scale(${k}) translate(${n2(-p.w / 2)},${n2(-p.h / 2)})`;
    let inner;
    if (p.svg) inner = p.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    else if (p.crop) { const {l = 0, t = 0, r = 0, b = 0} = p.crop, fw = p.w / (1 - l - r), fh = p.h / (1 - t - b);
      inner = `<svg x="0" y="0" width="${n2(p.w)}" height="${n2(p.h)}" viewBox="0 0 ${n2(p.w)} ${n2(p.h)}" overflow="hidden"><image href="${p.raster}" xlink:href="${p.raster}" x="${n2(-l * fw)}" y="${n2(-t * fh)}" width="${n2(fw)}" height="${n2(fh)}" preserveAspectRatio="none"/></svg>`; }
    else inner = `<image href="${p.raster}" xlink:href="${p.raster}" width="${n2(p.w)}" height="${n2(p.h)}" preserveAspectRatio="none"/>`;
    if (!p.svg && !p.raster) continue;
    if (!p.svg && p.radius) { const cid = 'rc' + (++clipN); inner = `<defs><clipPath id="${cid}"><rect width="${n2(p.w)}" height="${n2(p.h)}" rx="${n2(p.radius)}" ry="${n2(p.radius)}"/></clipPath></defs><g clip-path="url(#${cid})">${inner}</g>`; }
    body += `<g transform="${tf}"${p.opacity != null ? ` opacity="${p.opacity}"` : ''}><svg x="0" y="0" width="${n2(p.w)}" height="${n2(p.h)}" viewBox="0 0 ${n2(p.w)} ${n2(p.h)}" overflow="visible">${inner}</svg></g>`;
  }
  return wrapSVG(W, H, body);
}
/** mode 'slides' = one page per slide (final state); 'steps' = one page per click step. */
export async function buildPdf(doc, renderSlide, layoutOf, mode, onProgress) {
  const slides = await collect(doc, renderSlide, layoutOf, (i, n) => onProgress?.(`Diák előkészítése… ${i}/${n}`));
  const PW = W * 0.75, PH = H * 0.75;                    // 960 × 540 pt = 13.33 × 7.5 in, like PowerPoint 16:9
  const pdf = new jsPDF({unit: 'pt', format: [PW, PH], orientation: 'landscape', compress: true});
  let first = true;
  for (const [si, {s, pieces, bg}] of slides.entries()) {
    onProgress?.(`PDF írása… ${si + 1}/${slides.length}`);
    const states = stepStates(s);
    for (const st of mode === 'steps' ? states : [states.at(-1)]) {
      if (!first) pdf.addPage([PW, PH], 'landscape'); first = false;
      const holder = document.createElement('div'); holder.style.cssText = 'position:fixed;left:-20000px;top:0';
      holder.innerHTML = pageSVG(pieces, bg, st); document.body.appendChild(holder);
      try { await pdf.svg(holder.firstChild, {x: 0, y: 0, width: PW, height: PH}); } finally { holder.remove(); }
    }
  }
  return pdf.output('blob');
}

/** A picture of one slide as the export sees it (used by the eyedropper where the browser has none). */
export async function slideCanvas(doc, s, renderSlide, layoutOf) {
  const [{pieces, bg}] = await collect(doc, renderSlide, layoutOf, null, s);
  const svg = pageSVG(pieces, bg, {vis: {}, grow: {}});
  const img = new Image(), url = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
  await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').drawImage(img, 0, 0, W, H); URL.revokeObjectURL(url);
  return c;
}
