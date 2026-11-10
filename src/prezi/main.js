// Matekos Prezi – the editor.
//
// Its code is in the folder  src/prezi/main/ , one file per topic. When the app is built (and in "npm run dev"),
// vite.config.js joins the files listed below, in this order, into this one module – so they share one scope and
// behave exactly as one long file would. Rules that follow from this:
//   * every `import` is in 01-setup.js; paths in them are relative to src/prezi/ (this file's folder);
//   * a name declared at the top level of one part is visible in all the others (no export / import between them);
//   * a new part must be added to this list (tests/code.test.mjs checks that no file is forgotten).
//
//@part main/01-setup.js                 imports, shared state, small helpers
//@part main/02-template-files.js        .mpsab template files, template builder
//@part main/03-comments.js              comments panel and marks
//@part main/04-history.js               undo / redo, automatic draft
//@part main/05-rendering.js             drawing slides and objects
//@part main/06-selection.js             selection frame, animation badges
//@part main/07-left-panel.js            slide thumbnails, layouts list
//@part main/08-pointer.js               moving, resizing, snapping, cropping
//@part main/09-text-editing.js          the text editor in a box, tables
//@part main/10-inserting.js             new objects, pictures, videos, grouping
//@part main/11-right-panel.js           properties, layers, animations
//@part main/12-ribbon.js                toolbar and its menus
//@part main/13-slideshow.js             slideshow preview, animation playback
//@part main/14-files.js                 new / open / save / export / import, home screen
//@part main/15-clipboard.js             copy / paste, drag and drop
//@part main/16-spell-eye-menu.js        spell checking, eye mode, right-click menu
//@part main/17-find.js                  find and replace
//@part main/18-keyboard.js              keyboard shortcuts
//@part main/19-start.js                 start-up
