// Rule B: a puzzle from the coach's set hides the solution until it is solved, unless the coach
// ticked "Разрешить показ решения" (sets.allow_solution).
import { describe, it, expect } from 'vitest';
import { setFromBook, mergeRemoteSet, solutionLocked } from '../src/sync/model.js';
import { createApi } from '../src/sync/api.js';
import { itemsHTML } from '../src/ui/library.js';
import { parseBackup, makeBackup } from '../src/ui/backup.js';

const FEN = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
const set = (extra) => Object.assign({ id: 'S1', title: 'Мат в 1', source: 'Пример', created_at: '2026-11-18T10:00:00Z',
  set_items: [{ id: 'i1', position: 0, kind: 'puzzle', title: 'А', start_fen: FEN, movetext: '1. Rd8#' }] }, extra);

describe('allow_solution: mapping', () => {
  it('the coach\'s choice goes into the set (off by default)', () => {
    const book = { id: 'b', name: 'Книга', items: [{ id: 'x', type: 'puzzle', title: 'З', startFen: FEN, text: '1. Rd8#' }] };
    expect(setFromBook(book, book.items, {}).allowSolution).toBe(false);
    expect(setFromBook(book, book.items, { allowSolution: true }).allowSolution).toBe(true);
  });
  it('the student book keeps it; a missing column (cloud not updated yet) means hidden', () => {
    expect(mergeRemoteSet(null, set({ allow_solution: true }), [], 0).book.remote.allowSolution).toBe(true);
    expect(mergeRemoteSet(null, set({ allow_solution: false }), [], 0).book.remote.allowSolution).toBe(false);
    expect(mergeRemoteSet(null, set({}), [], 0).book.remote.allowSolution).toBe(false);
    expect(mergeRemoteSet(null, set({ allow_solution: 'yes' }), [], 0).book.remote.allowSolution).toBe(false);
  });
  it('locks only puzzles of the coach\'s sets without the permission; own books and the coach\'s books are unchanged', () => {
    const locked = mergeRemoteSet(null, set({}), [], 0).book;
    const open = mergeRemoteSet(null, set({ allow_solution: true }), [], 0).book;
    const own = { id: 'b', name: 'Моя книга', items: [] };
    expect(solutionLocked(locked, { type: 'puzzle' })).toBe(true);
    expect(solutionLocked(locked, { type: 'game' })).toBe(false);
    expect(solutionLocked(open, { type: 'puzzle' })).toBe(false);
    expect(solutionLocked(own, { type: 'puzzle' })).toBe(false);
    expect(solutionLocked(null, { type: 'puzzle' })).toBe(false);
  });
  it('survives a backup round trip (and a forged value is ignored)', () => {
    const b = mergeRemoteSet(null, set({ allow_solution: true }), [], 0).book;
    expect(parseBackup(JSON.stringify(makeBackup([b], {}))).books[0].remote.allowSolution).toBe(true);
    const forged = JSON.parse(JSON.stringify(makeBackup([b], {})));
    forged.books[0].remote.allowSolution = 'true';
    expect(parseBackup(JSON.stringify(forged)).books[0].remote.allowSolution).toBeUndefined();
  });
  it('no "edit moves" button in a locked set', () => {
    const list = [{ id: 'i1', type: 'puzzle', title: 'А', plies: 1 }];
    expect(itemsHTML(list, null, '')).toContain('data-edit');
    expect(itemsHTML(list, null, '', { noEdit: true })).not.toContain('data-edit');
  });
});

describe('allow_solution: API', () => {
  function client(results) {
    const calls = [];
    return {
      calls,
      from: (name) => {
        const ops = [];
        const chain = new Proxy({}, {
          get(_, op) {
            if (op === 'then') { const r = results(name, ops, calls.filter((c) => c === name).length); return (ok, bad) => Promise.resolve(r).then(ok, bad); }
            return (...a) => { ops.push([op, ...a]); if (op === 'select' || op === 'insert') calls.push(name); return chain; };
          }
        });
        return chain;
      },
      rpc: async () => ({ data: null, error: null }),
      auth: { getSession: async () => ({ data: { session: null } }) }
    };
  }
  it('sends allow_solution only when ticked', async () => {
    const sent = [];
    const c = client((name, ops) => { if (name === 'sets') sent.push(ops[0][1]); return { data: { id: 'N' }, error: null }; });
    const api = createApi(c);
    await api.createSetAndAssign('c1', { title: 'T', source: 'S', rows: [], allowSolution: false }, []);
    await api.createSetAndAssign('c1', { title: 'T', source: 'S', rows: [], allowSolution: true }, []);
    expect(sent).toEqual([{ coach_id: 'c1', title: 'T', source: 'S' }, { coach_id: 'c1', title: 'T', source: 'S', allow_solution: true }]);
  });
  it('the student still gets the sets before the cloud is updated (no allow_solution column)', async () => {
    const selects = [];
    const c = client((name, ops, n) => {
      if (name !== 'sets') return { data: [], error: null };
      selects.push(ops[0][1]);
      return n === 1 ? { data: null, error: { message: 'column sets.allow_solution does not exist' } } : { data: [set({})], error: null };
    });
    const r = await createApi(c).fetchAssigned();
    expect(r.sets.length).toBe(1);
    expect(selects[0]).toContain('allow_solution');
    expect(selects[1]).not.toContain('allow_solution');
  });
});
