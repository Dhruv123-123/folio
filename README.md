# Folio

An Apple Books style reader for iPad (and any browser). Add a PDF of a book and Folio pulls the
text out, rebuilds the paragraphs and chapters, and re-typesets it as clean, reflowable pages.

Everything runs in the browser. Books are stored on the device (IndexedDB) and the app works offline,
so it can be hosted for free as a static site.

## Install on iPad

1. Open the site in Safari.
2. Tap the Share button, then **Add to Home Screen**.
3. Launch Folio from the home screen and tap **Add PDF**.

## What it does with a PDF

- Removes running headers, footers and page numbers
- Rejoins lines into paragraphs and undoes end-of-line hyphenation
- Detects chapters from the PDF outline, or from headings when there is no outline
- Keeps italics, bold, superscripts, block quotes, verse and scene breaks
- Moves footnotes to the end of each chapter
- Fixes typography: curly quotes, dashes, ellipses, ligatures
- Scanned PDFs: optional on-device text recognition (Tesseract)
- Makes a cover from the first page, or designs one when the first page is plain text

## Reading features

Library with covers and progress, Continue Reading, page turns by tap or swipe, two-page spreads in
landscape, eight themes (Original, Quiet, Paper, Bold, Calm, Focus, Ember, Night) with automatic dark
mode, twelve fonts, text size, line spacing, margins, justification, scrolling view, drop caps,
bookmarks, highlights in five colours plus underline, notes, search, table of contents with page
numbers, and a position scrubber.

## Development

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
```

Vendored libraries: pdf.js 4.10 (`vendor/pdfjs`), tesseract.js 5 (`vendor/tesseract`).
