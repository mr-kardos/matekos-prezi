/* ================================================================== template files (.mpsab)
   save the template (master, slide types, text styles, base font) into a Matekos Prezi Sablon file and use one
   (at most one per presentation), as in Matekos Doksi */
const tplLabel = () => doc.customTpl?.on ? doc.customTpl.name : (doc.templateName === 'Üres' ? 'Sima' : (doc.templateName || 'Saját'));
const tplSnapshot = () => JSON.parse(JSON.stringify({master: doc.master, templates: doc.templates, styles: stylesOf(), font: doc.font || DEFAULT_FONT}));
function tplMedia(t) {
  const keys = new Set();
  for (const g of [t.master, ...Object.values(t.templates || {})]) { if (!g) continue; if (g.background) keys.add(g.background); for (const o of flatObjects(g.objects || [])) { if (o.media) keys.add(o.media); if (o.poster) keys.add(o.poster); } }
  return [...keys];
}
async function packTemplate(name, t) {
  const z = new JSZip(), files = {};
  for (const k of tplMedia(t)) { const m = media[k]?.match(/^data:([^;]+);base64,(.*)$/); if (!m) continue; const fn = `media/${k}.${EXT[m[1]] ?? 'bin'}`; z.file(fn, m[2], {base64: true, compression: 'STORE'}); files[k] = fn; }
  z.file('manifest.json', JSON.stringify({format: 'mprezi', version: doc.version || 4, size: {w: W, h: H}, app: 'matekos-prezi-sablon', name, ...t, slides: [], media: files}, null, 1));
  return z.generateAsync({type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE'});
}
async function readTemplate(buf) {
  let z, m;
  try { z = await JSZip.loadAsync(buf); m = JSON.parse(await z.file('manifest.json').async('string')); } catch (e) { m = null; }
  if (!m || m.app !== 'matekos-prezi-sablon' || !m.master) throw new Error('Ez nem Matekos Prezi sablonfájl (.mpsab).');
  const md = {};
  for (const [k, fn] of Object.entries(m.media ?? {})) { const ext = fn.split('.').pop(), mime = Object.keys(EXT).find(x => EXT[x] === ext) ?? 'application/octet-stream'; md[k] = `data:${mime};base64,` + await z.file(fn).async('base64'); }
  const d = migrate({format: 'mprezi', version: m.version, size: m.size, master: m.master, templates: m.templates, styles: m.styles, font: m.font, slides: []});
  return {t: {master: d.master, templates: d.templates, styles: m.styles, font: m.font}, media: md};
}
/** Use a template (master, slide types, styles, font); the slides keep their content. */
async function useTemplate(p, label, custom) {
  if (editing) exitEdit();
  p = JSON.parse(JSON.stringify(p));
  doc.master = p.master; doc.templates = p.templates; doc.styles = {...defaultStyles(), ...p.styles}; doc.templateName = label;
  if (doc.customTpl) doc.customTpl.on = !!custom;
  const first = Object.keys(doc.templates)[0];
  for (const sl of doc.slides) {
    if (!doc.templates[sl.template]) sl.template = doc.templates.tartalom ? 'tartalom' : first;
    for (const o of sl.objects) if (o.placeholder) { delete o.phMoved; delete o.phStyled; }
    syncPlaceholders(sl);
  }
  tcur = 'master'; setSel([]);
  if (p.font && p.font !== (doc.font || DEFAULT_FONT)) { doc.font = p.font; commit(); await restartWithFont(p.font); return; }
  commit(); toast(`Sablon: ${label}`);
}
async function templateToFile() {
  try {
    const name = doc.customTpl?.on ? doc.customTpl.name : (doc.title || 'Bemutató') + ' sablon', t = tplSnapshot();
    const n = await saveTemplateFile(await packTemplate(name, t), name); if (!n) return;
    if (doc.customTpl && !doc.customTpl.on && !await confirmBox(`A bemutatóban már van egy sablonfájl („${doc.customTpl.name}”). Egyszerre csak egy lehet – ez lép a helyére: „${n.replace(/\.mpsab$/i, '')}”?`, 'Csere')) { toast('Sablon elmentve: ' + n); return; }
    doc.customTpl = {name: n.replace(/\.mpsab$/i, ''), path: templateFilePath(), data: t, on: true}; doc.templateName = doc.customTpl.name;
    commit(); toast('Sablon elmentve és használatban: ' + n);
  } catch (e) { toast('A sablon mentése nem sikerült: ' + (e?.message || e)); }
}
async function templateUpdateFile() {
  if (!doc.customTpl) return;
  try {
    const t = tplSnapshot(), n = await updateTemplateFile(doc.customTpl.path || null, await packTemplate(doc.customTpl.name, t), doc.customTpl.name);
    if (n) { doc.customTpl.data = t; commit(); toast('Sablonfájl frissítve: ' + n); }
  } catch (e) { toast('A sablonfájl frissítése nem sikerült: ' + (e?.message || e)); }
}
async function templateFromFile(given) {
  let r;
  try { r = given || await openTemplateFile(); } catch (e) { toast(e?.message || String(e)); return; }
  if (!r) return;
  let tp; try { tp = await readTemplate(r.buf); } catch (e) { toast(e.message); return; }
  const name = r.name.replace(/\.mpsab$/i, '');
  if (!given && doc.customTpl && !await confirmBox(`A bemutatóban már van egy sablonfájl („${doc.customTpl.name}”). Egyszerre csak egy lehet – lecseréled erre: „${name}”?`, 'Csere')) return;
  if (!given && !await confirmBox(`A(z) „${name}” sablon lép a mostani helyére (háttér, diatípusok, szövegstílusok). A diák tartalma megmarad. Folytatod?`, 'Sablon alkalmazása')) return;
  Object.assign(media, tp.media);
  doc.customTpl = {name, path: r.path || null, data: tp.t, on: true};
  await useTemplate(tp.t, name, true);
}
async function applyPreset(key) {
  if (key === 'custom') {
    if (!doc.customTpl || doc.customTpl.on) return;
    if (!await confirmBox(`A(z) „${doc.customTpl.name}” sablon lép a mostani helyére (háttér, diatípusok, szövegstílusok). A diák tartalma megmarad. Folytatod?`, 'Sablon alkalmazása')) return;
    await useTemplate(doc.customTpl.data, doc.customTpl.name, true); return;
  }
  const P = PRESETS[key]; if (!P || P.locked) return;
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
  if (doc.customTpl) doc.customTpl.on = false;
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

