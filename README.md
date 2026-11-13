# Шахматная тетрадь

Chess notebook for a coach and students: games with variations, comments and arrows,
puzzles with spaced repetition, import of books (PDF, EPUB, DOCX, PGN), diagram recognition.

Built from a single-file prototype; stage 1 split it into ES modules without changing behaviour.

## Commands

```
npm install
npm run dev       # local dev server
npm test          # unit tests (Vitest)
npm run build     # production build into dist/
npm run preview   # serve dist/ on http://localhost:4173
```

## Layout

| Folder | What is inside |
|---|---|
| `src/core` | vendored chess.js, move tree (`tree.js`), `Core` facade |
| `src/pgn` | tokenizer and book/PGN parser |
| `src/board` | SVG board, FEN helpers |
| `src/pdf-import` | file readers (PDF, EPUB, DOCX, FB2, HTML) and the PDF puzzle-book parser |
| `src/recognition` | diagram recognition and user samples |
| `src/engine` | engine worker (Stockfish / fallback) |
| `src/storage` | IndexedDB store |
| `src/srs` | spaced repetition (pure functions) |
| `src/live` | live lesson (works only inside claude.ai for now) |
| `src/ui` | state, rendering, dialogs, events |
| `tests` | Vitest tests; `equivalence.test.js` compares the parser with the original prototype |

License: GPL-3.0-or-later, see `LICENSE` and `LICENSES.md`.
