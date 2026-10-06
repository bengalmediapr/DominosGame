import { Page, expect, test } from '@playwright/test';

interface DebugState {
  screen: string; overlay: string | null; mode?: string; finished: boolean; roulette: boolean;
  awaitingTrigger: boolean; alive?: boolean[]; hand: string[]; playable: string[]; selected: string | null;
}

const SHOTS = process.env.SHOTS;
const state = (page: Page) => page.evaluate(() => (window as unknown as { __domino: { state(): DebugState } }).__domino.state());

async function setup(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('capicu.settings.v1', JSON.stringify({ speed: 'fast', volume: 0 })));
  await page.reload();
  await expect(page.locator('.logo')).toHaveText('Capicú');
}

/** Plays as the human using only the keyboard and the on-screen buttons. */
async function humanTurn(page: Page, st: DebugState) {
  const [tile, side] = st.playable[0].split(':');
  await page.keyboard.press(String(st.hand.indexOf(tile) + 1));
  if ((await state(page)).selected) await page.keyboard.press(side === 'left' ? 'ArrowLeft' : 'ArrowRight');
}

test('ruleta: plays hands in 3D and survives (or not) the revolver', async ({ page }) => {
  const errors: string[] = [];
  await setup(page, errors);
  await page.waitForTimeout(800);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/menu3d.png` });
  await page.locator('[data-action=play][data-value=ruleta]').click();

  let rouletteRounds = 0;
  let boardShot = false;
  let rouletteShot = false;
  let wasInRoulette = false;
  for (let i = 0; i < 1500 && rouletteRounds < 2; i++) {
    const st = await state(page);
    if (st.overlay === 'dead' || st.overlay === 'match') break;
    if (wasInRoulette && !st.roulette) rouletteRounds++;
    wasInRoulette = st.roulette;
    if (st.overlay === 'hand') await page.locator('[data-action=next-hand]').click();
    else if (st.awaitingTrigger) {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/trigger.png` });
      await page.locator('[data-action=trigger]').click({ force: true }); // it throbs forever
      if (SHOTS) {
        await page.waitForTimeout(1700);
        await page.screenshot({ path: `${SHOTS}/roulette-me.png` });
      }
    } else if (st.roulette && !rouletteShot && SHOTS) {
      await page.waitForTimeout(2600);
      await page.screenshot({ path: `${SHOTS}/roulette.png` });
      rouletteShot = true;
    } else if (st.playable.length) {
      await humanTurn(page, st);
      if (!boardShot && SHOTS && st.hand.length <= 4) {
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/game3d.png` });
        boardShot = true;
      }
    } else await page.waitForTimeout(120);
  }
  const end = await state(page);
  expect(rouletteRounds > 0 || end.overlay === 'dead' || end.overlay === 'match').toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ruleta-end.png` });
  expect(errors).toEqual([]);
});

test('parejas: plays a full hand to the result card', async ({ page }) => {
  const errors: string[] = [];
  await setup(page, errors);
  await page.locator('[data-action=play][data-value=parejas]').click();
  for (let i = 0; i < 600; i++) {
    const st = await state(page);
    if (st.overlay) break;
    if (st.playable.length) await humanTurn(page, st);
    else await page.waitForTimeout(120);
  }
  await expect(page.locator('.overlay .card h2')).toHaveText(/Dominó|Capicú|Tranque/);
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/parejas-result.png` });
  await page.locator('[data-action=next-hand]').click();
  await expect(page.locator('.overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});
