// Online lesson in two browser contexts (coach and student) + the "hidden solution" rule.
// The real Supabase Realtime is not used here (no cloud in tests): the app gets a test backend
// (window.__tetradLiveTest) whose message bus is relayed between the two browsers by this test.
// The relay drops messages on the coach's channel that do not come from the coach, like the
// Realtime policies do. What is tested: the app's whole lesson logic and UI over that bus.
import { test, expect } from '@playwright/test';
import { openApp, move, openItem } from './helpers.js';

const LESSON = '11111111-2222-4333-8444-555555555555';

async function livePage(browser, cfg, relay) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.exposeBinding('__relayPost', (_src, msg) => relay(page, msg));
  await page.addInitScript((c) => {
    const subs = [];
    window.__relayDeliver = (m) => subs.slice().forEach((cb) => cb(m));
    window.__tetradLiveTest = Object.assign(c, {
      bus: {
        post: (m) => { window.__relayPost(m); },
        subscribe: (cb) => { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); }; }
      }
    });
  }, cfg);
  return { context, page };
}

function makeRelay() {
  const pages = [];
  const log = [];
  const relay = async (from, msg) => {
    if (msg.ch === 'c' && msg.role !== 'c') return; // only the coach may send on the coach's channel
    if (msg.evt) log.push(msg.ch + ':' + msg.evt);
    for (const p of pages) if (p !== from) await p.evaluate((m) => window.__relayDeliver(m), msg).catch(() => {});
  };
  return { pages, log, relay };
}

const movesOf = (page) => page.locator('#moves .mv').allInnerTexts();

