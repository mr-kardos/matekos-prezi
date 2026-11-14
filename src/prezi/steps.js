// Steps: a slide whose click steps are animations ⇄ one slide per step. The slideshow looks exactly the same either
// way: a step's animations play when its slide appears (automatically, without a slide transition), and the state a
// slide starts with is the state the step before ended with.
//
// Two small additions to the animation model make this exact (anim.js):
//   pieces: [i, …]  the animation drives only these pieces of a text box revealed in parts (paragraphs, formula parts);
//   pre: true       the animation is applied before the slide is shown (a piece already gone, an object already grown).
import { Anim } from './anim.js';

const clone = x => JSON.parse(JSON.stringify(x));
const keyPart = k => { const i = k.indexOf('#'); return i < 0 ? null : +k.slice(i + 1); };
const keyObj = k => { const i = k.indexOf('#'); return i < 0 ? k : k.slice(0, i); };

/** The objects (top level) whose pieces a key may be: the key of a group's child is the child's id. */
function ownerOf(slide, key) {
  const id = keyObj(key);
  for (const o of slide.objects) {
    if (o.id === id) return o;
    if (o.type === 'group' && JSON.stringify(o.children).includes(`"id":"${id}"`)) return o;
  }
  return null;
}

/* ---------- the state of a slide ---------- */
/** Every key of the slide (pieces of split text boxes, children of groups). */
const allKeys = slide => slide.objects.flatMap(o => Anim.pieceKeys(slide, o));
/** The states of a slide: [after the start (pre + automatic group), after click 1, …]; each {vis: {key: bool}, grow: {key: bool}}. */
export function slideStates(slide) {
  const list = Anim.expand(slide), vis = {}, grow = {};
  for (const k of allKeys(slide)) vis[k] = true;
  for (const k of Anim.initiallyHidden(list.filter(a => !a.pre))) vis[k] = false;
  const apply = a => { const c = Anim.EFFECTS[a.effect].cls; if (c === 'entr') vis[a.key] = true; else if (c === 'exit') vis[a.key] = false; else if (a.effect === 'grow') grow[a.key] = true; };
  // pre: the first effect of a key may be a pre one – then the key starts visible (initiallyHidden above ignored it)
  list.filter(a => a.pre).forEach(apply);
  const groups = Anim.groups(list.filter(a => !a.pre)), out = [];
  let gi = 0;
  if (groups[0]?.auto) groups[gi++].chains.flat().forEach(apply);
  out.push({vis: {...vis}, grow: {...grow}});
  for (; gi < groups.length; gi++) { groups[gi].chains.flat().forEach(apply); out.push({vis: {...vis}, grow: {...grow}}); }
  return out;
}
/** The number of clicks a slide takes. */
export const clicksOf = slide => { const g = Anim.groups(Anim.expand(slide).filter(a => !a.pre)); return g.length - (g[0]?.auto ? 1 : 0); };

