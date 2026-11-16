// @ts-check
// Scan jobs and their diagram images live in their own IndexedDB database, apart from the
// library: the app loads the whole library at start, and a scanned book can have hundreds of
// diagram images. Records:
//   'job:<fingerprint>'          the job state (pages done, results without images)
//   'img:<fingerprint>:<result>' { view, board } data URLs of one diagram, text of its page (OCR)
import { createStore } from '../storage/store.js';

/** @type {any} */ var store = null;
/** @type {Promise<void>|null} */ var opening = null;

/** @param {any} [deps] for tests: a fake indexedDB */
export function useScanStore(deps) { store = createStore(Object.assign({ dbName: 'shakhmatnaya-tetrad-scan', noCache: true }, deps || {})); opening = null; }

async function ready() {
  if (!store) useScanStore();
  if (!opening) opening = store.open();
  await opening;
  return store;
}

/** @param {string} fp */
export async function loadJob(fp) { var s = await ready(), rec = await s.get('job:' + fp); return rec ? rec.state : null; }
/** @param {{ fingerprint: string }} state */
export async function saveJob(state) { var s = await ready(); return s.put({ id: 'job:' + state.fingerprint, state: state }); }
/** @param {string} fp @param {string} id @param {{ view?: string, board?: string, text?: string }} img */
export async function putImages(fp, id, img) { var s = await ready(); return s.put({ id: 'img:' + fp + ':' + id, view: img.view || '', board: img.board || '', text: img.text || '' }); }
/** @param {string} fp @param {string} id @returns {Promise<{ view: string, board: string, text: string }|null>} */
export async function getImages(fp, id) { var s = await ready(), rec = await s.get('img:' + fp + ':' + id); return rec ? { view: rec.view, board: rec.board, text: rec.text || '' } : null; }

/**
 * Moves the images out of fresh results (they are stored separately), returns the results.
 * @param {string} fp @param {any[]} results
 */
export async function stashImages(fp, results) {
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.view || r.board) { await putImages(fp, r.id, { view: r.view, board: r.board, text: r.text }); delete r.view; delete r.board; delete r.text; }
  }
  return results;
}
