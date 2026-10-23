// App shell: library, importing, sheets and settings. The reading view lives in reader.js.
import { db, patchBook, flushAll } from './db.js';
import { Reader, SIZES, FONTS, THEMES, DEFAULTS } from './reader.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- settings ----------
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('folio.settings') || '{}')); } catch { /* private mode */ }
if (window.innerWidth < 600 && !localStorage.getItem?.('folio.settings')) settings.fs = 4;
function saveSettings() {
  try { localStorage.setItem('folio.settings', JSON.stringify(settings)); } catch { /* ignore */ }
  reader.setSettings({ ...settings });
  renderSettings();
}

// ---------- toast ----------
let toastT;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2400);
}

// ---------- sheets ----------
let openSheetEl = null;
function openSheet(id) {
  closeSheet();
  $('scrim').hidden = false;
  openSheetEl = $(id);
  openSheetEl.hidden = false;
}
function closeSheet() {
  if (openSheetEl) openSheetEl.hidden = true;
  openSheetEl = null;
  $('scrim').hidden = true;
  closeActions();
}
$('scrim').addEventListener('click', () => { if (!importing) closeSheet(); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheetEl && !importing) closeSheet(); });

// Swipe a sheet down to dismiss it (phones / portrait).
for (const sh of document.querySelectorAll('.sheet')) {
  let y0 = null;
  sh.querySelector('.grabber')?.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) sh.style.transform = `translate(-50%, ${dy}px)`;
  }, { passive: true });
  sh.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    sh.style.transform = '';
    if (dy > 90 && !importing) closeSheet();
  });
}

function dialog({ title, body = '', actions }) {
  return new Promise((resolve) => {
    $('dlgTitle').textContent = title;
    $('dlgBody').innerHTML = body;
    const box = $('dlgActions');
    box.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.cls) b.className = a.cls;
      b.onclick = () => { const v = a.value === undefined ? true : (typeof a.value === 'function' ? a.value() : a.value); closeSheet(); resolve(v); };
      box.appendChild(b);
    }
    openSheet('dialogSheet');
    setTimeout(() => $('dlgBody').querySelector('input,textarea')?.focus(), 250);
  });
}

// Small popover menu anchored to an element.
function actions(anchor, items) {
  const box = $('actionSheet');
  box.innerHTML = '';
  for (const it of items) {
    if (it === '-') { box.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.danger) b.classList.add('danger');
    if (it.on) b.classList.add('on');
    b.onclick = () => { closeActions(); it.run(); };
    box.appendChild(b);
  }
  box.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  let x = Math.min(window.innerWidth - w - 12, Math.max(12, r.right - w));
  let y = r.bottom + 8;
  if (y + h > window.innerHeight - 12) y = Math.max(12, r.top - h - 8);
  box.style.left = x + 'px';
  box.style.top = y + 'px';
  setTimeout(() => document.addEventListener('pointerdown', outsideActions, true), 0);
}
function outsideActions(e) { if (!$('actionSheet').contains(e.target)) closeActions(); }
function closeActions() {
  $('actionSheet').hidden = true;
  document.removeEventListener('pointerdown', outsideActions, true);
}

