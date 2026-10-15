// Saving and opening – native dialogs in the desktop app, downloads / file picker in the browser.
export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
export const safeName = t => (t || 'bemutato').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 120) || 'bemutato';
const baseName = p => String(p).split(/[\\/]/).pop();

let currentPath = null;      // desktop app: path of the presentation file
let currentHandle = null;    // browser (Chrome/Edge): file handle, so "Mentés" can write the same file again
export const getCurrentPath = () => currentPath;
export const setCurrentPath = p => { currentPath = p; };
export const getCurrentHandle = () => currentHandle;
export const setCurrentHandle = h => { currentHandle = h || null; };
/** Name of the file the presentation is saved to (or null). */
export const currentFileName = () => currentPath ? baseName(currentPath) : currentHandle ? currentHandle.name : null;
const MPREZI_TYPE = [{description: 'Matekos Prezi bemutató', accept: {'application/zip': ['.mprezi']}}];

/** Browser download (or the claude.ai downloads capability when running as a published page). */
async function download(filename, blob) {
  let dl = null;
  try { if (window.claude && window.claude.use) dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
  if (dl) {
    try { await dl.save({filename, data: blob}); return 'Mentve'; }
    catch (e) { return e && e.code === 'declined' ? 'Mentés megszakítva' : 'A fájl mentése nem sikerült' + (e && e.code ? ' (' + e.code + ')' : ''); }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'Mentve';
}

/** Save the editable presentation (.mprezi = zip). */
export async function savePresentation(blob, title, saveAs) {
  if (isTauri()) {
    const {save} = await import('@tauri-apps/plugin-dialog');
    const {writeFile} = await import('@tauri-apps/plugin-fs');
    let path = !saveAs && currentPath;
    if (!path) {
      path = await save({defaultPath: safeName(title) + '.mprezi', filters: [{name: 'Matekos Prezi bemutató', extensions: ['mprezi']}]});
      if (!path) return 'Mentés megszakítva';
    }
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    currentPath = path;
    return 'Mentve';
  }
  if (window.showSaveFilePicker) {                       // Chrome / Edge: real files, saved in place
    try {
      let h = !saveAs && currentHandle;
      if (h && (await h.queryPermission?.({mode: 'readwrite'})) !== 'granted' && (await h.requestPermission?.({mode: 'readwrite'})) !== 'granted') h = null;
      if (!h) h = await window.showSaveFilePicker({suggestedName: safeName(title) + '.mprezi', types: MPREZI_TYPE});
      const w = await h.createWritable(); await w.write(blob); await w.close();
      currentHandle = h; return 'Mentve';
    } catch (e) { if (e && e.name === 'AbortError') return 'Mentés megszakítva'; }
  }
  return download(safeName(title) + '.mprezi', blob);
}

/** Export files (.pptx, .pdf). */
export async function saveExport(blob, title, ext, label) {
  if (isTauri()) {
    const {save} = await import('@tauri-apps/plugin-dialog');
    const {writeFile} = await import('@tauri-apps/plugin-fs');
    const path = await save({defaultPath: safeName(title) + '.' + ext, filters: [{name: label, extensions: [ext]}]});
    if (!path) return 'Mentés megszakítva';
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return 'Mentve';
  }
  return download(safeName(title) + '.' + ext, blob);
}

/** Pick a .mprezi file. Returns {data: ArrayBuffer, path, name} or null. */
export async function openPresentation() {
  if (isTauri()) {
    const {open} = await import('@tauri-apps/plugin-dialog');
    const path = await open({multiple: false, filters: [{name: 'Matekos Prezi bemutató', extensions: ['mprezi']}]});
    if (!path) return null;
    return openPathFile(path);
  }
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({types: MPREZI_TYPE, multiple: false});
      const f = await h.getFile(); currentHandle = h;
      return {data: await f.arrayBuffer(), path: null, name: f.name, handle: h};
    } catch (e) { if (e && e.name === 'AbortError') return null; }
  }
  return new Promise(resolve => {
    const inp = document.getElementById('openIn');
    inp.onchange = async () => { const f = inp.files[0]; inp.value = ''; resolve(f ? {data: await f.arrayBuffer(), path: null, name: f.name} : null); };
    inp.click();
  });
}
/** Pick any file (e.g. a PowerPoint file to import). Returns {data: ArrayBuffer, name} or null. */
export async function pickFile(label, exts) {
  if (isTauri()) {
    const {open} = await import('@tauri-apps/plugin-dialog');
    const path = await open({multiple: false, filters: [{name: label, extensions: exts}]});
    if (!path) return null;
    const {readFile} = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(path);
    return {data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name: baseName(path)};
  }
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = exts.map(e => '.' + e).join(',');
    inp.onchange = async () => { const f = inp.files[0]; resolve(f ? {data: await f.arrayBuffer(), name: f.name} : null); };
    inp.click();
  });
}
/** Desktop: read a presentation from a path (e.g. a double-clicked .mprezi file). */
export async function openPathFile(path) {
  const {readFile} = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(path);
  return {data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), path, name: baseName(path)};
}
/** Desktop: files the operating system asked us to open (double-click), plus later requests. */
export async function watchOpenedFiles(onFile) {
  const {invoke} = await import('@tauri-apps/api/core');
  const {listen} = await import('@tauri-apps/api/event');
  await listen('open-files', e => { const p = e.payload && e.payload[0]; if (p) onFile(p); });
  const first = await invoke('take_opened_files');
  return first && first.length ? first[0] : null;
}

/* ---------- autosave: the last state survives a crash or a closed window ---------- */
const DB = 'matekos-prezi', STORE = 'autosave';
function idb() {
  return new Promise((ok, err) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error);
  });
}
export async function autosave(value) {
  try {
    const db = await idb();
    await new Promise((ok, err) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, 'last'); t.oncomplete = ok; t.onerror = () => err(t.error); });
    db.close(); return true;
  } catch (e) { return false; }
}
export async function loadAutosave() {
  try {
    const db = await idb();
    const v = await new Promise((ok, err) => { const r = db.transaction(STORE).objectStore(STORE).get('last'); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
    db.close(); return v || null;
  } catch (e) { return null; }
}
