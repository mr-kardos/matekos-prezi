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

/** Animation pieces of a text box: top-level blocks; lists count item by item. */
export function blockCount(o) {
  let n = 0;
  for (const b of o.doc?.content ?? []) n += (b.type === 'bulletList' || b.type === 'orderedList') ? (b.content?.length || 1) : 1;
  return n;
}
export function isEmptyText(o) {
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
export const TITLE_PROMPT = 'Kattints duplán a cím beírásához';
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
export const PH_STYLE = ['size', 'color', 'bold', 'italic', 'underline', 'strike', 'align'];
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
  for (const g of [d.master, ...Object.values(d.templates), ...d.slides]) g.objects.forEach(migrateObject);
  for (const s of d.slides) {
    for (const a of s.anims) { const o = s.objects.find(q => q.id === a.target); if (o?.byParagraph && a.byParagraph == null) a.byParagraph = true; }
    for (const o of s.objects) delete o.byParagraph;
  }
  d.version = 3; return d;
}
