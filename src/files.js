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

/** Desktop: write a file so that a crash or a full disk in the middle of saving cannot ruin the previous version –
 *  the new content goes into a temporary file next to it, which then takes the place of the old file in one step. */
async function writeFileSafely(path, bytes) {
  const {writeFile, rename, remove} = await import('@tauri-apps/plugin-fs');
  const tmp = path + '.tmp';
  let written = false;
  try { await writeFile(tmp, bytes); written = true; } catch (e) { /* e.g. no right to create a new file here */ }
  if (written) {
    try { await rename(tmp, path); return; }
    catch (e) { try { await remove(tmp); } catch (e2) { /* stays behind */ } }
  }
  await writeFile(path, bytes);
}

/* ---------- recently used presentations (desktop app; shown on the home screen) ---------- */
const RECENT = 'matekosprezi.recent';
export function recentFiles() {
  try { const l = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(l) ? l.filter(r => r && typeof r.path === 'string') : []; } catch (e) { return []; }
}
const setRecent = l => { try { localStorage.setItem(RECENT, JSON.stringify(l.slice(0, 8))); } catch (e) { /* ignore */ } };
export function noteRecent(path) { if (path) setRecent([{path, at: Date.now()}, ...recentFiles().filter(r => r.path !== path)]); }
export function forgetRecent(path) { setRecent(recentFiles().filter(r => r.path !== path)); }

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
    let path = !saveAs && currentPath;
    if (!path) {
      path = await save({defaultPath: safeName(title) + '.mprezi', filters: [{name: 'Matekos Prezi bemutató', extensions: ['mprezi']}]});
      if (!path) return 'Mentés megszakítva';
    }
    await writeFileSafely(path, new Uint8Array(await blob.arrayBuffer()));
    currentPath = path; noteRecent(path);
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

/** Rename the presentation's own file (title box). Returns the new file name, or null when not possible. */
export async function renameCurrentFile(newTitle) {
  const name = safeName(newTitle) + '.mprezi';
  if (isTauri() && currentPath) {
    if (baseName(currentPath) === name) return name;
    const {rename, exists} = await import('@tauri-apps/plugin-fs');
    const sep = currentPath.includes('\\') && !currentPath.includes('/') ? '\\' : '/';
    const target = currentPath.slice(0, currentPath.length - baseName(currentPath).length) + name;
    if (await exists(target)) throw new Error(`Ebben a mappában már van „${name}” nevű fájl.`);
    await rename(currentPath, target);
    forgetRecent(currentPath); currentPath = target; noteRecent(target); return name;
  }
  if (currentHandle && currentHandle.move) { if (currentHandle.name !== name) await currentHandle.move(name); return currentHandle.name; }
  return null;
}
/** Does the presentation's file still exist where it was (it may have been renamed or moved outside the app)? */
export async function currentFileExists() {
  if (isTauri() && currentPath) { try { const {exists} = await import('@tauri-apps/plugin-fs'); return await exists(currentPath); } catch (e) { return true; } }
  return true;
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
  if (/\.mprezi$/i.test(path)) noteRecent(path);
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

/* ---------- autosave: the last state survives a crash or a closed window ----------
   Every window has its own slot, so two open windows never overwrite each other's draft:
     'doc:<slot>'           the presentation (without its media), {doc, title, path, handle, dirty, at}
     'media:<slot>:<key>'   one picture / video each – written once, not again with every change
   A slot belongs to a running window while that window holds its lock. At start-up the newest slot without an owner
   is continued (as before: the last state comes back); other ownerless slots with unsaved changes stay available
   as "recoverable drafts" (home screen), the rest is removed. */
const DB = 'matekos-prezi', STORE = 'autosave';
const SLOT_KEY = 'mp.slot', ALIVE = 'matekosprezi.alive.', LOCK = 'matekos-prezi-slot-';
let slot = null, wroteMedia = new Map(), saveChain = Promise.resolve(), drafts = [];
const newSlot = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function idb() {
  return new Promise((ok, err) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error);
  });
}
const req = r => new Promise((ok, err) => { r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
const txDone = t => new Promise((ok, err) => { t.oncomplete = () => ok(); t.onerror = t.onabort = () => err(t.error); });
const mediaRange = id => IDBKeyRange.bound(`media:${id}:`, `media:${id}:\uffff`);
const hasLocks = () => typeof navigator !== 'undefined' && !!navigator.locks?.request && !!navigator.locks?.query;

/** Slots whose window is running right now. */
async function liveSlots() {
  const live = new Set();
  if (hasLocks()) {
    try { for (const l of (await navigator.locks.query()).held || []) if (l.name.startsWith(LOCK)) live.add(l.name.slice(LOCK.length)); return live; }
    catch (e) { /* fall through to the heartbeat */ }
  }
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i); if (!k || !k.startsWith(ALIVE)) continue;
      if (now - (+localStorage.getItem(k) || 0) < 10000) live.add(k.slice(ALIVE.length)); else localStorage.removeItem(k);
    }
  } catch (e) { /* ignore */ }
  return live;
}
/** Take a slot for this window. Resolves to a release function, or to null when another window owns the slot.
 *  wait = true: this window's own slot after a reload – wait until the old page has let it go. */
