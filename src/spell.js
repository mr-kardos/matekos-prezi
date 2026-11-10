// Hungarian spell checking with Hunspell (WebAssembly) and the Magyar Ispell 1.9 dictionary (LibreOffice;
// MPLv2 / LGPLv3+, public/spell) – the same as in Matekos Doksi, independent of the operating system.
// Prezi draws the red wavy lines on a layer over the slide (never part of the text, never exported).
let hun = null, loading = null;
const cache = new Map(), ignored = new Set();
const USER_KEY = 'matekosprezi.userdict';
let userWords = new Set();
try { userWords = new Set(JSON.parse(localStorage.getItem(USER_KEY) || '[]')); } catch (e) { /* none */ }
export function loadSpell() {
  if (!loading) loading = (async () => {
    const [{createHunspellFromStrings}, aff, dic] = await Promise.all([
      import('hunspell-wasm'),
      fetch('./spell/hu_HU.aff').then(r => r.text()),
      fetch('./spell/hu_HU.dic').then(r => r.text())
    ]);
    hun = await createHunspellFromStrings(aff, dic);
    return hun;
  })().catch(e => { console.warn('spell', e); loading = null; throw e; });
  return loading;
}
export const WORD = /[\p{L}][\p{L}\p{M}]*(?:[’'-][\p{L}\p{M}]+)*/gu;
export function wordOk(w) {
  if (w.length < 2 || ignored.has(w) || userWords.has(w) || userWords.has(w.toLowerCase())) return true;
  if (/^[\p{Lu}]+$/u.test(w) && w.length <= 4) return true;          // abbreviations
  let r = cache.get(w);
  if (r === undefined) { r = hun ? (hun.testSpelling(w) || (w.includes('-') && w.split('-').every(p => !p || hun.testSpelling(p)))) : true; cache.set(w, r); }
  return r;
}
export const spellReady = () => !!hun;
export function suggestions(word) { try { return hun ? hun.getSpellingSuggestions(word).slice(0, 7) : []; } catch (e) { return []; } }
export function addToDictionary(word) { userWords.add(word); try { localStorage.setItem(USER_KEY, JSON.stringify([...userWords])); } catch (e) { /* full */ } cache.delete(word); }
export function ignoreWord(word) { ignored.add(word); }
