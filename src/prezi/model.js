// Matekos Prezi document model.
//   doc.master    = {background, bgColor, objects}         – shared by every layout (PowerPoint: slide master)
//   doc.templates = {key: {name, ownBg, background, bgColor, showMaster, objects}}   – layouts
//   doc.slides    = [{id, template, objects, anims}]
// Text objects keep their content as a TipTap document (same editor and formula nodes as Matekos Doksi):
//   {type:'text', x, y, w, h, rot, size(px), color, align, bold, italic, underline, strike, doc}
export const W = 1280, H = 720;
export const uid = () => 'o' + Math.random().toString(36).slice(2, 9);
export const clone = o => JSON.parse(JSON.stringify(o));
export const emptyDoc = () => ({type: 'doc', content: [{type: 'paragraph'}]});
export const textDoc = (...paras) => ({type: 'doc', content: paras.map(runs => ({type: 'paragraph', content: runs.length ? runs : undefined}))});
export const T = text => ({type: 'text', text});
export const M = tex => ({type: 'math', attrs: {tex, display: false}});
const cellP = content => ({type: 'tableCell', content: [{type: 'paragraph', ...(content ? {content} : {})}]});
/** A table object's document: exactly one table. */
export const tableDoc = (rows, cols, fill) => ({type: 'doc', content: [{type: 'table', content: Array.from({length: rows}, (_, r) =>
  ({type: 'tableRow', content: Array.from({length: cols}, (_, c) => cellP(fill?.(r, c)))}))}]});

/* ---------- objects, groups ---------- */
/** All objects of a list, including the members of groups (depth first). */
export const flatObjects = list => list.flatMap(o => o.type === 'group' ? [o, ...flatObjects(o.children)] : [o]);
export function findObject(list, id) {
  for (const o of list) { if (o.id === id) return o; if (o.type === 'group') { const r = findObject(o.children, id); if (r) return r; } }
  return null;
}
/** The group that directly contains `id` (or null for top-level objects). */
export function parentGroup(list, id, parent = null) {
  for (const o of list) { if (o.id === id) return parent; if (o.type === 'group') { const r = parentGroup(o.children, id, o); if (r !== undefined) return r; } }
  return undefined;
}
/** Axis-aligned bounds of a (possibly rotated) object. */
export function bounds(o) {
  const t = (o.rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const w = o.w * c + o.h * s, h = o.w * s + o.h * c, cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  return {x: cx - w / 2, y: cy - h / 2, w, h};
}
export function fitGroup(g) {
  if (!g.children.length) return g;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of g.children) { if (c.type === 'group') fitGroup(c); const b = bounds(c); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  Object.assign(g, {x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), rot: 0});
  return g;
}
export function moveObject(o, dx, dy) { o.x += dx; o.y += dy; if (o.type === 'group') o.children.forEach(c => moveObject(c, dx, dy)); }
/** Scale an object (and a group's members) from its original copy `o0` about the point (ax, ay). */
export function scaleFrom(o, o0, k, ax, ay) {
  o.x = ax + (o0.x - ax) * k; o.y = ay + (o0.y - ay) * k; o.w = o0.w * k; o.h = o0.h * k;
  if (o.type === 'text' || o.type === 'table') o.size = Math.max(4, o0.size * k);
  if (o.type === 'shape' && o0.strokeWidth) o.strokeWidth = o0.strokeWidth * k;
  if (o.type === 'group') o.children.forEach((c, i) => scaleFrom(c, o0.children[i], k, ax, ay));
}

/** Animation pieces of a text box: top-level blocks; lists count item by item. */
export function blockCount(o) {
  if (o.type !== 'text') return 1;
  let n = 0;
  for (const b of o.doc?.content ?? []) n += (b.type === 'bulletList' || b.type === 'orderedList') ? (b.content?.length || 1) : 1;
  return n;
}
export function isEmptyText(o) {
  if (o.type === 'table') return false;
  const walk = n => n.type === 'math' || n.type === 'table' || (n.type === 'text' && n.text.trim()) || (n.content || []).some(walk);
  return !walk(o.doc ?? emptyDoc());
}

