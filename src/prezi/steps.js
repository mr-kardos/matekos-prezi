// Steps: a slide whose click steps are animations ⇄ one slide per step. The slideshow looks exactly the same either
// way: a step's animations play when its slide appears (automatically, without a slide transition), and the state a
// slide starts with is the state the step before ended with.
//
// Two small additions to the animation model make this exact (anim.js):
//   pieces: [i, …]  the animation drives only these pieces of a text box revealed in parts (paragraphs, formula parts);
//   pre: true       the animation is applied before the slide is shown (a piece already gone, an object already grown).
import { Anim } from './anim.js';
import { flatBlocks, blockPieceCounts, firstBlocks, deepParagraphs } from './parts.js';

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
/** The state a slide is shown with (before its automatic effects): visibility and growth after its pre effects. */
export function slideStatesBefore(b) {
  const list = Anim.expand(b), vis = {}, grow = {};
  for (const k of allKeys(b)) vis[k] = true;
  for (const k of Anim.initiallyHidden(list.filter(a => !a.pre))) vis[k] = false;
  for (const a of list.filter(x => x.pre)) { const c = Anim.EFFECTS[a.effect].cls; if (c === 'entr') vis[a.key] = true; else if (c === 'exit') vis[a.key] = false; else if (a.effect === 'grow') grow[a.key] = true; }
  return {vis, grow};
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
    // a text box revealed paragraph by paragraph: this slide's copy has only the paragraphs it shows (up to the last
    // one seen or animated here) – the later ones come on the later slides
    for (const [id, by] of Object.entries(splitOf)) {
      const so = s.objects.find(o => o.id === id), to = t.objects.find(o => o.id === idOf(id)); if (!so || !to || so.type !== 'text') continue;
      const counts = blockPieceCounts(so, by === 'parts'), keys = Anim.pieceKeys(s, so);
      if (keys.length !== counts.reduce((a, b) => a + b, 0)) continue;           // the box is not cut into these pieces
      const used = new Set(items.filter(a => a.target === id && a.part != null).map(a => a.part));
      let last = -1;
      keys.forEach((k, i) => { if (start.vis[k] || states[j].vis[k] || used.has(i)) last = i; });
      if (last < 0) continue;
      let nb = 0, acc = 0; while (acc <= last) acc += counts[nb++];                // the blocks up to that piece
      if (nb >= counts.length || !cutSafe(so.doc, nb)) continue;
      to.doc = firstBlocks(so.doc, nb);
      // effects of the pieces that are left out go too
      t.anims = t.anims.filter(a => a.target !== to.id || !Array.isArray(a.pieces) || a.pieces.every(i => i < acc) || (a.pieces = a.pieces.filter(i => i < acc)).length);
    }
    out.push(t);
  }
  return out;
}
/** Cutting the box after block n changes nothing that is seen: a numbered list keeps the room of its widest number. */
function cutSafe(doc, n) {
  let k = 0;
  for (const b of doc?.content ?? []) {
    const items = (b.type === 'bulletList' || b.type === 'orderedList') && b.content?.length ? b.content.length : 1;
    if (b.type === 'orderedList' && k < n && n < k + items && String(items).length !== String(n - k).length) return false;
    k += items;
  }
  return true;
}

/* ---------- one animated slide from the slides of its steps ----------
   A slide is the next step of the slide before when it only adds: everything seen on the slide before is still there
   (at the same place, in the same look, in the same state), and a text box may grow – it continues the box before
   paragraph by paragraph (also inside a list item; its width may change). The merged slide has one object for each
   object of the run (a growing text box: one box, with its last text), the things that come at a step appear at its
   click ("Megjelenés"; a growing box: piece by piece, "bekezdésenként"), and the slides' own effects stay. Nothing is
   ever made to disappear for this. */
