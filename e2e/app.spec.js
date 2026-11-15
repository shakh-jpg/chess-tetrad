// Main user flows on the built app (vite preview on 127.0.0.1).
import { test, expect } from '@playwright/test';
import { openApp, move, openItem } from './helpers.js';

test('open the app, make a move and create a variation', async ({ page }) => {
  const errors = await openApp(page);
  await openItem(page, 'Андерсен');
  await page.locator('[data-nav="first"]').click();
  await move(page, 'd2', 'd4'); // the game starts with 1.e4, so 1.d4 becomes a variation
  await expect(page.locator('#moves .var .mv', { hasText: 'd4' })).toBeVisible();
  await expect(page.locator('#moves .mv.cur')).toHaveText(/d4/);
  await expect(page.locator('#turnline')).toHaveText(/чёрных/);
  expect(errors).toEqual([]);
});

test('solve a puzzle, reload: the progress is still there', async ({ page }) => {
  const errors = await openApp(page);
  await openItem(page, 'Задача 1');
  await expect(page.locator('#banner')).toContainText('Белые начинают');
  await move(page, 'd1', 'd8'); // 1. Rd8#
  await expect(page.locator('#banner')).toContainText('Задача решена');
  const row = page.locator('#items .item', { hasText: 'Задача 1' });
  await expect(row).toContainText('решено сразу');
  await page.waitForTimeout(600); // the library is saved to IndexedDB with a short delay
  await page.reload();
  await expect(page.locator('#items .item', { hasText: 'Задача 1' })).toContainText('решено сразу');
  expect(errors).toEqual([]);
});

test('paste PGN: the game appears in the library', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('#btn-import').click();
  await page.locator('.paste summary').click();
  await page.locator('#imp-text').fill('[Event "E2E"]\n[White "Тестов"]\n[Black "Проверкин"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 {Испанская} 4. Ba4 Nf6 *');
  await page.locator('#imp-go-text').click();
  await expect(page.locator('.modal .status')).toContainText('партий 1');
  await page.locator('#rv-add').click();
  const item = page.locator('#items .item', { hasText: 'Тестов — Проверкин' });
  await expect(item).toBeVisible();
  await expect(item).toContainText('8 п/х');
  await item.locator('.it-main').click();
  await expect(page.locator('#moves .cm')).toHaveText('Испанская');
  expect(errors).toEqual([]);
});

test('markup in a pasted PGN is shown as text and never runs', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('#btn-import').click();
  await page.locator('.paste summary').click();
  await page.locator('#imp-text').fill('[Event "<img src=x onerror=alert(1)>"]\n[White "<script>alert(2)</script>"]\n[Black "B"]\n\n1. e4 {<img src=y onerror=alert(3)>} e5 2. Nf3 Nc6 3. Bb5 *');
  await page.locator('#imp-go-text').click();
  await page.locator('#rv-add').click();
  const item = page.locator('#items .item').filter({ hasText: '<script>alert(2)</script>' });
  await expect(item).toBeVisible();
  await item.locator('.it-main').click();
  await expect(page.locator('#moves .cm')).toHaveText('<img src=y onerror=alert(3)>');
  expect(await page.locator('#items img, #moves img, #books img').count()).toBe(0);
  expect(errors).toEqual([]); // no alert() dialogs, no page errors
});

test('engine: the evaluation bar is neutral when off and shows White\'s edge at the start', async ({ page }) => {
  await openApp(page);
  await openItem(page, 'Андерсен');
  await page.locator('[data-nav="first"]').click();
  const bar = page.locator('#evalfill');
  await expect(bar).toHaveAttribute('style', /height: 50%/);
  await page.locator('#engine-toggle').click();
  await expect(page.locator('.eng-status')).toContainText('Stockfish 19', { timeout: 30000 });
  await expect(page.locator('.eng-line').first()).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => parseFloat((await bar.getAttribute('style')).match(/height:\s*([\d.]+)%/)[1]), { timeout: 30000 })
    .toBeGreaterThan(50);
  await page.locator('#engine-toggle').click();
  await expect(bar).toHaveAttribute('style', /height: 50%/);
});
