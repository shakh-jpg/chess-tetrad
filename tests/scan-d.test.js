// Stage D of scan import: review logic without UI (statuses, edits, one-click choices, learning queue).
import { describe, it, expect } from 'vitest';
import {
  isConfident, reviewCounts, matchesFilter, editResult, nextChoice, altsFrom,
  confirmResult, skipResult, toLearn, cellsOf, CONFIDENT
} from '../src/scan/review.js';
import { scanItemsFrom } from '../src/scan/to-items.js';

const ok = () => ({ id: '1:0', page: 1, index: 0, fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', side: 'w', task: false, valid: true, problems: [], low: ['e2'], conf: 0.2, alts: { e2: 'wPRN', e8: 'bKNQ', e1: 'wKQ' } });
const bad = () => ({ id: '2:0', page: 2, index: 0, fen: '4k3/8/8/8/8/8/8/8 w - - 0 1', side: 'w', task: false, valid: false, problems: ['нет белого короля'], low: [], conf: 0.05, alts: {} });

describe('review statuses and filters', () => {
  it('counts and filters', () => {
    const R = [ok(), bad(), { ...ok(), id: '3:0', status: 'confirmed' }, { ...ok(), id: '4:0', status: 'skipped' }];
    expect(reviewCounts(R)).toEqual({ total: 4, confirmed: 1, skipped: 1, left: 2, bad: 1, confident: 1 });
    expect(R.filter((r) => matchesFilter(r, 'todo')).map((r) => r.id)).toEqual(['1:0', '2:0']);
    expect(R.filter((r) => matchesFilter(r, 'bad')).map((r) => r.id)).toEqual(['2:0']);
    expect(R.filter((r) => matchesFilter(r, 'done')).map((r) => r.id)).toEqual(['3:0']);
    expect(R.filter((r) => matchesFilter(r, 'all')).length).toBe(4);
  });
  it('"confident" = playable, confident enough, few unsure squares, not yet reviewed or edited', () => {
    expect(isConfident(ok())).toBe(true);
    expect(isConfident(bad())).toBe(false);
    expect(isConfident({ ...ok(), conf: CONFIDENT.conf - 0.01 })).toBe(false);
    expect(isConfident({ ...ok(), low: ['a1', 'a2', 'a3', 'a4', 'a5'] })).toBe(false);
    expect(isConfident({ ...ok(), status: 'confirmed' })).toBe(false);
  });
  it('an unplayable position cannot be confirmed; skipping is always possible', () => {
    const b = bad();
    expect(confirmResult(b)).toBe(false);
    expect(b.status).toBeUndefined();
    expect(skipResult(b)).toBe(true);
    expect(b.status).toBe('skipped');
  });
});

describe('editing a recognized board', () => {
  it('re-checks the position, clears the unsure mark of changed squares, marks it edited', () => {
    const b = bad();
    const cells = { ...cellsOf(b), e1: 'wK' };
    editResult(b, cells, 'b', true);
    expect(b).toMatchObject({ valid: true, problems: [], side: 'b', task: true, edited: true, fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1' });
    const r = ok();
    editResult(r, { ...cellsOf(r), e2: 'wR' }, 'w', false);
    expect(r.low).toEqual([]);
  });
  it('changing only the side to move is not a piece correction', () => {
    const r = ok();
    editResult(r, cellsOf(r), 'b', false);
    expect(r.edited).toBeUndefined();
    expect(r.fen.split(' ')[1]).toBe('b');
  });
  it('castling rights follow the king and rooks', () => {
    const r = ok();
    editResult(r, { e1: 'wK', h1: 'wR', e8: 'bK' }, 'w', false);
    expect(r.fen).toBe('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  });
});

describe('one click = next likely piece', () => {
  it('cycles through the candidates of the square, the other colour, empty, and back', () => {
    const r = ok();
    expect(nextChoice(r, 'e2', 'wP')).toBe('wR');
    expect(nextChoice(r, 'e2', 'wR')).toBe('wN');
    expect(nextChoice(r, 'e2', 'wN')).toBe('bP');
    expect(nextChoice(r, 'e2', 'bP')).toBe(null);
    expect(nextChoice(r, 'e2', undefined)).toBe('wP');
    expect(nextChoice(r, 'e2', 'bQ')).toBe('wP'); // a palette piece: back to the recognized one
  });
  it('squares read as empty have no candidates', () => {
    expect(nextChoice(ok(), 'a1', undefined)).toBeUndefined();
  });
  it('candidates come from the recognizer scores, recognized type first', () => {
    const raw = [
      { sq: 'e2', p: 'wP', scores: { R: 0.6, P: 0.5, N: 0.4, B: 0.1 } },
      { sq: 'a1', p: null }
    ];
    expect(altsFrom(raw)).toEqual({ e2: 'wPRN' });
  });
});

describe('learning and the book', () => {
  it('only corrected and confirmed boards are learned, once', () => {
    const a = ok(), b = ok(), c = ok();
    editResult(a, { ...cellsOf(a), e2: 'wN' }, 'w', false); expect(confirmResult(a)).toBe(true);
    editResult(b, { ...cellsOf(b), e2: 'wB' }, 'w', false);
    confirmResult(c);
    expect(toLearn([a, b, c])).toEqual([a]);
    a.learned = true;
    expect(toLearn([a, b, c])).toEqual([]);
  });
  it('a confirmed diagram goes to the book without the "не проверено" mark', () => {
    const r = ok(); confirmResult(r);
    const [item] = scanItemsFrom([r], 'Книга (скан)');
    expect(item).toMatchObject({ unchecked: false, title: 'Диаграмма (стр. 2, диаграмма 1)', startFen: r.fen });
  });
});

describe('scan store (separate database, images apart from the job)', async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  const S = await import('../src/scan/scan-store.js');
  it('keeps the job without images and the images by result id', async () => {
    S.useScanStore({ indexedDB: new IDBFactory(), storage: null });
    const results = [{ id: '3:0', fen: 'x', view: 'data:image/jpeg;base64,AA', board: 'data:image/png;base64,BB' }];
    await S.stashImages('fp1', results);
    expect(results[0]).toEqual({ id: '3:0', fen: 'x' });
    await S.saveJob({ fingerprint: 'fp1', pages: 5, done: [3], results });
    expect(await S.loadJob('fp1')).toEqual({ fingerprint: 'fp1', pages: 5, done: [3], results: [{ id: '3:0', fen: 'x' }] });
    expect(await S.getImages('fp1', '3:0')).toEqual({ view: 'data:image/jpeg;base64,AA', board: 'data:image/png;base64,BB' });
    expect(await S.getImages('fp1', '9:9')).toBe(null);
    expect(await S.loadJob('other')).toBe(null);
  });
});
