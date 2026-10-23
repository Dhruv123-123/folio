// The reading view: column-based pagination, page turns, location tracking,
// highlights, bookmarks, search jumps and whole-book page numbers.
import { patchBook, flushBook } from './db.js';

export const SIZES = [14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 29, 32, 36];
export const FONTS = [
  { id: 'iowan', name: 'Iowan', css: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  { id: 'newyork', name: 'New York', css: '"New York", ui-serif, "Iowan Old Style", Georgia, serif' },
  { id: 'charter', name: 'Charter', css: 'Charter, "Bitstream Charter", "Charis SIL", Cambria, Georgia, serif' },
  { id: 'athelas', name: 'Athelas', css: 'Athelas, "Book Antiqua", Georgia, serif' },
  { id: 'palatino', name: 'Palatino', css: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { id: 'georgia', name: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  { id: 'baskerville', name: 'Baskerville', css: 'Baskerville, "Libre Baskerville", "Baskerville Old Face", Georgia, serif' },
  { id: 'times', name: 'Times', css: '"Times New Roman", Times, serif' },
  { id: 'sf', name: 'San Francisco', css: '-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif' },
  { id: 'seravek', name: 'Seravek', css: 'Seravek, "Gill Sans Nova", "Gill Sans", "Avenir Next", Ubuntu, sans-serif' },
  { id: 'avenir', name: 'Avenir Next', css: '"Avenir Next", Avenir, "Segoe UI", sans-serif' },
  { id: 'dyslexic', name: 'Verdana', css: 'Verdana, Geneva, Tahoma, sans-serif' },
];
export const THEMES = [
  { id: 'original', name: 'Original', bg: '#ffffff', ink: '#121212' },
  { id: 'quiet', name: 'Quiet', bg: '#4a4a4d', ink: '#dcdcdc' },
  { id: 'paper', name: 'Paper', bg: '#efece5', ink: '#1e1d1b' },
  { id: 'bold', name: 'Bold', bg: '#ffffff', ink: '#000', bold: true },
  { id: 'calm', name: 'Calm', bg: '#f3e6cc', ink: '#3a2f22' },
  { id: 'focus', name: 'Focus', bg: '#fbf8ef', ink: '#161512' },
  { id: 'sepia-dark', name: 'Ember', bg: '#1e1a14', ink: '#d6c7a8' },
  { id: 'night', name: 'Night', bg: '#000000', ink: '#b8b8b8' },
];
export const DEFAULTS = {
  theme: 'original', autoNight: true, font: 'iowan', fs: 6, lh: 1.5, margin: 1,
  justify: true, spread: true, scroll: false, turn: 'slide', drop: false,
};

const $ = (id) => document.getElementById(id);

export class Reader {
  constructor({ onClose, onChange, toast, openSheet, dialog }) {
    this.cb = { onClose, onChange, toast, openSheet, dialog };
    this.el = {
      root: $('reader'), stage: $('rStage'), vp: $('rViewport'), content: $('rContent'),
      runhead: $('rRunhead'), footL: $('rFootLeft'), footC: $('rFootCenter'), footR: $('rFootRight'),
      title: $('rTitle'), scrub: $('rScrub'), scrubLabel: $('rScrubLabel'), scrubL: $('rScrubLeft'), scrubR: $('rScrubRight'),
      ribbon: $('rRibbon'), mark: $('rMark'), hlMenu: $('hlMenu'), mvp: $('mViewport'), mcontent: $('mContent'),
    };
    this.book = null;
    this.chapters = [];
    this.ch = 0; this.page = 0; this.pageCount = 1;
    this.anchor = 0;
    this.measure = null; this.measureToken = 0;
    this.nodes = null;
    this.selMenuFor = null;
    this.bindGestures();
    this.bindSelection();
    this.bindMenus();
    window.addEventListener('resize', () => this.isOpen() && this.scheduleRelayout());
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.book) flushBook(this.book.id); });
  }

  isOpen() { return !!this.book && !this.el.root.hidden; }

  // ---------- open / close ----------
  async open(book, content, settings) {
    this.book = book;
    this.chapters = content.chapters;
    this.wordsBefore = [];
    let acc = 0;
    for (const c of this.chapters) { this.wordsBefore.push(acc); acc += c.words || 1; }
    this.totalWords = acc;
    this.book.bookmarks ||= [];
    this.book.highlights ||= [];
    this.el.title.textContent = book.title;
    this.el.root.hidden = false;
    this.el.root.classList.remove('chrome');
    this.measure = null;
    this.settings = settings;
    this.applySettingsVars();
    const pr = book.progress || { ch: 0, off: 0 };
    this.ch = Math.min(pr.ch || 0, this.chapters.length - 1);
    this.anchor = pr.off || 0;
    await document.fonts?.ready;
    this.layoutGeometry();
    this.renderChapter(this.ch);
    this.goToOffset(this.anchor, false);
    this.scheduleMeasure();
    patchBook(book.id, { openedAt: Date.now() });
  }

  async close() {
    this.hideMenu();
    if (this.book) { this.saveProgress(true); await flushBook(this.book.id); }
    this.el.root.hidden = true;
    this.el.content.innerHTML = '';
    const b = this.book;
    this.book = null;
    this.cb.onClose?.(b);
  }

  // ---------- settings & geometry ----------
  setSettings(s) {
    const prevScroll = this.settings?.scroll;
    this.settings = s;
    if (!this.isOpen()) return;
    this.applySettingsVars();
    if (prevScroll !== s.scroll) this.renderChapter(this.ch);
    this.relayout();
  }

  effectiveTheme() {
    const s = this.settings;
    if (s.autoNight && matchMedia('(prefers-color-scheme: dark)').matches && !['night', 'quiet', 'sepia-dark'].includes(s.theme)) return 'night';
    return s.theme;
  }

  applySettingsVars() {
    const s = this.settings, r = this.el.root;
    const theme = this.effectiveTheme();
    r.className = 'view t-' + theme + (s.scroll ? ' scroll-mode' : '') + (r.classList.contains('chrome') ? ' chrome' : '');
    const font = (FONTS.find((f) => f.id === s.font) || FONTS[0]).css;
    const vars = { '--font': font, '--fs': SIZES[s.fs] + 'px', '--lh': String(s.lh), '--weight': theme === 'bold' ? '600' : '400' };
    for (const [k, v] of Object.entries(vars)) { r.style.setProperty(k, v); this.el.mcontent.style.setProperty(k, v); }
    for (const c of [this.el.content, this.el.mcontent]) {
      c.classList.toggle('justify', !!s.justify);
      c.classList.toggle('dropcaps', !!s.drop);
    }
    const t = THEMES.find((x) => x.id === theme);
    setThemeColor(t ? t.bg : '#ffffff');
  }

  layoutGeometry() {
    const s = this.settings;
    const vw = window.innerWidth, vh = window.innerHeight;
    const safe = safeInsets();
    const fs = SIZES[s.fs];
    const scroll = !!s.scroll;
    const marginFrac = [0.04, 0.075, 0.12][s.margin ?? 1];
    const side = Math.max(20, Math.round(vw * marginFrac));
    const top = safe.top + (vh < 500 ? 40 : 58);
    const bottom = safe.bottom + (vh < 500 ? 36 : 52);
    const spread = !scroll && s.spread && vw >= 900 && vw > vh * 1.05;
    const gap = spread ? Math.max(56, side * 1.6) : side * 2;
    let width = vw - safe.left - safe.right - side * 2;
    const maxCol = fs * 33;
    width = spread ? Math.min(width, maxCol * 2 + gap) : Math.min(width, maxCol);
    width = Math.floor(width);
    const height = Math.floor(vh - top - bottom);
    const left = Math.round((vw - width) / 2);
    this.geo = { width, height, gap, spread, left, top, stride: width + gap, scroll };
    for (const [vp, c] of [[this.el.vp, this.el.content], [this.el.mvp, this.el.mcontent]]) {
      Object.assign(vp.style, { left: left + 'px', top: (scroll ? 0 : top) + 'px', width: width + 'px', height: (scroll ? vh : height) + 'px' });
      if (scroll) {
        Object.assign(c.style, { width: width + 'px', height: 'auto', columnCount: 'auto', columnWidth: 'auto', columnGap: 'normal', columnFill: 'auto', paddingTop: top + 'px' });
      } else {
        // WebKit ignores `column-count: 1` (no multicol, so no extra pages), so single-page mode
        // is set up with an explicit column width instead.
        const colW = spread ? (width - gap) / 2 : width;
        Object.assign(c.style, { width: width + 'px', height: height + 'px', columnCount: spread ? '2' : 'auto', columnWidth: colW + 'px', columnGap: gap + 'px', columnFill: 'auto', paddingTop: '0' });
      }
    }
    if (scroll) { this.el.vp.style.left = '0'; this.el.vp.style.width = vw + 'px'; this.el.content.style.margin = '0 auto'; }
    else this.el.content.style.margin = '0';
    this.layoutKey = [width, height, gap, spread, scroll, s.font, s.fs, s.lh, s.justify, s.drop, this.effectiveTheme() === 'bold'].join('|');
  }

  scheduleRelayout() {
    clearTimeout(this._rl);
    this._rl = setTimeout(() => this.relayout(), 120);
  }

  relayout() {
    if (!this.isOpen()) return;
    this.hideMenu();
    this.layoutGeometry();
    this.nodes = null;
    this.pageCount = this.countPages(this.el.content);
    this.goToOffset(this.anchor, false);
    this.scheduleMeasure();
  }

  // ---------- rendering ----------
  renderChapter(i) {
    this.ch = i;
    const c = this.chapters[i];
    this.el.content.innerHTML = normHtml(c.html);
    this.nodes = null;
    for (const h of this.book.highlights.filter((h) => h.ch === i)) this.wrapRange(h.s, h.e, hlClass(h), h.id);
    this.el.vp.querySelector('.scroll-nav')?.remove();
    if (this.settings.scroll) this.addScrollNav();
    this.pageCount = this.countPages(this.el.content);
  }

  addScrollNav() {
    const nav = document.createElement('div');
    nav.className = 'scroll-nav';
    nav.style.cssText = 'display:flex;justify-content:space-between;gap:12px;max-width:' + this.geo.width + 'px;margin:-36vh auto 30vh;font-family:var(--ui, system-ui)';
    const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'padding:12px 18px;border-radius:12px;background:var(--r-line);color:var(--r-ink);font-weight:600'; b.onclick = fn; return b; };
    nav.append(this.ch > 0 ? mk('‹ ' + this.chapters[this.ch - 1].title, () => this.goToChapter(this.ch - 1)) : document.createElement('span'));
    if (this.ch < this.chapters.length - 1) nav.append(mk(this.chapters[this.ch + 1].title + ' ›', () => this.goToChapter(this.ch + 1)));
    this.el.vp.append(nav);
  }

  countPages(content) {
    if (this.settings.scroll) return 1;
    const last = content.lastElementChild;
    if (!last) return 1;
    const rects = last.getClientRects();
    const r = rects[rects.length - 1];
    if (!r) return 1;
    const c = content.getBoundingClientRect();
    return Math.max(1, Math.floor((r.left + Math.min(r.width, 4) - c.left) / this.geo.stride + 0.0001) + 1);
  }

  // ---------- text offsets ----------
  getNodes() {
    if (this.nodes) return this.nodes;
    const arr = [];
    const map = new Map();
    const w = document.createTreeWalker(this.el.content, NodeFilter.SHOW_TEXT);
    let n, pos = 0;
    while ((n = w.nextNode())) { arr.push({ n, s: pos }); map.set(n, pos); pos += n.data.length; }
    this.nodes = { arr, map, total: pos, _text: null };
    return this.nodes;
  }

  fullText() {
    const N = this.getNodes();
    if (N._text == null) N._text = N.arr.map((x) => x.n.data).join('');
    return N._text;
  }

  locate(off) {
    const { arr } = this.getNodes();
    if (!arr.length) return null;
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid].s <= off) lo = mid; else hi = mid - 1;
    }
    const e = arr[lo];
    return [e.n, Math.max(0, Math.min(off - e.s, e.n.data.length))];
  }

  offsetOf(node, o) {
    const N = this.getNodes();
    if (node.nodeType === 3) return (N.map.get(node) ?? 0) + o;
    const w = document.createTreeWalker(this.el.content, NodeFilter.SHOW_TEXT);
    let target = node.childNodes[o];
    if (!target) {
      // Past the last child: first text node after this element.
      let cur = node;
      while (cur && !cur.nextSibling && cur !== this.el.content) cur = cur.parentNode;
      if (!cur || cur === this.el.content) return N.total;
      target = cur.nextSibling;
    }
    if (target.nodeType === 3) return N.map.get(target) ?? 0;
    w.currentNode = target;
    const t = w.nextNode();
    return t ? (N.map.get(t) ?? N.total) : N.total;
  }

  charRect(off) {
    const loc = this.locate(off);
    if (!loc) return null;
    const [n, o] = loc;
    const len = n.data.length;
    if (!len) return null;
    const a = Math.min(o, len - 1);
    const r = document.createRange();
    r.setStart(n, a); r.setEnd(n, a + 1);
    const rects = r.getClientRects();
    return rects[0] || null;
  }

  pageOfOffset(off) {
    const { total } = this.getNodes();
    const c = this.el.content.getBoundingClientRect();
    for (let k = 0; k < 40 && off + k < total; k++) {
      const r = this.charRect(off + k);
      if (r && (r.width || r.height)) return Math.max(0, Math.min(this.pageCount - 1, Math.floor((r.left + r.width / 2 - c.left) / this.geo.stride)));
    }
    return 0;
  }

  pageStartOffset(p) {
    if (p <= 0) return 0;
    const { total } = this.getNodes();
    let lo = 0, hi = total;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pageOfOffset(mid) >= p) hi = mid; else lo = mid + 1;
    }
    return Math.min(lo, total);
  }

  // scroll mode: first character visible at the top of the viewport
  scrollTopOffset() {
    const { total } = this.getNodes();
    const top = this.geo.top + 4;
    let lo = 0, hi = total;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const r = this.charRect(mid);
      if (r && r.bottom > top) hi = mid; else lo = mid + 1;
    }
    return lo;
  }

  // ---------- navigation ----------
  goToOffset(off, animate) {
    if (this.settings.scroll) {
      const r = this.charRect(Math.min(off, Math.max(0, this.getNodes().total - 1)));
      const vp = this.el.vp;
      if (r) vp.scrollTop += r.top - this.geo.top - 8;
      else vp.scrollTop = 0;
      if (off === 0) vp.scrollTop = 0;
      this.afterTurn();
      return;
    }
    this.page = this.pageOfOffset(off);
    this.applyTransform(animate);
    this.afterTurn(off);
  }

  applyTransform(animate, extra = 0) {
    const c = this.el.content;
    c.classList.toggle('anim', !!animate && this.settings.turn === 'slide');
    c.style.transform = `translate3d(${-this.page * this.geo.stride + extra}px,0,0)`;
  }

  setPage(p, animate = true) {
    if (this.settings.turn === 'fade' && animate) {
      const c = this.el.content;
      c.classList.add('fade-out');
      setTimeout(() => { this.page = p; this.applyTransform(false); c.classList.remove('fade-out'); this.afterTurn(); }, 140);
      return;
    }
    this.page = p;
    this.applyTransform(animate);
    this.afterTurn();
  }

  next() {
    this.hideMenu();
    if (this.settings.scroll) { this.el.vp.scrollBy({ top: this.el.vp.clientHeight * 0.85, behavior: 'smooth' }); return; }
    if (this.page < this.pageCount - 1) this.setPage(this.page + 1);
    else if (this.ch < this.chapters.length - 1) this.changeChapter(this.ch + 1, 'start');
    else { this.applyTransform(true); this.cb.toast?.('You’ve reached the end of the book'); this.markFinished(); }
  }

  prev() {
    this.hideMenu();
    if (this.settings.scroll) { this.el.vp.scrollBy({ top: -this.el.vp.clientHeight * 0.85, behavior: 'smooth' }); return; }
    if (this.page > 0) this.setPage(this.page - 1);
    else if (this.ch > 0) this.changeChapter(this.ch - 1, 'end');
    else this.applyTransform(true);
  }

  changeChapter(i, where) {
    this.renderChapter(i);
    this.page = where === 'end' ? this.pageCount - 1 : 0;
    const c = this.el.content;
    if (this.settings.turn === 'slide') {
      c.classList.remove('anim');
      c.style.transform = `translate3d(${-this.page * this.geo.stride + (where === 'start' ? this.geo.stride : -this.geo.stride)}px,0,0)`;
      void c.offsetWidth;
      this.applyTransform(true);
    } else this.applyTransform(false);
    this.afterTurn();
  }

  goToChapter(i, off = 0) {
    this.hideMenu();
    this.renderChapter(i);
    if (this.settings.scroll) this.el.vp.scrollTop = 0;
    this.goToOffset(off, false);
  }

  goToPercent(f) {
    const target = f * this.totalWords;
    let i = 0;
    while (i < this.chapters.length - 1 && this.wordsBefore[i + 1] <= target) i++;
    const frac = Math.max(0, Math.min(1, (target - this.wordsBefore[i]) / (this.chapters[i].words || 1)));
    if (i !== this.ch) this.renderChapter(i);
    if (this.settings.scroll) {
      const vp = this.el.vp;
      vp.scrollTop = frac * (vp.scrollHeight - vp.clientHeight);
      this.afterTurn();
      return;
    }
    this.page = Math.min(this.pageCount - 1, Math.round(frac * (this.pageCount - 1)));
    this.applyTransform(false);
    this.afterTurn();
  }

  goToSearch(ch, query, nth) {
    if (ch !== this.ch) this.renderChapter(ch);
    const text = this.fullText().toLowerCase();
    const q = query.toLowerCase();
    let idx = -1;
    for (let k = 0; k <= nth; k++) { idx = text.indexOf(q, idx + 1); if (idx < 0) break; }
    if (idx < 0) { this.goToOffset(0, false); return; }
    this.wrapRange(idx, idx + q.length, 'search-hit', 'search');
    this.goToOffset(idx, false);
    setTimeout(() => this.unwrap('search'), 2600);
  }

  afterTurn(knownOffset) {
    if (!this.book) return;
    if (this.settings.scroll) this.anchor = this.scrollTopOffset();
    else this.anchor = knownOffset != null ? knownOffset : this.pageStartOffset(this.page);
    this.updateChrome();
    this.saveProgress();
  }

  percent() {
    const words = this.chapters[this.ch].words || 1;
    let frac;
    if (this.settings.scroll) {
      const vp = this.el.vp;
      frac = vp.scrollHeight > vp.clientHeight ? vp.scrollTop / (vp.scrollHeight - vp.clientHeight) : 1;
    } else frac = this.pageCount > 1 ? this.page / (this.pageCount - 1) : 1;
    return Math.min(1, (this.wordsBefore[this.ch] + words * frac) / this.totalWords);
  }

  saveProgress(now) {
    const pct = this.percent();
    const progress = { ch: this.ch, off: this.anchor, pct };
    this.book.progress = progress;
    const patch = { progress };
    if (pct >= 0.995 && !this.book.finished) { this.book.finished = true; patch.finished = true; }
    patchBook(this.book.id, patch);
    if (now) flushBook(this.book.id);
    this.cb.onChange?.(this.book);
  }

  markFinished() {
    this.book.finished = true;
    patchBook(this.book.id, { finished: true });
  }

  updateChrome() {
    const ch = this.chapters[this.ch];
    const pct = this.percent();
    this.el.runhead.textContent = this.page === 0 && !this.settings.scroll ? '' : ch.title;
    const left = Math.max(0, this.pageCount - 1 - this.page);
    if (this.settings.scroll) {
      this.el.footC.textContent = Math.round(pct * 100) + '%';
      this.el.footR.textContent = ''; this.el.footL.textContent = '';
    } else if (this.measure && this.measure.key === this.layoutKey) {
      const g = this.measure.starts[this.ch] + this.page + 1;
      this.el.footC.textContent = `${g} of ${this.measure.total}`;
      this.el.footR.textContent = left ? `${left} page${left === 1 ? '' : 's'} left in chapter` : (this.ch < this.chapters.length - 1 ? 'Last page in chapter' : '');
      this.el.footL.textContent = '';
    } else {
      this.el.footC.textContent = `${this.page + 1} of ${this.pageCount}`;
      this.el.footR.textContent = left ? `${left} page${left === 1 ? '' : 's'} left in chapter` : '';
      this.el.footL.textContent = '';
    }
    if (!this.scrubbing) this.el.scrub.value = String(Math.round(pct * 1000));
    this.el.scrubLabel.textContent = (ch.label ? ch.label + ' · ' : '') + ch.title;
    this.el.scrubL.textContent = this.measure && this.measure.key === this.layoutKey ? `Page ${this.measure.starts[this.ch] + this.page + 1} of ${this.measure.total}` : `${Math.round(pct * 100)}% read`;
    this.el.scrubR.textContent = this.timeLeftLabel();
    const bm = this.pageBookmark();
    this.el.ribbon.hidden = !bm;
    this.el.mark.classList.toggle('on', !!bm);
  }

  timeLeftLabel() {
    const words = this.chapters[this.ch].words || 0;
    const frac = this.pageCount > 1 ? this.page / (this.pageCount - 1) : 1;
    const mins = Math.round((words * (1 - frac)) / 230);
    if (mins < 1) return 'Less than a minute left in chapter';
    return `${mins} min left in chapter`;
  }

  // ---------- whole-book page numbers (measured in the background) ----------
  scheduleMeasure() {
    if (this.settings.scroll) return;
    const token = ++this.measureToken;
    const key = this.layoutKey;
    const cache = (this.measureCache ||= new Map());
    const cacheKey = this.book.id + '|' + key;
    if (cache.has(cacheKey)) { this.measure = cache.get(cacheKey); this.updateChrome(); return; }
    const run = async () => {
      const counts = [];
      for (let i = 0; i < this.chapters.length; i++) {
        if (token !== this.measureToken || !this.book) return;
        if (i === this.ch) counts.push(this.pageCount);
        else {
          this.el.mcontent.innerHTML = normHtml(this.chapters[i].html);
          counts.push(this.countPages(this.el.mcontent));
        }
        if (i % 2 === 1) await idle();
      }
      this.el.mcontent.innerHTML = '';
      if (token !== this.measureToken) return;
      const starts = [];
      let acc = 0;
      for (const n of counts) { starts.push(acc); acc += n; }
      this.measure = { key, starts, total: acc, counts };
      cache.set(cacheKey, this.measure);
      this.updateChrome();
      this.cb.onChange?.(this.book);
    };
    setTimeout(run, 300);
  }

  pageOfChapter(i) {
    if (this.measure && this.measure.key === this.layoutKey) return this.measure.starts[i] + 1;
    return null;
  }

  // ---------- bookmarks ----------
  pageRange() {
    if (this.settings.scroll) {
      return [this.anchor, this.anchor + 600];
    }
    const s = this.anchor;
    const e = this.page < this.pageCount - 1 ? this.pageStartOffset(this.page + 1) : Infinity;
    return [s, e];
  }

  pageBookmark() {
    if (!this.book) return null;
    const [s, e] = this.pageRange();
    return this.book.bookmarks.find((b) => b.ch === this.ch && b.off >= s && b.off < e) || null;
  }

  toggleBookmark() {
    const existing = this.pageBookmark();
    if (existing) {
      const [s, e] = this.pageRange();
      this.book.bookmarks = this.book.bookmarks.filter((b) => !(b.ch === this.ch && b.off >= s && b.off < e));
    } else {
      const text = this.fullText();
      this.book.bookmarks.push({
        id: uid(), ch: this.ch, off: this.anchor, at: Date.now(), pct: this.percent(),
        snippet: text.slice(this.anchor, this.anchor + 140).replace(/\s+/g, ' ').trim(),
      });
    }
    patchBook(this.book.id, { bookmarks: this.book.bookmarks });
    this.updateChrome();
  }

  // ---------- highlights ----------
  wrapRange(s, e, cls, id) {
    const { arr } = this.getNodes();
    for (const { n, s: ns } of arr) {
      const len = n.data.length;
      if (ns >= e || ns + len <= s) continue;
      const a = Math.max(0, s - ns), b = Math.min(len, e - ns);
      if (b <= a) continue;
      let node = n;
      if (b < len) node.splitText(b);
      if (a > 0) node = node.splitText(a);
      const mark = document.createElement('mark');
      mark.className = cls;
      mark.dataset.hid = id;
      node.parentNode.insertBefore(mark, node);
      mark.appendChild(node);
    }
    this.nodes = null;
  }

  unwrap(id) {
    for (const m of [...this.el.content.querySelectorAll(`mark[data-hid="${id}"]`)]) {
      const parent = m.parentNode;
      m.replaceWith(...m.childNodes);
      parent.normalize();
    }
    this.nodes = null;
  }

  addHighlight(range, color) {
    let s = this.offsetOf(range.startContainer, range.startOffset);
    let e = this.offsetOf(range.endContainer, range.endOffset);
    const text = this.fullText();
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e <= s) return null;
    // Merge with overlapping highlights in this chapter.
    const overl = this.book.highlights.filter((h) => h.ch === this.ch && h.s < e && h.e > s);
    for (const h of overl) { s = Math.min(s, h.s); e = Math.max(e, h.e); this.unwrap(h.id); }
    const note = overl.map((h) => h.note).filter(Boolean).join('\n');
    this.book.highlights = this.book.highlights.filter((h) => !overl.includes(h));
    const h = { id: uid(), ch: this.ch, s, e, color, note, text: this.fullText().slice(s, e), at: Date.now() };
    this.book.highlights.push(h);
    this.wrapRange(s, e, hlClass(h), h.id);
    patchBook(this.book.id, { highlights: this.book.highlights });
    return h;
  }

  updateHighlight(id, patch) {
    const h = this.book.highlights.find((x) => x.id === id);
    if (!h) return;
    Object.assign(h, patch);
    for (const m of this.el.content.querySelectorAll(`mark[data-hid="${id}"]`)) m.className = hlClass(h);
    patchBook(this.book.id, { highlights: this.book.highlights });
  }

  removeHighlight(id) {
    this.book.highlights = this.book.highlights.filter((x) => x.id !== id);
    this.unwrap(id);
    patchBook(this.book.id, { highlights: this.book.highlights });
  }

  // ---------- selection menu ----------
  bindSelection() {
    document.addEventListener('selectionchange', () => {
      if (!this.isOpen()) return;
      clearTimeout(this._selT);
      this._selT = setTimeout(() => {
        const sel = getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          if (this.selMenuFor?.type === 'sel') this.hideMenu();
          return;
        }
        const r = sel.getRangeAt(0);
        if (!this.el.content.contains(r.commonAncestorContainer)) return;
        this.showMenu({ type: 'sel', range: r.cloneRange() }, r.getBoundingClientRect());
      }, 280);
    });
  }

  showMenu(target, rect) {
    const m = this.el.hlMenu;
    this.selMenuFor = target;
    m.hidden = false;
    const isHl = target.type === 'hl';
    m.querySelector('[data-a=delete]').hidden = !isHl;
    const color = isHl ? this.book.highlights.find((h) => h.id === target.id)?.color : null;
    for (const b of m.querySelectorAll('.hl-colors button')) b.classList.toggle('on', b.dataset.c === color);
    const mw = m.offsetWidth, mh = m.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = rect.left + rect.width / 2;
    x = Math.max(mw / 2 + 10, Math.min(vw - mw / 2 - 10, x));
    let y = rect.bottom + 14;
    if (y + mh > vh - 20) y = Math.max(10, rect.top - mh - 14);
    m.style.left = x + 'px';
    m.style.top = y + 'px';
  }

  hideMenu() {
    this.el.hlMenu.hidden = true;
    this.selMenuFor = null;
  }

  bindMenus() {
    this.el.hlMenu.addEventListener('pointerdown', (e) => e.preventDefault());
    this.el.hlMenu.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn || !this.selMenuFor) return;
      const t = this.selMenuFor;
      if (btn.dataset.c) {
        if (t.type === 'sel') { this.addHighlight(t.range, btn.dataset.c); getSelection().removeAllRanges(); }
        else this.updateHighlight(t.id, { color: btn.dataset.c });
        this.hideMenu();
        return;
      }
      const a = btn.dataset.a;
      if (a === 'copy') {
        const text = t.type === 'sel' ? t.range.toString() : this.book.highlights.find((h) => h.id === t.id)?.text || '';
        try { await navigator.clipboard.writeText(text.replace(/\s+/g, ' ').trim()); this.cb.toast?.('Copied'); } catch { this.cb.toast?.('Couldn’t copy'); }
        this.hideMenu();
        getSelection().removeAllRanges();
      } else if (a === 'delete' && t.type === 'hl') {
        this.removeHighlight(t.id);
        this.hideMenu();
      } else if (a === 'note') {
        let h = t.type === 'hl' ? this.book.highlights.find((x) => x.id === t.id) : this.addHighlight(t.range, 'yellow');
        getSelection().removeAllRanges();
        this.hideMenu();
        if (!h) return;
        const note = await this.cb.dialog?.note(h);
        if (note != null) this.updateHighlight(h.id, { note });
      }
    });
  }

  // ---------- gestures ----------
  bindGestures() {
    const stage = this.el.stage;
    let st = null;
    stage.addEventListener('pointerdown', (e) => {
      if (!this.isOpen() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      st = { x: e.clientX, y: e.clientY, t: performance.now(), drag: false, id: e.pointerId, hadSel: !getSelection().isCollapsed };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id || this.settings.scroll) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.drag) {
        if (st.hadSel || !getSelection().isCollapsed) return;
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3 && e.pointerType !== 'mouse') {
          st.drag = true;
          this.hideMenu();
          this.el.content.classList.remove('anim');
        } else return;
      }
      let ex = dx;
      const atStart = this.page === 0 && this.ch === 0, atEnd = this.page === this.pageCount - 1 && this.ch === this.chapters.length - 1;
      if ((dx > 0 && atStart) || (dx < 0 && atEnd)) ex = dx * 0.3;
      this.el.content.style.transform = `translate3d(${-this.page * this.geo.stride + ex}px,0,0)`;
    });
    const end = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st; st = null;
      const dx = e.clientX - s.x, dy = e.clientY - s.y, dt = performance.now() - s.t;
      if (s.drag) {
        const v = dx / Math.max(dt, 1);
        if (dx < -60 || v < -0.45) this.next();
        else if (dx > 60 || v > 0.45) this.prev();
        else this.applyTransform(true);
        return;
      }
      if (e.type === 'pointercancel') return;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || dt > 450) return;
      if (s.hadSel || !getSelection().isCollapsed) { if (s.hadSel) { getSelection().removeAllRanges(); this.hideMenu(); } return; }
      const mark = e.target.closest?.('mark.hl');
      if (mark) { this.showMenu({ type: 'hl', id: mark.dataset.hid }, mark.getBoundingClientRect()); return; }
      if (!this.el.hlMenu.hidden) { this.hideMenu(); return; }
      const w = window.innerWidth;
      if (!this.settings.scroll && e.clientX < w * 0.24) this.prev();
      else if (!this.settings.scroll && e.clientX > w * 0.76) this.next();
      else this.toggleChrome();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    this.el.vp.addEventListener('scroll', () => {
      if (!this.settings.scroll) return;
      clearTimeout(this._sc);
      this._sc = setTimeout(() => this.afterTurn(), 150);
    }, { passive: true });
    stage.addEventListener('wheel', (e) => {
      if (this.settings.scroll || !this.isOpen()) return;
      if (this._wheelLock) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 18) return;
      this._wheelLock = true;
      setTimeout(() => { this._wheelLock = false; }, 420);
      d > 0 ? this.next() : this.prev();
    }, { passive: true });
    const sc = this.el.scrub;
    sc.addEventListener('input', () => {
      this.scrubbing = true;
      const f = +sc.value / 1000;
      const target = f * this.totalWords;
      let i = 0;
      while (i < this.chapters.length - 1 && this.wordsBefore[i + 1] <= target) i++;
      this.el.scrubLabel.textContent = this.chapters[i].title + ' · ' + Math.round(f * 100) + '%';
    });
    sc.addEventListener('change', () => { this.scrubbing = false; this.goToPercent(+sc.value / 1000); });
  }

  toggleChrome(force) {
    const on = force ?? !this.el.root.classList.contains('chrome');
    this.el.root.classList.toggle('chrome', on);
  }

  onKey(e) {
    if (!this.isOpen() || document.querySelector('.sheet:not([hidden])')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); this.next(); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); this.prev(); }
    else if (e.key === 'Escape') { this.el.root.classList.contains('chrome') ? this.toggleChrome(false) : this.close(); }
  }
}

// ---------- helpers ----------
export const hlClass = (h) => `hl c-${h.color || 'yellow'}${h.note ? ' has-note' : ''}`;
const normHtml = (html) => html.replace(/>\s*\n\s*</g, '><');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 16)));

let insetProbe;
function safeInsets() {
  if (!insetProbe) {
    insetProbe = document.createElement('div');
    insetProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)';
    document.body.appendChild(insetProbe);
  }
  const cs = getComputedStyle(insetProbe);
  return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
}

export function setThemeColor(color) {
  for (const m of document.querySelectorAll('meta[name=theme-color]')) m.remove();
  const m = document.createElement('meta');
  m.name = 'theme-color';
  m.content = color;
  document.head.appendChild(m);
}