// ---------- reader ----------
const reader = new Reader({
  toast,
  onClose: () => { $('library').hidden = false; restoreAppThemeColor(); renderLibrary(); },
  onChange: () => {},
  dialog: {
    note: (h) => dialog({
      title: h.note ? 'Edit note' : 'Add note',
      body: `<p style="font-family:var(--serif-ui);border-left:3px solid #ffd60a;padding-left:10px">${esc(h.text.slice(0, 280))}${h.text.length > 280 ? '…' : ''}</p>
             <label class="field"><textarea id="noteText" placeholder="Your note">${esc(h.note || '')}</textarea></label>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'primary', value: () => $('noteText').value.trim() }],
    }),
  },
});

function restoreAppThemeColor() {
  for (const m of document.querySelectorAll('meta[name=theme-color]')) m.remove();
  for (const [media, color] of [['(prefers-color-scheme: light)', '#f7f5f0'], ['(prefers-color-scheme: dark)', '#121212']]) {
    const m = document.createElement('meta');
    m.name = 'theme-color'; m.media = media; m.content = color;
    document.head.appendChild(m);
  }
}

async function openBook(id) {
  const [book, content] = await Promise.all([db.getBook(id), db.getContent(id)]);
  if (!book || !content) { toast('That book could not be opened'); return; }
  $('library').hidden = true;
  try { localStorage.setItem('folio.lastOpen', id); } catch { /* ignore */ }
  await reader.open(book, content, { ...settings });
  currentContent = content;
}
let currentContent = null;

$('rClose').onclick = () => { try { localStorage.removeItem('folio.lastOpen'); } catch { /* ignore */ } reader.close(); };
$('rMark').onclick = () => reader.toggleBookmark();
$('rAa').onclick = () => { renderSettings(); openSheet('settingsSheet'); };
$('rToc').onclick = () => { tocTab = 'contents'; renderToc(); openSheet('tocSheet'); setTimeout(() => $('tocList').querySelector('.current')?.scrollIntoView({ block: 'center' }), 50); };
$('rSearch').onclick = () => { openSheet('searchSheet'); setTimeout(() => $('searchInput').focus(), 200); };

// ---------- settings sheet ----------
function renderSettings() {
  const dots = $('fsDots');
  dots.innerHTML = SIZES.map((_, i) => `<i class="${i <= settings.fs ? 'on' : ''}"></i>`).join('');
  $('themes').innerHTML = THEMES.map((t) => `<button class="theme ${t.id === settings.theme ? 'on' : ''}" data-theme="${t.id}" style="background:${t.bg};color:${t.ink}"><b style="${t.bold ? 'font-weight:800' : ''}">Aa</b><span>${t.name}</span></button>`).join('');
  $('fonts').innerHTML = FONTS.map((f) => `<button class="font-opt ${f.id === settings.font ? 'on' : ''}" data-font="${f.id}" style="font-family:${esc(f.css)}">${f.name}</button>`).join('');
  $('setAutoNight').checked = !!settings.autoNight;
  $('setLh').value = settings.lh;
  $('setMargin').value = settings.margin;
  $('setJustify').checked = !!settings.justify;
  $('setSpread').checked = !!settings.spread;
  $('setScroll').checked = !!settings.scroll;
  $('setTurn').value = settings.turn;
  $('setDrop').checked = !!settings.drop;
}
$('fsDown').onclick = () => { if (settings.fs > 0) { settings.fs--; saveSettings(); } };
$('fsUp').onclick = () => { if (settings.fs < SIZES.length - 1) { settings.fs++; saveSettings(); } };
$('themes').onclick = (e) => { const b = e.target.closest('[data-theme]'); if (b) { settings.theme = b.dataset.theme; saveSettings(); } };
$('fonts').onclick = (e) => { const b = e.target.closest('[data-font]'); if (b) { settings.font = b.dataset.font; saveSettings(); } };
const bindSet = (id, key, get) => $(id).addEventListener('change', (e) => { settings[key] = get(e.target); saveSettings(); });
bindSet('setAutoNight', 'autoNight', (t) => t.checked);
bindSet('setLh', 'lh', (t) => +t.value);
bindSet('setMargin', 'margin', (t) => +t.value);
bindSet('setJustify', 'justify', (t) => t.checked);
bindSet('setSpread', 'spread', (t) => t.checked);
bindSet('setScroll', 'scroll', (t) => t.checked);
bindSet('setTurn', 'turn', (t) => t.value);
bindSet('setDrop', 'drop', (t) => t.checked);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => reader.isOpen() && reader.setSettings({ ...settings }));

// ---------- contents / bookmarks / highlights ----------
let tocTab = 'contents';
$('tocTabs').onclick = (e) => {
  const b = e.target.closest('[data-t]');
  if (!b) return;
  tocTab = b.dataset.t;
  renderToc();
};
function renderToc() {
  const book = reader.book;
  if (!book) return;
  for (const b of $('tocTabs').children) b.classList.toggle('on', b.dataset.t === tocTab);
  $('tocBook').innerHTML = `${coverHtml(book)}<div><div class="t">${esc(book.title)}</div><div class="a">${esc(book.author || '')}</div><div class="p">${Math.round((book.progress?.pct || 0) * 100)}% read</div></div>`;
  hydrateCovers($('tocBook'));
  const list = $('tocList');
  const chapters = reader.chapters;
  if (tocTab === 'contents') {
    list.innerHTML = chapters.map((c, i) => {
      const pg = reader.pageOfChapter(i);
      return `<button class="toc-row ${i === reader.ch ? 'current' : ''}" data-ch="${i}"><span class="tt">${c.label ? `<span class="lb">${esc(c.label)}</span>` : ''}<span class="nm">${esc(c.title)}</span></span><span class="pg">${pg ?? ''}</span></button>`;
    }).join('');
  } else if (tocTab === 'bookmarks') {
    const bms = [...book.bookmarks].sort((a, b) => a.ch - b.ch || a.off - b.off);
    list.innerHTML = bms.length ? bms.map((b) => `<div class="toc-row" data-ch="${b.ch}" data-off="${b.off}" role="button"><span class="tt"><span class="lb">${esc(chapters[b.ch]?.title || '')} · ${new Date(b.at).toLocaleDateString()}</span><span class="snip">${esc(b.snippet)}…</span></span><button class="del" data-delbm="${b.id}">Delete</button></div>`).join('')
      : `<div class="toc-empty">No bookmarks yet.<br>Tap the ribbon at the top of a page to add one.</div>`;
  } else {
    const hls = [...book.highlights].sort((a, b) => a.ch - b.ch || a.s - b.s);
    const colors = { yellow: '#ffd60a', green: '#34c759', blue: '#0a84ff', pink: '#ff3787', purple: '#af52de', underline: '#e0352b' };
    list.innerHTML = hls.length ? hls.map((h) => `<div class="toc-row" data-ch="${h.ch}" data-off="${h.s}" role="button"><span class="tt"><span class="lb">${esc(chapters[h.ch]?.title || '')}</span><span class="quote" style="border-color:${colors[h.color] || colors.yellow}">${esc(h.text)}</span>${h.note ? `<span class="note">${esc(h.note)}</span>` : ''}</span><button class="del" data-delhl="${h.id}">Delete</button></div>`).join('')
      : `<div class="toc-empty">No highlights yet.<br>Press and hold on text, select it, then pick a colour.</div>`;
  }
}
$('tocList').onclick = (e) => {
  const dbm = e.target.closest('[data-delbm]');
  if (dbm) { reader.book.bookmarks = reader.book.bookmarks.filter((b) => b.id !== dbm.dataset.delbm); patchBook(reader.book.id, { bookmarks: reader.book.bookmarks }); reader.updateChrome(); renderToc(); return; }
  const dhl = e.target.closest('[data-delhl]');
  if (dhl) { const id = dhl.dataset.delhl; if (reader.chapters && reader.book.highlights.find((h) => h.id === id)?.ch === reader.ch) reader.removeHighlight(id); else { reader.book.highlights = reader.book.highlights.filter((h) => h.id !== id); patchBook(reader.book.id, { highlights: reader.book.highlights }); } renderToc(); return; }
  const row = e.target.closest('[data-ch]');
  if (!row) return;
  closeSheet();
  reader.toggleChrome(false);
  reader.goToChapter(+row.dataset.ch, row.dataset.off ? +row.dataset.off : 0);
};

// ---------- search ----------
let searchT;
$('searchInput').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 220); });
function runSearch() {
  const q = $('searchInput').value.trim();
  const out = $('searchResults');
  if (q.length < 2) { out.innerHTML = ''; return; }
  const ql = q.toLowerCase();
  const results = [];
  reader.chapters.forEach((c, ci) => {
    // Match against the same text the page renders (no block separators).
    const flat = c.text.replace(/\n/g, '');
    const low = flat.toLowerCase();
    const disp = c.text.replace(/\n/g, ' ');
    let idx = -1, nth = 0;
    // Map flat index -> display index (display keeps a space per removed newline).
    const nlPos = [];
    for (let i = 0; i < c.text.length; i++) if (c.text[i] === '\n') nlPos.push(i - nlPos.length);
    while ((idx = low.indexOf(ql, idx + 1)) >= 0 && results.length < 300) {
      let shift = 0;
      while (shift < nlPos.length && nlPos[shift] <= idx) shift++;
      const di = idx + shift;
      const a = Math.max(0, di - 60), b = Math.min(disp.length, di + q.length + 80);
      results.push({ ci, nth, html: (a > 0 ? '…' : '') + esc(disp.slice(a, di)) + '<mark>' + esc(disp.slice(di, di + q.length)) + '</mark>' + esc(disp.slice(di + q.length, b)) + (b < disp.length ? '…' : '') });
      nth++;
    }
  });
  out.innerHTML = `<div class="sr-count">${results.length >= 300 ? '300+' : results.length} result${results.length === 1 ? '' : 's'}</div>` +
    results.map((r) => `<button class="sr-row" data-ci="${r.ci}" data-nth="${r.nth}"><div class="ch">${esc(reader.chapters[r.ci].title)}</div><div class="tx">${r.html}</div></button>`).join('');
}
$('searchResults').onclick = (e) => {
  const row = e.target.closest('.sr-row');
  if (!row) return;
  closeSheet();
  reader.toggleChrome(false);
  reader.goToSearch(+row.dataset.ci, $('searchInput').value.trim(), +row.dataset.nth);
};

// ---------- library ----------
let filter = 'all';
let sort = (() => { try { return localStorage.getItem('folio.sort') || 'recent'; } catch { return 'recent'; } })();
const coverUrls = new Map();
function coverUrl(book) {
  if (!book.cover) return null;
  const k = book.id + ':' + (book.coverV || 0);
  if (!coverUrls.has(k)) coverUrls.set(k, URL.createObjectURL(book.cover));
  return coverUrls.get(k);
}
function coverHtml(book) {
  const u = coverUrl(book);
  return `<div class="cover-img">${u ? `<img src="${u}" alt="" loading="lazy">` : ''}</div>`;
}
function hydrateCovers() { /* covers are plain <img> tags; nothing to do */ }

function status(book) {
  if (book.finished) return { text: 'Finished', cls: '' };
  const p = book.progress?.pct || 0;
  if (!book.openedAt) return { text: 'NEW', cls: 'new' };
  return { text: Math.max(1, Math.round(p * 100)) + '%', cls: '' };
}

async function renderLibrary() {
  const books = await db.allBooks();
  const shelf = $('shelf');
  $('empty').hidden = books.length > 0;
  $('libFilter').hidden = books.length === 0;
  $('sortBtn').hidden = books.length === 0;
  const cont = books.filter((b) => b.openedAt && !b.finished).sort((a, b) => b.openedAt - a.openedAt)[0];
  const cEl = $('continue');
  if (cont && filter === 'all') {
    const pct = Math.round((cont.progress?.pct || 0) * 100);
    cEl.hidden = false;
    cEl.innerHTML = `<button class="cont-card" data-open="${cont.id}">${coverHtml(cont)}<div style="min-width:0">
      <div class="cont-kicker">Continue reading</div><div class="cont-title">${esc(cont.title)}</div><div class="cont-author">${esc(cont.author || '')}</div>
      <div class="cont-meta">${pct}% · ${cont.chapterCount} chapters</div><div class="cont-bar"><i style="width:${pct}%"></i></div>
      <span class="pill-btn primary cont-go">Resume</span></div></button>`;
  } else cEl.hidden = true;

  let list = books.filter((b) => filter === 'all' || (filter === 'finished' && b.finished) || (filter === 'reading' && b.openedAt && !b.finished) || (filter === 'new' && !b.openedAt));
  const by = {
    recent: (a, b) => (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt),
    added: (a, b) => b.addedAt - a.addedAt,
    title: (a, b) => a.title.localeCompare(b.title),
    author: (a, b) => (a.author || '').localeCompare(b.author || '') || a.title.localeCompare(b.title),
  };
  list.sort(by[sort] || by.recent);
  shelf.innerHTML = list.map((b) => {
    const st = status(b);
    return `<div class="book-card"><button class="open" data-open="${b.id}" aria-label="Open ${esc(b.title)}">${coverHtml(b)}</button>
      <div class="bc-meta"><span class="bc-status ${st.cls}">${st.text}</span><button class="bc-more" data-more="${b.id}" aria-label="More options"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></svg></button></div>
      <div class="bc-title">${esc(b.title)}</div><div class="bc-author">${esc(b.author || '')}</div></div>`;
  }).join('') || (books.length ? `<div class="toc-empty" style="grid-column:1/-1">Nothing here yet.</div>` : '');
}

$('library').addEventListener('click', async (e) => {
  const open = e.target.closest('[data-open]');
  if (open) { openBook(open.dataset.open); return; }
  const more = e.target.closest('[data-more]');
  if (more) { bookMenu(more, more.dataset.more); return; }
});
$('libFilter').onclick = (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  filter = b.dataset.f;
  for (const x of $('libFilter').children) x.classList.toggle('on', x === b);
  renderLibrary();
};
$('sortBtn').onclick = () => actions($('sortBtn'), [
  ['recent', 'Recent'], ['added', 'Date added'], ['title', 'Title'], ['author', 'Author'],
].map(([k, label]) => ({ label, on: sort === k, run: () => { sort = k; try { localStorage.setItem('folio.sort', k); } catch { /* ignore */ } renderLibrary(); } })));

async function bookMenu(anchor, id) {
  const book = await db.getBook(id);
  if (!book) return;
  actions(anchor, [
    { label: 'Read', run: () => openBook(id) },
    { label: 'Edit title & author', run: () => editBook(book) },
    book.finished
      ? { label: 'Mark as still reading', run: async () => { await db.putBook({ ...book, finished: false }); renderLibrary(); } }
      : { label: 'Mark as finished', run: async () => { await db.putBook({ ...book, finished: true, openedAt: book.openedAt || Date.now() }); renderLibrary(); } },
    { label: 'Start over', run: async () => { await db.putBook({ ...book, progress: { ch: 0, off: 0, pct: 0 }, finished: false }); renderLibrary(); } },
    '-',
    { label: 'Remove from library', danger: true, run: async () => {
      const ok = await dialog({ title: `Remove “${book.title}”?`, body: '<p>The book, its bookmarks and highlights will be deleted from this device.</p>', actions: [{ label: 'Cancel', value: false }, { label: 'Remove', cls: 'danger', value: true }] });
      if (ok) { await db.deleteBook(id); toast('Removed'); renderLibrary(); }
    } },
  ]);
}

async function editBook(book) {
  const res = await dialog({
    title: 'Edit details',
    body: `<label class="field"><span>Title</span><input id="edTitle" value="${esc(book.title)}"></label><label class="field"><span>Author</span><input id="edAuthor" value="${esc(book.author || '')}"></label>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'primary', value: () => ({ title: $('edTitle').value.trim() || book.title, author: $('edAuthor').value.trim() }) }],
  });
  if (!res) return;
  const upd = { ...book, ...res };
  if (book.coverDesigned) {
    const { designedCover } = await import('./importer.js');
    upd.cover = await designedCover(upd.title, upd.author);
    upd.coverV = (book.coverV || 0) + 1;
  }
  await db.putBook(upd);
  renderLibrary();
}

