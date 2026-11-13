import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, describeError } from '../src/storage/store.js';

let n = 0;
const fresh = (extra) => createStore(Object.assign({ indexedDB: new IDBFactory(), storage: null, dbName: 'db' + (n++) }, extra || {}));

describe('storage', () => {
  it('saves, reads and deletes books in IndexedDB', async () => {
    const s = fresh();
    await s.open();
    expect(s.persistent).toBe(true);
    expect(await s.put({ id: 'b1', name: 'Книга', items: [{ id: 'i1' }] })).toBe(true);
    expect(await s.put({ id: 'b2', name: 'Вторая', items: [] })).toBe(true);
    expect((await s.all()).map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(await s.del('b1')).toBe(true);
    expect((await s.all()).map((b) => b.id)).toEqual(['b2']);
  });

  it('falls back to memory when IndexedDB is unavailable', async () => {
    const s = createStore({ indexedDB: null, storage: null });
    await s.open();
    expect(s.persistent).toBe(false);
    await s.put({ id: 'x', items: [] });
    expect((await s.all()).length).toBe(1);
  });

  it('does not swallow write errors: returns false and calls the error handler', async () => {
    const s = fresh();
    await s.open();
    const errors = [];
    s.setErrorHandler((op, why) => errors.push([op, why]));
    // A function cannot be cloned into IndexedDB -> DataCloneError inside the transaction.
    const ok = await s.put({ id: 'bad', fn: () => 1 });
    expect(ok).toBe(false);
    expect(errors.length).toBe(1);
    expect(errors[0][0]).toBe('save');
  });

  it('explains a full disk in plain words', () => {
    expect(describeError({ name: 'QuotaExceededError' })).toMatch(/закончилось место/);
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('requests persistent storage once and reports the result', async () => {
    let asked = 0;
    const granted = fresh({ storage: { persisted: async () => false, persist: async () => { asked++; return true; } } });
    expect(await granted.requestPersistence()).toBe('granted');
    const already = fresh({ storage: { persisted: async () => true, persist: async () => { asked++; return true; } } });
    expect(await already.requestPersistence()).toBe('persisted');
    const denied = fresh({ storage: { persisted: async () => false, persist: async () => false } });
    expect(await denied.requestPersistence()).toBe('denied');
    expect(await fresh({ storage: null }).requestPersistence()).toBe('unsupported');
    expect(asked).toBe(1);
  });

  it('debounced save writes the latest version once', async () => {
    const s = fresh();
    await s.open();
    const b = { id: 'b', name: 'v1', items: [] };
    s.save(b); b.name = 'v2'; s.save(b);
    await new Promise((r) => setTimeout(r, 450));
    expect((await s.all())[0].name).toBe('v2');
  });
});
