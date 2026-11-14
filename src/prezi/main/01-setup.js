import '../styles.css';
import './prezi.css';
import JSZip from 'jszip';
import { NodeSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { startMathJax, renderInto, mathReady, activeMathFont } from '../math.js';
import { FONT_SETS, DEFAULT_FONT, applyTextFont, loadTextFamily, allFamilies, familyLabel, familyCSS, familyFromCSS, registerAllFamilies, fontSet } from './fontsets.js';
import { openMathEditor, isMathEditorOpen, applyMathEditor } from '../mathEditor.js';
import { tableContext, changeListLevel } from '../editor/extensions.js';
import { svg as svgIcon } from '../icons.js';
import { saveTemplateFile, updateTemplateFile, openTemplateFile, templateFilePath, renameCurrentFile, currentFileExists, pickFile, isTauri, savePresentation, saveExport, openPresentation, openPathFile, watchOpenedFiles, setCurrentPath, getCurrentPath, getCurrentHandle, setCurrentHandle, currentFileName, autosave, loadAutosave, recoverableDrafts, takeDraft, dropDraft, shelveDraft, recentFiles, forgetRecent } from '../files.js';
import { Anim } from './anim.js';
import { splitSlide, mergeRun, findRuns, clicksOf } from './steps.js';
import { partCount, markDoc, partPieces, partEls, setPartVis, refreshParts } from './parts.js';
import { W, H, uid, clone, emptyDoc, textDoc, tableDoc, T, M, isEmptyText, blockCount, makeBackground, phName, ph, TITLE_PROMPT,
  defaultMaster, defaultTemplates, newSlide as makeSlide, syncPlaceholders as syncPh, migrate,
  flatObjects, findObject, parentGroup, bounds, fitGroup, moveObject, scaleFrom } from './model.js';
import { renderStatic, pieceEls, mountEditor, setTextHooks, mathPending } from './textview.js';
import { drawMarks, setCellFilter } from '../marks.js';
import { checkForUpdate, openLink, APP_VERSION } from '../updates.js';
import { loadSpell, wordOk, spellReady, suggestions, addToDictionary, ignoreWord, WORD } from '../spell.js';
import { buildPptx, buildPdf, slideCanvas, setMediaLookup } from './export.js';
import { PRESETS, PRESET_ORDER, presetFile } from './presets.js';
import { MATEKOS_BULLET } from './bullets.js';

const $ = s => document.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = v => Math.round(v * 10) / 10;
const PT = 0.75, MM = 96 / 25.4;
const CLS_COLOR = {entr: '#1f9d55', emph: '#c98a0b', exit: '#c0392b'};
const LS = {right: 'matekosprezi.rightw', left: 'matekosprezi.leftw', panel: 'matekosprezi.panel', badges: 'matekosprezi.badges', sections: 'matekosprezi.sections'};
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };


/* ================================================================== state */
let doc, media = {}, cur = 0, curAnim = null;
let selIds = [];                                  // selected objects (top level of the slide, or one group member being edited)
let sel = null;                                   // the single selected object (null when 0 or several are selected)
let mode = 'slides', tcur = 'master';            // 'slides' | 'template' (template builder)
let editing = null, ed = null;                    // id of the text box being edited, its TipTap editor
let history = [], hIdx = -1, dirty = false;
let showBadges = lsGet(LS.badges) !== '0';

const tgt = () => mode === 'slides' ? doc.slides[cur] : tcur === 'master' ? doc.master : doc.templates[tcur];
const objById = id => id ? findObject(tgt().objects, id) : null;
const selObj = () => sel && objById(sel);
let multiRun = false;               // true while a formatting step runs on several selected text boxes (12-ribbon.js)
const isText = o => o?.type === 'text', isShape = o => o?.type === 'shape', isTable = o => o?.type === 'table';
const isTextLike = o => isText(o) || isTable(o);
const kindOf = o => isTable(o) ? 'table' : 'text';
const layoutOf = s => doc.templates[s.template] ?? Object.values(doc.templates)[0];
const newSlide = t => makeSlide(doc, t);
const syncPlaceholders = s => syncPh(doc, s);

/** Text styles of the template: headlines (title placeholders) and normal text (body/subtitle placeholders, new text boxes). */
const defaultStyles = () => ({title: {size: 44, color: '#2f5d8a', bold: true, italic: false, underline: false, font: null},
  subtitle: {size: 29.33, color: '#4a5866', bold: false, italic: false, underline: false, font: null},
  body: {size: 29.33, color: '#1a1a1a', bold: false, italic: false, underline: false, font: null}});
const stylesOf = () => { const d = defaultStyles(); doc.styles = {...d, ...(doc.styles || {})}; for (const k in d) doc.styles[k] = {...d[k], ...doc.styles[k]}; return doc.styles; };
const roleOf = o => o.placeholder ? (o.placeholder.startsWith('title') ? 'title' : o.placeholder.startsWith('subtitle') ? 'subtitle' : 'body') : (o.styleRef || null);
function applyStyle(kind, changes) {
  const old = stylesOf()[kind], nw = {...old, ...changes}, k = nw.size / old.size;
  doc.styles[kind] = nw;
  const upd = (o, layoutLevel) => {
    if (roleOf(o) !== kind || (!layoutLevel && (o.phStyled || o.ownStyle))) return;
    if ('size' in changes) o.size = o.placeholder ? Math.round(o.size * k * 100) / 100 : nw.size;
    for (const key of ['color', 'bold', 'italic', 'underline']) if (key in changes) o[key] = nw[key] || undefined;
    if ('line' in changes) o.lineHeight = nw.line && nw.line !== 1.25 ? nw.line : undefined;
    if ('letterSpacing' in changes) o.letterSpacing = nw.letterSpacing || undefined;
    if ('align' in changes) o.align = nw.align || 'left';
    if ('font' in changes) o.font = nw.font || undefined;
  };
  for (const g of [doc.master, ...Object.values(doc.templates)]) flatObjects(g.objects).forEach(o => upd(o, true));
  for (const sl of doc.slides) flatObjects(sl.objects).forEach(o => { if (!o.placeholder) upd(o, false); });
  commit();
}
/** Apply a built-in template: master, slide types, text styles (and its font set). The slides keep their content. */