// ---------- importing ----------
let importing = false;
$('addBtn').onclick = () => $('fileInput').click();
$('emptyAdd').onclick = () => $('fileInput').click();
$('fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  await importFiles(files);
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (reader.isOpen() || !e.dataTransfer?.types?.includes('Files')) return; dragDepth++; $('dropOverlay').hidden = false; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropOverlay').hidden = true;
  if (reader.isOpen()) return;
  const files = [...(e.dataTransfer?.files || [])].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (files.length) importFiles(files);
});

async function importFiles(files) {
  if (importing || !files.length) return;
  importing = true;
  const { importPdf } = await import('./importer.js');
  let lastId = null;
  for (const file of files) {
    $('importName').textContent = file.name.replace(/\.pdf$/i, '');
    $('importStage').textContent = 'Opening…';
    $('importBar').style.width = '0%';
    $('importCover').innerHTML = '<div class="spinner"></div>';
    $('importActions').innerHTML = '';
    openSheet('importSheet');
    const ctrl = new AbortController();
    const cancel = document.createElement('button');
    cancel.className = 'link-btn';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => ctrl.abort();
    $('importActions').appendChild(cancel);
    try {
      const res = await importPdf(file, {
        signal: ctrl.signal,
        onStage: (label, f) => { $('importStage').textContent = label + '…'; $('importBar').style.width = Math.round(f * 100) + '%'; },
        confirmOcr: (n) => new Promise((resolve) => {
          $('importStage').textContent = 'This PDF is scanned page images, so there is no text to pull out yet.';
          $('importActions').innerHTML = '';
          const no = document.createElement('button'); no.className = 'link-btn'; no.textContent = 'Cancel'; no.style.color = 'var(--muted)';
          const yes = document.createElement('button'); yes.className = 'pill-btn primary'; yes.textContent = `Recognize text (~${Math.max(1, Math.round(n * 4 / 60))} min)`;
          no.onclick = () => { ctrl.abort(); resolve(false); };
          yes.onclick = () => { $('importActions').innerHTML = ''; $('importActions').appendChild(cancel); resolve(true); };
          $('importActions').append(no, yes);
        }),
      });
      if (ctrl.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (!res.chapters.length) throw new Error('No readable text was found in this PDF.');
      const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const words = res.chapters.reduce((s, c) => s + c.words, 0);
      let cover = res.cover;
      let coverDesigned = false;
      if (!cover) { const { designedCover } = await import('./importer.js'); cover = await designedCover(res.title, res.author); coverDesigned = true; }
      await db.putContent({ id, chapters: res.chapters });
      await db.putBook({
        id, title: res.title, author: res.author, cover, coverDesigned: coverDesigned || !!res.coverDesigned, addedAt: Date.now(), openedAt: 0,
        words, chapterCount: res.chapters.length, pageCount: res.pageCount, ocr: res.ocr,
        progress: { ch: 0, off: 0, pct: 0 }, bookmarks: [], highlights: [], finished: false,
      });
      lastId = id;
      $('importBar').style.width = '100%';
      const u = URL.createObjectURL(cover);
      $('importCover').innerHTML = `<img src="${u}" alt="">`;
      $('importStage').textContent = `Ready · ${res.chapters.length} chapters · ${Math.max(1, Math.round(words / 250))} min read`;
      await new Promise((r) => setTimeout(r, 700));
    } catch (err) {
      if (err?.name === 'AbortError') { toast('Import cancelled'); continue; }
      console.error(err);
      $('importStage').textContent = (err?.name === 'PasswordException' ? 'This PDF is password protected.' : err?.message || 'Something went wrong reading this PDF.');
      $('importActions').innerHTML = '';
      await new Promise((resolve) => {
        const ok = document.createElement('button'); ok.className = 'pill-btn'; ok.textContent = 'OK'; ok.onclick = resolve;
        $('importActions').appendChild(ok);
      });
    }
  }
  importing = false;
  closeSheet();
  await renderLibrary();
  if (lastId && files.length === 1) {
    toast('Added to your library');
  }
}

// ---------- boot ----------
(async function boot() {
  try { await navigator.storage?.persist?.(); } catch { /* not supported */ }
  await renderLibrary();
  let last = null;
  try { last = localStorage.getItem('folio.lastOpen'); } catch { /* ignore */ }
  if (last && await db.getBook(last)) openBook(last);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

window.addEventListener('pagehide', () => { flushAll(); });
window.folio = { db, reader, importFiles };