export function makeBackground() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, W, H); lg.addColorStop(0, '#f7f3ea'); lg.addColorStop(1, '#e8eef5');
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  g.fillStyle = '#2f5d8a'; g.fillRect(0, 0, W, 10);
  g.globalAlpha = .08; g.beginPath(); g.arc(1210, 660, 160, 0, 7); g.fill();
  g.globalAlpha = .07; g.fillStyle = '#c0392b'; g.beginPath(); g.arc(1150, 700, 90, 0, 7); g.fill();
  return c.toDataURL('image/png');
}
const PH_NAMES = {title: 'Cím', subtitle: 'Alcím', body: 'Szöveg'};
export const phName = k => PH_NAMES[k] ?? (PH_NAMES[k.replace(/\d+$/, '')] + ' ' + (k.match(/\d+$/)?.[0] ?? ''));
export function ph(key, x, y, w, pt, color, bold, align, prompt) {
  return {id: uid(), name: phName(key) + ' helykitöltő', type: 'text', placeholder: key, prompt, x, y, w, h: pt * 2, rot: 0,
    size: Math.round(pt / 0.75 * 100) / 100, color, bold, align, doc: emptyDoc()};
}
export const TITLE_PROMPT = 'Cím';
export function defaultMaster(bgKey) {
  return {background: bgKey, bgColor: '#ffffff', objects: [
    {id: uid(), name: 'Lábléc', type: 'text', x: 60, y: 668, w: 600, h: 30, rot: 0, size: 16, color: '#6b7785', align: 'left', doc: textDoc([T('Matekos Prezi')])}]};
}
export function defaultTemplates() {
  const L = (name, objects) => ({name, ownBg: false, background: null, bgColor: '#ffffff', showMaster: true, objects});
  const C = '#2f5d8a', B = '#1a1a1a';
  return {
    cimdia: L('Címdia', [ph('title', 140, 250, 1000, 45, C, true, 'center', TITLE_PROMPT), ph('subtitle', 240, 380, 800, 22, '#4a5866', false, 'center', 'Alcím')]),
    tartalom: L('Cím és tartalom', [ph('title', 60, 40, 1160, 33, C, true, 'left', TITLE_PROMPT), ph('body', 60, 150, 1160, 22, B, false, 'left', 'Szöveg')]),
    ketoszlop: L('Két hasáb', [ph('title', 60, 40, 1160, 33, C, true, 'left', TITLE_PROMPT), ph('body', 60, 150, 560, 22, B, false, 'left', 'Bal hasáb'), ph('body2', 660, 150, 560, 22, B, false, 'left', 'Jobb hasáb')]),
    csakcim: L('Csak cím', [ph('title', 60, 40, 1160, 33, C, true, 'left', TITLE_PROMPT)]),
    ures: L('Üres', []),
  };
}
export const phClone = p => ({...clone(p), id: uid(), name: phName(p.placeholder), doc: emptyDoc()});
export function newSlide(doc, template) {
  const L = doc.templates[template] ?? Object.values(doc.templates)[0];
  return {id: uid(), template, objects: L.objects.filter(o => o.placeholder).map(phClone), anims: []};
}
export const PH_STYLE = ['size', 'color', 'bold', 'italic', 'underline', 'strike', 'align', 'letterSpacing'];
/** Keep a slide's placeholders in step with its layout (unless moved / restyled on the slide). */
export function syncPlaceholders(doc, s) {
  const L = doc.templates[s.template]; if (!L) return;
  const phs = L.objects.filter(o => o.placeholder);
  for (const p of phs) {
    const o = s.objects.find(q => q.placeholder === p.placeholder);
    if (!o) { s.objects.push(phClone(p)); continue; }
    if (!o.phMoved) Object.assign(o, {x: p.x, y: p.y, w: p.w, rot: p.rot || 0});
    if (!o.phStyled) for (const k of PH_STYLE) o[k] = p[k];
    o.prompt = p.prompt;
  }
  s.objects = s.objects.filter(o => {
    if (!o.placeholder || phs.some(p => p.placeholder === o.placeholder)) return true;
    if (isEmptyText(o)) { s.anims = s.anims.filter(a => a.target !== o.id); return false; }
    delete o.placeholder; return true;
  });
}

/* ---------- migrations from the prototype versions ---------- */
function runsToNodes(runs) {
  return (runs || []).map(r => {
    if (r.math != null) return M(r.math);
    const marks = [];
    if (r.bold) marks.push({type: 'bold'}); if (r.italic) marks.push({type: 'italic'});
    if (r.underline) marks.push({type: 'underline'}); if (r.strike) marks.push({type: 'strike'});
    if (r.color) marks.push({type: 'textStyle', attrs: {color: r.color}});
    return r.text ? {type: 'text', text: r.text, ...(marks.length ? {marks} : {})} : null;
  }).filter(Boolean);
}
function migrateObject(o) {
  if (o.type === 'text' && !o.doc) {
    o.doc = {type: 'doc', content: (o.paragraphs || [{runs: []}]).map(p => { const c = runsToNodes(p.runs); return c.length ? {type: 'paragraph', content: c} : {type: 'paragraph'}; })};
    delete o.paragraphs;
  }
  return o;
}
export function migrate(d) {
  if (!d.master) {                                 // version 1: per-template background, no master
    const first = Object.values(d.templates).find(t => t.background);
    d.master = {background: first?.background ?? null, bgColor: '#ffffff', objects: []};
    for (const t of Object.values(d.templates)) {
      t.objects = [...(t.fixed ?? []), ...(t.placeholders ?? []).map(p => ph(p.key, p.x, p.y, p.w, p.size * 0.75, p.color, p.bold, p.align, p.prompt))];
      Object.assign(t, {ownBg: true, bgColor: '#ffffff', showMaster: false}); delete t.fixed; delete t.placeholders;
    }
  }
  for (const g of [d.master, ...Object.values(d.templates), ...d.slides]) {
    g.objects.forEach(migrateObject);
    // version 0.1: tables lived inside text boxes – they become table objects below the text
    for (const o of [...g.objects]) {
      if (o.type !== 'text' || !o.doc?.content?.some(b => b.type === 'table')) continue;
      let y = o.y + o.h + 10, at = g.objects.indexOf(o) + 1;
      for (const b of o.doc.content.filter(b => b.type === 'table')) {
        g.objects.splice(at++, 0, {id: uid(), name: 'Táblázat', type: 'table', x: o.x, y, w: o.w, h: 100, rot: 0, size: o.size, color: o.color, align: 'left', doc: {type: 'doc', content: [b]}});
        y += 110;
      }
      o.doc.content = o.doc.content.filter(b => b.type !== 'table');
      if (!o.doc.content.length) o.doc.content = [{type: 'paragraph'}];
    }
  }
  for (const s of d.slides) {
    for (const a of s.anims) { const o = s.objects.find(q => q.id === a.target); if (o?.byParagraph && a.byParagraph == null) a.byParagraph = true; }
    for (const o of s.objects) delete o.byParagraph;
  }
  d.version = 4; return d;
}
