# Matekos Prezi 1.0

Presentation editor with live inline TeX, the twin of **Matekos Doksi**. Built with **TipTap**
(text editor), **MathJax 4** (formulas), **MathLive** (visual formula editor) and **Tauri 2**
(Windows/macOS app). The formula editor, `$…$` typing, pasted TeX, tables, lists and fonts are
the same code as in Matekos Doksi.

Each presentation uses one of 9 font sets (text font + matching MathJax 4 math font), chosen in the
top bar: TeX Gyre Bonum (default), Pagella, Termes, Schola, Latin Modern, New Computer Modern, STIX Two,
Fira Sans, DejaVu Serif. Every text font and math font was tested for the Hungarian letters ő ű Ő Ű (also
inside formulas, `\text{…}`, bold and italic); Computer Modern (MathJax "tex") and Asana Math failed and
are not offered. Switching the font set restarts the editor with the same presentation (MathJax picks its
math font at start-up). Slides are 1280 × 720 px
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
  Beúszás / Kiúszás (Fly In/Out) in 8 directions, Belebegés / Kilebegés (Float In/Out) up or down –
  exported as PowerPoint's own presets (2 with subtypes, 42 / 47).
* Slide transitions (Áttűnés, Áttűnés feketén át, Eltolás, Takarás, Felfedés, Törlés, Szétválás, Nagyítás)
  with direction and exact duration – exported as PowerPoint transitions (`p14:dur`), previewed in the app.
* Saving: "Mentés" writes the presentation's own file (asks only the first time), "Mentés másként" writes a new
  file and leaves the previous one unchanged.
  Coloured sequence numbers on the slide (can be hidden) and a timeline in the right panel.
* Layers: show/hide (eye) and lock each object, drag to reorder, group / ungroup.
* Colours: every colour picker has white, #D8D8D8, black and #DA291C, the colours saved in the presentation
  (`doc.colors`, stored in the .mprezi file), a custom colour with OK / Mentés (save to this presentation)
  and an eyedropper (the browser's own where available, otherwise picking from a picture of the slide).
* Template builder: automatic slide number and date fields (master or layouts); text styles for headlines
  and normal text (size, colour, bold, italic) that update the placeholders and new text boxes.
* Home screen (new / open / continue), in-app confirmation before deleting a non-empty slide or starting a
  new presentation, ↑/↓ to move between slides.
* Built-in templates: Üres (default of every new file), Elearning (`src/presets/elearning.mprezi`: opening,
  content and closing slide types); Maraton and Elmélet are shown locked until they are finished.
  Applying a template keeps the slides' content.
* PowerPoint import (Fájl → PowerPoint importálása): slides, layouts and backgrounds, text with fonts / colours /
  sizes / lists, shapes, pictures, tables, groups, animations and transitions. MathType and Equation Editor 3.0
  objects are decoded (MTEF, `src/prezi/mtef.js`) into editable TeX and put into the text where the old slide left
  room for them (runs of spaces or tabs, a text box split in two, a formula at a line end); otherwise they become
  formula boxes of the same size. A report lists what could not be converted.
* Clipboard: objects and whole slides (select the slide in the left panel) can be copied / cut / pasted
  between slides, presentations and Matekos Prezi windows; pictures and text paste from other programs;
  pictures, text, layer rows and slide thumbnails can be dragged into another window.
* Pictures: crop (undoable), replace; every object has an opacity setting (also imported / exported).
* Find and replace (Ctrl/⌘+F) across all slides.
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

Text fonts: `src/fonts/families/<name>/{r,b,i,bi}.(ttf|otf)`; math fonts: the `@mathjax/mathjax-<name>-font`
packages (copied into `public/mathjax/fonts` at build time).

| Set | Text font | Licence |
|---|---|---|
| bonum, pagella, termes, schola | TeX Gyre (GUST e-foundry) | GUST Font License |
| modern | Latin Modern Roman | GUST Font License |
| newcm | New Computer Modern | GUST Font License |
| stix2 | STIX Two Text | SIL Open Font License |
| fira | Fira Sans | SIL Open Font License |
| dejavu | DejaVu Serif | Bitstream Vera / DejaVu licence (free) |

Other text fonts (no math version – formulas next to them use the base font's math): Liberation Sans/Mono
(OFL), Carlito (OFL), Caladea (Apache 2.0), Roboto (Apache 2.0), Open Sans (OFL), Lato (OFL), Montserrat (OFL),
Inter (OFL), Noto Sans/Serif (OFL), Linux Libertine (OFL/GPL), Ubuntu (Ubuntu Font Licence), Atkinson
Hyperlegible (OFL), Comic Neue (OFL), JetBrains Mono (OFL). All four styles, Hungarian letters checked; the files
are subset to Latin, Greek and common symbols.

Licence texts: `fonts-official/`.
