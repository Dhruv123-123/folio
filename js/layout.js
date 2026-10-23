// Rebuilds clean, reflowable book structure from positioned PDF text.
// Input: pages from extract.js. Output: { chapters: [{ title, label, html, text, words }] }.

const CHAPTER_RE = /^(chapter|chap\.|part|book|volume|prologue|epilogue|preface|foreword|introduction|afterword|appendix|acknowledg(e)?ments?|interlude|conclusion|postscript|author'?s note|a note on|dedication|glossary|bibliography|index|notes|contents|table of contents|kapitel|chapitre|cap[ií]tulo|teil)\b/i;
const NUMBER_ONLY_RE = /^(\d{1,3}|[IVXLC]{1,7})\.?$/;
const SCENE_RE = /^([*•·#~◆◇❖⁂✦✧❧☙§※○●◊♦]\s*){1,7}$|^[-–—_=]{3,}$|^[oO0]{3}$/;
const TOC_LINE_RE = /((\.\s?){4,}|(…\s?){2,}|(·\s?){3,}|(_\s?){4,})\s*[\dixvlc]+\s*$/i;
const TERMINAL_RE = /[.!?…:;"”’»)\]]$/;
const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ'’]+/g;

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const weightedMode = (pairs, bucket) => {
  const m = new Map();
  for (const [v, w] of pairs) {
    const k = Math.round(v / bucket) * bucket;
    m.set(k, (m.get(k) || 0) + w);
  }
  let best = 0, bw = -1;
  for (const [k, w] of m) if (w > bw) { bw = w; best = k; }
  return best;
};

// ---------- lines ----------

function makeLines(page, pageIndex) {
  const items = page.items;
  if (!items.length) return [];
  const sizes = items.map((it) => [it.size, it.str.trim().length || 0.1]);
  const pageBody = weightedMode(sizes, 0.5) || 10;

  const drops = [];
  const normal = [];
  for (const it of items) {
    const s = it.str.trim();
    if (s.length && s.length <= 2 && /^[A-Z0-9"“‘']/.test(s) && it.size > pageBody * 2.1) drops.push(it);
    else normal.push(it);
  }
  normal.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  for (const it of normal) {
    let line = null;
    for (let k = lines.length - 1; k >= Math.max(0, lines.length - 3); k--) {
      const L = lines[k];
      const tol = Math.max(Math.max(L.size, it.size) * 0.5, 1.5);
      if (Math.abs(L.y - it.y) <= tol) { line = L; break; }
    }
    if (!line) { line = { y: it.y, size: it.size, items: [] }; lines.push(line); }
    line.items.push(it);
    if (it.size > line.size * 1.05 || (it.size >= line.size * 0.95 && it.str.trim().length > 3)) {
      if (it.size >= line.size * 0.95) line.y = it.y;
      line.size = Math.max(line.size, it.size);
    }
  }

  const out = [];
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    const runs = [];
    let text = '';
    let prev = null;
    let chars = 0, boldChars = 0, italChars = 0;
    const sizeW = [];
    for (const it of L.items) {
      let str = it.str.replace(/\s+/g, ' ');
      if (prev) {
        // Fake-bold PDFs draw the same glyphs twice, slightly offset.
        if (it.str === prev.str && Math.abs(it.x - prev.x) < it.size * 0.3) continue;
        const gap = it.x - (prev.x + prev.w);
        if (gap > Math.min(it.size, prev.size) * 0.17 && !text.endsWith(' ') && !str.startsWith(' ')) str = ' ' + str;
      }
      const sup = it.size < L.size * 0.88 && (L.y - it.y) > L.size * 0.18 && /^[\d*†‡§¶a-z]{1,3}$/i.test(it.str.trim());
      const n = it.str.trim().length;
      chars += n; if (it.b) boldChars += n; if (it.i) italChars += n;
      if (!sup) sizeW.push([it.size, n || 0.1]);
      runs.push({ t: str, b: it.b, i: it.i, sup });
      text += str;
      prev = it;
    }
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    const first = L.items.find((it) => it.str.trim());
    const last = [...L.items].reverse().find((it) => it.str.trim());
    out.push({
      page: pageIndex, y: L.y, size: weightedMode(sizeW, 0.25) || L.size,
      x0: first.x, x1: last.x + last.w, runs, text: trimmed,
      bold: chars > 0 && boldChars / chars > 0.8, italic: chars > 0 && italChars / chars > 0.8,
    });
  }

  // Attach drop caps to the first line they sit beside.
  for (const d of drops) {
    const top = d.y - d.size * 0.75;
    const target = out.find((l) => l.y >= top - 2 && l.y <= d.y + 2 && l.x0 > d.x);
    if (target) {
      target.runs.unshift({ t: d.str.trim(), b: target.bold, i: false, sup: false });
      target.text = d.str.trim() + target.text;
      target.drop = true;
    } else {
      out.push({ page: pageIndex, y: d.y, size: d.size, x0: d.x, x1: d.x + d.w, runs: [{ t: d.str.trim() }], text: d.str.trim(), bold: false, italic: false });
    }
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}

// ---------- page furniture ----------

function normKey(t) {
  return t.toLowerCase()
    .replace(/\b[ivxlcdm]+\b/g, '')
    .replace(/\d+/g, '')
    .replace(/\bpage\b|\bof\b/g, '')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim();
}

function removeFurniture(pageLines, pages, body, lineGap) {
  const n = pageLines.length;
  const counts = new Map();
  const zone = (p, l) => {
    const h = pages[p].h;
    return l.y < h * 0.14 ? 'top' : l.y > h * 0.86 ? 'bottom' : null;
  };
  const cands = [];
  pageLines.forEach((lines, p) => {
    const edge = [...lines.slice(0, 2), ...lines.slice(-2)];
    const seen = new Set();
    for (const l of new Set(edge)) {
      const z = zone(p, l);
      if (!z) continue;
      const key = z + ':' + normKey(l.text);
      cands.push([p, l, key]);
      if (!seen.has(key)) { seen.add(key); counts.set(key, (counts.get(key) || 0) + 1); }
    }
  });
  const threshold = n < 10 ? 2 : Math.max(3, Math.round(n * 0.08));
  const drop = new Set();
  for (const [p, l, key] of cands) {
    if (l.size > body * 1.15) continue;
    const bare = key.split(':')[1];
    if (!bare || bare.length < 2) { drop.add(l); continue; } // page numbers
    if (counts.get(key) >= threshold) drop.add(l);
  }
  // Short running headers that sit alone above a large gap.
  pageLines.forEach((lines, p) => {
    const kept = lines.filter((l) => !drop.has(l));
    if (kept.length < 3) return;
    const [a, b] = kept;
    if (zone(p, a) === 'top' && a.size <= body * 1.05 && a.text.length < 70 && !TERMINAL_RE.test(a.text) && b.y - a.y > lineGap * 2.2 && !CHAPTER_RE.test(a.text)) drop.add(a);
  });
  return pageLines.map((lines) => lines.filter((l) => !drop.has(l) && !TOC_LINE_RE.test(l.text)));
}

// ---------- typography ----------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

export function typo(s, prevChar = ' ') {
  s = s.replace(/­/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F�]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/ﬅ|ﬆ/g, 'st')
    .replace(/\s*---?\s*/g, '—')
    .replace(/\.\s?\.\s?\./g, '…')
    .replace(/(\S) - (\S)/g, '$1 – $2')
    .replace(/ ([,.;:!?)\]}])/g, '$1')
    .replace(/([(\[{]) /g, '$1')
    .replace(/,(?=[A-Za-z]{2})/g, ', ');
  let out = '';
  let p = prevChar;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1] || ' ';
    if (c === '"') {
      out += /[\s([{—–‘“\-/]/.test(p) || p === '' ? '“' : '”';
    } else if (c === "'") {
      if (/[\p{L}\p{N}.,!?]/u.test(p)) out += '’';
      else if (/\d/.test(next) && /[\s]/.test(p)) out += '’';
      else out += /[\s([{—–“\-/]/.test(p) ? '‘' : '’';
    } else out += c;
    p = c;
  }
  return out;
}

function runsToHtml(runs) {
  // Merge adjacent runs with identical style.
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && !!last.b === !!r.b && !!last.i === !!r.i && !!last.sup === !!r.sup) last.t += r.t;
    else merged.push({ ...r });
  }
  let html = '';
  let prev = ' ';
  merged.forEach((r, idx) => {
    let t = typo(r.t, prev);
    if (idx === 0) t = t.replace(/^\s+/, '');
    if (idx === merged.length - 1) t = t.replace(/\s+$/, '');
    if (!t) return;
    prev = t[t.length - 1];
    if (r.sup) { html += `<sup>${esc(t.trim())}</sup>`; return; }
    const lead = t.match(/^\s*/)[0];
    const trail = t.match(/\s*$/)[0];
    let core = esc(t.trim());
    if (!core) { html += ' '; return; }
    if (r.i) core = `<em>${core}</em>`;
    if (r.b) core = `<strong>${core}</strong>`;
    html += (lead ? ' ' : '') + core + (trail ? ' ' : '');
  });
  return html.replace(/\s{2,}/g, ' ').trim();
}

// ---------- main ----------

export function buildBook(pages, opts = {}) {
  const pageLines = pages.map((p, i) => makeLines(p, i));
  const all = pageLines.flat();
  if (!all.length) return { chapters: [], stats: { chars: 0 } };

  const body = weightedMode(all.map((l) => [l.size, l.text.length]), 0.25) || 10;
  const isBody = (l) => Math.abs(l.size - body) <= body * 0.12;

  const gaps = [];
  for (const lines of pageLines) {
    for (let k = 1; k < lines.length; k++) {
      const a = lines[k - 1], b = lines[k];
      if (!isBody(a) || !isBody(b)) continue;
      const d = b.y - a.y;
      if (d > body * 0.8 && d < body * 2.6) gaps.push(d);
    }
  }
  const lineGap = median(gaps) || body * 1.25;

  const cleaned = removeFurniture(pageLines, pages, body, lineGap);

  // Per-page text column bounds, with fallbacks by odd/even page.
  const bounds = cleaned.map((lines) => {
    const bl = lines.filter(isBody);
    if (bl.length < 4) return null;
    const left = weightedMode(bl.map((l) => [l.x0, 1]), 1);
    const lefts = bl.filter((l) => Math.abs(l.x0 - left) < body * 0.6).map((l) => l.x0);
    return { left: lefts.length ? Math.min(...lefts) : left, right: pct(bl.map((l) => l.x1), 0.85) };
  });
  const parityDefault = [0, 1].map((par) => {
    const bs = bounds.filter((b, i) => b && i % 2 === par);
    const any = bounds.filter(Boolean);
    const use = bs.length ? bs : any;
    if (!use.length) return null;
    return { left: median(use.map((b) => b.left)), right: median(use.map((b) => b.right)) };
  });
  const boundsFor = (p) => bounds[p] || parityDefault[p % 2] || (() => {
    const ls = cleaned[p];
    return { left: Math.min(...ls.map((l) => l.x0), pages[p].w * 0.1), right: Math.max(...ls.map((l) => l.x1), pages[p].w * 0.9) };
  })();

  // Vocabulary for deciding whether a line-end hyphen is a real hyphen.
  const vocab = new Set();
  for (const l of all) for (const w of l.text.toLowerCase().match(/[\p{L}-]+/gu) || []) vocab.add(w);

  // ---- blocks ----
  const blocks = [];
  let para = null;
  let prevLine = null;

  const closePara = () => {
    if (!para) return;
    const b = boundsFor(para.page);
    const width = b.right - b.left;
    const ls = para.lines;
    const mid = (l) => (l.x0 + l.x1) / 2;
    const center = (b.left + b.right) / 2;
    const allCentered = ls.every((l) => Math.abs(mid(l) - center) < body * 1.2 && (l.x1 - l.x0) < width * 0.85 && l.x0 > b.left + body);
    const allIndented = ls.length >= 2 && ls.every((l) => l.x0 > b.left + body * 1.5) && ls.every((l) => l.x1 < b.right - body * 1.2);
    if (allCentered) para.cls = 'center';
    else if (allIndented) para.cls = ls.every((l) => l.x1 < b.right - body * 4) ? 'verse' : 'quote';
    const avgSize = ls.reduce((s, l) => s + l.size, 0) / ls.length;
    if (!para.cls && avgSize < body * 0.88) para.cls = 'small';
    blocks.push(para);
    para = null;
  };

  const appendLine = (l) => {
    const runs = l.runs.map((r) => ({ ...r }));
    if (!para.runs.length) { para.runs = runs; return; }
    const last = para.runs[para.runs.length - 1];
    last.t = last.t.replace(/\s+$/, '');
    runs[0].t = runs[0].t.replace(/^\s+/, '');
    const m = last.t.match(/([\p{L}]+)[-‐]$/u);
    const n = runs[0].t.match(/^([\p{Ll}][\p{L}]*)/u);
    if (para.cls === 'verse-pending') {
      runs[0].t = '\n' + runs[0].t;
    } else if (m && n) {
      const joined = (m[1] + n[1]).toLowerCase();
      const hyph = (m[1] + '-' + n[1]).toLowerCase();
      if (vocab.has(hyph) && !vocab.has(joined)) { /* keep real hyphen */ }
      else last.t = last.t.slice(0, -1);
    } else if (/[—–/]$/.test(last.t) || /^[—–]/.test(runs[0].t)) {
      // dashes join directly
    } else {
      runs[0].t = ' ' + runs[0].t;
    }
    para.runs.push(...runs);
  };

  const headingKind = (l, next, prevL) => {
    const t = l.text;
    if (t.length > 160) return null;
    const b = boundsFor(l.page);
    const center = (b.left + b.right) / 2;
    const centered = Math.abs((l.x0 + l.x1) / 2 - center) < body * 1.5 && l.x0 > b.left + body;
    const gapAbove = !prevL || prevL.page !== l.page ? 99 : (l.y - prevL.y) / lineGap;
    const gapBelow = !next || next.page !== l.page ? 99 : (next.y - l.y) / lineGap;
    if (l.size >= body * 1.18) return 'big';
    if (CHAPTER_RE.test(t) && t.length < 70 && (centered || l.bold || gapAbove > 1.6 || l.size > body * 1.05) && !/[,;]$/.test(t)) return 'word';
    if (NUMBER_ONLY_RE.test(t) && (centered || l.bold) && gapBelow > 1.3) return 'number';
    if (l.bold && t.length < 90 && gapAbove > 1.4 && gapBelow > 1.15 && !TERMINAL_RE.test(t.replace(/[”"’]$/, ''))) return 'bold';
    return null;
  };

  // Footnotes: small lines below the last body line of a page. They move to the chapter's end
  // so they don't split paragraphs that continue onto the next page.
  const noteLines = new Set();
  for (const lines of cleaned) {
    let lastBody = -1;
    lines.forEach((l, k) => { if (l.size >= body * 0.92) lastBody = k; });
    if (lastBody < 0 || lastBody === lines.length - 1) continue;
    const tail = lines.slice(lastBody + 1);
    if (!tail.every((l) => l.size < body * 0.9)) continue;
    const gapAbove = tail[0].y - lines[lastBody].y;
    if (gapAbove < lineGap * 1.15 && !/^[\d*†‡§]/.test(tail[0].text)) continue;
    tail.forEach((l) => noteLines.add(l));
  }
  let noteBlock = null;
  const ordered = cleaned.flat();
  for (let k = 0; k < ordered.length; k++) {
    const l = ordered[k];
    const next = ordered[k + 1];
    const b = boundsFor(l.page);
    if (noteLines.has(l)) {
      const startNew = !noteBlock || noteBlock.page !== l.page || /^[\d*†‡§]{1,3}\s?\S/.test(l.text) || l.y - noteBlock.lastY > l.size * 1.8;
      if (startNew) { noteBlock = { type: 'note', page: l.page, runs: [], lastY: l.y }; blocks.push(noteBlock); }
      else noteBlock.runs.push({ t: ' ' });
      noteBlock.runs.push(...l.runs.map((r) => ({ ...r, sup: false })));
      noteBlock.lastY = l.y;
      continue;
    }
    const hk = headingKind(l, next, prevLine);

    if (SCENE_RE.test(l.text) && l.text.length < 20) {
      closePara();
      blocks.push({ type: 'hr', page: l.page, y: l.y });
      prevLine = l;
      continue;
    }
    if (hk) {
      closePara();
      const lastB = blocks[blocks.length - 1];
      const canMerge = lastB && lastB.type === 'h' && prevLine && prevLine.page === l.page &&
        lastB.kind === hk && Math.abs(lastB.size - l.size) < body * 0.12 && (l.y - prevLine.y) < l.size * 1.9 && hk !== 'word' && hk !== 'number';
      if (canMerge) {
        lastB.text += ' ' + l.text;
      } else {
        const atTop = !prevLine || prevLine.page !== l.page;
        blocks.push({ type: 'h', kind: hk, text: l.text, size: l.size, page: l.page, y: l.y, atTop, bold: l.bold });
      }
      prevLine = l;
      continue;
    }

    let start = !para;
    if (para && prevLine) {
      const P = prevLine;
      const pb = boundsFor(P.page);
      const samePage = P.page === l.page;
      const firstWord = (l.text.match(/^\S+/) || [''])[0];
      const wouldFit = P.x1 + (firstWord.length + 1) * l.size * 0.48 < pb.right - l.size * 0.3;
      const endsHyphen = /[\p{L}][-‐]$/u.test(P.text);
      if (samePage && l.y - P.y > lineGap * 1.45) start = true;
      else if (l.x0 > b.left + l.size * 0.7 && l.x0 - (samePage ? P.x0 : b.left) > l.size * 0.5 && !P.drop) start = true;
      else if (!endsHyphen && wouldFit && TERMINAL_RE.test(P.text)) start = true;
      else if (!endsHyphen && P.x1 < pb.right - body * 6) start = true;
      else if (Math.abs(l.size - P.size) > body * 0.15) start = true;
      else if (para.cls === 'center') start = true;
      if (start && samePage && l.y - P.y > lineGap * 2.7 && blocks.length && blocks[blocks.length - 1].type === 'p') {
        closePara();
        blocks.push({ type: 'hr', page: l.page, y: l.y, soft: true });
      }
    }
    if (start) {
      closePara();
      para = { type: 'p', runs: [], lines: [], page: l.page, y: l.y, cls: '' };
    }
    para.lines.push(l);
    appendLine(l);
    prevLine = l;
  }
  closePara();

  // Verse keeps its line breaks.
  for (const bl of blocks) {
    if (bl.type === 'p' && bl.cls === 'verse') {
      bl.html = bl.lines.map((l) => runsToHtml(l.runs)).join('<br>');
    }
  }

  // ---- chapters ----
  const chapters = splitChapters(blocks, opts.outline, body, cleaned);
  // A "Contents" section is replaced by our own TOC; anything else on it (dedications etc.) is kept.
  const isToc = (ch) => /^(table of )?contents$/i.test((ch.title || '').trim()) ||
    (ch.blocks[0]?.type === 'h' && /^(table of )?contents$/i.test(ch.blocks[0].text.trim()));
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    if (!isToc(ch)) continue;
    const rest = ch.blocks.filter((bl) => bl.type === 'p' && !/[\divxlc]\s*$/i.test(htmlToText(runsToHtml(bl.runs)).trim()));
    if (i > 0) chapters[i - 1].blocks.push(...rest);
    else if (chapters[i + 1]) chapters[i + 1].blocks.unshift(...rest);
    chapters.splice(i--, 1);
  }
  const result = [];
  for (const ch of chapters) {
    const r = renderChapter(ch);
    if (r) result.push(r);
  }
  return { chapters: result, stats: { body, lineGap, chars: all.reduce((s, l) => s + l.text.length, 0) } };
}

function splitChapters(blocks, outline, body) {
  const chapters = [];
  const newCh = (title, label, from) => ({ title, label, blocks: [], from });

  const flat = [];
  const walk = (items, depth) => {
    for (const it of items || []) {
      if (it.page != null) flat.push({ ...it, depth });
      if (depth < 1) walk(it.items, depth + 1);
    }
  };
  walk(outline, 0);
  const uniq = [];
  for (const e of flat.sort((a, b) => a.page - b.page || (a.top ?? 0) - (b.top ?? 0))) {
    const last = uniq[uniq.length - 1];
    if (last && last.page === e.page && Math.abs((last.top ?? 0) - (e.top ?? 0)) < 5) continue;
    uniq.push(e);
  }

  if (uniq.length >= 2) {
    let cur = newCh('Front Matter', '', null);
    let idx = 0;
    for (const bl of blocks) {
      while (idx < uniq.length && (bl.page > uniq[idx].page || (bl.page === uniq[idx].page && (uniq[idx].top == null || bl.y >= uniq[idx].top - body * 1.5)))) {
        chapters.push(cur);
        cur = newCh(uniq[idx].title.trim(), '', uniq[idx]);
        idx++;
      }
      cur.blocks.push(bl);
    }
    chapters.push(cur);
    return chapters.filter((c) => c.blocks.length);
  }

  // Heading-driven chapters.
  const isMajor = (bl) => bl.type === 'h' && (bl.kind === 'word' || bl.kind === 'number' || bl.size >= body * 1.4 || (bl.atTop && bl.size >= body * 1.15));
  let majors = blocks.filter(isMajor).length;
  let major = isMajor;
  if (majors < 2) {
    const alt = (bl) => bl.type === 'h' && (bl.kind === 'big' || bl.kind === 'bold');
    if (blocks.filter(alt).length >= 3) { major = alt; majors = 3; }
  }

  if (majors >= 2) {
    let cur = newCh('', '', null);
    let prevWasMajor = false;
    for (const bl of blocks) {
      const m = major(bl);
      if (m && !prevWasMajor && (cur.blocks.length || chapters.length)) {
        chapters.push(cur);
        cur = newCh('', '', null);
      }
      cur.blocks.push(bl);
      prevWasMajor = m || (prevWasMajor && bl.type === 'h');
    }
    chapters.push(cur);
    for (const ch of chapters) {
      const heads = leadingHeads(ch.blocks).map((h) => h.text);
      if (heads.length >= 2 && (CHAPTER_RE.test(heads[0]) || NUMBER_ONLY_RE.test(heads[0]))) { ch.label = heads[0]; ch.title = heads.slice(1).join(' '); }
      else if (heads.length) ch.title = heads.join(' ');
    }
    if (!chapters[0].title) chapters[0].title = 'Front Matter';
    return chapters.filter((c) => c.blocks.length);
  }

  // No structure: split into readable sections at paragraph boundaries.
  const out = [];
  let cur = newCh('', '', null);
  let words = 0;
  for (const bl of blocks) {
    cur.blocks.push(bl);
    words += bl.runs ? bl.runs.reduce((s, r) => s + (r.t.match(WORD_RE) || []).length, 0) : 0;
    if (words > 3500 && bl.type === 'p') { out.push(cur); cur = newCh('', '', null); words = 0; }
  }
  if (cur.blocks.length) out.push(cur);
  out.forEach((c, i) => {
    const p0 = c.blocks[0].page + 1, p1 = c.blocks[c.blocks.length - 1].page + 1;
    c.title = out.length === 1 ? 'Text' : `Section ${i + 1}`;
    c.label = p0 === p1 ? `Page ${p0}` : `Pages ${p0}–${p1}`;
    c.synthetic = true;
  });
  return out;
}

// The chapter opening: an optional label ("Chapter 3", "IV") plus the title. Later headings are sections.
function leadingHeads(bl) {
  const out = [];
  if (bl[0]?.type !== 'h') return out;
  out.push(bl[0]);
  const labelLike = CHAPTER_RE.test(bl[0].text) || NUMBER_ONLY_RE.test(bl[0].text);
  const next = bl[1];
  if (next?.type === 'h') {
    if (labelLike && !CHAPTER_RE.test(next.text)) out.push(next);
    else if (!labelLike && Math.abs(next.size - bl[0].size) < bl[0].size * 0.08 && next.page === bl[0].page) out.push(next);
  }
  return out;
}

function bodySizeOf(bl) {
  const sizes = bl.filter((b) => b.type === 'p').flatMap((b) => b.lines.map((l) => [l.size, l.text.length]));
  return weightedMode(sizes, 0.25) || 10;
}

function renderChapter(ch) {
  const parts = [];
  const bl = ch.blocks;
  let i = 0;
  const heads = leadingHeads(bl);
  i = heads.length;
  let label = ch.label, title = ch.title;
  if (heads.length) {
    if (heads.length >= 2 && (CHAPTER_RE.test(heads[0].text) || NUMBER_ONLY_RE.test(heads[0].text))) {
      label = heads[0].text; title = heads.slice(1).map((h) => h.text).join(' ');
    } else if (heads.length === 1 && (CHAPTER_RE.test(heads[0].text) || NUMBER_ONLY_RE.test(heads[0].text)) && ch.title && ch.from && ch.title.toLowerCase() !== heads[0].text.toLowerCase()) {
      label = heads[0].text;
    } else {
      title = heads.map((h) => h.text).join(' ');
      if (ch.from && ch.title && !title.toLowerCase().includes(ch.title.toLowerCase().slice(0, 12))) {
        label = '';
      }
    }
  }
  if (!title && !label && ch.from) title = ch.title;
  const numbered = !label && title && title.match(/^(\d{1,3}|[IVXLC]{1,6})[.:]\s+(\S.{2,})$/);
  if (numbered) { label = numbered[1]; title = numbered[2]; }
  if (title || label) {
    const t = title ? typo(title) : '';
    const lb = label ? typo(label) : '';
    parts.push(`<header class="ch-head">${lb ? `<div class="ch-label">${esc(lb)}</div>` : ''}${t ? `<h1 class="ch-title">${esc(t)}</h1>` : ''}</header>`);
  }
  let afterBreak = true;
  let inQuote = false;
  const notes = [];
  for (; i < bl.length; i++) {
    const b = bl[i];
    if (b.type === 'h') {
      if (inQuote) { parts.push('</blockquote>'); inQuote = false; }
      const tag = b.size >= bodySizeOf(bl) * 1.15 ? 'h2' : 'h3';
      parts.push(`<${tag}>${esc(typo(b.text))}</${tag}>`);
      afterBreak = true;
      continue;
    }
    if (b.type === 'hr') {
      if (inQuote) { parts.push('</blockquote>'); inQuote = false; }
      parts.push('<hr class="scene">');
      afterBreak = true;
      continue;
    }
    if (b.type === 'note') { notes.push(b); continue; }
    const html = b.html || runsToHtml(b.runs);
    if (!html) continue;
    const quoteLike = b.cls === 'quote' || b.cls === 'verse';
    if (quoteLike && !inQuote) { parts.push(`<blockquote${b.cls === 'verse' ? ' class="verse"' : ''}>`); inQuote = true; }
    if (!quoteLike && inQuote) { parts.push('</blockquote>'); inQuote = false; afterBreak = true; }
    const cls = [];
    if (afterBreak && !quoteLike) cls.push('first');
    if (b.cls === 'center' || b.cls === 'small') cls.push(b.cls);
    parts.push(`<p${cls.length ? ` class="${cls.join(' ')}"` : ''}>${html}</p>`);
    afterBreak = false;
  }
  if (inQuote) parts.push('</blockquote>');
  if (notes.length) {
    parts.push('<section class="notes"><h3>Notes</h3>' + notes.map((n) => `<p>${runsToHtml(n.runs)}</p>`).join('') + '</section>');
  }
  const html = parts.join('\n');
  const text = htmlToText(html);
  const words = (text.match(WORD_RE) || []).length;
  if (!words) return null;
  return {
    title: typo(title || label || ch.title || 'Untitled'),
    label: title && label ? typo(label) : '',
    html, text, words,
    page: bl[0]?.page ?? 0,
  };
}

export function htmlToText(html) {
  return html.replace(/<br>/g, '\n').replace(/<\/(p|h1|h2|h3|div|header|blockquote)>/g, '\n').replace(/<hr[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