/* ---------- one slide per step ---------- */
/** The animation of one expanded item (one piece, or a whole object), with its own trigger. */
function itemAnim(a, trigger, uid, extra = {}) {
  const {key, src, part, ...rest} = a;
  const out = {...rest, id: uid(), trigger, ...extra};
  delete out.pre;
  if (part != null) out.pieces = [part]; else delete out.pieces;
  return out;
}
/** The slides of one slide's steps (the slide itself when it has no click steps). h: {uid, reid(obj, map)} */
export function splitSlide(s, h) {
  const list = Anim.expand(s), groups = Anim.groups(list.filter(a => !a.pre));
  const autoFirst = groups[0]?.auto ? 1 : 0, clicks = groups.length - autoFirst;
  if (!clicks) return [s];
  const states = slideStates(s), initial = slideStatesBefore(s), out = [];
  const splitOf = {};                                    // text boxes revealed in parts: their mode (byParagraph value)
  for (const a of s.anims) if (a.byParagraph) splitOf[a.target] = a.byParagraph === 'parts' || splitOf[a.target] === 'parts' ? 'parts' : true;
  for (let j = 0; j <= clicks; j++) {
    // the state this slide starts with, and the step it plays when it appears
    const start = j === 0 ? initial : states[j - 1];
    const step = j === 0 ? (autoFirst ? groups[0] : null) : groups[autoFirst + j - 1];
    const items = step ? step.chains.flat() : [];
    const t = clone(s), map = new Map();
    if (j > 0) {
      t.id = h.uid(); t.transition = null; delete t.cmt;
      t.objects.forEach(o => h.reid(o, map));
    }
    const idOf = id => map.get(id) || id;
    const anims = [];
    {
      // keys already gone / grown: applied before the slide is shown; objects gone for good are left out
      const used = new Set(items.map(a => a.key)), firstNow = {};
      for (const a of items) if (!(a.key in firstNow)) firstNow[a.key] = Anim.EFFECTS[a.effect].cls;
      const drop = new Set();
      for (const o of s.objects) {
        const keys = Anim.pieceKeys(s, o);
        if (keys.every(k => !start.vis[k] && !used.has(k))) { drop.add(o.id); continue; }
        const by = splitOf[o.id];
        for (const k of keys) {
          const part = keyPart(k), base = {target: idOf(o.id), dur: 0, delay: 0, ...(by ? {byParagraph: by} : {}), ...(part != null ? {pieces: [part]} : {})};
          if (!start.vis[k] && firstNow[k] !== 'entr') anims.push({id: h.uid(), ...base, effect: 'disappear', trigger: 'with', pre: true});
          if (start.grow[k]) anims.push({id: h.uid(), ...base, effect: 'grow', trigger: 'with', pre: true});
        }
      }
      t.objects = t.objects.filter(o => ![...drop].some(id => idOf(id) === o.id));
    }
    // the step: its first effect starts with the slide, the others keep their own timing
    items.forEach((a, k) => anims.push(itemAnim({...a, target: idOf(a.target)}, k === 0 ? 'with' : a.trigger, h.uid)));
    // keep the cutting into pieces where the step itself does not say it (a box shown in part, no effect of it now)
    for (const [id, by] of Object.entries(splitOf)) {
      const tid = idOf(id);
      if (t.objects.some(o => o.id === tid) && !anims.some(a => a.target === tid && a.byParagraph)) {
        const keys = Anim.pieceKeys(s, s.objects.find(o => o.id === id));
        const shown = keys.map(k => start.vis[k]);
        if (shown.some(v => !v)) anims.forEach(a => { if (a.target === tid) a.byParagraph = by; });
      }
    }
    t.anims = anims;
    out.push(t);
  }
  return out;
}

