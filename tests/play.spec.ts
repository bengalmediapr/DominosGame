import { expect, test } from '@playwright/test';

test('plays a full hand from the menu to the result screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('domino-boricua.settings.v1', JSON.stringify({ speed: 'fast', volume: 0 })));
  await page.reload();
  await expect(page.locator('.logo')).toHaveText('Dominó Boricua');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/menu.png` });
  await page.getByRole('button', { name: 'Jugar' }).click();

  let shotTaken = false;
  for (let i = 0; i < 400; i++) {
    if (await page.locator('.overlay').isVisible()) break;
    const target = page.locator('.target').first();
    const playable = page.locator('.hand-tile.playable').first();
    if (await target.isVisible()) await target.click({ force: true }); // it pulses forever
    else if (await playable.isVisible()) {
      await playable.click();
      if (!shotTaken && process.env.SHOTS && (await page.locator('.board .tile').count()) >= 8) {
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${process.env.SHOTS}/game.png` });
        shotTaken = true;
      }
    } else await page.waitForTimeout(150);
  }
  await expect(page.locator('.overlay .card h2')).toHaveText(/Dominó|Capicú|Tranque/);
  await page.waitForTimeout(1200);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/result.png` });
  const tilesPlayed = await page.locator('.board .tile').count();
  expect(tilesPlayed).toBeGreaterThan(3);
  await page.getByRole('button', { name: 'Próxima mano' }).click();
  await expect(page.locator('.overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});