function claim(id, wait = false) {
  if (hasLocks()) return new Promise(res => {
    navigator.locks.request(LOCK + id, wait ? {} : {ifAvailable: true}, lock => {
      if (!lock) { res(null); return undefined; }
      return new Promise(release => res(() => release()));
    }).catch(() => res(() => {}));
  });
  // older systems without the Locks API: a heartbeat
  const beat = () => { try { localStorage.setItem(ALIVE + id, String(Date.now())); } catch (e) { /* ignore */ } };
  beat(); const t = setInterval(beat, 3000);
  const stop = () => { clearInterval(t); try { localStorage.removeItem(ALIVE + id); } catch (e) { /* ignore */ } };
  addEventListener('pagehide', stop);
  return Promise.resolve(stop);
}
async function readSlot(db, id) {
  const s = db.transaction(STORE).objectStore(STORE), rg = mediaRange(id);
  const [v, keys, vals] = await Promise.all([req(s.get('doc:' + id)), req(s.getAllKeys(rg)), req(s.getAll(rg))]);
  if (!v) return null;
  const media = {}, pre = `media:${id}:`.length;
  keys.forEach((k, i) => { media[k.slice(pre)] = vals[i]; });
  return {...v, media};
}
async function writeSlot(db, id, value, known) {
  const {media = {}, ...rest} = value, next = new Map();
  const t = db.transaction(STORE, 'readwrite'), s = t.objectStore(STORE);
  s.put({...rest, at: Date.now()}, 'doc:' + id);
  for (const [k, v] of Object.entries(media || {})) { if (known.get(k) !== v) s.put(v, `media:${id}:${k}`); next.set(k, v); }
  for (const k of known.keys()) if (!next.has(k)) s.delete(`media:${id}:${k}`);
  await txDone(t);
  return next;
}
async function removeSlot(db, id) {
  const t = db.transaction(STORE, 'readwrite'), s = t.objectStore(STORE);
  s.delete('doc:' + id); s.delete(mediaRange(id));
  await txDone(t);
}
const draftInfo = (id, v) => ({id, title: v.title || v.doc?.title || 'Névtelen bemutató', at: v.at || 0, path: v.path || null});

