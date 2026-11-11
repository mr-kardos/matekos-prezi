// Text pasted from other programs (Word, PowerPoint, web pages): plain paragraphs and lists, keeping only bold,
// italic, underline and links. Fonts, sizes and colours are dropped – the text takes the look of its text box.
const escH = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BLOCK = /^(P|DIV|H[1-6]|LI|TR|BLOCKQUOTE|PRE|TABLE|SECTION|ARTICLE|HEADER|FOOTER|DT|DD)$/;
const SKIP = /^(SCRIPT|STYLE|HEAD|TITLE|META|LINK|NOSCRIPT)$/;

/** Numbering style of a list from its first number as Word wrote it ("a)", "1)", "I.", …); null = 1. 2. 3. */
function numStyleOf(sym) {
  if (/^\d+\)$/.test(sym)) return 'decimal-paren';
  if (/^[ivxlcdm]+[.)]$/.test(sym)) return 'lower-roman';
  if (/^[IVXLCDM]+[.)]$/.test(sym)) return 'upper-roman';
  if (/^[a-z][.)]$/.test(sym)) return 'lower-alpha';
  if (/^[A-Z][.)]$/.test(sym)) return 'upper-alpha';
  return null;
}
/** Word writes list items as paragraphs ("mso-list: l0 level2 lfo1") with the symbol as text: make real lists of them. */
function wordLists(body) {
  const doc = body.ownerDocument;
  const paras = [...body.querySelectorAll('p, h1, h2, h3, h4, h5, h6')].filter(p => /mso-list\s*:/i.test(p.getAttribute('style') || '') && !p.closest('li'));
  let stack = [];                                  // the open lists of the current run: [{el, level}]
  for (const p of paras) {
    const level = +(/level(\d+)/i.exec(p.getAttribute('style'))?.[1] || 1);
    const ign = [...p.querySelectorAll('span')].find(s => /mso-list\s*:\s*ignore/i.test(s.getAttribute('style') || ''));
    const sym = ign ? ign.textContent.replace(/[\s\u00a0]+/g, '') : '';
    if (ign) ign.remove();
    const ordered = /^(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]$/.test(sym);
    const make = () => { const l = doc.createElement(ordered ? 'ol' : 'ul'); const ns = ordered && numStyleOf(sym); if (ns) l.setAttribute('data-num', ns); return l; };
    if (!stack.length || p.previousElementSibling !== stack[0].el) { const l = make(); p.before(l); stack = [{el: l, level}]; }
    while (stack.length > 1 && level < stack[stack.length - 1].level) stack.pop();
    let top = stack[stack.length - 1];
    if (level > top.level && top.el.lastElementChild) { const l = make(); top.el.lastElementChild.appendChild(l); top = {el: l, level}; stack.push(top); }
    const li = doc.createElement('li'); top.el.appendChild(li); li.appendChild(p);
  }
}

export function cleanPastedHTML(html) {
  if (/data-pm-slice/.test(html)) return html.replace(/(font-size|line-height)\s*:[^;"']*;?/gi, '');   // copied inside the app: keep it
  const d = new DOMParser().parseFromString(html, 'text/html');
  wordLists(d.body);
  /** Blocks of `n` go to `out` (HTML strings); `buf.s` is the paragraph being collected. */
  const run = (n, st, out, buf) => {
    const flush = () => { if (buf.s.trim()) out.push('<p>' + buf.s.trim() + '</p>'); buf.s = ''; };
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        let t = escH(c.data.replace(/[\s\u00a0]+/g, ' ')); if (!t) continue;
        if (st.u) t = `<u>${t}</u>`; if (st.i) t = `<em>${t}</em>`; if (st.b) t = `<strong>${t}</strong>`;
        if (st.a) t = `<a href="${st.a.replace(/"/g, '&quot;')}">${t}</a>`;
        buf.s += t; continue;
      }
      if (c.nodeType !== 1 || SKIP.test(c.tagName)) continue;
      if (c.tagName === 'BR') { flush(); continue; }
      const s2 = {...st}, cs = c.style, fw = cs && cs.fontWeight;
      if (/^(B|STRONG)$/.test(c.tagName)) s2.b = !(fw === 'normal' || (fw && +fw < 600));
      if (fw === 'bold' || +fw >= 600) s2.b = true; else if (fw === 'normal' || (fw && +fw < 600)) s2.b = false;
      if (/^(I|EM)$/.test(c.tagName) || (cs && cs.fontStyle === 'italic')) s2.i = true;
      if (c.tagName === 'U' || (cs && /underline/.test(cs.textDecoration || cs.textDecorationLine || ''))) s2.u = true;
      if (c.tagName === 'A' && c.getAttribute('href')) s2.a = c.getAttribute('href');
      if (c.tagName === 'UL' || c.tagName === 'OL') {                    // a list stays a list, with its levels
        flush();
        const items = [];
        const item = el => { const io = [], ib = {s: ''}; run(el, s2, io, ib); if (ib.s.trim()) io.push('<p>' + ib.s.trim() + '</p>'); return io; };
        for (const li of c.children) {
          if (li.tagName === 'LI') { const io = item(li); if (!io.length || !io[0].startsWith('<p>')) io.unshift('<p></p>'); items.push(io); }
          else if (li.tagName === 'UL' || li.tagName === 'OL') { const io = item({childNodes: [li]}); if (items.length) items[items.length - 1].push(...io); else items.push(['<p></p>', ...io]); }
        }
        const tag = c.tagName.toLowerCase(), ns = tag === 'ol' && c.getAttribute('data-num');
        if (items.length) out.push(`<${tag}${ns ? ` data-num="${ns}"` : ''}>${items.map(io => '<li>' + io.join('') + '</li>').join('')}</${tag}>`);
        continue;
      }
      const block = BLOCK.test(c.tagName);
      if (block) flush();
      run(c, s2, out, buf);
      if (block) flush();
    }
  };
  const out = [], buf = {s: ''};
  run(d.body, {}, out, buf);
  if (buf.s.trim()) out.push('<p>' + buf.s.trim() + '</p>');
  return out.join('') || '<p></p>';
}
