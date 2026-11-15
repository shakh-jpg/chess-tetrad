// Recording a game over the board: new game -> 5 moves -> reload -> moves kept -> PGN export.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { openApp, move } from './helpers.js';

function today() {
  const d = new Date();
  return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
}

test('record a game: 5 moves, reload, moves kept, correct PGN', async ({ page }) => {
  const errors = await openApp(page);

  // new game with headers; the engine stays off
  await page.locator('#btn-newgame').click();
  await page.locator('#rh-white').fill('Иванов');
  await page.locator('#rh-black').fill('Петров');
  await page.locator('#rh-event').fill('E2E');
  await expect(page.locator('#rh-date')).toHaveValue(today());
  await page.locator('#rh-start').click();
  await expect(page.locator('#itemtitle')).toContainText('Иванов — Петров · E2E');
  await expect(page.locator('#banner')).toBeEmpty(); // no puzzle banner, no "Решать"
  await expect(page.locator('#recbar')).toBeVisible();
  await expect(page.locator('#engine-toggle')).toHaveText('Включить');
  await expect(page.locator('#books .book', { hasText: 'Мои партии' })).toBeVisible();

  // 5 moves
  await move(page, 'e2', 'e4');
  await move(page, 'e7', 'e5');
  await move(page, 'g1', 'f3');
  await move(page, 'b8', 'c6');
  await move(page, 'f1', 'b5');
  await expect(page.locator('#moves .mv')).toHaveCount(5);

  // back one move, another move = a variation; "Удалить ход" removes it again
  await page.locator('#recbar [data-nav="prev"]').click();
  await move(page, 'f1', 'c4');
  await expect(page.locator('#moves .var .mv')).toHaveCount(1);
  await page.locator('#recbar [data-act="delmove"]').click();
  await expect(page.locator('#moves .var')).toHaveCount(0);
  await expect(page.locator('#moves .mv')).toHaveCount(5);

  // reload right away: the game is saved after each move
  await page.reload();
  await expect(page.locator('#itemtitle')).toContainText('Иванов — Петров · E2E');
  await expect(page.locator('#moves .mv')).toHaveCount(5);
  await expect(page.locator('#engine-toggle')).toHaveText('Включить');

  // result in the headers dialog
  await page.locator('#recbar [data-act="headers"]').click();
  await page.locator('#rh-result').selectOption('1-0');
  await page.locator('#rh-save').click();
  await expect(page.locator('#itemsub')).toContainText('1-0');

  // PGN export of the current record
  await page.locator('#btn-data').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#dt-pgn-cur').click()]);
  const pgn = fs.readFileSync(await download.path(), 'utf8');
  expect(pgn).toContain('[Event "E2E"]');
  expect(pgn).toContain('[Date "' + today() + '"]');
  expect(pgn).toContain('[White "Иванов"]');
  expect(pgn).toContain('[Black "Петров"]');
  expect(pgn).toContain('[Result "1-0"]');
  expect(pgn).toContain('1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0');
  expect(errors).toEqual([]);
});
