/* ================================================================== history */
function snapshot() { return JSON.stringify({doc, cur, mode, tcur}); }
function setStatus(t) {
  const f = currentFileName(), st = $('#status');
  st.className = 'status ' + (t ? 'msg' : dirty || !f ? 'unsaved' : 'saved');
  st.textContent = t ?? (dirty ? 'Nem mentett' : f ? 'Mentve' : 'Még nincs mentve');
  if (t === 'Mentve') st.className = 'status saved';
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
function pushHistory() {
  history = history.slice(0, hIdx + 1); history.push(snapshot());
  if (history.length > 150) { history.shift(); editBase--; }
  hIdx = history.length - 1; dirty = true; editedNow = true; setStatus(); saveSoon();
}
function commit() {
  syncEditor();
  if (multiRun) return;                // formatting several text boxes: one undo step and one redraw at the end
  pushHistory();
  renderAll();
}
/* Typing in a text box makes its own undo steps (one per pause), so after leaving the box Ctrl+Z goes back step by
   step instead of dropping everything typed – and the automatic draft follows the typing too. Undo / redo inside the
   box (the editor's own) folds the box's steps so far into one, so the two histories never contradict each other. */
let editT = 0, editBase = -1, editNav = false;
function foldEditSteps() {
  if (editNav && editBase >= 0 && editBase < history.length) { history = history.slice(0, editBase + 1); hIdx = editBase; }
  editNav = false;
}
function editStep() {
  clearTimeout(editT); editT = 0;
  if (!editing || !ed) return;
  const o = objById(editing); if (!o) return;
  const j = ed.getJSON(); if (JSON.stringify(j) === JSON.stringify(o.doc)) return;
  o.doc = j; foldEditSteps(); pushHistory(); updateRibbon();
}
function editSoon(nav) { if (nav) editNav = true; clearTimeout(editT); editT = setTimeout(editStep, 1200); }
function restore(i) {
  if (editing) stopEditor();
  hIdx = i; const s = JSON.parse(history[i]); doc = s.doc; mode = s.mode ?? 'slides'; tcur = s.tcur ?? 'master';
  cur = Math.min(s.cur, doc.slides.length - 1); if (mode === 'template' && tcur !== 'master' && !doc.templates[tcur]) tcur = 'master';
  selIds = selIds.filter(id => objById(id)); sel = selIds.length === 1 ? selIds[0] : null; renderAll(); saveSoon();
}
const undo = () => { if (editing) return ed.commands.undo(); if (hIdx > 0) restore(hIdx - 1); };
const redo = () => { if (editing) return ed.commands.redo(); if (hIdx < history.length - 1) restore(hIdx + 1); };

