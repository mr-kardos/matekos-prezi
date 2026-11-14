# Matekos Prezi 1.5.5

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
* Built-in templates: Üres (default of every new file), Elearning and Maraton (`src/presets/*.mprezi`: opening,
  content and closing slide types); Elmélet is shown locked until it is finished.
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
* Formulas take the font of the text around them (math-capable fonts use their own math letters, each through
  its own MathJax document in the page (loaded on first use, with its own queue); other fonts use the presentation's) and its boldness.
* Formatting a selected, closed text box applies to all of its text and formulas; opening it turns the box
  formatting into ordinary formatting of the text, so parts can then be changed one by one.
* Comments (right panel, as in Matekos Doksi): on selected text, on objects, or on the slide; replies, done,
  hide marks; saved in the file (older files simply have none).
* Lists as in Matekos Doksi: the text starts 0,8 cm after the symbol (where the next level's symbol stands), start
  numbers, Tab / Shift+Tab change the level next to the symbol or with several items selected, otherwise Tab inserts
  a tabulator; tab stops per paragraph (left / centre / right, dotted or line leader).
* Spell checking (Hunspell WebAssembly + Magyar Ispell, public/spell), eye mode (formatting marks, and objects that
  would jump between neighbouring slides), the app's own right-click menu, closable left panel.
* Template files: Matekos Prezi Sablon (.mpsab) – save, import, update; opening one from the system starts a new
  presentation with it.
* Formula editor: "Kedvencek" tab with the user's favourite buttons (kept by the app for every presentation).
* The title box always shows the file name: Save as, renaming in the title box (renames the file) and files
  renamed outside the app stay in step.
* Videos (MP4 recommended): start on click / automatically, trimming, crop, rounded corners; played in the
  slideshow and exported to PowerPoint (video file, trim, play command in the timing).
* Lines: arrow heads at both ends; solid / dashed / dotted / dash-dot outlines; rounded corners for polygons
  and pictures (PowerPoint: rounded-rectangle picture geometry).
* Formulas may break into lines at the edge of their text box (per formula; MathJax inline line breaking).
* PowerPoint import: charts, SmartArt and EMF/WMF pictures become marked boxes of the same size and position.
* Slideshow preview inside the app.
* Safety (1.4.5): every window keeps its own automatic draft (pictures and videos are stored once, not with every
  change); unsaved presentations of windows that are no longer running can be restored from the home screen; saving
  writes a temporary file first and then swaps it in, so an interrupted save cannot damage the previous version.
  The home screen lists the recently used presentations (desktop app).
* Reviewing (1.4.6): comments and replies carry the reviewer's name (typed once in the comments panel, kept by the
  app); the panel can list only the open comments and step to the next / previous open one; slide thumbnails show the
  number of open comments (a click opens the first one); copies of slides and objects never share comments with the original.
* Editing (1.4.7): snapping also when resizing and when moving several or rotated objects (Alt switches it off);
  Ctrl/⌘+D duplicates every selected object together with its animations; grouping / ungrouping asks before
  animations are removed; find also looks into the TeX code of formulas (search only – replace never changes a formula);
  zoom with Ctrl/⌘ + wheel or a touchpad pinch and Ctrl/⌘ + plus / minus / 0 (fit); typing in a text box makes undo
  steps of its own, so Ctrl/⌘+Z after leaving the box goes back step by step.
* Formulas part by part (1.4.8): an animation of a text box can also reveal its formulas in parts ("Képletek
  részenként is" in the animation's settings) – a new step starts at every new row (`\\`) of a multi-line formula,
  after a wide space (`\quad`, `\qquad`) and after an implication arrow (⇒, ⇔; `\Rightarrow`, `\implies`,
  `\iff`, …). Exported to PowerPoint / PDF as one picture per part with the chosen effect; the in-app preview
  fades the parts in. Slideshow: Home / End jump to the first / last slide, a number + Enter to that slide.
  Slide thumbnails are redrawn only when their slide changed.
* 1.4.9: zooming with Ctrl/⌘ + two-finger scroll and with a touchpad pinch (Windows and Mac); a profile icon in the
  reviewer's own colour before the names in the comments. Automated tests (`npm test`, in `tests/`): where formulas
  are cut into parts and that the markers do not change their layout, animation order, automatic drafts and recovery.
* 1.5.0 (no change in the app itself – the built app is byte for byte the same as it would be without the split): the
  editor's code, formerly one 250 KB file, is in `src/prezi/main/`, one file per topic (rendering, pointer, ribbon,
  files, …). `src/prezi/main.js` lists them and `vite.config.js` joins them into one module when building, so
  they still share one scope. `npm test` also checks that no part is forgotten and that no file uses a name that
  does not exist (ESLint).
* 1.5.1 – text and checking:
  * lists: the symbol takes the size and colour its item's text starts with; the indent buttons do what Tab /
    Shift+Tab do; only `- ` starts a list while typing (`+ ` and `* ` do not); lists pasted from Word, PowerPoint
    or the web stay lists, with their levels (`src/prezi/paste.js`);
  * text formatting (font, size, colour, bold…, alignment, lists, spacing) works on every selected text box at once;
  * typing: `"` becomes „ or ”, `--` becomes – (not inside a `$…` formula; Backspace undoes the correction);
  * eye mode: also reports nudged placeholders, members of groups and the same text with a different look; a click
    on a report fixes it; text that leaves the slide is marked in red; the thumbnails show the number of reports;
  * PDF export: an invisible text layer over the outlines – the text can be searched, selected and copied (a
    formula's hidden text is its TeX code);
  * home screen: "continue" looks like the recent files; the "new version" notice has a red outline.
* 1.5.2: eye mode – for every selected text box, green labels at the end of its paragraphs show the space before /
  after that is not 0 and a line spacing that differs from the template's; formula editor – the "Egyéb" tab holds
  Space, Nagy space (`\quad`), Óriás space (`\qquad`) and the frame (`\boxed`).
* 1.5.3: the spacing labels also appear in tables, for the column the cursor is in.
* 1.5.4: formula editor – the Space and Óriás space buttons show their names.
* 1.5.5:
  * "⋯ További funkciók" (end of the ribbon): "Minden lépés külön diára" and "A lépések egy diára, animációval" – the
    click steps of the slides become slides of their own (no slide transition between them; a step's effects start
    when its slide appears), or consecutive slides that are steps of one another become one slide with click
    animations. Asked first; one undo step. The slideshow looks the same either way (checked screen by screen; only
    the slide / step counter differs). Slides with a video are left as they are. Code: `src/prezi/steps.js`, with
    two additions to the animation model: `pieces` (only some pieces of a box revealed in parts) and `pre` (applied
    before the slide is shown);
  * ribbon as in Matekos Doksi: one alignment button with a menu (its icon shows the alignment in effect, highlighted
    for every alignment but left), then paragraph, tab stops, the lists, and the two indent buttons;
  * left panel: the transition button is the size of the others, without an arrow, with a clearer icon; the four
    buttons stay in one row;
  * no extra empty line under a list at the end of a text box (files saved before lose the one that was added);
  * the eye button is called "Lektor mód".

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