const near = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) <= 0.5;
const sameBox = (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h) && near(a.rot, b.rot) && (a.opacity ?? 1) === (b.opacity ?? 1);
const looks = (o, skip = []) => { const r = {}; for (const k of Object.keys(o).sort()) if (!['id', 'name', 'doc', 'h', 'cmt', ...skip].includes(k)) r[k] = o[k]; return JSON.stringify(r); };
/** A piece of a document without its unset settings (null / false / empty: the same as not written – files differ in this). */
function norm(x) {
  if (Array.isArray(x)) return x.map(norm);
  if (!x || typeof x !== 'object') return x;
  const out = {};
  for (const k of Object.keys(x).sort()) {
    let v = x[k]; if (v === null || v === false || v === '' || v === undefined) continue;
    v = norm(v); if (k === 'attrs' && v && typeof v === 'object' && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}
/** The paragraphs of a box as comparable strings (with the lists around them); empty paragraphs at the end left out. */
function paraSigs(doc) {
  const ps = deepParagraphs(doc).map(x => JSON.stringify(norm({p: x.p, path: x.path})));
  while (ps.length && deepParagraphs(doc)[ps.length - 1] && !(deepParagraphs(doc)[ps.length - 1].p.content || []).length) ps.pop();
  return ps;
}
/** Does text box b continue text box a (the same paragraphs, maybe more after them; same place and look, any width)? */
function continues(oa, ob) {
  if (oa.type !== 'text' || ob.type !== 'text' || looks(oa, ['w']) !== looks(ob, ['w'])) return false;
  const pa = paraSigs(oa.doc), pb = paraSigs(ob.doc);
  return pb.length >= pa.length && pa.every((x, i) => x === pb[i]);
}
/** Objects of b matched to objects of a: Map(b.id → a.id) – the same object, or a text box continued. */
function matchObjects(a, b, sigOf) {
  const m = new Map(), taken = new Set();
  for (const ob of b.objects) {
    const oa = a.objects.find(o => !taken.has(o.id) && sigOf(o) === sigOf(ob) && sameBox(o, ob));
    if (oa) { m.set(ob.id, oa.id); taken.add(oa.id); }
  }
  for (const ob of b.objects) {
    if (m.has(ob.id)) continue;
    const oa = a.objects.find(o => !taken.has(o.id) && continues(o, ob));
    if (oa) { m.set(ob.id, oa.id); taken.add(oa.id); }
  }
  return m;
}
/** How a box is cut into pieces on its slide: 'parts', 'deep', true (blocks) or null (not cut). */
const modeOf = (slide, o) => { const x = Anim.splitMode(slide, o); return x ? (x.mode === 'para' ? true : x.mode) : null; };
/** The paragraphs (indices in the box's paragraph list) a piece of a box stands for, in a given mode. */
function pieceParas(o, mode) {
  const deep = deepParagraphs(o.doc), n = deep.length;
  if (mode === 'deep') return Array.from({length: n}, (_, i) => [i]);
  // blocks: a top-level paragraph, or a list item with everything inside it (its paragraphs, lists in it)
  const out = []; let k = 0;
  for (const b of o.doc?.content ?? []) {
    const count = x => deepParagraphs({content: [x]}).length;
    if ((b.type === 'bulletList' || b.type === 'orderedList') && b.content?.length) for (const li of b.content) { const c = deepParagraphs({content: [{...b, content: [li]}]}).length; out.push(Array.from({length: c}, (_, i) => k + i)); k += c; }
    else { const c = Math.max(1, count(b)); out.push(Array.from({length: c}, (_, i) => k + i)); k += c; }
  }
  if (mode === 'parts') { const counts = blockPieceCounts(o, true), res = []; out.forEach((ps, bi) => { for (let j = 0; j < counts[bi]; j++) res.push(ps); }); return res; }
  return out;
}

/* A run of slides as "chains": the same object through the slides. */
function buildChains(slides, sigOf) {
  const chains = [], at = [new Map()];
  for (const o of slides[0].objects) { const c = {v: new Map([[0, o]])}; chains.push(c); at[0].set(o.id, c); }
  for (let i = 1; i < slides.length; i++) {
    const m = matchObjects(slides[i - 1], slides[i], sigOf), here = new Map();
    let after = null;
    for (const ob of slides[i].objects) {
      let c = m.has(ob.id) ? at[i - 1].get(m.get(ob.id)) : null;
      if (!c) { c = {v: new Map()}; chains.splice(after ? chains.indexOf(after) + 1 : 0, 0, c); }
      c.v.set(i, ob); here.set(ob.id, c); after = c;
    }
    at.push(here);
  }
  return {chains, at};
}
/** The merged piece space of a chain: mode, and its last (longest) version. null: the chain cannot be one object. */
function chainPlan(chain, slides) {
  const vs = [...chain.v.entries()], last = vs[vs.length - 1][1];
  if (last.type !== 'text') return {mode: null, last};
  const grows = vs.some(([, o]) => JSON.stringify(paraSigs(o.doc)) !== JSON.stringify(paraSigs(last.doc)));
  const modes = vs.map(([i, o]) => modeOf(slides[i], o)).filter(Boolean);
  if (!grows && !modes.length) return {mode: null, last};
  if (modes.includes('parts')) {
    // formula parts: only when every version is cut the same way at its blocks (the pieces keep their numbers)
    if (modes.some(x => x === 'deep')) return null;
    const bl = o => blockPieceCounts(o, true); const L = bl(last);
    if (vs.some(([, o]) => bl(o).some((c, k) => c !== L[k] && k < bl(o).length - 0))) return null;
    return {mode: 'parts', last};
  }
  // blocks are enough when every step ends at the end of a block (and nothing is cut finer); otherwise every paragraph
  const blocks = pieceParas(last, true), ends = new Set(blocks.map(ps => ps[ps.length - 1] + 1));
  const fine = modes.includes('deep') || vs.some(([, o]) => { const n = paraSigs(o.doc).length; return n && !ends.has(n); });
  return {mode: fine ? 'deep' : true, last};
}
/** The merged pieces (indices) a key of a version stands for. */
function mapKey(key, ver, slide, plan) {
  const part = keyPart(key);
  if (!plan.mode) return null;                                       // not cut: the whole object
  const mine = modeOf(slide, ver), own = pieceParas(ver, mine || true), real = paraSigs(ver.doc).length;
  // the empty paragraphs at the end of a version are not part of the text that goes on
  const paras = (mine && part != null ? (own[part] || []) : own.flat()).filter(x => x < real);
  const target = pieceParas(plan.last, plan.mode), out = [];
  target.forEach((ps, i) => { if (ps.some(x => paras.includes(x))) out.push(i); });
  if (plan.mode === 'parts' && mine === 'parts' && part != null) return [part];
  return [...new Set(out)];
}
/** What is seen of every chain at a state of slide i: Map(chain → Set of merged pieces | 'all' | null). */
function seenOf(chains, plans, slides, i, state) {
  const out = new Map();
  chains.forEach((c, ci) => {
    const ver = c.v.get(i); if (!ver) { out.set(c, null); return; }
    const plan = plans[ci], keys = Anim.pieceKeys(slides[i], ver);
    if (!plan.mode) { out.set(c, keys.some(k => state.vis[k]) ? 'all' : null); return; }
    const set = new Set(); for (const k of keys) if (state.vis[k]) mapKey(k, ver, slides[i], plan).forEach(x => set.add(x));
    out.set(c, set);
  });
  return out;
}
const growOf = (chains, slides, i, state) => new Map(chains.map(c => { const v = c.v.get(i); return [c, v ? Anim.pieceKeys(slides[i], v).some(k => state.grow[k]) : false]; }));

/** Can the run of slides be one slide? Returns {chains, plans} or null. */
function analyse(slides, sigOf) {
  for (let i = 1; i < slides.length; i++) {
    const a = slides[i - 1], b = slides[i];
    if (b.transition && b.transition.type && b.transition.type !== 'none') return null;
    if (a.template !== b.template || JSON.stringify(a.bg ?? null) !== JSON.stringify(b.bg ?? null)) return null;
  }
  const {chains} = buildChains(slides, sigOf), plans = chains.map(c => chainPlan(c, slides));
  if (plans.some(p => !p)) return null;
  for (let i = 1; i < slides.length; i++) {
    const end = seenOf(chains, plans, slides, i - 1, slideStates(slides[i - 1]).at(-1)), start = seenOf(chains, plans, slides, i, slideStatesBefore(slides[i]));
    const gEnd = growOf(chains, slides, i - 1, slideStates(slides[i - 1]).at(-1)), gStart = growOf(chains, slides, i, slideStatesBefore(slides[i]));
    let change = false, kept = false;
    for (const c of chains) {
      const e = end.get(c), s0 = start.get(c);
      if (e && (e === 'all' || e.size)) {                            // seen at the end of a: must still be seen when b appears
        if (!s0 || (e === 'all' ? s0 !== 'all' : s0 === 'all' ? false : [...e].some(x => !s0.has(x)))) return null;
        kept = true;
        if (gEnd.get(c) !== gStart.get(c)) return null;              // growing cannot be undone at a step
      }
      if (s0 && (s0 === 'all' ? e !== 'all' : [...s0].some(x => !(e && e !== 'all' && e.has(x))) && e !== 'all')) change = true;
    }
    const g = Anim.groups(Anim.expand(slides[i]).filter(x => !x.pre));
    if (!kept || (!change && !g[0]?.auto)) return null;
  }
  return {chains, plans};
}
/** Can slide b be the next step of slide a? */
export const isNextStep = (a, b, sigOf) => analyse([a, b], sigOf) ? true : null;
/** Runs of slides that are steps of one another: [[i, i+1, …], …] (only runs of two or more). */
export function findRuns(slides, sigOf) {
  const runs = []; let cur = [0];
  for (let i = 1; i < slides.length; i++) {
    if (analyse([...cur.map(k => slides[k]), slides[i]], sigOf)) cur.push(i);
    else { if (cur.length > 1) runs.push(cur); cur = [i]; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}
/** One slide from a run of step slides. h: {uid, sigOf} */
export function mergeRun(slides, h) {
  const r = analyse(slides, h.sigOf); if (!r) throw new Error('not a run of steps');
  const {chains, plans} = r;
  const s0 = slides[0], ids = chains.map(c => c.v.has(0) ? c.v.get(0).id : h.uid());
  const objects = chains.map((c, ci) => { const o = clone(plans[ci].last); o.id = ids[ci]; if (!c.v.has(0)) delete o.cmt; return o; });
  const anims = [];
  const emit = (ci, pieces, base, trigger) => {                      // one effect; more pieces: the first one starts it, the others go with it
    const plan = plans[ci];
    if (!plan.mode || pieces == null) { anims.push({...base, id: h.uid(), target: ids[ci], trigger}); return; }
    pieces.forEach((p, k) => anims.push({...base, id: h.uid(), target: ids[ci], trigger: k ? 'with' : trigger, byParagraph: plan.mode, pieces: [p]}));
  };
  const effectOf = a => { const {id, target, key, src, part, pieces, byParagraph, trigger, pre, ...rest} = a; return rest; };
  for (let i = 0; i < slides.length; i++) {
    const sl = slides[i], items = Anim.expand(sl).filter(x => !x.pre), g = Anim.groups(items);
    let first = true;
    if (i > 0) {
      // what comes at this click: everything seen when the slide appears that was not seen at the end of the one before
      const end = seenOf(chains, plans, slides, i - 1, slideStates(slides[i - 1]).at(-1)), start = seenOf(chains, plans, slides, i, slideStatesBefore(sl));
      chains.forEach((c, ci) => {
        const e = end.get(c), st = start.get(c); if (!st) return;
        if (st === 'all') { if (e !== 'all') { emit(ci, null, {effect: 'appear', dur: 0, delay: 0}, first ? 'click' : 'with'); first = false; } return; }
        const add = [...st].filter(x => !(e && e !== 'all' && e.has(x))).sort((x, y) => x - y);
        if (add.length) { emit(ci, add, {effect: 'appear', dur: 0, delay: 0}, first ? 'click' : 'with'); first = false; }
      });
    }
    // the slide's own effects (its automatic ones start with the click that brought the slide)
    items.forEach((a, k) => {
      const ci = chains.findIndex(c => c.v.get(i)?.id === keyObj(a.key) || (c.v.get(i)?.type === 'group' && JSON.stringify(c.v.get(i)).includes(`"id":"${keyObj(a.key)}"`)));
      if (ci < 0) return;
      let trigger = a.trigger;
      if (i > 0 && k === 0 && g[0]?.auto) trigger = first ? 'click' : 'with';
      const ver = chains[ci].v.get(i), pieces = plans[ci].mode ? mapKey(a.key, ver, sl, plans[ci]) : null;
      emit(ci, pieces, effectOf(a), trigger);
    });
  }
  return compact({...clone(s0), objects, anims});
}
/** Effects of one box that each reveal the next piece at a click of their own: one "by paragraph" effect. */
function compact(slide) {
  const out = [];
  for (const a of slide.anims) {
    const p = out[out.length - 1], one = x => Array.isArray(x.pieces) && x.trigger === 'click' && x.byParagraph;
    if (p && one(p) && one(a) && a.pieces.length === 1 && p.target === a.target && p.effect === a.effect && p.byParagraph === a.byParagraph
        && (p.dir ?? null) === (a.dir ?? null) && (p.dur ?? null) === (a.dur ?? null) && (p.delay ?? null) === (a.delay ?? null) && a.pieces[0] === p.pieces[p.pieces.length - 1] + 1) { p.pieces = [...p.pieces, a.pieces[0]]; continue; }
    out.push(a);
  }
  return {...slide, anims: out};
}
