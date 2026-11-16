// Scanned book import on a SYNTHETIC scan: the test draws a page with one diagram (hatched dark
// squares, chess glyphs, the □ marker) in the browser and wraps it into an image-only PDF.
// No book pages are used. Checks: scan offer, page processing, review screen, edit, confirm,
// the book "(скан)", and that the review state survives a new visit.
import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';
import { openApp } from './helpers.js';

const DPI = 200;

// one-page PDF with a DeviceGray image covering the page (no text layer, like a scan)
function imagePdf(gray, w, h) {
  const img = zlib.deflateSync(gray), pw = (w * 72 / DPI).toFixed(2), ph = (h * 72 / DPI).toFixed(2);
  const content = Buffer.from('q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q');
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ' + img.length + ' >>\nstream\n'), img, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from('<< /Length ' + content.length + ' >>\nstream\n'), content, Buffer.from('\nendstream')])
  ];
  const parts = [Buffer.from('%PDF-1.4\n')], offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from((i + 1) + ' 0 obj\n'), o, Buffer.from('\nendobj\n')]);
    offsets.push(pos); parts.push(b); pos += b.length;
  });
  const xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  parts.push(Buffer.from(xref + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + pos + '\n%%EOF\n'));
  return Buffer.concat(parts);
}

// draws the synthetic page in the browser (the app's chess font) and returns its gray pixels
async function syntheticPage(page) {
  const b64 = await page.evaluate(async () => {
    await document.fonts.load('48px "Noto Sans Symbols 2"', '♚♔');
    const W = 1000, H = 1300, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#000';
    for (let i = 0; i < 12; i++) c.fillRect(120, 80 + i * 40, 760, 14); // "text" lines
    const x0 = 260, y0 = 620, t = 4, sq = 60, S = sq * 8 + 2 * t;
    c.fillRect(x0, y0, S, t); c.fillRect(x0, y0 + S - t, S, t); c.fillRect(x0, y0, t, S); c.fillRect(x0 + S - t, y0, t, S);
    c.save(); c.lineWidth = 1.6; c.strokeStyle = '#000';
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if ((r + f) % 2 === 1) {
      const x = x0 + t + f * sq, y = y0 + t + r * sq;
      c.save(); c.beginPath(); c.rect(x, y, sq, sq); c.clip();
      for (let k = -sq; k < sq; k += 5) { c.beginPath(); c.moveTo(x + k, y + sq); c.lineTo(x + k + sq, y); c.stroke(); }
      c.restore();
    }
    c.restore();
    const pos = { g1: '♔', f2: '♙', g2: '♙', h2: '♙', d1: '♖', g8: '♚', f7: '♟', g7: '♟', h7: '♟', d8: '♜' };
    c.font = '52px "Noto Sans Symbols 2"'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const [s, g] of Object.entries(pos)) {
      const f = 'abcdefgh'.indexOf(s[0]), r = 8 - Number(s[1]), x = x0 + t + f * sq + sq / 2, y = y0 + t + r * sq + sq / 2;
      c.fillStyle = '#fff'; c.fillRect(x - sq / 2, y - sq / 2, sq, sq); // book pieces sit on a clean background
      c.fillStyle = '#000'; c.fillText(g, x, y + 2);
    }
    // □ marker at the bottom-left: White to move
    c.fillRect(x0 - 40, y0 + S - 26, 22, 2); c.fillRect(x0 - 40, y0 + S - 6, 22, 2); c.fillRect(x0 - 40, y0 + S - 26, 2, 22); c.fillRect(x0 - 20, y0 + S - 26, 2, 22);
    const d = c.getImageData(0, 0, W, H).data;
    let s = '';
    for (let i = 0; i < W * H; i += 8192) {
      const n = Math.min(8192, W * H - i), a = new Array(n);
      for (let k = 0; k < n; k++) a[k] = d[(i + k) * 4];
      s += String.fromCharCode.apply(null, a);
    }
    return btoa(s);
  });
  return { gray: Buffer.from(b64, 'base64'), w: 1000, h: 1300 };
}

async function clickSq(page, sq) {
  const box = await page.locator('#sr-board svg').boundingBox();
  const f = 'abcdefgh'.indexOf(sq[0]), r = Number(sq[1]);
  await page.mouse.click(box.x + (f + 0.5) * box.width / 8, box.y + (8 - r + 0.5) * box.height / 8);
}

test('scanned PDF: diagram found, reviewed, corrected and added to the book', async ({ page }) => {
  const errors = await openApp(page);
  const { gray, w, h } = await syntheticPage(page);
  const pdf = imagePdf(gray, w, h);

  await page.locator('#btn-import').click();
  await page.locator('#imp-file').setInputFiles({ name: 'Синтетический скан.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.locator('#imp-scan').click();
  await page.locator('#sc-go').click();
  await expect(page.locator('.modal .status.good')).toContainText('найдено: 1');
  await page.locator('#sc-review').click();

  // review screen: the image from the book and the recognized board
  await expect(page.locator('#sr-count')).toContainText('Найдено: 1');
  await expect(page.locator('#sr-view')).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(page.locator('#sr-where')).toContainText('Стр. 1, диаграмма 1');
  expect(await page.locator('#sr-board svg use.pc').count()).toBeGreaterThanOrEqual(6);
  await expect(page.locator('input[name=sr-turn][value=w]')).toBeChecked();

  // correct the board to a known position: clear it, put two kings and a rook
  await page.locator('#sr-pal [data-t=x]').click();
  for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) {
    const has = await page.locator('#sr-board svg use.pc').count();
    if (!has) break;
    await clickSq(page, f + r);
  }
  await expect(page.locator('#sr-board svg use.pc')).toHaveCount(0);
  await expect(page.locator('#sr-ok')).toBeDisabled();
  await page.locator('#sr-pal [data-t=wK]').click(); await clickSq(page, 'g1');
  await page.locator('#sr-pal [data-t=wR]').click(); await clickSq(page, 'd1');
  await page.locator('#sr-pal [data-t=bK]').click(); await clickSq(page, 'g8');
  await expect(page.locator('#sr-status')).toContainText('Позиция возможна');
  await page.locator('#sr-ok').click();
  await expect(page.locator('#sr-count')).toContainText('подтверждено: 1');
  await expect(page.locator('#sr-empty')).toContainText('Все найденные диаграммы проверены');
  await page.locator('.sr-act [data-close]').click();

  // the book "(скан)" has the confirmed position, without the "не проверено" mark
  const item = page.locator('#items .item', { hasText: 'Диаграмма (стр. 1, диаграмма 1)' });
  await expect(item).toBeVisible();
  await expect(item).not.toContainText('не проверено');
  await item.locator('.it-main').click();
  await expect(page.locator('#board svg use.pc')).toHaveCount(3);

  // a new visit: the scan remembers what was done and reviewed
  await page.reload();
  await expect(page.locator('#items .item').first()).toBeAttached();
  await page.locator('#btn-import').click();
  await page.locator('#imp-file').setInputFiles({ name: 'Синтетический скан.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.locator('#imp-scan').click();
  await expect(page.locator('.modal .status.warn')).toContainText('Уже обработано: 1 страница, найдено: 1');
  await page.locator('#sc-review').click();
  await expect(page.locator('#sr-count')).toContainText('подтверждено: 1');
  expect(errors).toEqual([]);
});
