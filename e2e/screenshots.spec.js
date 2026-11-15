// Screenshots for README (docs/img/). Run on demand: npm run screenshots
import { test, expect } from '@playwright/test';
import { openApp, openItem } from './helpers.js';

const OUT = 'docs/img/';

test('desktop: game with variations and the engine', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await openItem(page, 'Андерсен');
  await page.locator('#moves .mv', { hasText: 'xf4' }).first().click();
  await page.locator('#engine-toggle').click();
  await expect(page.locator('.eng-line')).toHaveCount(3, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + 'desktop.png' });
});

test('phone: puzzle', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await openApp(page);
  await page.locator('.tab[data-pane="lib"]').click();
  await openItem(page, 'Задача 2');
  await expect(page.locator('#banner')).toContainText('Белые начинают');
  await page.screenshot({ path: OUT + 'phone-puzzle.png' });
  await ctx.close();
});

test('phone: menu', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await openApp(page);
  await page.locator('#btn-menu').click();
  await expect(page.locator('#top-actions')).toBeVisible();
  await page.screenshot({ path: OUT + 'phone-menu.png' });
  await ctx.close();
});

test('phone: recording a game (controls at hand)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await openApp(page);
  await page.locator('#btn-menu').click();
  await page.locator('#btn-newgame').click();
  await page.locator('#rh-white').fill('Иванов');
  await page.locator('#rh-black').fill('Петров');
  await page.locator('#rh-start').click();
  const bar = page.locator('#recbar');
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  // the recording buttons are on screen without scrolling, in the lower half (thumb zone)
  expect(box.y + box.height).toBeLessThanOrEqual(812);
  expect(box.y).toBeGreaterThan(812 / 2);
  for (const b of await bar.locator('.btn').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: OUT + 'phone-record.png' });
  await ctx.close();
});
