// Automatic drafts (src/files.js): one slot per window, recovery after a crash, recently used files.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

const mem = () => { const m = new Map(); return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; }}; };
globalThis.localStorage = mem();
// the Web Locks of every "window" of the test
const held = new Map();
const locks = {
  query: async () => ({held: [...held.keys()].map(name => ({name}))}),
  request: async (name, opt, cb) => {
    if (typeof opt === 'function') { cb = opt; opt = {}; }
    if (held.has(name)) { if (opt.ifAvailable) return cb(null); await held.get(name); }
    let rel; const p = new Promise(r => { rel = r; }); held.set(name, p);
    try { return await cb({name}); } finally { held.delete(name); rel(); }
  }
};
Object.defineProperty(globalThis, 'navigator', {value: {locks}, configurable: true});
globalThis.addEventListener = () => {};
let n = 0;
/** A new window: its own sessionStorage and its own copy of the module. */
async function win(session = mem()) { globalThis.sessionStorage = session; return {m: await import('../src/files.js?window=' + (++n)), session}; }
const crashAll = () => held.clear();
const storeKeys = () => new Promise(res => { const r = indexedDB.open('matekos-prezi', 1); r.onsuccess = () => { const q = r.result.transaction('autosave').objectStore('autosave').getAllKeys(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; });

test('drafts: every window has its own, nothing unsaved is lost', async () => {
  // a draft written by version 1.4.4 (one slot for every window)
  await new Promise(res => { const r = indexedDB.open('matekos-prezi', 1); r.onupgradeneeded = () => r.result.createObjectStore('autosave'); r.onsuccess = () => { const t = r.result.transaction('autosave', 'readwrite'); t.objectStore('autosave').put({doc: {title: 'old'}, media: {a: 'data:AAA'}, title: 'old', dirty: true}, 'last'); t.oncomplete = () => { r.result.close(); res(); }; }; });
  const A = await win(); let v = await A.m.loadAutosave();
  assert.equal(v.title, 'old'); assert.equal(v.media.a, 'data:AAA'); assert.equal(v.dirty, true);
  await A.m.autosave({doc: {title: 'A'}, media: {a: 'data:AAA', b: 'data:BBB'}, title: 'A', dirty: true});

  const B = await win(); v = await B.m.loadAutosave();
  assert.equal(v, null, 'a second window does not take the draft of the running one');
  await B.m.autosave({doc: {title: 'B'}, media: {x: 'data:X'}, title: 'B', dirty: true});
  await A.m.autosave({doc: {title: 'A2'}, media: {b: 'data:BBB'}, title: 'A', dirty: true});

  const B2 = await win(B.session); v = await B2.m.loadAutosave();          // reload (font change)
  assert.equal(v.title, 'B'); assert.equal(v.media.x, 'data:X');

  crashAll();
  const C = await win(); v = await C.m.loadAutosave();
  assert.equal(v.doc.title, 'A2', 'the newest draft is continued');
  assert.deepEqual(Object.keys(v.media), ['b'], 'media that is no longer used is gone');
  assert.deepEqual(C.m.recoverableDrafts().map(d => d.title), ['B'], 'the other unsaved draft can be recovered');

  await C.m.shelveDraft({doc: {title: 'A2'}, media: {b: 'data:BBB'}, title: 'A', dirty: true});
  assert.equal(C.m.recoverableDrafts().length, 2);
  const t = await C.m.takeDraft(C.m.recoverableDrafts().find(d => d.title === 'B').id);
  assert.equal(t.title, 'B'); assert.equal(t.media.x, 'data:X'); assert.equal(C.m.recoverableDrafts().length, 1);
  await C.m.autosave({doc: {title: 'clean'}, media: {}, title: 'clean', dirty: false});

  crashAll();
  const D = await win(); v = await D.m.loadAutosave();
  assert.equal(v.title, 'clean');
  assert.deepEqual(D.m.recoverableDrafts().map(d => d.title), ['A'], 'a draft put aside survives a restart');
  await D.m.dropDraft(D.m.recoverableDrafts()[0].id);
  const keys = await storeKeys();
  assert.equal(keys.length, 1); assert.match(keys[0], /^doc:/);
});

test('recently used files: newest first, no duplicates, at most 8', async () => {
  const { m } = await win();
  for (let i = 1; i <= 10; i++) m.noteRecent(`C:\\dia\\${i}.mprezi`);
  m.noteRecent('C:\\dia\\5.mprezi');
  const list = m.recentFiles().map(r => r.path);
  assert.equal(list.length, 8); assert.equal(list[0], 'C:\\dia\\5.mprezi'); assert.equal(list.filter(p => p.endsWith('\\5.mprezi')).length, 1);
  m.forgetRecent('C:\\dia\\5.mprezi');
  assert.ok(!m.recentFiles().some(r => r.path.endsWith('\\5.mprezi')));
});
