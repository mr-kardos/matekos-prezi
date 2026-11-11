/* ================================================================== right panel */
const props = $('#props');
const fld = (label, html, full) => `<label class="fld${full ? ' full' : ''}">${label}${html}</label>`;
const slider = (id, label, v, min, max, step = 1, dis = '') => `<div class="sl"><span>${label}</span><input type="range" id="${id}R" min="${min}" max="${max}" step="${step}" value="${v}" ${dis}><input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}" ${dis}></div>`;
function panelVisible(v) { mainEl.classList.toggle('noprops', !v); document.body.classList.toggle('noprops-on', !v); lsSet(LS.panel, v ? '1' : '0'); fitStage(); }
$('#panelOpen').onclick = () => panelVisible(true);
function slidesVisible(v) { mainEl.classList.toggle('noslides', !v); lsSet('matekosprezi.slides', v ? '1' : '0'); fitStage(); drawComments(); }
$('#slidesOpen').onclick = () => slidesVisible(true);
if (lsGet('matekosprezi.slides') === '0') mainEl.classList.add('noslides');
let secState = {}; try { secState = JSON.parse(lsGet(LS.sections) || '{}'); } catch (e) { secState = {}; }
const section = (key, title, body) => `<section class="psec${secState[key] ? ' closed' : ''}" data-sec="${key}">
  <button class="psec-h" data-sec-toggle="${key}" aria-expanded="${!secState[key]}">${svgIcon('chev')}<span>${title}</span></button><div class="psec-b">${body}</div></section>`;
const TYPE_LABEL = {text: 'Szöveg', table: 'Táblázat', image: 'Kép', group: 'Csoport'};
const typeIcon = o => o.type === 'shape' ? o.shape : o.type === 'group' ? 'group' : o.type === 'table' ? 'table' : o.type === 'image' ? 'image' : 'textbox';

/** Objects whose corners can be rounded: rectangles, polygons, pictures, videos. */
const canRound = o => o.type === 'image' || o.type === 'video' || (o.type === 'shape' && (['rect', 'triangle', 'arrow'].includes(o.shape) ||
  (o.shape === 'path' && o.path?.every(([c]) => c === 'M' || c === 'L' || c === 'Z') && o.path.filter(([c]) => c === 'M').length === 1)));
