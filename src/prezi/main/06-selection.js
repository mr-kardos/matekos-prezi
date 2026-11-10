/* ================================================================== selection frame + animation badges */
const HANDLES_FULL = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], HANDLES_W = ['nw', 'ne', 'e', 'se', 'sw', 'w'];
function drawSelection() {
  drawComments(); drawKept(); drawMarksSoon(); drawSpellSoon(150);
  // a selected table shows its invisible borders (red dashed)
  stage.querySelectorAll('.obj.table.tblsel').forEach(x => x.classList.remove('tblsel'));
  for (const id of selIds) stage.querySelector(`.obj.table[data-id="${id}"]`)?.classList.add('tblsel');
  stage.querySelectorAll('.self').forEach(x => x.remove());
  const objs = selIds.map(objById).filter(Boolean);
  if (!objs.length) return;
  const frame = (o, cls) => {
    const d = document.createElement('div'); d.className = 'self ' + cls;
    const g = groupOf(o.id);   // a member being edited inside a group: absolute position
    Object.assign(d.style, {left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px', transform: o.rot ? `rotate(${o.rot}deg)` : ''});
    stage.appendChild(d); return d;
  };
  if (objs.length > 1) {                        // several: a thin frame for each and one frame around all
    objs.forEach(o => frame(o, 'multi'));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of objs) { const b = bounds(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const d = frame({x: x0, y: y0, w: x1 - x0, h: y1 - y0}, 'all');
    d.innerHTML = '<div class="stem"></div><div class="h move" data-h="move" title="A kijelöltek mozgatása">' + svgIcon('move') + '</div>';
    return;
  }
  const o = objs[0], d = frame(o, 'one' + (editing === o.id ? ' editing' : '') + (o.locked ? ' locked' : '') + (cropping === o.id ? ' cropping' : ''));
  if (cropping === o.id) drawCropGhost(); else stage.querySelectorAll('.cropghost').forEach(x => x.remove());
  d.id = 'sel';
  if (o.locked) return;
  const widthOnly = isText(o) || o.shape === 'line', hs = widthOnly ? HANDLES_W : HANDLES_FULL;
  const pos = {nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50]};
  const cr = {nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew'};
  d.innerHTML = '<div class="stem"></div><div class="h move" data-h="move" title="Mozgatás (Alt: illesztés nélkül)">' + svgIcon('move') + '</div>'
    + (o.shape === 'line' ? ['e', 'w'] : hs).map(h => `<div class="h" data-h="${h}" style="left:${pos[h][0]}%;top:${pos[h][1]}%;cursor:${cr[h]}-resize"></div>`).join('');
}
function drawBadges() {
  stage.querySelectorAll('.badges').forEach(b => b.remove());
  if (mode !== 'slides' || !showBadges) return;
  const s = tgt(), rg = Anim.ranges(Anim.expand(s)), map = {};
  for (const a of s.anims) if (rg[a.id]) (map[a.target] ??= []).push({r: rg[a.id], cls: Anim.EFFECTS[a.effect].cls});
  for (const [id, arr] of Object.entries(map)) {
    const o = objById(id); if (!o || o.hidden) continue;
    const b = document.createElement('div'), bb = bounds(o); b.className = 'badges';
    Object.assign(b.style, {left: bb.x + 'px', top: bb.y + 'px'});
    b.innerHTML = arr.map(({r, cls}) => `<span class="badge ${cls}" title="${Anim.CLASSES[cls]}">${r[0] === r[1] ? r[0] : r[0] + '–' + r[1]}</span>`).join('');
    stage.appendChild(b);
  }
}

