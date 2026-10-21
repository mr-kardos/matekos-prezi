// Animation model – shared by the editor (badges, timeline), the slideshow preview and the PPTX exporter.
import { blockCount } from "./model.js";

export const Anim = (() => {
  // cls: entr = belépő, emph = kiemelés, exit = kilépő. id/sub = PowerPoint preset ids.
  const EFFECTS = {
    appear:    {cls: 'entr', label: 'Megjelenés',            id: 1,  sub: 0, dur: 0,    instant: true},
    fade:      {cls: 'entr', label: 'Elhalványulás',         id: 10, sub: 0, dur: 500},
    fly:       {cls: 'entr', label: 'Beúszás',               id: 2,  sub: 4, dur: 500,  dirs: 'fly'},
    float:     {cls: 'entr', label: 'Belebegés',             id: 42, sub: 0, dur: 1000, dirs: 'float'},
    wipe:      {cls: 'entr', label: 'Törlés balról',         id: 22, sub: 8, dur: 500},
    pulse:     {cls: 'emph', label: 'Lüktetés',              id: 26, sub: 0, dur: 500},
    grow:      {cls: 'emph', label: 'Nagyítás (150%)',       id: 6,  sub: 0, dur: 1000},
    spin:      {cls: 'emph', label: 'Forgás (360°)',         id: 8,  sub: 0, dur: 1000},
    disappear: {cls: 'exit', label: 'Eltűnés',               id: 1,  sub: 0, dur: 0,    instant: true},
    fadeOut:   {cls: 'exit', label: 'Elhalványulás',         id: 10, sub: 0, dur: 500},
    flyOut:    {cls: 'exit', label: 'Kiúszás',               id: 2,  sub: 4, dur: 500,  dirs: 'fly'},
    play:      {cls: 'mediacall', label: 'Videó lejátszása', id: 1, sub: 0, dur: 0, internal: true},
    floatOut:  {cls: 'exit', label: 'Kilebegés',             id: 42, sub: 0, dur: 1000, dirs: 'float'},
    wipeOut:   {cls: 'exit', label: 'Törlés balra',          id: 22, sub: 8, dur: 500},
  };
  // directions (like PowerPoint's effect options). Fly: where the object comes from / goes to. Float: up or down.
  const DIRS = {
    fly: {b: 'alulról / lefelé', t: 'felülről / felfelé', l: 'balról / balra', r: 'jobbról / jobbra', tl: 'balra fentről', tr: 'jobbra fentről', bl: 'balra lentről', br: 'jobbra lentről'},
    float: {u: 'felfelé', d: 'lefelé'}
  };
  const DIR_DEFAULT = {fly: 'b', float: 'u'};
  const FLY_SUB = {t: 1, r: 2, b: 4, l: 8, tr: 3, br: 6, bl: 12, tl: 9};
  const dirOf = a => { const k = EFFECTS[a.effect].dirs; return k ? (DIRS[k][a.dir] ? a.dir : DIR_DEFAULT[k]) : null; };
  /** PowerPoint preset id / subtype of an animation (direction included). */
  const preset = a => {
    const E = EFFECTS[a.effect], d = dirOf(a);
    if (E.dirs === 'fly') return {id: 2, sub: FLY_SUB[d]};
    if (E.dirs === 'float') return {id: d === 'd' ? 47 : 42, sub: 0};
    return {id: E.id, sub: E.sub};
  };
  const CLASSES = {entr: 'Belépő', emph: 'Kiemelés', exit: 'Kilépő'};
  const DEFAULT = {entr: 'appear', emph: 'pulse', exit: 'disappear'};
  const TRIGGERS = {click: 'Kattintásra', with: 'Az előzővel', after: 'Az előző után'};
  const durOf = a => EFFECTS[a.effect].instant ? 0 : (a.dur ?? EFFECTS[a.effect].dur);
  const delayOf = a => a.delay ?? 0;

  /** A text box is cut into one piece per paragraph when at least one of its animations is "by paragraph". */
  function splitsByParagraph(slide, o) {
    return o.type === 'text' && !o.rot && blockCount(o) > 1 && slide.anims.some(a => a.target === o.id && a.byParagraph);
  }
  function pieceKeys(slide, o) {
    if (o.type === 'group') return o.children.flatMap(c => pieceKeys(slide, c));
    return splitsByParagraph(slide, o) ? Array.from({length: blockCount(o)}, (_, i) => `${o.id}#${i}`) : [o.id];
  }
  /** One entry per animated piece. Whole-object animations on a split box drive all its pieces together. */
  function expand(slide) {
    const out = [];
    for (const a of slide.anims) {
      const o = slide.objects.find(q => q.id === a.target); if (!o) continue;
      const keys = pieceKeys(slide, o);
      keys.forEach((key, i) => {
        const trigger = i === 0 ? a.trigger : a.byParagraph ? a.trigger : 'with';
        out.push({...a, key, trigger, src: a.id, part: keys.length > 1 ? i : null});
      });
    }
    return out;
  }
  /** PowerPoint numbering: only "on click" increments. */
  function numbers(list) { let n = 0; return list.map(a => (a.trigger === 'click' ? ++n : n)); }
  /** {src: [from, to]} – number range of every animation (e.g. 2–4 for a three-paragraph text). */
  function ranges(list) {
    const nums = numbers(list), r = {};
    list.forEach((a, i) => { const x = r[a.src]; r[a.src] = x ? [Math.min(x[0], nums[i]), Math.max(x[1], nums[i])] : [nums[i], nums[i]]; });
    return r;
  }
  /** groups[i] = one click step; chains = "after previous" sequence; effects in a chain run together */
  function groups(list) {
    const g = [];
    for (const a of list) {
      if (a.trigger === 'click' || !g.length) g.push({auto: a.trigger !== 'click', chains: [[a]]});
      else if (a.trigger === 'after') g.at(-1).chains.push([a]);
      else g.at(-1).chains.at(-1).push(a);
    }
    return g;
  }
  /** Start/end times (ms) inside every click step – used by the timeline and the PPTX timing tree. */
  function timeline(list) {
    return groups(list).map(g => {
      let t = 0; const items = [];
      for (const chain of g.chains) {
        let end = 0;
        for (const a of chain) { const s = t + delayOf(a), d = durOf(a); items.push({a, start: s, end: s + d}); end = Math.max(end, delayOf(a) + d); }
        t += end;
      }
      return {auto: g.auto, total: t, items};
    });
  }
  /** keys hidden before any animation runs (their first effect is an entrance) */
  function initiallyHidden(list) {
    const first = {};
    for (const a of list) if (!(a.key in first)) first[a.key] = a.effect;
    return new Set(Object.keys(first).filter(k => EFFECTS[first[k]].cls === 'entr'));
  }
  /** Older files: object-level "byParagraph" flag. */
  function migrateSlide(s) {
    for (const a of s.anims) { const o = s.objects.find(q => q.id === a.target); if (o?.byParagraph && a.byParagraph == null) a.byParagraph = true; }
    for (const o of s.objects) delete o.byParagraph;
  }
  return {DIRS, dirOf, preset, EFFECTS, CLASSES, DEFAULT, TRIGGERS, durOf, delayOf, splitsByParagraph, pieceKeys, expand, numbers, ranges, groups, timeline, initiallyHidden, migrateSlide};
})();
