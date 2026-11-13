import { describe, it, expect } from 'vitest';
import { applyResult, newStat, isEarlyRepeat, bumpLog, streak, dayKey, statLabel, DAY, BOX_DAYS } from '../src/srs/srs.js';

const T0 = new Date(2026, 10, 13, 12, 0, 0).getTime();

describe('spaced repetition', () => {
  it('uses boxes 0/1/3/7/16/35 days', () => {
    expect(BOX_DAYS).toEqual([0, 1, 3, 7, 16, 35]);
  });

  it('a clean first solve goes to box 1, due in 1 day', () => {
    const st = applyResult(newStat(), 'clean', T0);
    expect(st).toMatchObject({ n: 1, ok: 1, clean: 1, box: 1, res: 'clean', due: T0 + DAY });
  });

  it('clean solves on time climb the boxes up to 35 days and stop there', () => {
    const st = newStat(); let now = T0;
    const intervals = [];
    for (let i = 0; i < 7; i++) {
      applyResult(st, 'clean', now);
      intervals.push(Math.round((st.due - now) / DAY));
      now = st.due; // come back exactly when due
    }
    expect(intervals).toEqual([1, 3, 7, 16, 35, 35, 35]);
    expect(st.box).toBe(5);
  });

  it('solving with help keeps the box; at least 1 day', () => {
    const st = applyResult(newStat(), 'help', T0);
    expect(st.box).toBe(0);
    expect(st.due).toBe(T0 + DAY);
    const st2 = applyResult(applyResult(newStat(), 'clean', T0), 'help', T0 + DAY);
    expect(st2.box).toBe(1);
    expect(st2.due).toBe(T0 + 2 * DAY);
  });

  it('showing the solution (fail) resets to box 0 and makes it due now', () => {
    const st = newStat(); applyResult(st, 'clean', T0); applyResult(st, 'clean', T0 + DAY);
    applyResult(st, 'fail', T0 + 4 * DAY);
    expect(st).toMatchObject({ box: 0, due: T0 + 4 * DAY, res: 'fail', fail: 1 });
  });

  // Regression for the stage-0 bug: "Ещё раз" right after solving pushed the puzzle up a box each time.
  it('"Ещё раз" before the due date does not grow the interval', () => {
    const st = applyResult(newStat(), 'clean', T0);
    for (let i = 1; i <= 6; i++) applyResult(st, 'clean', T0 + i * 60000);
    expect(st.box).toBe(1);
    expect(st.due).toBe(T0 + DAY);
    expect(st.n).toBe(7);
    expect(st.res).toBe('clean');
    expect(isEarlyRepeat(st, 'clean', T0 + DAY)).toBe(false);
  });

  it('an early repeat with mistakes does not change the result either', () => {
    const st = applyResult(newStat(), 'clean', T0);
    applyResult(st, 'help', T0 + 1000);
    expect(st).toMatchObject({ box: 1, res: 'clean', due: T0 + DAY });
  });

  it('an early fail still counts (box 0, due now)', () => {
    const st = applyResult(newStat(), 'clean', T0);
    applyResult(st, 'fail', T0 + 1000);
    expect(st).toMatchObject({ box: 0, res: 'fail', due: T0 + 1000 });
  });

  it('after a fail, solving again right away counts normally', () => {
    const st = applyResult(newStat(), 'fail', T0);
    applyResult(st, 'clean', T0 + 1000);
    expect(st).toMatchObject({ box: 1, res: 'clean', due: T0 + 1000 + DAY });
  });

  it('counts a streak of active days', () => {
    const log = {};
    bumpLog(log, T0 - 2 * DAY); bumpLog(log, T0 - DAY); bumpLog(log, T0); bumpLog(log, T0);
    expect(log[dayKey(T0)]).toBe(2);
    expect(streak(log, T0)).toBe(3);
    expect(streak(log, T0 + DAY)).toBe(3); // nothing yet today: count from yesterday
    expect(streak(log, T0 + 2 * DAY)).toBe(0);
  });

  it('keeps at most 400 days in the log', () => {
    const log = {};
    for (let i = 0; i < 405; i++) bumpLog(log, T0 + i * DAY);
    expect(Object.keys(log).length).toBe(400);
  });

  it('labels items for the library', () => {
    expect(statLabel({}, T0)).toBe('');
    expect(statLabel({ stat: applyResult(newStat(), 'fail', T0) }, T0)).toContain('не решено');
    const st = applyResult(newStat(), 'clean', T0);
    expect(statLabel({ stat: st }, T0)).not.toContain('пора повторить');
    expect(statLabel({ stat: st }, T0 + DAY)).toContain('пора повторить');
  });
});
