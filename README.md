# Шахматная тетрадь

Chess notebook for a coach and students: games with variations, comments and arrows,
puzzles with spaced repetition, import of books (PDF, EPUB, DOCX, PGN), diagram recognition.
Installable PWA that works offline, with Stockfish 19 (lite, WASM) built in.

## Commands

```
npm install
npm run dev       # local dev server on http://127.0.0.1:5173 (no service worker in dev)
npm test          # unit tests (Vitest)
npm run build     # production build into dist/ (copies the engine, writes dist/sw.js)
npm run preview   # serve dist/ on http://127.0.0.1:4173
npm run icons     # re-render public/icons/*.png (only when the icon design changes)
```

## Layout

| Folder | What is inside |
|---|---|
| `src/core` | vendored chess.js, move tree (`tree.js`), `Core` facade |
| `src/pgn` | tokenizer and book/PGN parser |
| `src/board` | SVG board, cburnett piece set, FEN helpers |
| `src/pdf-import` | file readers (PDF, EPUB, DOCX, FB2, HTML) and the PDF puzzle-book parser |
| `src/recognition` | diagram recognition and user samples |
| `src/engine` | engine adapter (Stockfish worker / fallback worker), UCI parsing |
| `src/storage` | IndexedDB store (persistence request, write-error reporting) |
| `src/srs` | spaced repetition (pure functions) |
| `src/live` | live lesson (works only inside claude.ai for now) |
| `src/pwa` | service worker registration, install button, iOS hint |
| `src/ui` | state, rendering, dialogs, events, phone menu |
| `scripts` | engine copy, service-worker template and Vite plugin, icon renderer |
| `public` | manifest, icons; `public/engine/` is generated (git-ignored) |
| `tests` | Vitest tests; `equivalence.test.js` compares the parser with the original prototype |

## Offline

`dist/sw.js` precaches every built file (about 4 MB: app, Stockfish, pdf.js, fonts, icons).
The engine is single-threaded, so no special server headers are needed (works on GitHub Pages).

License: GPL-3.0-or-later, see `LICENSE` and `LICENSES.md`.
