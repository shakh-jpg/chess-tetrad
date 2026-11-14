# Licenses

The application itself is licensed under **GPL-3.0-or-later** (see `LICENSE`).
It ships the Stockfish chess engine (GPL-3.0), so the whole app is open source.

## Third-party code and assets shipped with the app

| Component | Version | License | How it is used |
|---|---|---|---|
| Stockfish (stockfish.js by Nathan Rugg, lite single-threaded WASM build with its built-in NNUE network) | 19.0.1 | GPL-3.0 | Bundled: copied from the npm package `stockfish` into `engine/` by `scripts/copy-engine.mjs`; the license text is shipped as `engine/COPYING-stockfish.txt`. Source: https://github.com/nmrugg/stockfish.js and https://github.com/official-stockfish/Stockfish |
| chess.js (Jeff Hlywa) | 0.10.x, vendored in `src/core/chess.js` | BSD-2-Clause | Bundled (also inside the fallback engine worker). Copied from the prototype unchanged except the module export lines; the copyright notice is kept in the file. |
| Chess pieces "cburnett" (Colin M.L. Burnett) | — | GPL-2.0-or-later / BSD / GFDL (triple-licensed); used under the GPL | `src/board/pieces.js`, extracted from `@lichess-org/chessground` 10.5.0 (`assets/chessground.cburnett.css`, GPL-3.0-or-later). The app icons in `public/icons/` use the cburnett white knight. |
| pdfjs-dist (Mozilla pdf.js) | 3.11.174 | Apache-2.0 | Bundled, loaded lazily when a PDF is opened. |
| JSZip | 3.10.1 | MIT OR GPL-3.0-or-later (used under MIT) | Bundled, loaded lazily for EPUB/DOCX. Pulls in pako (MIT AND Zlib), lie (MIT), immediate (MIT), readable-stream (MIT), setimmediate (MIT) and small MIT helpers. |
| path2d-polyfill | 2.0.1 | MIT | Dependency of pdfjs-dist (Node-only path, not used in the browser). |
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
