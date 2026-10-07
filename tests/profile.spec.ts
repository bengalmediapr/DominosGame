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

async function fill(page: Page, id: string, text: string) {
  await page.locator(`#${id}`).fill('');
  await page.locator(`#${id}`).click();
  await page.keyboard.type(text);
}

async function createName(page: Page, name: string, pin: string) {
  await fill(page, 'name-input', name);
  await fill(page, 'pin-input', pin);
  await page.keyboard.press('Enter');
}

test('names are unique, and a name\'s code signs you in on another device', async ({ browser }) => {
  test.slow(); // three players, each loading the 3D table
  const env: Env = { DB: fakeD1() };
  const [anaCtx, ana] = await player(browser, env);
  await ana.locator('.name-chip').click();
  await createName(ana, 'Ana Boricua', 'coqui77');
  await expect(ana.locator('.notice.ok')).toBeVisible();
  await expect(ana.locator('.stats')).toContainText('#1');
  await anaCtx.close(); // one 3D page at a time: this machine renders on the CPU

  // Someone else can't take it, however they spell it.
  const [betoCtx, beto] = await player(browser, env);
  await beto.locator('.name-chip').click();
  await createName(beto, 'ana_boricua', 'abcd');
  await expect(beto.locator('.notice')).toContainText('ya lo tiene otra persona');
  await createName(beto, 'Beto', 'abcd');
  await expect(beto.locator('.notice.ok')).toBeVisible();
  await betoCtx.close();

  // Ana on her phone: a wrong code fails, the right one brings her name.
  const [phoneCtx, phone] = await player(browser, env);
  await phone.locator('.name-chip').click();
  await fill(phone, 'login-name', 'ana boricua');
  await fill(phone, 'login-pin', 'nope');
  await phone.keyboard.press('Enter');
  await expect(phone.locator('.notice')).toContainText('incorrectos');
  await fill(phone, 'login-pin', 'coqui77');
  await phone.keyboard.press('Enter');
  await expect(phone.locator('.notice.ok')).toContainText('Bienvenido');
  await phone.locator('[data-action=menu]').click();
  await expect(phone.locator('.name-chip')).toContainText('Ana Boricua');
  await phone.locator('[data-action=online]').click();
  await expect(phone.locator('.playing-as')).toContainText('Ana Boricua');
  await phoneCtx.close();
});