function alignBar(n) {
  const b = (k, ic, t, dis) => `<button class="tb" data-align="${k}" title="${t}" ${dis ? 'disabled' : ''}>${svgIcon(ic)}</button>`;
  return `<div class="alignbar"><span class="albl">${n > 1 ? 'Igazítás egymáshoz' : 'Igazítás a diához'}</span>
    ${b('l', 'alObjL', 'Balra')}${b('c', 'alObjC', 'Vízszintesen középre')}${b('r', 'alObjR', 'Jobbra')}${b('t', 'alObjT', 'Fel')}${b('m', 'alObjM', 'Függőlegesen középre')}${b('b', 'alObjB', 'Le')}
    ${b('dh', 'distH', 'Egyenletes elosztás vízszintesen (legalább 3 objektum)', n < 3)}${b('dv', 'distV', 'Egyenletes elosztás függőlegesen (legalább 3 objektum)', n < 3)}</div>`;
}
function groupBar() {
  const multiTop = tgt().objects.filter(o => selIds.includes(o.id)).length > 1, one = selObj();
  if (!multiTop && one?.type !== 'group') return '';
  return `<div class="grpbar">${multiTop ? `<button class="btn" data-arr="group" title="A kijelöltek csoportosítása (Ctrl/⌘+G)">${svgIcon('group')}Csoportosítás</button>` : ''}
    ${one?.type === 'group' ? `<button class="btn" data-arr="ungroup" title="A csoport szétbontása (Ctrl/⌘+Shift+G)">${svgIcon('ungroup')}Szétbontás</button>` : ''}</div>`;
}
function positionBody() {
  const objs = selIds.map(objById).filter(Boolean);
  if (objs.length > 1) return `${groupBar()}${alignBar(objs.length)}<div class="phint" style="margin:8px 0 0">${objs.length} objektum kijelölve – húzd bármelyiket a közös mozgatáshoz.</div>`;
  const o = objs[0];
  if (!o) return '<div class="phint" style="margin:0">Jelölj ki egy objektumot a dián vagy a Rétegek listában. Több objektum: Shift+kattintás, vagy húzz keretet az üres területen.</div>';
  const round = Math.round, rot = o.rot > 180 ? o.rot - 360 : (o.rot || 0), lk = o.locked ? 'disabled' : '';
  const colors = o.type === 'shape' ? `<div class="colbtns">
      <button class="btn colbtn" data-pop="popFill" ${o.shape === 'line' || o.locked ? 'disabled' : ''} title="Kitöltés színe"><i class="dot fill${o.fill ? '' : ' none'}" style="--c:${o.fill || 'transparent'}"></i>Kitöltés</button>
      <button class="btn colbtn" data-pop="popStroke" ${lk} title="Körvonal színe és vastagsága"><i class="dot ring${o.stroke ? '' : ' none'}" style="--c:${o.stroke || 'transparent'}"></i>${o.shape === 'line' ? 'Vonal' : 'Körvonal'}</button></div>` : '';
  return `${colors}${groupBar()}${o.locked ? '' : alignBar(1)}${o.locked ? `<div class="phint lockhint">${svgIcon('lock')} Zárolva – a Rétegek résznél oldható fel.</div>` : ''}
    ${slider('pX', 'Vízszintes', round(o.x), -round(o.w) + 10, W - 10, 1, lk)}
    ${slider('pY', 'Függőleges', round(o.y), -round(o.h) + 10, H - 10, 1, lk)}
    ${slider('pW', 'Szélesség', round(o.w), 16, W, 1, lk)}
    ${slider('pH', 'Magasság', round(o.h), 16, H, 1, isTextLike(o) || o.shape === 'line' ? 'disabled title="A magasság a tartalomhoz igazodik"' : lk)}
    ${slider('pR', 'Elforgatás (°)', round(rot), -180, 180, 1, o.type === 'group' ? 'disabled title="Csoport nem forgatható – a tagjai igen"' : lk)}
    ${o.type === 'shape' ? slider('pSW', o.shape === 'line' ? 'Vastagság (px)' : 'Körvonal (px)', o.stroke ? (o.strokeWidth || 0) : 0, o.shape === 'line' ? 1 : 0, 30, 1, lk) : ''}
    ${canRound(o) ? slider('pRad', 'Lekerekítés', o.radius || 0, 0, Math.round(Math.min(o.w, o.h) / 2), 1, lk) : ''}
    ${slider('pOp', 'Átlátszatlanság (%)', round((o.opacity ?? 1) * 100), 5, 100, 1, lk)}
    ${o.placeholder && mode === 'template' ? fld('Helykitöltő mintaszövege', `<input type="text" id="pPrompt" value="${esc(o.prompt ?? '')}">`, true) : ''}
    ${o.placeholder && mode === 'slides' ? `<div class="phint">${esc(phName(o.placeholder))} helykitöltő – helye és formája az elrendezést követi, amíg itt nem módosítod.</div>` : ''}`;
}
function layersBody() {
  const objs = tgt().objects, one = selObj(), top = one && tgt().objects.includes(one);
  const dis = top && !one.locked ? '' : 'disabled';
  const multiTop = tgt().objects.filter(o => selIds.includes(o.id)).length > 1;
  const rows = [...objs].reverse().map(o => `<div class="lyr${selIds.includes(o.id) ? ' on' : ''}${o.locked ? ' isl' : ''}${o.hidden ? ' ish' : ''}" draggable="true" data-id="${o.id}">
    <span class="grip">${svgIcon('grip')}</span>${svgIcon(typeIcon(o))}<span class="lname">${esc(o.name ?? TYPE_LABEL[o.type] ?? '')}${o.type === 'group' ? ` <small>(${o.children.length})</small>` : ''}</span>
    <button class="lk eye${o.hidden ? ' on' : ''}" data-hide="${o.id}" title="${o.hidden ? 'Megjelenítés' : 'Elrejtés (a dián, a lejátszásban és az exportban sem látszik)'}">${svgIcon(o.hidden ? 'eyeOff' : 'eye')}</button>
    <button class="lk${o.locked ? ' on' : ''}" data-lock="${o.id}" title="${o.locked ? 'Feloldás' : 'Zárolás: nem mozdítható, nem jelölhető ki a dián'}">${svgIcon(o.locked ? 'lock' : 'unlock')}</button></div>`).join('');
  return `<div class="layers" id="layerList">${rows || '<div class="phint" style="margin:4px 0">Ezen a dián még nincs objektum.</div>'}</div>
    <div class="phint">Legfelül az előtérben lévő. Húzással átrendezhető; Shift+kattintás: több kijelölése.</div>`;
}
function renderProps() {
  const o = selObj(); let h = '';
  const title = selIds.length > 1 ? `${selIds.length} objektum` : o ? esc(o.name ?? TYPE_LABEL[o.type] ?? 'Objektum') : mode === 'slides' ? `${cur + 1}. dia` : tcur === 'master' ? 'Mester' : 'Elrendezés';
  h += `<div class="phead2"><b>${title}</b><button class="tb" id="propsX" title="Jobb oldali panel bezárása">${svgIcon('panel')}</button></div>`;
  if (mode === 'template' && !selIds.length) {
    const curTpl = tplLabel();
    h += `<section class="presetbox"><div class="pbhead"><b>Sablonok</b></div>
      <div class="pbgrid">${PRESET_ORDER.map(k => { const P = PRESETS[k], sw = P.swatch || ['#ffffff', '#d8d8d8'];
        if (P.locked) return `<button class="pbcard locked" disabled title="${esc(P.note)}"><i style="--a:${sw[0]};--b:${sw[1]}"></i><span>${svgIcon('lock')}${P.label}</span><small>Hamarosan</small></button>`;
        return `<button class="pbcard${curTpl === P.label && !doc.customTpl?.on ? ' on' : ''}" data-preset="${k}" title="${esc(P.note)}"><i style="--a:${sw[0]};--b:${sw[1]}"></i><span>${P.label}</span></button>`; }).join('')}
        ${doc.customTpl ? `<button class="pbcard custom${doc.customTpl.on ? ' on' : ''}" data-preset="custom" title="Sablonfájlból: ${esc(doc.customTpl.name)}"><i style="--a:#ffffff;--b:#2e4a9e"></i><span>${esc(doc.customTpl.name)}</span><small>sablonfájlból</small></button>` : ''}</div>
      <div class="pbfile">${doc.customTpl?.on ? `<button class="btn primary" id="tplUpdate" title="A sablonfájl felülírása a mostani beállításokkal (különben a változások csak ebbe a bemutatóba kerülnek)">Sablonfájl frissítése</button>` : ''}<button class="btn" id="tplToFile" title="A mester, a diatípusok, a szövegstílusok és az alap betűtípus egy Matekos Prezi Sablon fájlba">Sablon mentése fájlba…</button><button class="btn" id="tplFromFile" title="Egy Matekos Prezi Sablon fájl használata ebben a bemutatóban">Sablonfájl importálása…</button></div>
      <div class="pbnote">Válassz kész sablont, és szabd tovább lent és a dián – a módosítások ebbe a fájlba mentődnek. Új bemutató mindig a Sima sablonnal indul. Az Elmélet sablon hamarosan érkezik.</div></section>`;
    const isM = tcur === 'master', L = tgt();
    h += `<section><div class="fgrid">
      ${isM ? '' : fld('Név', `<input type="text" id="pName" value="${esc(L.name)}">`, true)}
      ${isM ? '' : `<label class="chk full"><input type="checkbox" id="pShowM" ${L.showMaster ? 'checked' : ''}> A mester elemeinek megjelenítése</label>`}
      ${isM ? '' : `<label class="chk full"><input type="checkbox" id="pOwnBg" ${L.ownBg ? 'checked' : ''}> Saját háttér (a mesteré helyett)</label>`}</div>`;
    if (isM || L.ownBg) h += `<div class="fgrid" style="margin-top:10px">
      <div class="fld">Háttérszín<button class="btn colbtn" id="pBgColor"><i class="dot fill" style="--c:${L.bgColor || '#ffffff'}"></i>${L.bgColor || '#ffffff'}</button></div>
      <div class="fld">Háttérkép<div class="imgpick">${L.background ? `<img src="${media[L.background]}" alt="">` : ''}<button class="btn" id="pBgPick">Kép…</button>${L.background ? '<button class="btn" id="pBgClear">Eltávolítás</button>' : ''}</div></div></div>`;
    h += `<div class="phint">${isM ? 'Ami a mesterre kerül, minden elrendezésen megjelenik.' : 'Helykitöltőt a menüszalag „Helykitöltő” gombjával adhatsz hozzá.'}</div></section>`;
    const st = stylesOf(), fams = allFamilies();
    const famSel = (k, v) => `<select class="stfont" data-st="${k}" title="Betűtípus"><option value="">Alap betűtípus</option>${[...fams.math, ...fams.other].map(([f, l]) => `<option value="${f}" ${f === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const row = (k, label, hint) => `<div class="strow"><div class="sthead"><b>${label}</b><span class="phint">${hint}</span></div>
      <div class="stctl"><input type="number" class="stsize" data-st="${k}" min="8" max="120" step="0.5" value="${Math.round(st[k].size * 0.75 * 2) / 2}" title="Betűméret (pt)"><span class="unit">pt</span>
        <button class="btn colbtn stcolor" data-st="${k}" title="Betűszín"><i class="dot fill" style="--c:${st[k].color}"></i>Szín</button>
        <button class="tb${st[k].bold ? ' on' : ''}" data-stt="bold" data-st="${k}" title="Félkövér"><b>B</b></button><button class="tb${st[k].italic ? ' on' : ''}" data-stt="italic" data-st="${k}" title="Dőlt"><i>I</i></button><button class="tb${st[k].underline ? ' on' : ''}" data-stt="underline" data-st="${k}" title="Aláhúzott"><u>U</u></button>
        ${famSel(k, st[k].font)}</div>
      <div class="stctl st2"><label title="Sorköz">Sorköz <input type="number" class="stline" data-st="${k}" min="0.8" max="3" step="0.05" value="${st[k].line ?? 1.25}"></label>
        <label title="Betűköz (pt)">Betűköz <input type="number" class="stls" data-st="${k}" min="-3" max="10" step="0.1" value="${st[k].letterSpacing ?? 0}"></label>
        <span class="stalign">${[['left', 'alignL', 'Balra'], ['center', 'alignC', 'Középre'], ['right', 'alignR', 'Jobbra'], ['justify', 'alignJ', 'Sorkizárt']].map(([v, ic, t]) => `<button class="tb${(st[k].align || 'left') === v ? ' on' : ''}" data-stal="${v}" data-st="${k}" title="${t}">${svgIcon(ic)}</button>`).join('')}</span></div></div>`;
    h += `<section><div class="fgrid">${fld('Alap betűtípus (szöveg és képletek)', `<select id="pBaseFont">${Object.entries(FONT_SETS).map(([k2, f]) => `<option value="${k2}" ${k2 === (doc.font || DEFAULT_FONT) ? 'selected' : ''}>${f.label}</option>`).join('')}</select>`, true)}</div>
      <div class="phint">Az új szövegdobozok és a képletek ezt használják. Csak képletbarát betűtípus lehet.</div></section>`;
    h += section('styles', 'Szövegstílusok', row('title', 'Címek', 'cím-helykitöltők') + row('subtitle', 'Alcímek', 'alcím-helykitöltők') + row('body', 'Szöveg', 'szöveg-helykitöltők, új szövegdobozok')
      + '<div class="phint">A méretváltozás arányosan hat. A diákon egyenként átformázott dobozok megtartják a saját formájukat.</div>');
  }
  h += section('pos', 'Megjelenés és elhelyezés', positionBody());
  h += section('layers', 'Rétegek', layersBody());
  if (mode === 'slides') h += section('anim', 'Animációk', animBody());
  props.innerHTML = h;
  bindProps(o);
}
props.addEventListener('click', e => {
  const t = e.target.closest('[data-sec-toggle]'); if (!t) return;
  const k = t.dataset.secToggle; secState[k] = !secState[k]; lsSet(LS.sections, JSON.stringify(secState));
  const sec = t.closest('.psec'); sec.classList.toggle('closed', !!secState[k]); t.setAttribute('aria-expanded', String(!secState[k]));
});
function syncGeometryInputs(o) {
  if (o.id !== sel) return;
  const set = (id, v) => { for (const el of [$('#' + id), $('#' + id + 'R')]) if (el && document.activeElement !== el) el.value = Math.round(v); };
  set('pX', o.x); set('pY', o.y); set('pW', o.w); set('pH', o.h); set('pR', o.rot > 180 ? o.rot - 360 : (o.rot || 0));
}
function bindProps(o) {
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
  on('propsX', 'click', () => panelVisible(false));
  on('pName', 'change', e => { tgt().name = e.target.value.trim() || 'Elrendezés'; commit(); });
  on('pShowM', 'change', e => { tgt().showMaster = e.target.checked; commit(); });
  on('pOwnBg', 'change', e => { const L = tgt(); L.ownBg = e.target.checked; if (L.ownBg && !L.background) { L.background = doc.master.background; L.bgColor = doc.master.bgColor; } commit(); });
  on('pBgColor', 'click', e => pickAnyColor(e.currentTarget, 'Háttérszín', tgt().bgColor || '#ffffff', c => { tgt().bgColor = c === 'none' ? '#ffffff' : c; commit(); }));
  props.querySelectorAll('.stsize').forEach(inp => inp.onchange = () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (v > 0) applyStyle(inp.dataset.st, {size: Math.round(v / 0.75 * 100) / 100}); });
  props.querySelectorAll('.stcolor').forEach(b => b.onclick = () => pickAnyColor(b, b.dataset.st === 'title' ? 'Címek színe' : 'Szöveg színe', stylesOf()[b.dataset.st].color, c => { if (c !== 'none') applyStyle(b.dataset.st, {color: c}); }));
  props.querySelectorAll('[data-stt]').forEach(b => b.onclick = () => applyStyle(b.dataset.st, {[b.dataset.stt]: !stylesOf()[b.dataset.st][b.dataset.stt]}));
  props.querySelectorAll('.stfont').forEach(sel_ => sel_.onchange = () => applyStyle(sel_.dataset.st, {font: sel_.value || null}));
  props.querySelectorAll('.stline').forEach(inp => inp.onchange = () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (v >= 0.8 && v <= 3) applyStyle(inp.dataset.st, {line: Math.round(v * 100) / 100}); });
  props.querySelectorAll('.stls').forEach(inp => inp.onchange = () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (isFinite(v)) applyStyle(inp.dataset.st, {letterSpacing: Math.round(v * 10) / 10}); });
  props.querySelectorAll('[data-stal]').forEach(b => b.onclick = () => applyStyle(b.dataset.st, {align: b.dataset.stal}));
  $('#tplToFile')?.addEventListener('click', templateToFile);
  $('#tplFromFile')?.addEventListener('click', () => templateFromFile());
  $('#tplUpdate')?.addEventListener('click', templateUpdateFile);
  on('pBaseFont', 'change', e => switchFont(e.target.value));
  props.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => applyPreset(b.dataset.preset));
  on('pBgPick', 'click', () => pickImage(key => { tgt().background = key; commit(); }));
  on('pBgClear', 'click', () => { tgt().background = null; commit(); });
  on('pPrompt', 'change', e => { o.prompt = e.target.value; commit(); });
  if (o) {
    let o0 = null;
    const SETTERS = {
      pX: v => moveObject(o, v - o.x, 0), pY: v => moveObject(o, 0, v - o.y),
      pW: v => { if (o.type === 'group') { o0 ??= clone(o); scaleFrom(o, o0, Math.max(16, v) / o0.w, o0.x, o0.y); } else o.w = Math.max(16, v); },
      pH: v => { if (o.type === 'group') { o0 ??= clone(o); scaleFrom(o, o0, Math.max(16, v) / o0.h, o0.x, o0.y); } else o.h = Math.max(16, v); },
      pR: v => { o.rot = ((v % 360) + 360) % 360; }, pSW: v => { o.strokeWidth = Math.max(0, v); if (v > 0 && !o.stroke) o.stroke = '#2f5d8a'; if (!v && o.shape !== 'line') o.stroke = null; },
      pRad: v => { o.radius = Math.max(0, v); }, pOp: v => { o.opacity = v >= 100 ? undefined : v / 100; }
    };
    for (const [id, set] of Object.entries(SETTERS)) for (const suffix of ['', 'R']) {
      const el = $('#' + id + suffix); if (!el) continue;
      el.addEventListener('input', () => { const v = parseFloat(el.value); if (!isFinite(v)) return; set(v); const twin = $('#' + id + (suffix ? '' : 'R')); if (twin) twin.value = el.value; updateObjLive(o); });
      el.addEventListener('change', () => { o0 = null; if (o.placeholder && mode === 'slides' && /p[XYWHR]$/.test(id)) o.phMoved = true; commit(); });
    }
  }
  // layers
  props.querySelectorAll('[data-arr]').forEach(b => b.onclick = () => ({group: groupSelected, ungroup: ungroupSelected})[b.dataset.arr]());
  props.querySelectorAll('[data-align]').forEach(b => b.onclick = () => alignObjects(b.dataset.align));
  props.querySelectorAll('.colbtn[data-pop]').forEach(b => b.onclick = () => showPop(b.dataset.pop, b));
  bindLayers();
  if (mode === 'slides') bindAnims();
}
/** Align the selected objects to each other (one object: to the slide), or distribute them evenly. */
function alignObjects(how) {
  const objs = selIds.map(objById).filter(o => o && !o.locked); if (!objs.length) return;
  if (editing) syncEditor();
  const bs = objs.map(bounds);
  let X0 = Math.min(...bs.map(b => b.x)), Y0 = Math.min(...bs.map(b => b.y)), X1 = Math.max(...bs.map(b => b.x + b.w)), Y1 = Math.max(...bs.map(b => b.y + b.h));
  if (objs.length === 1) { X0 = 0; Y0 = 0; X1 = W; Y1 = H; }
  if (how === 'dh' || how === 'dv') {
    const hz = how === 'dh', idx = objs.map((o, i) => i).sort((a, b) => hz ? bs[a].x - bs[b].x : bs[a].y - bs[b].y);
    const total = idx.reduce((t, i) => t + (hz ? bs[i].w : bs[i].h), 0), gap = ((hz ? X1 - X0 : Y1 - Y0) - total) / (objs.length - 1);
    let pos = hz ? X0 : Y0;
    for (const i of idx) { const d = Math.round(pos - (hz ? bs[i].x : bs[i].y)); moveObject(objs[i], hz ? d : 0, hz ? 0 : d); pos += (hz ? bs[i].w : bs[i].h) + gap; }
  } else objs.forEach((o, i) => {
    const b = bs[i], dx = how === 'l' ? X0 - b.x : how === 'c' ? (X0 + X1) / 2 - (b.x + b.w / 2) : how === 'r' ? X1 - (b.x + b.w) : 0;
    const dy = how === 't' ? Y0 - b.y : how === 'm' ? (Y0 + Y1) / 2 - (b.y + b.h / 2) : how === 'b' ? Y1 - (b.y + b.h) : 0;
    moveObject(o, Math.round(dx), Math.round(dy));
  });
  for (const o of objs) if (o.placeholder && mode === 'slides') o.phMoved = true;
  commit();
}
function reorder(fn) { const o = selObj(); if (!o || !tgt().objects.includes(o)) return; if (editing) syncEditor(); const a = tgt().objects, i = a.indexOf(o); a.splice(i, 1); a.splice(fn(i, a.length), 0, o); commit(); }
let dragId = null;
function bindLayers() {
  const list = $('#layerList'); if (!list) return;
  list.addEventListener('dragstart', e => { const r = e.target.closest('.lyr'); dragId = r?.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId || ''); r?.classList.add('dragging'); });
  list.addEventListener('dragend', () => { dragId = null; list.querySelectorAll('.lyr').forEach(r => r.classList.remove('dragging', 'above', 'below')); });
  list.addEventListener('dragover', e => {
    const r = e.target.closest('.lyr'); if (!r || !dragId) return; e.preventDefault();
    const below = e.clientY > r.getBoundingClientRect().top + r.offsetHeight / 2;
    list.querySelectorAll('.lyr').forEach(x => x.classList.remove('above', 'below'));
    if (r.dataset.id !== dragId) r.classList.add(below ? 'below' : 'above');
  });
  list.addEventListener('drop', e => {
    e.preventDefault(); const r = e.target.closest('.lyr'); if (!r || !dragId || r.dataset.id === dragId) return;
    if (editing) syncEditor();
    const below = r.classList.contains('below'), order = [...tgt().objects].reverse();
    const moving = order.splice(order.findIndex(o => o.id === dragId), 1)[0];
    order.splice(order.findIndex(o => o.id === r.dataset.id) + (below ? 1 : 0), 0, moving);
    tgt().objects = order.reverse(); setSel([moving.id]); dragId = null; commit();
  });
  list.addEventListener('click', e => {
    const lk = e.target.closest('[data-lock]'); if (lk) { toggleLock(lk.dataset.lock); return; }
    const hd = e.target.closest('[data-hide]'); if (hd) { toggleHidden(hd.dataset.hide); return; }
    const r = e.target.closest('.lyr'); if (!r) return;
    if (editing) exitEdit();
    const id = r.dataset.id;
    if (e.shiftKey || e.ctrlKey || e.metaKey) setSel(selIds.includes(id) ? selIds.filter(x => x !== id) : [...selIds, id]); else setSel([id]);
    curAnim = null; drawSelection(); renderProps(); updateRibbon();
  });
}

