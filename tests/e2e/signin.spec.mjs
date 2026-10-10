// The deployed configuration (Google sign-in configured) must refuse anyone who is not signed in.
// Runs against a second copy of the app that has sign-in configured but no session.
import { test, expect } from '@playwright/test';

const base = `http://localhost:${Number(process.env.E2E_PORT || 3100) + 1}`;

// The second app starts cold and Playwright only waits for the first one, so give this one time to answer properly
// (a cold dev server can reply with a 5xx while it optimises dependencies). This waits for readiness; it never relaxes a check.
test.beforeAll(async ({ request }) => {
  test.setTimeout(240_000); // the hook's own limit must outlast the wait below (CI runners are slow to start a second dev server)
  let status = 0;
  for (let i = 0; i < 180; i++) {
    status = await request.get(base + '/api/assistant').then((r) => r.status(), () => 0);
    if (status === 401) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`The locked app on ${base} never answered 401 (last status ${status}).`);
});

test('without a valid sign-in token no page and no record is served', async ({ page, request }) => {
  // a person opening the site is sent to the sign-in page, never shown the app
  await page.goto(base + '/');
  await expect(page).toHaveURL(base + '/signin');
  await expect(page.getByText('Sign in with your Google account')).toBeVisible();
  await expect(page.getByText('What happened today?')).toHaveCount(0);
  for (const path of ['/api/assistant', '/api/manage/cats', '/api/manage/export?format=json']) {
    expect((await request.get(base + path)).status(), path).toBe(401);
  }
  // a forged session cookie and a forged identity header do not help
  const forged = await request.get(base + '/api/assistant', { headers: { cookie: 'catnr_session=forged.value', 'x-catnr-user-id': 'ari@example.com', 'x-catnr-user-email': 'ari@example.com' } });
  expect(forged.status()).toBe(401);
  const write = await request.post(base + '/api/assistant', { data: { input: 'hello' }, headers: { 'x-catnr-user-id': 'ari@example.com', 'x-catnr-user-email': 'ari@example.com' } });
  expect(write.status()).toBe(401);
});
