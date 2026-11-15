// @ts-check
// Runs a scan over a page range: one page at a time, resumable, cancellable.
// Everything external is injected (page source, page processor, state storage), so it is testable.

/**
 * @typedef {{ width: number, height: number, gray: Uint8ClampedArray }} PageImage
 * @typedef {{ fingerprint: string, name: string, pages: number, done: number[], results: any[], updated: number }} ScanState
 * @typedef {{ page: number, index: number, total: number, found: number, skipped: boolean }} Progress
 */

/** @param {string} fingerprint @param {string} name @param {number} pages @returns {ScanState} */
export function newScanState(fingerprint, name, pages) {
  return { fingerprint: fingerprint, name: name, pages: pages, done: [], results: [], updated: 0 };
}

/** Pages of [from, to] (0-based, inclusive) that are not done yet. @param {ScanState} st @param {number} from @param {number} to */
export function pendingPages(st, from, to) {
  var out = [];
  for (var p = Math.max(0, from); p <= Math.min(to, st.pages - 1); p++) if (st.done.indexOf(p) < 0) out.push(p);
  return out;
}

/**
 * @param {{
 *   source: { pages: number, renderPage: (i: number, dpi: number) => Promise<PageImage> },
 *   state: ScanState,
 *   dpi: number,
 *   processPage: (img: PageImage, page: number) => Promise<any[]> | any[],
 *   save: (st: ScanState) => any,
 *   pause?: () => Promise<void>
 * }} o
 */
export function createScanJob(o) {
  var cancelled = false;
  var pause = o.pause || function () { return new Promise(function (r) { setTimeout(r, 0); }); };
  return {
    cancel: function () { cancelled = true; },
    get cancelled() { return cancelled; },
    /**
     * @param {number} from 0-based first page @param {number} to 0-based last page (inclusive)
     * @param {(p: Progress) => void} [onProgress]
     * @returns {Promise<{ state: ScanState, finished: boolean }>}
     */
    run: async function (from, to, onProgress) {
      var list = pendingPages(o.state, from, to), total = list.length;
      for (var k = 0; k < list.length; k++) {
        if (cancelled) return { state: o.state, finished: false };
        var p = list[k];
        var img = await o.source.renderPage(p, o.dpi);
        var res = await o.processPage(img, p);
        (res || []).forEach(function (r) { o.state.results.push(r); });
        o.state.done.push(p);
        o.state.updated = Date.now();
        await o.save(o.state);
        if (onProgress) onProgress({ page: p, index: k + 1, total: total, found: o.state.results.length, skipped: false });
        await pause(); // let the UI breathe between pages
      }
      return { state: o.state, finished: !cancelled };
    }
  };
}