test('online lesson: coach leads, student follows, moves when allowed, lesson saved on both sides', async ({ browser }) => {
  const R = makeRelay();
  const coach = await livePage(browser, { role: 'coach', profile: { display_name: 'Тренер' }, students: [{ id: 's1', nick: 'Петя', bound_at: '2026-11-18T10:00:00Z' }, { id: 's2', nick: 'Маша', bound_at: null }] }, R.relay);
  const student = await livePage(browser, { role: 'student', profile: { nick: 'Петя', student_id: 's1' } }, R.relay);
  R.pages.push(coach.page, student.page);
  const cErr = await openApp(coach.page), sErr = await openApp(student.page);
  const C = coach.page, St = student.page;

  // the coach opens a book game and starts the lesson for Petya
  await openItem(C, 'Легаль');
  await expect(St.locator('#btn-live')).toBeHidden();
  await C.locator('#btn-live').click();
  await expect(C.locator('.modal .lv-pick input[data-s="s1"]')).toBeChecked();
  await expect(C.locator('.modal .lv-pick input[data-s="s2"]')).not.toBeChecked(); // has not signed in yet
  await C.locator('#lv-go').click();
  await expect(C.locator('#livebar')).toContainText('Урок идёт');
  await expect(C.locator('#livebar')).toContainText('Ученики ещё не подключились');
  expect(await C.evaluate(() => window.__tetradLiveTest.invited)).toEqual(['s1']);

  // the student sees the invitation and joins
  await St.evaluate((id) => { window.__tetradLiveTest.offer = { lesson_id: id, coach_name: 'Тренер' }; return window.__tetradLiveTest.poll(); }, LESSON);
  await expect(St.locator('#livebar')).toContainText('Тренер начал урок');
  await St.locator('[data-live="join"]').click();
  await expect(St.locator('#livebar')).toContainText('Идёт урок · Тренер');
  await expect(C.locator('#livebar')).toContainText('В уроке: Петя');
  await expect(St.locator('#itemtitle')).toContainText('Легаль');
  expect(await movesOf(St)).toEqual(await movesOf(C));
  // the book's comment stays on the coach's screen only
  await expect(C.locator('#moves')).toContainText('Чёрные не заметили');
  await expect(St.locator('#moves')).not.toContainText('Чёрные не заметили');

  // the coach navigates; the student follows
  await C.locator('[data-nav="first"]').click();
  await expect(St.locator('#moves .mv.cur')).toHaveCount(0);
  await C.locator('[data-nav="next"]').click();
  await C.locator('[data-nav="next"]').click();
  await expect(St.locator('#moves .mv.cur')).toHaveText(/e5/);

  // the coach plays a new move (a variation); it appears on the student's board
  await move(C, 'f1', 'c4');
  await expect(St.locator('#moves .var .mv', { hasText: 'c4' })).toBeVisible();
  await expect(St.locator('#moves .mv.cur')).toHaveText(/c4/);
  expect(R.log).toContain('c:mv'); // one small message, not the whole tree

  // by default only the coach moves; the engine is off for the student
  await move(St, 'g8', 'f6');
  await expect(St.locator('#toast')).toContainText('ходит только тренер');
  await expect(C.locator('#moves .mv', { hasText: 'f6' })).toHaveCount(0);
  await St.locator('#engine-toggle').click();
  await expect(St.locator('#toast')).toContainText('выключил движок');
  expect(await St.evaluate(() => window.__app.S.engineOn)).toBe(false);
  await expect(St.locator('#cmtext')).toBeDisabled();

  // the coach lets students move: the student's move goes through the coach to everyone
  await C.locator('[data-live="unlock"]').click();
  await expect(St.locator('#livebar')).toContainText('Можно ходить вместе с тренером');
  await move(St, 'g8', 'f6');
  await expect(C.locator('#moves .mv', { hasText: 'f6' })).toBeVisible();
  await expect(St.locator('#moves .mv', { hasText: 'f6' })).toBeVisible();
  // an illegal attempt changes nothing
  const before = await movesOf(C);
  await move(St, 'a1', 'a5');
  expect(await movesOf(C)).toEqual(before);

  // engine allowed; board flipped by the coach
  await C.locator('[data-live="eng"]').click();
  await expect(St.locator('#livebar')).not.toContainText('Движок выключен');
  await C.locator('[data-act="flip"]').first().click();
  await expect.poll(() => St.evaluate(() => window.__app.S.flipped)).toBe(true);

  // the coach records a new game during the lesson: the student's board switches to it
  await C.locator('#btn-newgame').click();
  await C.locator('#rh-white').fill('Тренер');
  await C.locator('#rh-black').fill('Петя');
  await C.locator('#rh-start').click();
  await expect(St.locator('#itemtitle')).toContainText('Тренер — Петя');
  await move(C, 'd2', 'd4'); // a new record opens unflipped (as in loadItem)
  await expect(St.locator('#moves .mv')).toHaveText([/d4/]);

  // end: the student's copy goes to «Уроки» (both records), the coach's book game too
  await C.locator('[data-live="end"]').click();
  await expect(St.locator('#toast')).toContainText('Тренер закончил урок');
  await expect(St.locator('#livebar')).toBeHidden();
  await expect(St.locator('#books .book', { hasText: 'Уроки' })).toBeVisible();
  const sBook = await St.evaluate(() => window.__app.S.books.find((b) => b.name === 'Уроки').items.map((i) => ({ title: i.title, text: i.text, source: i.source, ev: i.headers.Event })));
  expect(sBook.length).toBe(2);
  expect(sBook[0].text).toContain('Bc4');
  expect(sBook[0].text).toContain('Nf6');
  expect(sBook[0].text).not.toContain('Чёрные не заметили');
  expect(sBook[1].text).toBe('1. d4');
  expect(sBook[0].source).toBe('live');
  expect(sBook[0].ev).toContain('Петя');
  // the student keeps analysing the saved copy
  await expect(St.locator('#itemtitle')).toContainText('урок');
  const cBook = await C.evaluate(() => window.__app.S.books.find((b) => b.name === 'Уроки').items.map((i) => i.text));
  expect(cBook.length).toBe(1); // the recorded game stays in «Мои партии»
  expect(cBook[0]).toContain('Чёрные не заметили'); // the coach's own copy keeps the book text
  expect(await C.evaluate(() => window.__tetradLiveTest.ended)).toBe(true);

  expect(cErr).toEqual([]);
  expect(sErr).toEqual([]);
  await coach.context.close(); await student.context.close();
});