/** Save this window's state (one save at a time; media that is already stored is not written again). */
export function autosave(value) {
  const run = async () => {
    if (!slot) return false;
    const db = await idb();
    try { wroteMedia = await writeSlot(db, slot, value, wroteMedia); return true; } finally { db.close(); }
  };
  saveChain = saveChain.then(run, run).catch(() => false);
  return saveChain;
}
/** Start-up: the state this window continues with ({doc, media, title, path, handle, dirty} or null). */
export async function loadAutosave() {
  let db = null;
  try {
    db = await idb();
    const store = mode => db.transaction(STORE, mode).objectStore(STORE);
    // versions up to 1.4.4 kept a single state for every window
    const old = await req(store('readonly').get('last'));
    if (old) { await writeSlot(db, newSlot(), old, new Map()); await req(store('readwrite').delete('last')); }

    let own = null; try { own = sessionStorage.getItem(SLOT_KEY); } catch (e) { own = null; }
    drafts = [];
    if (own) { slot = own; claim(slot, true); }                 // the same window after a reload (font change)
    else {
      const ids = (await req(store('readonly').getAllKeys())).filter(k => typeof k === 'string' && k.startsWith('doc:')).map(k => k.slice(4));
      const live = await liveSlots(), free = [];
      for (const id of ids) if (!live.has(id)) { const v = await req(store('readonly').get('doc:' + id)); if (v) free.push({id, v}); }
      free.sort((a, b) => (b.v.at || 0) - (a.v.at || 0));
      for (const {id, v} of free) {
        if (!slot) { if (await claim(id)) slot = id; continue; }
        if (v.dirty && v.doc) { drafts.push(draftInfo(id, v)); continue; }
        const release = await claim(id);                        // nothing unsaved in it: no longer needed
        if (release) { try { await removeSlot(db, id); } finally { release(); } }
      }
      if (!slot) { slot = newSlot(); claim(slot, true); }
      try { sessionStorage.setItem(SLOT_KEY, slot); } catch (e) { /* ignore */ }
    }
    const v = await readSlot(db, slot);
    wroteMedia = new Map(Object.entries(v?.media || {}));
    return v;
  } catch (e) {
    if (!slot) { slot = newSlot(); claim(slot, true); try { sessionStorage.setItem(SLOT_KEY, slot); } catch (e2) { /* ignore */ } }
    return null;
  } finally { db?.close(); }
}
/** Unsaved presentations of windows that are no longer running: [{id, title, at, path}], newest first. */
export const recoverableDrafts = () => drafts;
/** Take a recoverable draft out of the store (it continues in this window). Null when it is gone or open elsewhere. */
export async function takeDraft(id) {
  let db = null;
  try {
    const release = await claim(id); if (!release) return null;
    try {
      db = await idb();
      const v = await readSlot(db, id);
      await removeSlot(db, id);
      drafts = drafts.filter(d => d.id !== id);
      return v;
    } finally { release(); }
  } catch (e) { return null; } finally { db?.close(); }
}
export async function dropDraft(id) { await takeDraft(id); drafts = drafts.filter(d => d.id !== id); }
/** Put a state aside as a recoverable draft (before this window continues with another presentation). */
export async function shelveDraft(value) {
  let db = null;
  try {
    db = await idb();
    const id = newSlot(); await writeSlot(db, id, {...value, dirty: true}, new Map());
    drafts = [draftInfo(id, {...value, at: Date.now()}), ...drafts];
    return true;
  } catch (e) { return false; } finally { db?.close(); }
}

/* ---------- template files (.mpsab = Matekos Prezi SABlon): a zip like .mprezi, without slides ---------- */
let lastTplPath = null;                 // the path of the template file last saved / opened (desktop app)
export const templateFilePath = () => lastTplPath;
const TPL_FILTER = [{name: 'Matekos Prezi Sablon', extensions: ['mpsab']}];
export async function saveTemplateFile(blob, suggested) {
  if (isTauri()) {
    const {save} = await import('@tauri-apps/plugin-dialog');
    const {writeFile} = await import('@tauri-apps/plugin-fs');
    const path = await save({defaultPath: safeName(suggested) + '.mpsab', filters: TPL_FILTER});
    if (!path) return null;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    lastTplPath = path; return baseName(path);
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = safeName(suggested) + '.mpsab'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  lastTplPath = null; return a.download;
}
/** Overwrite a template file (desktop app: at its path; otherwise a download). */
export async function updateTemplateFile(path, blob, name) {
  if (isTauri() && path) { await writeFileSafely(path, new Uint8Array(await blob.arrayBuffer())); return baseName(path); }
  return saveTemplateFile(blob, name || 'sablon');
}
/** Pick a template file: {buf, name, path} or null. */
export async function openTemplateFile() {
  if (isTauri()) {
    const {open} = await import('@tauri-apps/plugin-dialog');
    const {readFile} = await import('@tauri-apps/plugin-fs');
    const path = await open({multiple: false, filters: TPL_FILTER});
    if (!path) return null;
    lastTplPath = path;
    return {buf: (await readFile(path)).buffer, name: baseName(path), path};
  }
  const f = await new Promise(res => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.mpsab'; inp.onchange = () => res(inp.files[0] || null); inp.click(); });
  if (!f) return null;
  lastTplPath = null;
  return {buf: await f.arrayBuffer(), name: f.name, path: null};
}
