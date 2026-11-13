# Licenses

The application itself is licensed under **GPL-3.0-or-later** (see `LICENSE`).
It is meant to ship with the Stockfish chess engine (GPL-3.0), so the whole app is open source.

## Third-party code

| Component | Version | License | How it is used |
|---|---|---|---|
| chess.js (Jeff Hlywa) | 0.10.x, vendored in `src/core/chess.js` | BSD-2-Clause | Bundled. Copied from the prototype unchanged except the module export lines; the copyright notice is kept in the file. |
| pdfjs-dist (Mozilla pdf.js) | 3.11.174 | Apache-2.0 | Bundled, loaded lazily when a PDF is opened. |
| JSZip | 3.10.1 | MIT OR GPL-3.0-or-later (used under MIT) | Bundled, loaded lazily for EPUB/DOCX. Pulls in pako (MIT AND Zlib), lie (MIT), immediate (MIT), readable-stream (MIT), setimmediate (MIT) and small MIT helpers. |
| path2d-polyfill | 2.0.1 | MIT | Dependency of pdfjs-dist (Node-only path, not used in the browser). |
| Stockfish 10 (asm.js) | 10.0.2 | GPL-3.0 | **Not bundled yet**: downloaded at run time from cdn.jsdelivr.net (as in the prototype). Stage 2 bundles a current Stockfish WASM build. |
| chess.js 0.10.3 (fallback engine worker) | 0.10.3 | BSD-2-Clause | Not bundled yet: the fallback engine worker loads it from cdnjs (as in the prototype). Stage 2 removes the CDN load. |
| IBM Plex Sans / Mono, Literata, Noto Sans Symbols 2 | — | SIL Open Font License 1.1 | Not bundled yet: loaded from Google Fonts. Stage 2 bundles them. |

## Development tools (not shipped)

| Tool | License |
|---|---|
| Vite | MIT |
| Vitest | MIT |

## Content

User books (PDF, EPUB, …) are never stored in this repository. Only positions (FEN), moves and the coach's own comments
may be shared with students; the source (book, author) is recorded automatically.
