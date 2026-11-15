// Shared helpers for the end-to-end tests.
import { expect } from '@playwright/test';

// Opens the app with a clean profile state and waits until the sample book is loaded.
export async function openApp(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.goto('./');
  await expect(page.locator('#items .item').first()).toBeAttached();
  await expect(page.locator('#board svg use.pc').first()).toBeAttached();
  return errors;
}

// Clicks the centre of a square, e.g. 'd2', on the main board (respects board flipping).
export async function clickSquare(page, sq, flipped) {
  const box = await page.locator('#board svg').boundingBox();
  const f = 'abcdefgh'.indexOf(sq[0]), r = parseInt(sq[1], 10);
  const col = flipped ? 7 - f : f, row = flipped ? r - 1 : 8 - r;
  await page.mouse.click(box.x + (col + 0.5) * box.width / 8, box.y + (row + 0.5) * box.height / 8);
}

export async function move(page, from, to, flipped) {
  await clickSquare(page, from, flipped);
  await clickSquare(page, to, flipped);
}

export async function openItem(page, titleStart) {
  await page.locator('#items .it-main', { hasText: titleStart }).first().click();
}