/* animations: cards, timeline */
const effectOptions = c0 => Object.entries(Anim.CLASSES).map(([c, label]) => `<optgroup label="${label}">${Object.entries(Anim.EFFECTS)
  .filter(([, e]) => e.cls === c).map(([k, e]) => `<option value="${k}" ${k === c0 ? 'selected' : ''}>${e.label}</option>`).join('')}</optgroup>`).join('');
const secs = ms => String(Math.round(ms / 100) / 10).replace('.', ',');
const rangeLabel = r => r ? (r[0] === r[1] ? r[0] : r[0] + '–' + r[1]) : '0';
/** Play one animation (all its parts) on the slide being edited, then put the slide back as it was. */
let previewing = null;
async function previewAnim(id) {
  if (mode !== 'slides' || editing || sh) return;
  const s_ = tgt(), items = Anim.expand(s_).filter(x => x.src === id); if (!items.length) return;
  const token = previewing = {}, running = [];
  const E = Anim.EFFECTS[items[0].effect];
  const po = objById(items[0].target);
  if (po && Anim.splitMode(s_, po)?.mode === 'parts') {
    const old = stage.querySelector(`.obj[data-id="${po.id}"]`);
    if (old) {
      partsSlide = s_; const neu = objEl(po, 'show'); partsSlide = null; old.replaceWith(neu);
      for (let t = 0; t < 60 && mathPending(neu); t++) await new Promise(r => setTimeout(r, 50));
      if (previewing !== token) return;
    }
  }
  for (const it of items) { const el = keyEl(stage, it.key); if (el && E.cls === 'entr') setVis(el, 'hidden'); }
  await new Promise(r => setTimeout(r, 120));
  for (const it of items) { if (previewing !== token) return; await playEffect(stage, {...it, delay: 0}, running); }
  await new Promise(r => setTimeout(r, E.cls === 'exit' ? 500 : 250));
  if (previewing === token) { running.forEach(a => a.cancel?.()); renderStage(); previewing = null; }
}
/** Play the slide's transition over the slide being edited (from the previous slide, or from black). */
function previewTransition() {
  const t = tgt().transition; if (!t || mode !== 'slides' || sh) return;
  if (editing) exitEdit();
  stageWrap.querySelector('.trprev')?.remove();
  const box = document.createElement('div'); box.className = 'trprev';
  Object.assign(box.style, {width: W + 'px', height: H + 'px', transform: `scale(${scale})`});
  const old = document.createElement('div'); old.className = 'slide';
  if (cur > 0) renderSlide(doc.slides[cur - 1], old, 'show'); else old.style.background = '#000';
  const el = document.createElement('div'); el.className = 'slide'; renderSlide(tgt(), el, 'show');
  box.append(old, el); stageWrap.appendChild(box);
  const d = playTransition(old, el, t, box);
  setTimeout(() => box.remove(), d + 150);
}
function addAnimation(effect, byParagraph) {
  const o = selObj(); if (!o || mode !== 'slides') return;
  if (editing) syncEditor();
  const a = {id: uid(), target: o.id, effect, trigger: 'click'};
  if (byParagraph && isText(o) && blockCount(o) > 1 && !o.rot) a.byParagraph = (tgt().anims || []).some(x => x.target === o.id && x.byParagraph === 'parts') ? 'parts' : true;
  if (groupOf(o.id)) return toast('Csoport tagja nem animálható külön – az egész csoportot animáld.');
  tgt().anims.push(a); curAnim = a.id; commit();
  requestAnimationFrame(() => previewAnim(a.id));
}
function timelineHTML(list) {
  const tl = Anim.timeline(list); if (!tl.length) return '';
  const nums = Anim.numbers(list), idx = new Map(list.map((a, i) => [a, i]));
  const Tm = Math.max(1000, ...tl.map(g => g.total)), step = Tm > 6000 ? 2000 : Tm > 3000 ? 1000 : 500;
  let ticks = ''; for (let t = 0; t <= Tm + 1; t += step) ticks += `<span style="left:${Math.min(t, Tm) / Tm * 100}%">${secs(t)}</span>`;
  let h = `<div class="tl"><div class="tl-axis"><span class="tl-lab">mp</span><div class="tl-ticks">${ticks}</div></div>`, click = 0;
  for (const g of tl) {
    h += `<div class="tl-step">${g.auto ? 'A dia megjelenésekor' : `${++click}. kattintás`}<span>${secs(g.total)} mp</span></div>`;
    for (const it of g.items) {
      if (it.a.part > 0 && !it.a.byParagraph) continue;
      const a = it.a, o = objById(a.target), E = Anim.EFFECTS[a.effect], left = it.start / Tm * 100, w = (it.end - it.start) / Tm * 100;
      const name = (o?.name ?? '') + (a.part != null && a.byParagraph ? ` ${o && Anim.splitMode(tgt(), o)?.mode === 'parts' ? '§' : '¶'}${a.part + 1}` : '');
      h += `<div class="tl-row${a.src === curAnim ? ' cur' : ''}" data-id="${a.src}" title="${esc(name)} – ${E.label}: ${secs(it.start)}–${secs(it.end)} mp">
        <span class="tl-lab"><span class="badge ${E.cls}">${nums[idx.get(a)]}</span>${esc(name)}</span>
        <div class="tl-track"><i class="${E.instant ? 'pt' : ''}" style="left:${left}%;width:${E.instant ? 0 : w}%;--c:${CLS_COLOR[E.cls]}"></i></div></div>`;
    }
  }
  return h + '</div>';
}
function animBody() {
  const s = tgt(), list = Anim.expand(s), rg = Anim.ranges(list), o = selObj();
  const rows = s.anims.map((a, i) => {
    const t = objById(a.target); if (!t) return '';
    const E = Anim.EFFECTS[a.effect], nb = isText(t) ? blockCount(t) : 1, np = isText(t) ? partCount(t) : 1, canPara = nb > 1;
    const rotOff = t.rot ? 'disabled title="Elforgatott szövegdoboznál nem érhető el"' : '';
    return `<div class="anim${a.id === curAnim ? ' cur' : ''}" data-id="${a.id}" style="--c:${CLS_COLOR[E.cls]}">
      <span class="badge ${E.cls}">${rangeLabel(rg[a.id])}</span><span class="name" title="${esc(t.name ?? '')}">${esc(t.name ?? '')}<small>${Anim.CLASSES[E.cls]}</small></span>
      <span class="ctl"><button data-act="up" title="Előrébb a sorban" ${i ? '' : 'disabled'}>▲</button><button data-act="down" title="Hátrébb a sorban" ${i < s.anims.length - 1 ? '' : 'disabled'}>▼</button><button data-act="del" title="Animáció törlése">✕</button></span>
      <select data-k="effect" aria-label="Effektus">${effectOptions(a.effect)}</select>
      ${E.dirs ? `<select data-k="dir" aria-label="Irány">${Object.entries(Anim.DIRS[E.dirs]).map(([k, l]) => `<option value="${k}" ${k === Anim.dirOf(a) ? 'selected' : ''}>Irány: ${l}</option>`).join('')}</select>` : ''}
      <select data-k="trigger" aria-label="Indítás">${Object.entries(Anim.TRIGGERS).map(([k, l]) => `<option value="${k}" ${k === a.trigger ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="times"><label class="fld">Időtartam (mp)<input type="text" inputmode="decimal" data-k="dur" value="${secs(Anim.durOf(a))}" ${E.instant ? 'disabled title="Ez az effektus azonnali"' : ''}></label>
        <label class="fld">Késleltetés (mp)<input type="text" inputmode="decimal" data-k="delay" value="${secs(Anim.delayOf(a))}"></label></div>
      ${canPara ? `<label class="chk opts"><input type="checkbox" data-k="byParagraph" ${a.byParagraph ? 'checked' : ''} ${rotOff}> Bekezdésenként</label>` : ''}
      ${np > nb ? `<label class="chk opts" title="A képlet új sora (\\\\), a nagy szóköz (\\quad, \\qquad) és a következtetésnyíl (⇒, ⇔) után új lépés kezdődik – összesen ${np} lépés"><input type="checkbox" data-k="byParts" ${a.byParagraph === 'parts' ? 'checked' : ''} ${rotOff}> Képletek részenként is (${np} lépés)</label>` : ''}
    </div>`;
  }).join('');
  const dis = o ? '' : 'disabled title="Előbb jelölj ki egy objektumot (vagy csoportot)"';
  return `${o ? `<div class="btnrow addrow"><button class="btn" data-add="entr" style="--c:${CLS_COLOR.entr}">+ Belépő</button><button class="btn" data-add="emph" style="--c:${CLS_COLOR.emph}">+ Kiemelés</button><button class="btn" data-add="exit" style="--c:${CLS_COLOR.exit}">+ Kilépő</button></div>`
      : '<div class="phint" style="margin:0 0 8px">Animáció hozzáadásához jelölj ki egy objektumot.</div>'}
    ${s.anims.length ? `<h4>Idővonal</h4>${timelineHTML(list)}` : ''}
    <div class="anim-list" id="animList">${rows || '<div class="phint" style="margin-top:0">Ezen a dián nincs animáció.</div>'}</div>
    <div class="btnrow"><button class="btn" id="aPlay">Lejátszás innen</button><label class="chk"><input type="checkbox" id="aBadges" ${showBadges ? 'checked' : ''}> Sorszámok a dián</label></div>`;
}
function bindAnims() {
  const s = tgt();
  props.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addAnimation(Anim.DEFAULT[b.dataset.add], false));
  $('#aPlay')?.addEventListener('click', () => startShow(cur));
  $('#aBadges')?.addEventListener('change', e => { showBadges = e.target.checked; lsSet(LS.badges, showBadges ? '1' : '0'); drawBadges(); });
  props.querySelector('.tl')?.addEventListener('click', e => {
    const r = e.target.closest('.tl-row'); if (!r) return;
    const a = s.anims.find(x => x.id === r.dataset.id); if (!a) return;
    if (editing && editing !== a.target) exitEdit();
    curAnim = a.id; setSel([a.target]); drawSelection(); renderProps(); updateRibbon();
    props.querySelector(`.anim[data-id="${a.id}"]`)?.scrollIntoView({block: 'nearest'});
  });
  const list = $('#animList'); if (!list) return;
  list.addEventListener('click', e => {
    const row = e.target.closest('.anim'); if (!row) return;
    const i = s.anims.findIndex(a => a.id === row.dataset.id), act = e.target.closest('button')?.dataset.act;
    if (act === 'up' && i > 0) { [s.anims[i - 1], s.anims[i]] = [s.anims[i], s.anims[i - 1]]; commit(); return; }
    if (act === 'down' && i < s.anims.length - 1) { [s.anims[i + 1], s.anims[i]] = [s.anims[i], s.anims[i + 1]]; commit(); return; }
    if (act === 'del') { s.anims.splice(i, 1); commit(); return; }
    if (!e.target.closest('select, input, label')) { if (editing && editing !== s.anims[i].target) exitEdit(); curAnim = s.anims[i].id; setSel([s.anims[i].target]); drawSelection(); renderProps(); updateRibbon(); }
  });
  list.addEventListener('change', e => {
    const row = e.target.closest('.anim'), a = s.anims.find(x => x.id === row.dataset.id), k = e.target.dataset.k;
    const num = v => parseFloat(String(v).replace(',', '.'));
    const tb = objById(a.target);
    if (k === 'byParagraph') a.byParagraph = e.target.checked || undefined;
    else if (k === 'byParts') a.byParagraph = e.target.checked ? 'parts' : (tb && isText(tb) && blockCount(tb) > 1) || undefined;
    else if (k === 'dur') a.dur = Math.min(60000, Math.max(100, Math.round(num(e.target.value) * 1000) || Anim.EFFECTS[a.effect].dur));
    else if (k === 'delay') a.delay = Math.max(0, Math.round(num(e.target.value) * 1000) || 0);
    else if (k === 'effect') { a.effect = e.target.value; delete a.dur; delete a.dir; }
    else a[k] = e.target.value;
    curAnim = a.id; commit();
    requestAnimationFrame(() => previewAnim(a.id));
  });
}

