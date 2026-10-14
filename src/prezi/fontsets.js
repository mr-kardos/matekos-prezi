// The 9 font sets of Matekos Prezi: a text font and the MathJax 4 math font made for it.
// Every text font and every math font was checked to contain the Hungarian letters (ő ű Ő Ű and the other accented
// letters) – also inside formulas (\\text{…}). Computer Modern (MathJax 'tex') and Asana Math failed that test and are not offered.
// The chosen set is stored in the presentation (doc.font); the app shows and exports with exactly these files.
const FILES = import.meta.glob('../fonts/families/*/*.{ttf,otf}', {query: '?url', import: 'default', eager: true});
const fileOf = (fam, st) => Object.entries(FILES).find(([p]) => p.includes(`/families/${fam}/${st}.`))?.[1];

export const FONT_SETS = {
  bonum:   {label: 'TeX Gyre Bonum',        text: 'bonum',   math: 'bonum',   note: 'Bookman-szerű, kerek, jól olvasható'},
  pagella: {label: 'TeX Gyre Pagella',      text: 'pagella', math: 'pagella', note: 'Palatino-szerű, elegáns'},
  termes:  {label: 'TeX Gyre Termes',       text: 'termes',  math: 'termes',  note: 'Times-szerű'},
  schola:  {label: 'TeX Gyre Schola',       text: 'schola',  math: 'schola',  note: 'Century Schoolbook, tankönyvi'},
  modern:  {label: 'Latin Modern',          text: 'lmodern', math: 'modern',  note: 'a klasszikus LaTeX-kép'},
  newcm:   {label: 'New Computer Modern',   text: 'newcm',   math: 'newcm',   note: 'modern LaTeX-kép'},
  stix2:   {label: 'STIX Two',              text: 'stix2',   math: 'stix2',   note: 'Times-szerű, tudományos'},
  fira:    {label: 'Fira Sans',             text: 'fira',    math: 'fira',    note: 'talpatlan, kivetítve nagyon olvasható'},
  dejavu:  {label: 'DejaVu Serif',          text: 'dejavu',  math: 'dejavu',  note: 'széles, erős, kis méretben is jó'},
};
export const DEFAULT_FONT = 'bonum';
export const fontSet = key => FONT_SETS[key] ?? FONT_SETS[DEFAULT_FONT];
export const familyName = key => 'MP ' + fontSet(key).text;
const STYLES = [['r', '400', 'normal'], ['b', '700', 'normal'], ['i', '400', 'italic'], ['bi', '700', 'italic']];

const loaded = new Map();
/** Register a text font (4 styles) with the browser. */
export function loadTextFamily(fam) {
  if (loaded.has(fam)) return loaded.get(fam);
  const p = Promise.all(STYLES.map(([st, weight, style]) => {
    const url = fileOf(fam, st); if (!url) return null;
    try { const ff = new FontFace('MP ' + fam, `url(${url})`, {weight, style}); document.fonts.add(ff); return ff.load().catch(() => null); }
    catch (e) { return null; }
  }));
  loaded.set(fam, p); return p;
}
/** Use a font set for the slides (CSS variable --slide-font). */
export function applyTextFont(key) {
  const fam = fontSet(key).text;
  document.documentElement.style.setProperty('--slide-font', `'MP ${fam}', Georgia, serif`);
  return loadTextFamily(fam);
}
/** The raw font files (for turning text into outlines in PowerPoint / PDF export). */
export async function fontFiles(key) {
  const fam = fontSet(key).text, out = {};
  for (const [st] of STYLES) out[st] = await (await fetch(fileOf(fam, st))).arrayBuffer();
  return out;
}
