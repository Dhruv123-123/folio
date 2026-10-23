// Browser-side PDF import: pdf.js extraction, optional OCR for scanned books, cover art.
import { extractPage, itemsFromOcr } from './extract.js';
import { buildBook } from './layout.js';
import { resolveOutline } from './outline.js';

const base = new URL('../vendor/', import.meta.url).href;
let pdfjsP;
function pdfjs() {
  if (!pdfjsP) {
    pdfjsP = import('../vendor/pdfjs/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = base + 'pdfjs/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsP;
}

export async function openPdf(file) {
  const lib = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({
    data,
    cMapUrl: base + 'pdfjs/cmaps/', cMapPacked: true,
    standardFontDataUrl: base + 'pdfjs/standard_fonts/',
    fontExtraProperties: true, isEvalSupported: false, verbosity: 0,
  }).promise;
  return { lib, pdf };
}

// onStage(label, fraction) reports progress. ocr: 'auto' | 'never' | 'ask' (ask returns a promise<boolean> via opts.confirmOcr)
export async function importPdf(file, { onStage = () => {}, confirmOcr, signal } = {}) {
  onStage('Opening', 0);
  const { lib, pdf } = await openPdf(file);
  const n = pdf.numPages;
  const pages = [];
  for (let i = 1; i <= n; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const page = await pdf.getPage(i);
    pages.push(await extractPage(lib, page));
    page.cleanup();
    onStage(`Reading page ${i} of ${n}`, (i / n) * 0.7);
  }

  // Scanned books have (almost) no text layer.
  const textPages = pages.filter((p) => p.items.reduce((s, it) => s + it.str.length, 0) > 40).length;
  let ocrUsed = false;
  if (textPages < n * 0.3 && n > 0) {
    const go = confirmOcr ? await confirmOcr(n) : true;
    if (go) {
      ocrUsed = true;
      await ocrPages(pdf, pages, (i) => onStage(`Recognizing text, page ${i} of ${n}`, 0.1 + (i / n) * 0.8), signal);
    }
  }

  onStage('Formatting text', 0.85);
  await new Promise((r) => setTimeout(r, 20));
  const outline = await resolveOutline(pdf);
  const book = buildBook(pages, { outline });

  onStage('Making cover', 0.95);
  let meta = {};
  try { meta = (await pdf.getMetadata()).info || {}; } catch { /* no metadata */ }
  const fileTitle = file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const guess = guessTitleAuthor(book, fileTitle);
  const title = cleanMeta(meta.Title) && !/^(untitled|microsoft word|document\d*)/i.test(meta.Title) && !/\.(docx?|indd|pdf)$/i.test(meta.Title) ? cleanMeta(meta.Title) : guess.title;
  const author = cleanMeta(meta.Author) && !/^(admin|user|owner|unknown)$/i.test(meta.Author) ? cleanMeta(meta.Author) : guess.author;
  let cover = null, coverDesigned = false;
  try { ({ blob: cover, designed: coverDesigned } = await renderCover(pdf, title, author)); } catch { cover = null; }
  await pdf.destroy();

  return { title, author, cover, coverDesigned, chapters: book.chapters, pageCount: n, ocr: ocrUsed };
}

const cleanMeta = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

function guessTitleAuthor(book, fileTitle) {
  const first = book.chapters[0];
  let title = fileTitle;
  let author = '';
  if (first && /front matter|^the|./i.test(first.title) && first.words < 120) {
    if (first.title && first.title !== 'Front Matter' && first.title.length < 90) title = first.title;
    const m = first.text.split('\n').map((s) => s.trim()).filter(Boolean);
    const by = m.find((s) => /^by\s+/i.test(s));
    if (by) author = by.replace(/^by\s+/i, '');
    else if (m[1] && m[1].length < 40 && /^[\p{Lu}][\p{L}.'’ -]+$/u.test(m[1]) && m[1].split(' ').length <= 4) author = m[1];
  }
  return { title, author };
}

async function renderCover(pdf, title, author) {
  const page = await pdf.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = 600 / vp1.width;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  // A plain text title page makes a dull cover; design one instead.
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0, colorful = 0;
  for (let i = 0; i < img.length; i += 4 * 16) {
    const r = img[i], g = img[i + 1], b = img[i + 2];
    const l = (r + g + b) / 3;
    if (l < 200) dark++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colorful++;
  }
  const samples = img.length / 64;
  if (dark / samples < 0.12 && colorful / samples < 0.05) return { blob: await designedCover(title, author), designed: true };
  return { blob: await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85)), designed: false };
}

const PALETTES = [
  ['#1f3a5f', '#f4e9d8'], ['#6b2737', '#f6e7d7'], ['#24453a', '#efe6cf'], ['#3d2c4f', '#f1e4f0'],
  ['#8a4b1f', '#fbf0e0'], ['#1d2b2f', '#e6d3a3'], ['#5a3e2b', '#f3e3c3'], ['#2e3f6e', '#e8e1d0'],
];

export async function designedCover(title, author) {
  const W = 600, H = 900;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  let hsh = 0;
  for (const c of title) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTES[hsh % PALETTES.length];
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, 'rgba(255,255,255,.10)'); grad.addColorStop(1, 'rgba(0,0,0,.25)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = fg; ctx.globalAlpha = 0.55; ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, W - 72, H - 72);
  ctx.strokeRect(46, 46, W - 92, H - 92);
  ctx.globalAlpha = 1;
  ctx.fillStyle = fg; ctx.textAlign = 'center';
  const serif = '"Iowan Old Style", "Palatino", "Georgia", serif';
  let size = 64;
  let lines;
  do {
    ctx.font = `600 ${size}px ${serif}`;
    lines = wrap(ctx, title, W - 150);
    size -= 4;
  } while ((lines.length > 5 || lines.length * size * 1.2 > 420) && size > 28);
  size += 4;
  const lh = size * 1.18;
  let y = H * 0.38 - (lines.length * lh) / 2 + size;
  for (const l of lines) { ctx.fillText(l, W / 2, y); y += lh; }
  ctx.globalAlpha = 0.7; ctx.fillRect(W / 2 - 30, y + 10, 60, 2); ctx.globalAlpha = 1;
  if (author) {
    ctx.font = `400 30px ${serif}`;
    ctx.fillText(author.toUpperCase().split('').join(' '), W / 2, H - 120);
  }
  return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
}

function wrap(ctx, text, max) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

let tessP;
function tesseract() {
  if (!tessP) {
    tessP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = base + 'tesseract/tesseract.min.js';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error('Could not load text recognition'));
      document.head.appendChild(s);
    });
  }
  return tessP;
}

async function ocrPages(pdf, pages, onPage, signal) {
  const T = await tesseract();
  const worker = await T.createWorker('eng', 1, {
    workerPath: base + 'tesseract/worker.min.js',
    corePath: base + 'tesseract/core/',
    langPath: base + 'tesseract/lang',
    gzip: true,
  });
  try {
    for (let i = 0; i < pages.length; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (pages[i].items.length > 20) { onPage(i + 1); continue; }
      const page = await pdf.getPage(i + 1);
      const scale = 2;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) words.push({ ...w, line: l });
      pages[i].items = itemsFromOcr(words, scale);
      page.cleanup();
      onPage(i + 1);
    }
  } finally {
    await worker.terminate();
  }
}
