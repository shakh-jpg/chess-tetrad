# Licenses

The application itself is licensed under **GPL-3.0-or-later** (see `LICENSE`).
It ships the Stockfish chess engine (GPL-3.0), so the whole app is open source.

## Third-party code and assets shipped with the app

| Component | Version | License | How it is used |
|---|---|---|---|
| Stockfish (stockfish.js by Nathan Rugg, lite single-threaded WASM build with its built-in NNUE network) | 19.0.1 | GPL-3.0 | Bundled: copied from the npm package `stockfish` into `engine/` by `scripts/copy-engine.mjs`; the license text is shipped as `engine/COPYING-stockfish.txt`. Source: https://github.com/nmrugg/stockfish.js and https://github.com/official-stockfish/Stockfish |
| chess.js (Jeff Hlywa) | 0.10.x, vendored in `src/core/chess.js` | BSD-2-Clause | Bundled (also inside the fallback engine worker). Copied from the prototype unchanged except the module export lines; the copyright notice is kept in the file. |
| Chess pieces "cburnett" (Colin M.L. Burnett) | — | GPL-2.0-or-later / BSD / GFDL (triple-licensed); used under the GPL | `src/board/pieces.js`, extracted from `@lichess-org/chessground` 10.5.0 (`assets/chessground.cburnett.css`, GPL-3.0-or-later). The app icons in `public/icons/` use the cburnett white knight. |
| djvu-rs (Lev Matyushkin) — DjVu decoder, pure Rust compiled to WASM | 0.45.0 | MIT (its Rust dependencies: MIT / Apache-2.0, listed in the package's THIRD_PARTY_NOTICES) | Bundled as a lazily loaded worker + `.wasm` (scanned-book import, coach's tool; cached on first use). Chosen because DjVu.js is GPL-2.0-only, which is not compatible with GPL-3.0. |
| tesseract.js (+ tesseract.js-core: Tesseract OCR compiled to WASM, LSTM builds) | 7.0.0 / 6.1.2 | Apache-2.0 | Copied into `ocr/` by `scripts/copy-engine.mjs` (worker, cores, license files); loaded only when a scanned book is read with "Читать текст"; cached on first use, not in the first offline download. Tesseract itself: Apache-2.0. |
| Tesseract language data `rus`, `eng` (tessdata, 4.0.0_best_int) via @tesseract.js-data/rus, /eng | 1.0.0 | data: Apache-2.0 (tessdata); npm packaging: MIT | Copied into `ocr/lang/` (gzip), same loading as above. |
| pdfjs-dist (Mozilla pdf.js), legacy build | 6.5.438 | Apache-2.0 | Bundled, loaded lazily when a PDF is opened. Updated from 3.11.174 because of CVE-2024-4367 (GHSA-wgrm-67xf-hhpq); every document is opened with `isEvalSupported: false`. |
| pdf.js image decoders (`pdfjs/wasm/`): JBIG2 (PDFium, BSD-3-Clause), OpenJPEG (BSD-2-Clause), qcms (MIT); pdf.js glue Apache-2.0 | from pdfjs-dist 6.5.438 | see the LICENSE_* files shipped next to them | Copied by `scripts/copy-engine.mjs`; used only for scanned PDFs, cached on first use. |
| JSZip | 3.10.1 | MIT OR GPL-3.0-or-later (used under MIT) | Bundled, loaded lazily for EPUB/DOCX. Pulls in pako (MIT AND Zlib), lie (MIT), immediate (MIT), readable-stream (MIT), setimmediate (MIT) and small MIT helpers. |
| @supabase/supabase-js (+ auth-js, postgrest-js, realtime-js, storage-js, functions-js, phoenix, iceberg-js) | 2.119.0 | MIT | Bundled as a lazy chunk; loaded only when the cloud is configured (stage 4). |
| IBM Plex Sans, IBM Plex Mono (via @fontsource) | 5.3.0 | SIL Open Font License 1.1 | Bundled font files (no Google Fonts requests). |
| Literata (via @fontsource) | 5.3.0 | SIL Open Font License 1.1 | Bundled font files. |
| Noto Sans Symbols 2, "symbols" subset (via @fontsource) | 5.3.0 | SIL Open Font License 1.1 | Bundled; chess glyphs for figurine notation and diagram recognition. |

Nothing is loaded from a CDN any more (stage 2): engine, fonts, pdf.js and JSZip are all served by the app and cached for offline use.

## Development tools (not shipped)

| Tool | License |
|---|---|
| Vite | MIT |
| Vitest | MIT |
| fake-indexeddb (storage tests) | Apache-2.0 |
| @electric-sql/pglite (runs the SQL migration and RLS tests in Postgres/WASM) | Apache-2.0 (Postgres itself: PostgreSQL License) |
| @resvg/resvg-js (renders the PNG icons once, `npm run icons`) | MPL-2.0 |

## Content

User books (PDF, EPUB, DOCX, FB2, …) are never stored in this repository. Only positions (FEN), moves and the coach's own comments
may be shared with students; the source (book, author) is recorded automatically.