test('online lesson: a student that reconnects gets the full board; leaving and joining again', async ({ browser }) => {
  const R = makeRelay();
  const coach = await livePage(browser, { role: 'coach', profile: { display_name: 'Тренер' }, students: [{ id: 's1', nick: 'Петя', bound_at: 'x' }] }, R.relay);
  const student = await livePage(browser, { role: 'student', profile: { nick: 'Петя', student_id: 's1' } }, R.relay);
  R.pages.push(coach.page, student.page);
  await openApp(coach.page); await openApp(student.page);
  const C = coach.page, St = student.page;
  await openItem(C, 'Андерсен');
  await C.locator('#btn-live').click();
  await C.locator('#lv-go').click();
  await St.evaluate((id) => { window.__tetradLiveTest.offer = { lesson_id: id, coach_name: 'Тренер' }; return window.__tetradLiveTest.poll(); }, LESSON);
  await St.locator('[data-live="join"]').click();
  await expect(St.locator('#itemtitle')).toContainText('Андерсен');

  // the student leaves (saved), the coach goes on, the student joins again: full state arrives
  await St.locator('[data-live="leave"]').click();
  await expect(St.locator('#toast')).toContainText('Вы вышли из урока');
  await expect(St.locator('#livebar')).toContainText('Присоединиться');
  await C.locator('[data-nav="first"]').click();
  await move(C, 'd2', 'd4');
  await St.locator('[data-live="join"]').click();
  await expect(St.locator('#moves .var .mv', { hasText: 'd4' })).toBeVisible();
  await expect(St.locator('#moves .mv.cur')).toHaveText(/d4/);

  // opening one's own record during the lesson leaves the lesson
  await openItem(St, 'Задача 1');
  await expect(St.locator('#toast')).toContainText('вышли из урока');
  await expect(St.locator('#livebar')).toContainText('Присоединиться');
  await coach.context.close(); await student.context.close();
});

test('online lesson: before the cloud update the coach sees a clear message', async ({ browser }) => {
  const R = makeRelay();
  const coach = await livePage(browser, { role: 'coach', missing: true, profile: {}, students: [{ id: 's1', nick: 'Петя', bound_at: 'x' }] }, R.relay);
  const errors = await openApp(coach.page);
  await coach.page.locator('#btn-live').click();
  await coach.page.locator('#lv-go').click();
  await expect(coach.page.locator('#lv-st')).toContainText('Онлайн-урок ещё не включён в облаке');
  expect(errors).toEqual([]);
  await coach.context.close();
});

test('no cloud: no lesson button', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('#btn-live')).toBeHidden();
  await expect(page.locator('#livebar')).toBeHidden();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- rule B
async function addRemoteBook(page, allow) {
  await page.evaluate((allowSolution) => {
    const S = window.__app.S;
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const book = { id: 'set-T' + allowSolution, name: allowSolution ? 'Набор с решением' : 'Набор тренера', created: Date.now(),
      remote: { setId: 'T', source: 'Пример', allowSolution },
      items: [
        { id: 'r1', type: 'puzzle', title: 'Т1', startFen: fen, text: '1. Rd8#', plies: 1, result: '' },
        { id: 'r2', type: 'puzzle', title: 'Т2', startFen: fen, text: '1. Rd8#', plies: 1, result: '' }
      ] };
    S.books.push(book);
    S.book = book;
    window.__app.loadItem(book, book.items[0]);
  }, allow);
}

test('coach\'s set: no solution, no free analysis, no engine before solving; "Skip" counts as not solved', async ({ page }) => {
  const errors = await openApp(page);
  await addRemoteBook(page, false);
  const ban = page.locator('#banner');
  await expect(ban).toContainText('Белые начинают');
  await expect(ban.locator('[data-act="skip"]')).toBeVisible();
  await expect(ban.locator('[data-act="solution"]')).toHaveCount(0);
  await expect(ban.locator('[data-act="analyse"]')).toHaveCount(0);
  await expect(page.locator('#items [data-edit]')).toHaveCount(0);
  await page.locator('#engine-toggle').click();
  await expect(page.locator('#toast')).toContainText('Движок откроется, когда задача будет решена');
  // PGN export of the set is closed
  await page.locator('#btn-data').click();
  await expect(page.locator('#dt-pgn-cur')).toBeDisabled();
  await page.locator('.modal [data-close]').click();

  // skip: not solved, next puzzle
  await page.locator('[data-act="skip"]').click();
  await expect(page.locator('#itemtitle')).toHaveText('Т2');
  expect(await page.evaluate(() => window.__app.S.book.items[0].stat.res)).toBe('fail');

  // solved: analysis and engine open
  await move(page, 'd1', 'd8');
  await expect(ban).toContainText('Задача решена');
  await expect(ban.locator('[data-act="analyse"]')).toBeVisible();
  await page.locator('#engine-toggle').click();
  expect(await page.evaluate(() => window.__app.S.engineOn)).toBe(true);
  expect(errors).toEqual([]);
});

test('coach\'s set with "allow the solution": the usual buttons', async ({ page }) => {
  const errors = await openApp(page);
  await addRemoteBook(page, true);
  const ban = page.locator('#banner');
  await expect(ban.locator('[data-act="solution"]')).toBeVisible();
  await expect(ban.locator('[data-act="analyse"]')).toBeVisible();
  await expect(ban.locator('[data-act="skip"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
