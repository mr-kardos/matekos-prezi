/* ================================================================== files */
const EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v'};
function usedMedia() {
  const keys = new Set();
  if (doc.master.background) keys.add(doc.master.background);
  for (const t of Object.values(doc.templates)) if (t.background) keys.add(t.background);
  for (const g of [doc.master, ...Object.values(doc.templates), ...doc.slides]) for (const o of flatObjects(g.objects)) { if (o.media) keys.add(o.media); if (o.poster) keys.add(o.poster); }
  if (doc.customTpl?.data) for (const k of tplMedia(doc.customTpl.data)) keys.add(k);
  return [...keys];
}
async function packMprezi() {
  const z = new JSZip(), files = {};
  for (const k of usedMedia()) {
    const m = media[k]?.match(/^data:([^;]+);base64,(.*)$/); if (!m) continue;
    const name = `media/${k}.${EXT[m[1]] ?? 'bin'}`; z.file(name, m[2], {base64: true, compression: /svg/.test(m[1]) ? 'DEFLATE' : 'STORE'}); files[k] = name;   // pictures and videos are compressed already
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
/** The title box always shows the presentation's file name (after Save as, opening, renaming). */
function titleFromFile() {
  const f = currentFileName(); if (!f) return;
  doc.title = f.replace(/\.mprezi$/i, ''); $('#docTitle').value = doc.title;
}
/** Title box changed: a saved presentation's file is renamed to match. */
async function renameFromTitle(v) {
  const t = v.trim() || 'Névtelen bemutató';
  if (!currentFileName()) { doc.title = t; saveSoon(); return; }
  try {
    const n = await renameCurrentFile(t);
    if (n) { doc.title = n.replace(/\.mprezi$/i, ''); $('#docTitle').value = doc.title; toast('Átnevezve: ' + n); saveSoon(); }
    else { doc.title = t; saveSoon(); }
  } catch (e) { toast('Az átnevezés nem sikerült: ' + (e?.message || e)); titleFromFile(); }
}
async function doSave(saveAs) {
  if (editing) exitEdit(); closePops();
  try { const msg = await savePresentation(await packMprezi(), doc.title, saveAs); if (msg === 'Mentve') { titleFromFile(); dirty = false; saveSoon(); setStatus(); } else { setStatus(msg); toast(msg); setTimeout(() => setStatus(), 2500); } }
  catch (e) { setStatus('A mentés nem sikerült: ' + (e?.message || e)); }
}
function loadDocument(d, m, name, path, handle, asDirty) {
  setCurrentHandle(handle ?? null);
  doc = d; media = m; if (name) doc.title = name.replace(/\.(mprezi|pptx)$/i, '');   // the file's own name
  doc.font = FONT_SETS[doc.font] ? doc.font : DEFAULT_FONT;
  if (doc.font !== activeMathFont()) { setCurrentPath(path ?? null); resetHistory(); if (asDirty) dirty = true; restartWithFont(doc.font); return; }
  mode = 'slides'; cur = 0; setSel([]); curAnim = null; setCurrentPath(path ?? null);
  resetHistory(); if (asDirty) { dirty = true; setStatus(); } renderAll(); fitStage();
}
async function openResult(r) {
  if (!r) return;
  sessionOpen = true; showHome(false);
  try { const {doc: d, media: m} = await unpackMprezi(r.data); loadDocument(d, m, r.name, r.path, r.handle); saveSoon(); toast('Megnyitva: ' + r.name); setStatus('Megnyitva: ' + r.name); }
  catch (e) { toast('A fájl nem nyitható meg: ' + (e?.message || e)); }
}
/** May this window's presentation be replaced by another one? Unsaved work made in this session asks first; a draft
 *  that only came back from the last session (and was not touched) is put aside as a recoverable draft instead. */
async function okToReplace(msg, yes) {
  if (editing) exitEdit();
  if (!dirty) return true;
  if (editedNow) return confirmBox(msg, yes);
  if (await shelveDraft(autoValue())) { toast('Az előző, nem mentett bemutató megmaradt – a kezdőképernyőn állítható vissza.'); return true; }
  return confirmBox(msg, yes);
}
async function doOpen() {
  if (editing) exitEdit();
  if (dirty && editedNow && !await confirmBox('A nem mentett módosítások elvesznek. Megnyitsz egy másik bemutatót?', 'Megnyitás')) return;
  const r = await openPresentation(); if (!r) return;
  if (dirty && !editedNow && await shelveDraft(autoValue())) toast('Az előző, nem mentett bemutató megmaradt – a kezdőképernyőn állítható vissza.');   // only once a file was really chosen
  showHome(false); openResult(r);
}
/** Home screen: a recently used presentation. */
async function openRecent(path) {
  if (!await okToReplace('A nem mentett módosítások elvesznek. Megnyitsz egy másik bemutatót?', 'Megnyitás')) return;
  let r = null;
  try { r = await openPathFile(path); }
  catch (e) { forgetRecent(path); renderHomeLists(); toast(`A(z) „${path.split(/[\\/]/).pop()}” fájl már nincs a korábbi helyén.`); return; }
  openResult(r);
}
/** Home screen: continue an unsaved presentation of a window that is no longer running. */
async function openDraft(id) {
  if (!await okToReplace('A mostani bemutató nem mentett módosításai elvesznek. Visszaállítod a másikat?', 'Visszaállítás')) return;
  const v = await takeDraft(id);
  if (!v?.doc) { renderHomeLists(); toast('Ez a bemutató már nem állítható vissza (lehet, hogy egy másik ablakban van nyitva).'); return; }
  sessionOpen = true; showHome(false);
  try {
    let path = v.path || null;
    if (path) { setCurrentPath(path); if (!await currentFileExists()) path = null; }
    loadDocument(migrate(v.doc), v.media || {}, v.title || null, path, v.handle, true);
    if (path) titleFromFile();
    saveSoon(); toast(path ? 'Visszaállítva – a módosítások még nincsenek a fájlba mentve.' : 'Visszaállítva – még nincs fájlba mentve.');
  } catch (e) { toast('A bemutató nem állítható vissza: ' + (e?.message || e)); }
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
$('#fImport').onclick = () => { closePops(); importPowerPoint(); };
$('#fSaveAs').onclick = () => { closePops(); doSave(true); };
document.querySelector('.splitdd').onclick = e => showPop('popSave', e.currentTarget);
$('#bSave').onclick = () => doSave(false);

$('#bPlay').onclick = () => startShow(cur);
$('#bZoom').onclick = e => showPop('popZoom', e.currentTarget);
$('#popZoom').onopen = () => { for (const b of $$('#popZoom [data-zoom]')) b.classList.toggle('on', b.dataset.zoom === String(zoom)); };
/** Set the zoom ('auto' = fit, or a percentage). `at` (screen point): that point of the slide stays under the pointer. */
function setZoom(z, at) {
  const r0 = stage.getBoundingClientRect(), k0 = scale;
  zoom = z === 'auto' ? 'auto' : Math.max(25, Math.min(400, Math.round(z)));
  $('#zoomLabel').textContent = zoom === 'auto' ? '' : zoom + '%'; $('#bZoom').classList.toggle('pct', zoom !== 'auto');
  fitStage();
  if (at && zoom !== 'auto') { const r = stage.getBoundingClientRect(); work.scrollLeft += r.left + (at.x - r0.left) / k0 * scale - at.x; work.scrollTop += r.top + (at.y - r0.top) / k0 * scale - at.y; }
  drawSelection(); drawBadges(); drawFind();
}
$('#popZoom').addEventListener('click', e => { const b = e.target.closest('[data-zoom]'); if (!b) return; closePops(); setZoom(b.dataset.zoom === 'auto' ? 'auto' : +b.dataset.zoom); });
/* Zoom at the pointer: Ctrl/⌘ + mouse wheel, Ctrl/⌘ + two-finger scroll and pinching on a touchpad.
   Windows (WebView2) and Chrome report a pinch as a wheel event with Ctrl; the Mac (WebKit) as gesture events. */
let zoomRun = null;                  // exact (not rounded) zoom while a wheel / pinch sequence lasts
function zoomBy(factor, at) {
  const pct = Math.round(scale * 100);
  if (!zoomRun || zoomRun.shown !== pct) zoomRun = {v: pct};
  zoomRun.v = Math.max(25, Math.min(400, zoomRun.v * factor));
  setZoom(zoomRun.v, at); zoomRun.shown = Math.round(scale * 100);
}
const zoomable = e => !sh && $('#home').hidden && e.target instanceof Node && work.contains(e.target);
window.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey) || !zoomable(e)) return;
  e.preventDefault(); e.stopPropagation();
  let d = e.deltaY || e.deltaX; if (e.deltaMode === 1) d *= 33; else if (e.deltaMode === 2) d *= 300;
  if (!d) return;
  zoomBy(Math.abs(d) >= 50 ? (d < 0 ? 1.1 : 1 / 1.1) : Math.exp(-d * 0.01), {x: e.clientX, y: e.clientY});   // a wheel notch: 10%; a touchpad: smooth
}, {passive: false, capture: true});
let pinch = null;
window.addEventListener('gesturestart', e => { if (!zoomable(e)) return; e.preventDefault(); pinch = Math.round(scale * 100); }, {passive: false, capture: true});
window.addEventListener('gesturechange', e => { if (pinch == null) return; e.preventDefault(); setZoom(pinch * (e.scale || 1), {x: e.clientX, y: e.clientY}); }, {passive: false, capture: true});
window.addEventListener('gestureend', e => { if (pinch != null) e.preventDefault(); pinch = null; }, {passive: false, capture: true});
$('#bExport').onclick = e => showPop('popExport', e.currentTarget);
let titleBusy = false;
$('#docTitle').addEventListener('keydown', async e => {
  if (e.key === 'Escape') { e.target.value = doc.title; e.target.blur(); return; }
  if (e.key !== 'Enter') return; e.preventDefault();
  titleBusy = true; const v = e.target.value; e.target.blur();
  if (!currentFileName()) { doc.title = v.trim() || 'Névtelen bemutató'; await doSave(false); }   // a new presentation: ask where to save it now
  else await renameFromTitle(v);
  titleBusy = false;
});
$('#docTitle').onchange = e => { if (!titleBusy && e.target.value.trim() !== doc.title) renameFromTitle(e.target.value); };
/* ---------- PowerPoint import ---------- */
let impHost = null;
async function waitMath(el) {
  await mathReady;
  for (let i = 0; i < 200 && el.querySelector('.math .mpending:not(.merr)'); i++) await new Promise(r => setTimeout(r, 25));
}
/** Render a text object off-screen exactly like on the slide; `cb(textRoot, left, top)` reads the layout. */
async function renderForImport(o, cb) {
  if (!impHost) {
    impHost = document.createElement('div'); impHost.className = 'slide imphost';
    Object.assign(impHost.style, {position: 'fixed', left: '-6000px', top: '0', width: W + 'px', height: H + 'px', transform: 'none', visibility: 'hidden', pointerEvents: 'none'});
    document.body.appendChild(impHost);
  }
  const fams = new Set([fontSet(doc.font).text]); if (o.font) fams.add(o.font);
  JSON.stringify(o.doc).replace(/MP ([a-z0-9]+)/g, (_, f) => fams.add(f));
  await Promise.all([...fams].map(f => loadTextFamily(f)));
  impHost.innerHTML = '';
  const el = objEl({...o, rot: 0, x: 0, y: 0}, 'thumb'); el.style.visibility = 'visible'; impHost.appendChild(el);
  await waitMath(el);
  try {
    if (cb) { const r = el.getBoundingClientRect(); return cb(el.querySelector('.txt'), r.left, r.top); }
    return el.firstChild.offsetHeight;
  } finally { impHost.innerHTML = ''; }
}
async function measureMath(tex) {
  if (!impHost) await renderForImport({id: 'x', type: 'text', x: 0, y: 0, w: 10, h: 10, size: 10, color: '#000', doc: emptyDoc()});
  const sp = document.createElement('span'); sp.style.fontSize = '100px'; impHost.appendChild(sp);
  await mathReady; await new Promise(res => renderInto(sp, tex, false, res));
  const r = (sp.querySelector('svg') || sp).getBoundingClientRect(); sp.remove();
  return {h: r.height / 100 || 1.2, w: r.width / 100 || 1};
}
function showReport(title, lines) {
  const box = $('#cfm'); $('#cfmMsg').innerHTML = `<b>${esc(title)}</b>` + lines.map(l => `<br>${l}`).join('');
  $('#cfmNo').hidden = true; $('#cfmYes').textContent = 'Rendben'; box.hidden = false; box.classList.add('report');
  $('#cfmYes').onclick = () => { box.hidden = true; $('#cfmNo').hidden = false; box.classList.remove('report'); $('#cfmYes').onclick = null; };
}
async function importPowerPoint(given) {
  if (editing) exitEdit();
  if (!given && !await okToReplace('Az importált fájl új bemutatóként nyílik meg; a mostani nem mentett módosításai elvesznek. Folytatod?', 'Importálás')) return;
  const f = given || await pickFile('PowerPoint-bemutató', ['pptx']); if (!f) return;
  busy('PowerPoint-fájl beolvasása…');
  try {
    const {importPptx, placeContent} = await import('./importPptx.js');
    const r = await importPptx(f.data, {onProgress: m => busy(m)});
    if (!r.doc.slides.length) throw new Error('nem találtam diát');
    await placeContent(r.doc, {renderText: renderForImport, measureMath, onProgress: m => busy(m), textJSON: r.textJSON, boxStyle: r.boxStyle, report: r.report});
    const d = r.doc;
    d.font = doc.font || DEFAULT_FONT; d.styles = defaultStyles(); d.title = f.name.replace(/\.pptx$/i, '');
    for (const s_ of d.slides) { const ids = new Set(flatObjects(s_.objects).map(o => o.id)); s_.anims = (s_.anims || []).filter(a => ids.has(a.target)); if (!s_.transition) delete s_.transition; }
    if (!Object.keys(d.templates).length) d.templates = PRESETS.ures.build().templates;
    for (const s_ of d.slides) if (!d.templates[s_.template]) s_.template = Object.keys(d.templates)[0];
    loadDocument(migrate(d), r.media, f.name.replace(/\.pptx$/i, '.mprezi'), null);
    sessionOpen = true; showHome(false); dirty = true; setStatus(); saveSoon();
    busy('');
    const rep_ = r.report, lines = [`${rep_.slides} dia beolvasva.`];
    if (rep_.formulas) lines.push(`Képletek: ${rep_.formulas} – ebből ${rep_.inline} a szövegbe illesztve, ${rep_.standalone} önálló képletdobozként.`);
    if (rep_.failed.length) lines.push(`<span style="color:var(--accent)">Nem sikerült átalakítani ${rep_.failed.length} képletet</span> (dia: ${[...new Set(rep_.failed.map(x => x.slide))].join(', ')}). Ezek a helyükön képként vagy piros „[képlet – írd be újra]” jelöléssel maradtak.`);
    if (rep_.skipped.length) { const c = {}; for (const x of rep_.skipped) c[x.what] = (c[x.what] || 0) + 1; lines.push('Kihagyva / egyszerűsítve: ' + Object.entries(c).map(([w, n]) => `${w} ×${n}`).join(', ') + '.'); }
    lines.push('Az eredeti PowerPoint-fájl nem változott. Mentéskor új .mprezi fájl készül.');
    showReport('PowerPoint importálása kész', lines);
  } catch (e) { console.error(e); busy(''); toast('Az importálás nem sikerült: ' + (e.message || e)); }
}
let editedNow = false;                 // changes made since the app started (a restored draft alone does not count)
/** Unsaved changes when the window is closed: save / quit without saving / stay. */
function quitBox() {
  return new Promise(res => {
    const box = $('#cfm'), extra = document.createElement('button');
    extra.className = 'btn'; extra.textContent = 'Mentés és kilépés';
    $('#cfmMsg').textContent = 'A bemutatóban nem mentett módosítások vannak. Kilépsz mentés nélkül?';
    $('#cfmYes').textContent = 'Kilépés mentés nélkül'; $('#cfmNo').after(extra); box.hidden = false;
    const done = v => { box.hidden = true; extra.remove(); removeEventListener('keydown', key, true); $('#cfmYes').onclick = $('#cfmNo').onclick = null; res(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('stay'); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done('save'); } };
    addEventListener('keydown', key, true); extra.focus();
    $('#cfmYes').onclick = () => done('quit'); $('#cfmNo').onclick = () => done('stay'); extra.onclick = () => done('save');
  });
}
async function newPresentation() {
  if (!await okToReplace('Új bemutatót kezdesz. A mostani nem mentett módosításai elvesznek. Folytatod?', 'Új bemutató')) return false;
  if (editing) stopEditor();
  blankDoc(); doc.slides.push(newSlide('cimdia')); loadDocument(doc, media, null, null); saveSoon(); sessionOpen = true; editedNow = false; showHome(false); return true;
}
/* home screen (as in Matekos Doksi) */
function showHome(show) {
  $('#home').hidden = !show;
  if (show) {
    const f = currentFileName();
    // also an unsaved presentation that came back from the last session can be continued
    $('#homeResume').hidden = !(sessionOpen || f || dirty);
    $('#homeResume').textContent = f ? `Folytatás: ${f}${dirty ? ' (nem mentett módosításokkal)' : ''}` : sessionOpen ? 'Vissza a megnyitott bemutatóhoz' : `Nem mentett bemutató folytatása: ${doc.title || 'Névtelen bemutató'}`;
    renderHomeLists();
  }
  else fitStage();
}
const homeDate = t => t ? new Date(t).toLocaleString('hu-HU', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}) : '';
/** Home screen lists: recoverable unsaved presentations and recently used files. */
function renderHomeLists() {
  const dr = recoverableDrafts(), box = $('#homeDrafts');
  box.hidden = !dr.length;
  box.innerHTML = dr.length ? '<h2>Nem mentett munka visszaállítása</h2>' + dr.map(d => `<div class="hrow"><button class="hitem" data-draft="${esc(d.id)}" title="Megnyitás ebben az ablakban"><b>${esc(d.title)}</b><span>${esc(homeDate(d.at))}</span></button><button class="hx" data-dropdraft="${esc(d.id)}" title="Elvetés">${svgIcon('xmark')}</button></div>`).join('') : '';
  const here = getCurrentPath(), rc = isTauri() ? recentFiles().filter(r => r.path !== here).slice(0, 6) : [], rb = $('#homeRecent');
  rb.hidden = !rc.length;
  rb.innerHTML = rc.length ? '<h2>Legutóbbi bemutatók</h2>' + rc.map(r => { const n = r.path.split(/[\\/]/).pop(); return `<div class="hrow"><button class="hitem" data-recent="${esc(r.path)}" title="${esc(r.path)}"><b>${esc(n.replace(/\.mprezi$/i, ''))}</b><span>${esc(homeDate(r.at))}</span></button><button class="hx" data-droprecent="${esc(r.path)}" title="Eltávolítás a listából">${svgIcon('xmark')}</button></div>`; }).join('') : '';
}
$('#home').addEventListener('click', async e => {
  const b = e.target.closest('[data-draft], [data-dropdraft], [data-recent], [data-droprecent]'); if (!b) return;
  if (b.dataset.draft) return openDraft(b.dataset.draft);
  if (b.dataset.recent) return openRecent(b.dataset.recent);
  if (b.dataset.droprecent) { forgetRecent(b.dataset.droprecent); renderHomeLists(); return; }
  if (await confirmBox('Biztosan elveted ezt a nem mentett bemutatót? Később már nem állítható vissza.', 'Elvetés')) { await dropDraft(b.dataset.dropdraft); renderHomeLists(); }
});
$('.home-ver').textContent = 'v' + APP_VERSION;
$('#homeNew').onclick = newPresentation;
$('#homeOpen').onclick = doOpen;
$('#homeResume').onclick = () => { sessionOpen = true; showHome(false); };
let sessionOpen = false;            // a presentation was opened / created / continued in this session
/* colour theme: dark (default on every platform) or light; also the desktop window's own title bar */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('matekosprezi.theme', t); } catch (e) { /* ignore */ }
  $('#fTheme').innerHTML = `<span class="cico">${svgIcon(t === 'dark' ? 'sun' : 'moon')}</span><span class="clbl">${t === 'dark' ? 'Világos mód' : 'Sötét mód'}</span>`;
  if (isTauri()) import('@tauri-apps/api/window').then(m => m.getCurrentWindow().setTheme(t)).catch(() => {});
}
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
$('#fTheme').onclick = () => { closePops(); applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); };
$('#fHome').onclick = () => { closePops(); sessionOpen = true; if (editing) exitEdit(); clearTimeout(autoT); autosave(autoValue()); showHome(true); };
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2800); }

