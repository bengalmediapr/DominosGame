import { Page, expect, test } from '@playwright/test';

interface DebugState {
  screen: string; phase: string | null; overlay: string | null; hand: string[]; playable: string[];
  selected: string | null; isController: boolean;
  lobby: { code: string | null; me: number; seats: string[] } | null;
}

const SHOTS = process.env.SHOTS;
const state = (page: Page) => page.evaluate(() => (window as unknown as { __domino: { state(): DebugState } }).__domino.state());

async function open(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('domino-boricua.settings.v1', JSON.stringify({ speed: 'fast', volume: 0 })));
  await page.reload();
  await page.locator('[data-action=online]').click();
}

async function humanTurn(page: Page, st: DebugState) {
  const [tile, side] = st.playable[0].split(':');
  await page.keyboard.press(String(st.hand.indexOf(tile) + 1));
  if ((await state(page)).selected) await page.keyboard.press(side === 'left' ? 'ArrowLeft' : 'ArrowRight');
}

test('two players at one table: host and guest play a hand together', async ({ browser }) => {
  // One browser context = two tabs that can reach each other (BroadcastChannel).
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  const guest = await context.newPage();
  const errors: string[] = [];
  for (const p of [host, guest]) p.on('pageerror', (e) => errors.push(e.message));

  await open(host);
  await host.locator('[data-action=host-tabs]').click();
  await expect(host.locator('.lobby .code b')).toHaveText(/^[A-Z0-9]{4}$/);
  const code = (await host.locator('.lobby .code b').textContent())!;

  await open(guest);
  await guest.locator('#join-code').fill(code);
  await guest.locator('#join-form button[type=submit]').click();

  // The guest takes the partner's chair (seat 2) and both see the same lobby.
  await expect.poll(async () => (await state(host)).lobby?.seats.join(',')).toBe('human,ai,human,ai');
  await expect.poll(async () => (await state(guest)).lobby?.me).toBe(2);
  await host.locator('[data-action=lobby-mode][data-value=parejas]').click();
  await expect(guest.locator('.lobby .note').first()).toContainText(/Parejas/);
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/online-lobby.png` });
  await host.locator('[data-action=start]').click();

  await expect.poll(async () => (await state(guest)).screen).toBe('game');
  const [h0, g0] = [await state(host), await state(guest)];
  expect(h0.hand).toHaveLength(7);
  expect(g0.hand).toHaveLength(7);
  expect(h0.hand.filter((t) => g0.hand.includes(t))).toEqual([]); // different tiles, each sees only their own

  let shot = false;
  for (let i = 0; i < 600; i++) {
    const [hs, gs] = [await state(host), await state(guest)];
    if (hs.overlay === 'hand' && gs.overlay === 'hand') break;
    if (hs.playable.length) await humanTurn(host, hs);
    else if (gs.playable.length) {
      if (SHOTS && !shot && gs.hand.length <= 5) {
        await guest.screenshot({ path: `${SHOTS}/online-guest.png` });
        shot = true;
      }
      await humanTurn(guest, gs);
    } else await host.waitForTimeout(120);
  }
  await expect(host.locator('.overlay [data-action=next-hand]')).toBeVisible();
  // Only the host moves the table on; the guest sees who it's waiting for.
  await expect(guest.locator('.overlay [data-action=next-hand]')).toHaveCount(0);
  await expect(guest.locator('.overlay .card')).toContainText(/anfitrión/);
  await host.locator('.overlay [data-action=next-hand]').click();
  await expect.poll(async () => (await state(guest)).overlay).toBeNull();
  await expect(guest.locator('.score .vs')).toContainText('Mano 2');
  expect(errors).toEqual([]);
  await context.close();
});

test('a guest who leaves is replaced by the AI', async ({ browser }) => {
  const context = await browser.newContext();
  const host = await context.newPage();
  const guest = await context.newPage();
  await open(host);
  await host.locator('[data-action=host-tabs]').click();
  const code = (await host.locator('.lobby .code b').textContent())!;
  await open(guest);
  await guest.locator('#join-code').fill(code);
  await guest.locator('#join-form button[type=submit]').click();
  await expect.poll(async () => (await state(host)).lobby?.seats[2]).toBe('human');
  await guest.close();
  await expect.poll(async () => (await state(host)).lobby?.seats[2], { timeout: 15_000 }).toBe('ai');
  await context.close();
});
