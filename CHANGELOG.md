# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- "Новая партия": record a game over the board into the "Мои партии" book (created automatically).
  Moves are written as the pieces are moved (analysis mode: going back and playing another move makes
  a variation, "Удалить ход" removes the last move), the game is saved after every move, headers
  (White, Black, Event, Date, Result) are edited in a small dialog and form the title, PGN export
  uses them. Optionally starts from the current position. The engine is off while recording until
  switched on. On phones "Назад / Удалить ход / Заголовки" sit in one row at the bottom of the board.
- The recorded-game format (`headers`, `source: 'record' | 'live'`) is ready for live games (stage 5).

## [0.2.0] - 2026-11-15

### Security
- pdf.js updated from 3.11.174 to 6.5.438: fixes CVE-2024-4367 (GHSA-wgrm-67xf-hhpq), where a
  malicious PDF could run arbitrary JavaScript. Every PDF is opened with `isEvalSupported: false`.
  `npm audit`: 0 vulnerabilities.
- Untrusted text (books, PGN, backup files, cloud sets) is escaped everywhere it becomes HTML:
  library ids/types, move-list comments and NAGs, SVG board squares and piece codes.
- Backup files are validated before import: types checked, fields clipped, items with an invalid
  position or id are skipped and reported.

### Added
- Accounts and sync (optional, stage 4 part A): coach signs in with e-mail, students join with a
  one-time code from the coach (no e-mail), sets of puzzles are assigned to students, progress is
  synced offline-first. Supabase schema with Row Level Security on every table. Disabled until the
  cloud is configured (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Reminder to download a backup every 14 days when the library lives only in this browser.
- End-to-end tests (Playwright, Chromium) and README screenshots.
- ESLint and type checking (`// @ts-check` + JSDoc) for the pure modules.
- CI on every pull request and push: lint, type check, unit tests, build, end-to-end tests.
- Keep-alive workflow for the free Supabase project.

### Changed
- `src/ui/app.js` split into modules (state, dialogs, import, position editor/diagram, progress,
  data, library and move-list markup); behaviour unchanged.
- Deployment to GitHub Pages runs only after a green CI run on `main`.
- The "Урок" button is hidden outside claude.ai (online lessons are planned).
- Pieces take 88% of a square; board coordinates are smaller and sit in the corners.

### Fixed
- File letters a–h no longer overlap first-rank pieces on phones.
- The evaluation bar is neutral (50/50) while there is no evaluation for the current position.
- The opponent's delayed reply and the "Показать решение" animation no longer move the board of
  another item opened in the meantime.
- Engine score text no longer shows "NaN" for a line without a score.

## [0.1.0] - 2026-11-14

First public version: https://shakh-jpg.github.io/chess-tetrad/

### Added
- The single-file prototype split into ES modules (Vite), with unit tests.
- Installable PWA that works offline; Stockfish 19 lite (WASM) built in; local fonts; SVG pieces.
- Deployment to GitHub Pages; install guide for students.

### Fixed
- Repeating a puzzle before it is due no longer grows its review interval.
- A puzzle with a `[FEN]` tag no longer takes the previous game's tag as its title.
- Russian plural forms ("1 полуход", "3 полухода", "45 полуходов").

### Removed
- Sample puzzle 4 (its solution ended with a check, not a mate).

[Unreleased]: https://github.com/shakh-jpg/chess-tetrad/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/shakh-jpg/chess-tetrad/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shakh-jpg/chess-tetrad/releases/tag/v0.1.0