/* ---------- one animated slide from the slides of its steps ---------- */
const near = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) <= 0.5;
const sameBox = (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h) && near(a.rot, b.rot) && (a.opacity ?? 1) === (b.opacity ?? 1);
/** Objects of b matched to objects of a: Map(b.id → a.id) – the same content at the same place. */
function matchObjects(a, b, sigOf) {
  const m = new Map(), taken = new Set();
  for (const ob of b.objects) {
    const oa = a.objects.find(o => !taken.has(o.id) && sigOf(o) === sigOf(ob) && sameBox(o, ob));
    if (oa) { m.set(ob.id, oa.id); taken.add(oa.id); }
  }
  return m;
}
const mapKey = (k, m) => { const id = keyObj(k), p = keyPart(k), n = m.get(id); return n ? (p == null ? n : `${n}#${p}`) : null; };
/** Can slide b be the next step of slide a? (Then the slideshow could show it on the same slide.) */
export function isNextStep(a, b, sigOf) {
  if (!a || !b || (b.transition && b.transition.type && b.transition.type !== 'none') || a.template !== b.template) return null;
  if (JSON.stringify(a.bg ?? null) !== JSON.stringify(b.bg ?? null)) return null;
  const m = matchObjects(a, b, sigOf);
  if (!m.size) return null;
  const end = slideStates(a).at(-1), bStart = slideStatesBefore(b);
  // everything visible at the end of a must be at the same place in b, in the same state when b appears
  for (const o of a.objects) for (const k of Anim.pieceKeys(a, o)) {
    if (!end.vis[k]) continue;
    const bo = [...m].find(([, aid]) => aid === o.id); if (!bo) return null;
  }
  const inv = new Map([...m].map(([bid, aid]) => [aid, bid]));
  for (const o of a.objects) {
    if (!inv.has(o.id)) continue;
    const bo = b.objects.find(q => q.id === inv.get(o.id));
    const ka = Anim.pieceKeys(a, o), kb = Anim.pieceKeys(b, bo);
    if (ka.length !== kb.length && ka.length > 1 && kb.length > 1) return null;      // cut into a different number of pieces
    // growing cannot be undone at a step: the grown state must go on
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) { const x = ka[Math.min(i, ka.length - 1)], y = kb[Math.min(i, kb.length - 1)]; if (!!end.grow[x] !== !!bStart.grow[y]) return null; }
  }
  // a step must show something when b appears: a change, or effects that start with it
  const changes = stepChanges(a, b, m), g = Anim.groups(Anim.expand(b).filter(x => !x.pre));
  if (!changes.length && !g[0]?.auto) return null;
  return m;
}
/** The state b is shown with (before its automatic effects): visibility and growth after its pre effects. */
export function slideStatesBefore(b) {
  const list = Anim.expand(b), vis = {}, grow = {};
  for (const k of allKeys(b)) vis[k] = true;
  for (const k of Anim.initiallyHidden(list.filter(a => !a.pre))) vis[k] = false;
  for (const a of list.filter(x => x.pre)) { const c = Anim.EFFECTS[a.effect].cls; if (c === 'entr') vis[a.key] = true; else if (c === 'exit') vis[a.key] = false; else if (a.effect === 'grow') grow[a.key] = true; }
  return {vis, grow};
}
/** What changes at the switch from a (end) to b (shown): [{key (in a's or b's ids), show: bool, inA}] */
function stepChanges(a, b, m) {
  const end = slideStates(a).at(-1), st = slideStatesBefore(b), out = [], inv = new Map([...m].map(([bid, aid]) => [aid, bid]));
  for (const o of b.objects) {
    const aid = m.get(o.id), kb = Anim.pieceKeys(b, o);
    if (!aid) { for (const k of kb) if (st.vis[k]) out.push({bkey: k, show: true}); continue; }
    const ao = a.objects.find(q => q.id === aid), ka = Anim.pieceKeys(a, ao);
    kb.forEach((k, i) => { const ak = ka[Math.min(i, ka.length - 1)]; const va = !!end.vis[ak], vb = !!st.vis[k]; if (va !== vb) out.push({bkey: k, show: vb}); });
  }
  void inv;
  return out;
}
/** Runs of slides that are steps of one another: [[i, i+1, …], …] (only runs of two or more). */
export function findRuns(slides, sigOf) {
  const runs = []; let cur = [0];
  for (let i = 1; i < slides.length; i++) {
    if (isNextStep(slides[i - 1], slides[i], sigOf)) cur.push(i);
    else { if (cur.length > 1) runs.push(cur); cur = [i]; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}
/** One slide from a run of step slides. h: {uid, sigOf} */
export function mergeRun(slides, h) {
  const m0 = clone(slides[0]);
  const merged = {...m0, anims: clone(m0.anims)};
  let prev = slides[0], idMap = new Map(m0.objects.map(o => [o.id, o.id]));   // ids of prev → ids in merged
  for (let i = 1; i < slides.length; i++) {
    const b = slides[i], m = isNextStep(prev, b, h.sigOf); if (!m) throw new Error('not a step');
    const bm = new Map();                                // ids of b → ids in merged
    // b's objects: the matched ones are the merged ones; new ones are added (in b's stacking order)
    let after = null;
    for (const ob of b.objects) {
      const aid = m.get(ob.id);
      if (aid) { bm.set(ob.id, idMap.get(aid)); after = idMap.get(aid); continue; }
      const no = clone(ob); no.id = h.uid(); delete no.cmt; bm.set(ob.id, no.id);
      const at = after ? merged.objects.findIndex(o => o.id === after) + 1 : 0;
      merged.objects.splice(at, 0, no); after = no.id;
    }
    // the click: what appears / disappears when b is shown, then b's own effects (its automatic ones go with the click)
    const anims = [], splitOf = {};
    for (const x of b.anims) if (x.byParagraph) splitOf[x.target] = x.byParagraph;
    for (const c of stepChanges(prev, b, m)) {
      const id = bm.get(keyObj(c.bkey)), part = keyPart(c.bkey), by = splitOf[keyObj(c.bkey)];
      anims.push({id: h.uid(), target: id, effect: c.show ? 'appear' : 'disappear', trigger: anims.length ? 'with' : 'click', dur: 0, delay: 0,
        ...(by ? {byParagraph: by} : {}), ...(part != null ? {pieces: [part]} : {})});
    }
    const own = b.anims.filter(x => !x.pre).map(x => ({...clone(x), id: h.uid(), target: bm.get(x.target) ?? x.target}));
    const g = Anim.groups(Anim.expand(b).filter(x => !x.pre));
    // b's effects that start when b appears go with the step's click (or are that click, when nothing changes at the
    // switch); b's own clicks stay clicks
    if (own.length && g[0]?.auto) own[0].trigger = anims.length ? 'with' : 'click';
    merged.anims.push(...anims, ...own);
    // b's objects that only b had and that are no longer needed are kept: they are hidden by their effects
    prev = b;
    idMap = new Map([...bm]);
  }
  return merged;
}
