// Turns a pdf.js document into plain page/line data that layout.js can reason about.
// Works in the browser and in Node (pdfjsLib is passed in).

const BOLD_RE = /bold|black|heavy|semibold|demi|extrab|ultrab|\bsb\b|-b$|,b$/i;
const ITALIC_RE = /italic|oblique|-it$|-ital|\bit\b|-i$|,i$|slant/i;

export async function extractPages(pdfjsLib, pdf, { onProgress, signal } = {}) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const page = await pdf.getPage(n);
    pages.push(await extractPage(pdfjsLib, page));
    page.cleanup();
    onProgress?.(n, pdf.numPages);
  }
  return pages;
}

export async function extractPage(pdfjsLib, page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const textItems = tc.items.filter((it) => it.str !== undefined && it.str.length);
  const fonts = {};
  if (textItems.length) {
    // Loading the operator list makes pdf.js resolve the real font objects (name, bold, italic).
    try { await page.getOperatorList(); } catch { /* fonts stay unknown */ }
    for (const id of Object.keys(tc.styles)) {
      let f = null;
      try { if (page.commonObjs.has(id)) f = page.commonObjs.get(id); } catch { f = null; }
      const name = (f && (f.name || f.loadedName)) || '';
      const base = name.replace(/^[A-Z]{6}\+/, '');
      fonts[id] = {
        bold: !!(f && (f.bold || f.black)) || BOLD_RE.test(base),
        italic: !!(f && f.italic) || ITALIC_RE.test(base),
        mono: !!(f && f.isMonospace) || /mono|courier|consol/i.test(base),
      };
    }
  }
  const items = [];
  for (const it of textItems) {
    const t = pdfjsLib.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(t[2], t[3]);
    if (!size || size < 2) continue;
    // Skip rotated text (spine labels, watermarks, vertical margin notes).
    if (Math.abs(t[1]) > size * 0.2 || Math.abs(t[2]) > size * 0.2) continue;
    const f = fonts[it.fontName] || {};
    items.push({
      str: it.str, x: t[4], y: t[5], w: it.width * vp.scale, size,
      b: !!f.bold, i: !!f.italic, eol: !!it.hasEOL,
    });
  }
  return { w: vp.width, h: vp.height, items };
}

// Converts Tesseract word boxes into the same item shape so OCR'd pages share the pipeline.
export function itemsFromOcr(words, scale) {
  const items = [];
  const lineH = (wd) => (wd.line?.bbox ? (wd.line.bbox.y1 - wd.line.bbox.y0) : (wd.bbox.y1 - wd.bbox.y0));
  // Line boxes vary with ascenders/descenders; snap lines near the typical height to one size.
  const hs = words.map(lineH).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)] || 1;
  for (const wd of words) {
    if (!wd.text || wd.confidence < 25) continue;
    const { x0, x1, y1 } = wd.bbox;
    const h = lineH(wd);
    const size = Math.max(4, ((Math.abs(h - med) < med * 0.3 ? med : h) / scale) * 0.78);
    const base = wd.line?.baseline ? wd.line.baseline.y0 : y1;
    items.push({ str: wd.text + ' ', x: x0 / scale, y: base / scale, w: (x1 - x0) / scale, size,
      b: !!wd.is_bold, i: !!wd.is_italic, eol: false });
  }
  return items;
}
