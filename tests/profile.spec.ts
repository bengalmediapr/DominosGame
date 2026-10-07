import { BrowserContext, Page, expect, test } from '@playwright/test';
import { Env, handle } from '../server/api';
import { fakeD1 } from '../server/fakeD1';

/** Serve /api from the real name server code, on an in-memory database shared by every player. */
async function serve(context: BrowserContext, env: Env) {
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const res = await handle(new Request(req.url(), {
      method: req.method(), headers: req.headers(), body: req.method() === 'GET' ? undefined : req.postData() ?? undefined,
    }), env);
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
}

async function player(browser: import('@playwright/test').Browser, env: Env): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await serve(context, env);
  const page = await context.newPage();
  await page.goto('/');
  return [context, page];
}

async function chooseName(page: Page, name: string) {
  await page.locator('#name-input').fill('');
  await page.locator('#name-input').click();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

test('names are unique: the first to claim one keeps it', async ({ browser }) => {
  test.slow(); // two players, each loading the 3D table
  const env: Env = { DB: fakeD1() };
  const [anaCtx, ana] = await player(browser, env);
  await ana.locator('.name-chip').click();
  await chooseName(ana, 'Ana Boricua');
  await expect(ana.locator('.notice.ok')).toBeVisible();
  await expect(ana.locator('.stats')).toContainText('#1');

  const [betoCtx, beto] = await player(browser, env);
  await beto.locator('.name-chip').click();
  await chooseName(beto, 'ana_boricua');
  await expect(beto.locator('.notice')).toContainText('ya lo tiene otra persona');
  await chooseName(beto, 'Beto');
  await expect(beto.locator('.notice.ok')).toBeVisible();
  await beto.locator('[data-action=menu]').click();
  await expect(beto.locator('.name-chip')).toContainText('Beto');

  // The name sticks after a reload, and online play uses it.
  await beto.reload();
  await beto.locator('[data-action=online]').click();
  await expect(beto.locator('.playing-as')).toContainText('Beto');
  await anaCtx.close();
  await betoCtx.close();
});
