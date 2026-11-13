// Spaced repetition for puzzles: simple Leitner boxes (0, 1, 3, 7, 16, 35 days).
// Extracted from the prototype's UI as pure functions so they can be tested.

export var BOX_DAYS = [0, 1, 3, 7, 16, 35];
export var DAY = 864e5;

export function dayKey(t) {
  var d = new Date(t || Date.now());
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

export function newStat() {
  return { n: 0, ok: 0, clean: 0, fail: 0, box: 0, last: 0, due: 0, res: '' };
}

// True if a successful attempt comes before the puzzle is due again
// (e.g. pressing "Ещё раз" right after solving). Such repeats must not
// move the puzzle to a longer interval.
export function isEarlyRepeat(st, kind, now) {
  return kind !== 'fail' && st.n > 0 && st.res !== 'fail' && now < st.due;
}

// kind: 'clean' (no mistakes, no hints) | 'help' (mistakes or hints) | 'fail' (solution shown).
// Mutates and returns st.
export function applyResult(st, kind, now) {
  if (now === undefined) now = Date.now();
  if (isEarlyRepeat(st, kind, now)) {
    // Fix (stage 1): an early repeat is practice only; box, due date and the last result stay.
    st.n++; st.ok++; st.last = now;
    return st;
  }
  st.n++; st.last = now; st.res = kind;
  if (kind === 'fail') { st.fail++; st.box = 0; st.due = now; }
  else {
    st.ok++;
    if (kind === 'clean') { st.clean++; st.box = Math.min(5, st.box + 1); }
    st.due = now + Math.max(1, BOX_DAYS[st.box]) * DAY;
  }
  return st;
}

// Daily activity log { 'YYYY-MM-DD': count }, keeps the last 400 days. Mutates and returns log.
export function bumpLog(log, now) {
  var k = dayKey(now); log[k] = (log[k] || 0) + 1;
  var keys = Object.keys(log).sort(); while (keys.length > 400) delete log[keys.shift()];
  return log;
}

// Days in a row with activity, counting today or (if nothing yet today) from yesterday.
export function streak(log, now) {
  var n = 0, d = new Date(now || Date.now());
  if (!log[dayKey(d)]) d = new Date(d.getTime() - DAY);
  while (log[dayKey(d)]) { n++; d = new Date(d.getTime() - DAY); }
  return n;
}

export function isDue(st, now) {
  return st.res !== 'fail' && st.due <= (now === undefined ? Date.now() : now);
}

// Status suffix for the library list (HTML, as in the prototype).
export function statLabel(it, now) {
  var st = it.stat;
  if (!st) return it.solved ? ' · <b class="ok">решено</b>' : '';
  var due = isDue(st, now);
  if (st.res === 'fail') return ' · <b class="warn">не решено, повторить</b>';
  return ' · <b class="ok">' + (st.res === 'clean' ? 'решено сразу' : 'решено с ошибками или подсказкой') + '</b>' + (due ? ' · <b class="due">пора повторить</b>' : '');
}
