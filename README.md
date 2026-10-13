# Matekos Prezi 0.1

Presentation editor with live inline TeX, the twin of **Matekos Doksi**. Built with **TipTap**
(text editor), **MathJax 4** (formulas), **MathLive** (visual formula editor) and **Tauri 2**
(Windows/macOS app). The formula editor, `$…$` typing, pasted TeX, tables, lists and fonts are
the same code as in Matekos Doksi.

All slide text is TeX Gyre Bonum, all math is TeX Gyre Bonum Math. Slides are 1280 × 720 px
(16:9, exactly PowerPoint's slide size: 1 px = 9525 EMU = 0.75 pt).

## Installers without a terminal

See **HOW-TO-MAKE-INSTALLERS.md**: GitHub builds the Windows setup wizard and the Mac .dmg for you.

## Build the desktop app yourself

You build on the system you are targeting (Windows installer on Windows, Mac app on a Mac).
One-time setup: Node.js LTS, Rust (`rustup`), and on Windows the "Microsoft C++ Build Tools"
(Desktop development with C++); on macOS `xcode-select --install`.

```
npm install
npm run tauri build
```

The installer ends up in `src-tauri/target/release/bundle/`. Development with hot reload: `npm run tauri dev`.
Browser test version: `npm run build:web` → one self-contained `dist-web/index.html` (needs internet for MathJax).

## Features

* Text boxes, pictures, rectangles, ellipses, arrows; move (also by the ✥ handle), resize, rotate
  (right panel sliders), recolour, stacking order (buttons and drag-and-drop list).
* Text: Doksi editor – bold/italic/underline/strike, super/subscript, colour, highlight, headings,
  lists, line spacing, tables, formulas. `$…$` becomes a formula when the closing `$` is typed
  (live preview under the cursor); pasted `$…$`, `$$…$$`, `\(…\)`, `\[…\]` become formulas automatically.
* Templates (like PowerPoint's slide master): a master (background, logo, footer) and layouts with
  placeholders. New slides are created from layouts.
* Animations: entrance, emphasis and exit effects; on click / with previous / after previous;
  duration and delay; whole text or paragraph by paragraph (both can be combined on one object).
  Coloured sequence numbers on the slide (can be hidden) and a timeline in the right panel.
* Slideshow preview inside the app.

## Export

* **PowerPoint (.pptx)** – every text box, formula and shape is placed on the slide as an SVG picture
  (with a PNG copy for viewers without SVG support), drawn from the very same font files, so it looks
  identical everywhere without installing fonts. Animations are PowerPoint's own preset effects in the
  slide timing tree, so they play in PowerPoint's slideshow. Paragraph-by-paragraph text is exported as
  one picture per paragraph. (Text is not editable in PowerPoint – by design.)
* **PDF** – vector, one page per slide (final state) or one page per click step.

Code: `src/prezi/export.js`. Text layout is taken from the rendered slide (every glyph at the position the
browser placed it), so the export always matches the editor.

## File format

`.mprezi` is a zip: `manifest.json` (master, layouts, slides, animations; text as TipTap JSON) and
`media/` (pictures). Older prototype files are converted when opened (`src/prezi/model.js`).

## Fonts

`src/fonts/bonum-*.ttf` (TeX Gyre Bonum) and the MathJax Bonum math font, as in Matekos Doksi.
Licence: GUST Font License (`fonts-official/GUST-FONT-LICENSE.txt`).
