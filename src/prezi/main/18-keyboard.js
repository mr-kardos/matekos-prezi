/* ================================================================== keyboard */
let clipboard = null, nudgeT = 0;
addEventListener('keydown', e => {
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey, k = e.key.toLowerCase();
  if (sh) {
    // a number and Enter: jump to that slide; Home / End: first / last slide
    if (/^[0-9]$/.test(k) && !mod && !e.altKey) { e.preventDefault(); sh.num = ((sh.num || '') + k).slice(-4); info(); return; }
    const num = sh.num; sh.num = '';
    if (k === 'enter' && num) { e.preventDefault(); loadShowSlide(Math.max(1, Math.min(doc.slides.length, +num)) - 1, 0, true); return; }
    if (k === 'home' || k === 'end') { e.preventDefault(); loadShowSlide(k === 'home' ? 0 : doc.slides.length - 1, 0, true); return; }
    if (num) info();
    if (['arrowright', 'arrowdown', ' ', 'pagedown', 'enter'].includes(k)) { e.preventDefault(); showNext(); }
    else if (['arrowleft', 'arrowup', 'pageup', 'backspace'].includes(k)) { e.preventDefault(); showPrev(); }
    else if (k === 'escape') stopShow();
    return;
  }
  // Ctrl+M a second time closes the formula editor (the first one, typed in a text, opened it during this same key press)
  if (isMathEditorOpen() && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm' && !e.target.closest?.('.ProseMirror')) { e.preventDefault(); applyMathEditor(); return; }
  if (isMathEditorOpen() || !$('#cfm').hidden) return;
  if (!$('#home').hidden) return;
  if (mod && ['0', '+', '=', '-'].includes(k)) { e.preventDefault(); const pct = Math.round(scale * 100); setZoom(k === '0' ? 'auto' : k === '-' ? pct / 1.25 : pct * 1.25); return; }
  if (mod && k === 's') { e.preventDefault(); doSave(e.shiftKey); return; }
  if (mod && k === 'o') { e.preventDefault(); doOpen(); return; }
  if (k === 'f5') { e.preventDefault(); startShow(cur); return; }
  if (mod && (k === 'h' || k === 'l') && !e.shiftKey && (editing || isTextLike(selObj()))) {
    e.preventDefault(); withEditor(c => (k === 'h' ? c.toggleSuperscript() : c.toggleSubscript()).run()); updateRibbon(); return;
  }
  if (mod && k === 'f') { e.preventDefault(); showPop('popFind', ribbon.querySelector('[data-pop=popFind]')); $('#findIn').focus(); $('#findIn').select(); return; }
  if (editing) { if (mod && k === 'm') { e.preventDefault(); openMath(null, null); } return; }   // the editor handles the rest
  if (e.target.closest('input, select, textarea')) return;
  if (mod && k === 'm') { e.preventDefault(); openMath(null, null); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && 'biu'.includes(k) && isTextLike(selObj())) { e.preventDefault(); COMMANDS[{b: 'bold', i: 'italic', u: 'underline'}[k]](); return; }
  if (mod && k === 'a') { e.preventDefault(); setSel(tgt().objects.filter(q => !q.locked).map(q => q.id)); drawSelection(); renderProps(); updateRibbon(); return; }
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelected() : groupSelected(); return; }
  const o = selObj();
  if (mod && k === 'd' && selIds.length) {
    e.preventDefault(); duplicateSel(); return;
  }
  if ((k === 'delete' || k === 'backspace') && selIds.length) { e.preventDefault(); deleteSelected(); return; }
  if (k === 'escape' || (k === 'enter' && cropping)) { if (cropping) { endCrop(); return; } if (painter) { COMMANDS.painter(); return; } select(null); return; }
  if (k === 'enter' && isTextLike(o) && !o.locked && !(mode === 'template' && o.placeholder)) { e.preventDefault(); enterEdit(o.id); return; }
  if ((k === 'arrowup' || k === 'arrowdown') && mode === 'slides' && (!selIds.length || slideFocus)) {
    e.preventDefault(); const to = cur + (k === 'arrowup' ? -1 : 1);
    if (to >= 0 && to < doc.slides.length) { gotoSlide(to); slideFocus = true; }
    return;
  }
  if (selIds.length && k.startsWith('arrow')) {
    e.preventDefault(); const d = e.shiftKey ? 10 : 1;
    const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
    for (const q of selIds.map(objById)) { if (!q || q.locked) continue; moveObject(q, dx, dy); if (q.placeholder && mode === 'slides') q.phMoved = true; updateObjLive(q, true); }
    drawSelection(); drawBadges(); if (o) syncGeometryInputs(o);
    clearTimeout(nudgeT); nudgeT = setTimeout(commit, 400); return;
  }
  if (!mod && !e.altKey) { if (k === 't') addText(); else if (k === 'r') addShape('rect'); else if (k === 'e') addShape('ellipse'); else if (k === 'a') addShape('arrow'); else if (k === 'l') addShape('line'); }
});
addEventListener('beforeunload', e => { if (dirty && !isTauri()) e.preventDefault(); });

