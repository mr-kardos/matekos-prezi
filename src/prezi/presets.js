// Built-in templates. "Üres" is the default of every new presentation (white slides, no decoration).
// Elearning comes from src/presets/elearning.mprezi (the final design). Maraton and Elmélet are not finished yet:
// they are shown locked. A file dropped into src/presets/<key>.mprezi overrides the built-in definition below
// (its master, slide types, text styles and font set are used).
import { uid, ph, textDoc, T, TITLE_PROMPT } from './model.js';

const L = (name, objects, extra = {}) => ({name, ownBg: false, background: null, bgColor: '#ffffff', showMaster: true, objects, ...extra});
const rect = (x, y, w, h, fill, extra = {}) => ({id: uid(), name: 'Díszítés', type: 'shape', shape: 'rect', x, y, w, h, rot: 0, fill, stroke: null, strokeWidth: 0, radius: 0, locked: true, ...extra});
const field = (f, x, y, w, color, align = 'right') => ({id: uid(), name: f === 'slideNumber' ? 'Diaszám' : 'Dátum', type: 'text', field: f, x, y, w, h: 30, rot: 0, size: 21.33, color, align, doc: textDoc([])});
const styles = (title, subtitle, body) => ({title, subtitle, body});
const st = (pt, color, bold = false, extra = {}) => ({size: Math.round(pt / 0.75 * 100) / 100, color, bold, italic: false, underline: false, font: null, ...extra});
/** The usual slide types, with the given title / body colours and positions. */
function layouts(c, o = {}) {
  const tx = o.titleX ?? 60, ty = o.titleY ?? 40, tw = o.titleW ?? 1160, by = o.bodyY ?? 150;
  return {
    cimdia: L('Címdia', [ph('title', 140, o.coverTitleY ?? 250, 1000, 45, c.coverTitle ?? c.title, true, 'center', TITLE_PROMPT), ph('subtitle', 240, (o.coverTitleY ?? 250) + 130, 800, 22, c.subtitle, false, 'center', 'Alcím')], o.cover || {}),
    tartalom: L('Cím és tartalom', [ph('title', tx, ty, tw, 33, c.title, true, 'left', TITLE_PROMPT), ph('body', tx, by, tw, 22, c.body, false, 'left', 'Szöveg')]),
    ketoszlop: L('Két hasáb', [ph('title', tx, ty, tw, 33, c.title, true, 'left', TITLE_PROMPT), ph('body', tx, by, tw / 2 - 20, 22, c.body, false, 'left', 'Bal hasáb'), ph('body2', tx + tw / 2 + 20, by, tw / 2 - 20, 22, c.body, false, 'left', 'Jobb hasáb')]),
    csakcim: L('Csak cím', [ph('title', tx, ty, tw, 33, c.title, true, 'left', TITLE_PROMPT)]),
    ures: L('Üres', []),
  };
}

export const PRESETS = {
  ures: {
    label: 'Üres', note: 'Fehér diák, díszítés nélkül – minden új bemutató így indul.',
    build: () => {
      const c = {title: '#1a1a1a', subtitle: '#4a5866', body: '#1a1a1a'};
      return {font: null, master: {background: null, bgColor: '#ffffff', objects: []}, templates: layouts(c),
        styles: styles(st(33, c.title, true), st(22, c.subtitle), st(22, c.body))};
    }
  },
  elearning: {
    label: 'Elearning', note: 'Studium Generale Matematika e-learning sablon: nyitó dia, tartalmi dia, záró dia.', swatch: ['#fbf6ef', '#da291c'],
    build: () => {
      const c = {title: '#16677a', subtitle: '#4a5866', body: '#1a1a1a', coverTitle: '#ffffff'};
      const t = layouts({...c, subtitle: '#e6f4f7'}, {titleX: 90, titleW: 1130});
      t.cimdia.showMaster = false;
      t.cimdia.objects.unshift(rect(0, 0, 1280, 720, '#1f8a9e'), rect(0, 520, 1280, 200, '#16677a'));
      return {font: 'fira', master: {background: null, bgColor: '#ffffff', objects: [rect(0, 0, 24, 720, '#1f8a9e'), rect(60, 118, 120, 5, '#f2b134'), field('slideNumber', 1100, 670, 120, '#16677a')]},
        templates: t, styles: styles(st(33, c.title, true), st(22, '#e6f4f7'), st(22, c.body))};
    }
  },
  maraton: {
    label: 'Maraton', note: 'Hamarosan elérhető.', locked: true, swatch: ['#f3f3f3', '#da291c'],
    build: () => {
      const c = {title: '#ffffff', subtitle: '#3b3b3b', body: '#1a1a1a', coverTitle: '#da291c'};
      const t = layouts(c, {titleY: 22, bodyY: 150});
      t.cimdia.showMaster = false;
      t.cimdia.objects.unshift(rect(0, 600, 1280, 120, '#da291c'), rect(140, 365, 1000, 6, '#1a1a1a'));
      return {font: 'bonum', master: {background: null, bgColor: '#f3f3f3', objects: [rect(0, 0, 1280, 112, '#da291c'), field('slideNumber', 1100, 670, 120, '#da291c'), field('dateShort', 60, 670, 300, '#6b6b6b', 'left')]},
        templates: t, styles: styles(st(33, c.title, true), st(22, c.subtitle), st(22, c.body))};
    }
  },
  elmelet: {
    label: 'Elmélet', note: 'Hamarosan elérhető.', locked: true, swatch: ['#fbfaf6', '#22325c'],
    build: () => {
      const c = {title: '#22325c', subtitle: '#5a6378', body: '#1a1a1a'};
      return {font: 'modern', master: {background: null, bgColor: '#fbfaf6', objects: [rect(60, 112, 1160, 2, '#22325c'), rect(60, 660, 1160, 1, '#b8bccb'), field('slideNumber', 1100, 668, 120, '#5a6378')]},
        templates: layouts(c), styles: styles(st(33, c.title, true), st(22, c.subtitle, false, {italic: true}), st(22, c.body))};
    }
  },
};
export const PRESET_ORDER = ['ures', 'elearning', 'maraton', 'elmelet'];
/** Final template files (src/presets/<key>.mprezi), when present. */
const FILES = import.meta.glob('../presets/*.mprezi', {query: '?url', import: 'default', eager: true});
export const presetFile = key => Object.entries(FILES).find(([p]) => p.endsWith(`/${key}.mprezi`))?.[1] || null;
