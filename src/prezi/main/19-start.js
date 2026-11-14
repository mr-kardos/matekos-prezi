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
  if (saved?.path) {
    setCurrentPath(saved.path);
    // renamed or moved outside the app since the last session: the old place is no longer used
    if (!await currentFileExists()) { toast(`A(z) „${saved.path.split(/[\\/]/).pop()}” fájl már nincs a korábbi helyén – mentéskor új helyet kérdez.`); setCurrentPath(null); }
    else titleFromFile();
  }
  if (saved?.handle) setCurrentHandle(saved.handle);
  if (saved?.dirty) { dirty = true; setStatus(); }
  fitStage(); renderAll();
  if (sessionStorage.getItem('mp.skipHome')) sessionOpen = true; else showHome(true);
  sessionStorage.removeItem('mp.skipHome');
  fontLoad.then(() => { measureTexts(); drawSelection(); drawBadges(); thumbCache.clear(); renderThumbs(); });   // list gaps and tabs were laid out with the fallback font
  mathReady.then(() => setTimeout(() => { measureTexts(); drawSelection(); drawBadges(); }, 100));
  if (isTauri()) {
    try {
      const {getCurrentWindow} = await import('@tauri-apps/api/window'), win = getCurrentWindow();
      win.onCloseRequested(async ev => {
        if (!dirty) return;
        ev.preventDefault();
        const r = await quitBox();
        if (r === 'stay') return;
        if (r === 'save') { await doSave(false); if (dirty) return; }
        clearTimeout(autoT); await autosave({...autoValue(), dirty: false}); await win.destroy();
      });
    } catch (e) { /* not available */ }
    // a Matekos Prezi Sablon (.mpsab) opened from the system: a new presentation with that template
    const openSys = async path => {
      if (/\.mpsab$/i.test(path)) {
        try { const {readFile} = await import('@tauri-apps/plugin-fs'); const buf = (await readFile(path)).buffer; if (!await newPresentation()) return; await templateFromFile({buf, name: path.split(/[\\/]/).pop(), path}); }
        catch (e) { toast('A sablon nem nyitható meg: ' + (e?.message || e)); }
        return;
      }
      if (!await okToReplace('A nem mentett módosítások elvesznek. Megnyitod a másik bemutatót?', 'Megnyitás')) return;
      openResult(await openPathFile(path));
    };
    try { const p = await watchOpenedFiles(openSys); if (p) await openSys(p); }
    catch (e) { /* not available */ }
  }
})();

// hooks for automated tests
setMediaLookup(k => media[k]);
window.mprezi = {runUpdateCheck, insertVideo: (data, name) => insertVideo({data, name}), dbgRender: (o, cb) => renderForImport(o, cb), importBuffer: (data, name) => importPowerPoint({data, name}), snapshotTest: async () => { const c = await slideCanvas(doc, tgt(), renderSlide, layoutOf); return [...c.getContext('2d').getImageData(640, 5, 1, 1).data]; }, get doc() { return doc; }, get media() { return media; }, get editor() { return ed; }, get sel() { return sel; }, set sel(v) { select(v); }, get selIds() { return selIds; }, setSel: ids => { setSel(ids); drawSelection(); renderProps(); updateRibbon(); }, groupSelected, ungroupSelected, addShape, addTable, toggleLock,
  gotoSlide, enterEdit, exitEdit, commit, renderAll, buildPptx: () => buildPptx(doc, renderSlide, layoutOf, () => {}),
  buildPdf: m => buildPdf(doc, renderSlide, layoutOf, m, () => {}), renderSlide, packMprezi, unpackMprezi, loadDocument, Anim};
// for the tests that run the app in a browser (tests/app.e2e.mjs)
Object.assign(window.mprezi, {startShow, showNext, stopShow, splitAllSteps, mergeAllSteps, commit: () => commit()});
Object.defineProperty(window.mprezi, 'slideCount', {get: () => doc.slides.length});
