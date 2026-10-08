// The deployed configuration (Cloudflare Access settings present) must refuse anyone who is not signed in.
// Runs against a second copy of the app that keeps the real production Access settings.
import { test, expect } from '@playwright/test';

const base = `http://localhost:${Number(process.env.E2E_PORT || 3100) + 1}`;

// The second app starts cold and Playwright only waits for the first one, so give this one time to answer properly
// (a cold dev server can reply with a 5xx while it optimises dependencies). This waits for readiness; it never relaxes a check.
test.beforeAll(async ({ request }) => {
  for (let i = 0; i < 60; i++) {
    const status = await request.get(base + '/api/assistant').then((r) => r.status(), () => 0);
    if (status === 401) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
});

test('without a valid sign-in token no page and no record is served', async ({ page, request }) => {
  const response = await page.goto(base + '/');
  expect(response.status()).toBe(401);
  await expect(page.getByText('Please sign in to Cat Tracker.')).toBeVisible();
  await expect(page.getByText('What happened today?')).toHaveCount(0);
  for (const path of ['/api/assistant', '/api/manage/cats', '/api/manage/export?format=json']) {
    expect((await request.get(base + path)).status(), path).toBe(401);
  }
  // a forged token and a forged identity header do not help
  const forged = await request.get(base + '/api/assistant', { headers: { 'cf-access-jwt-assertion': 'aaa.bbb.ccc', 'x-catnr-user-id': 'ari@example.com', 'x-catnr-user-email': 'ari@example.com' } });
  expect([401, 503]).toContain(forged.status()); // refused: invalid token, or Access' keys unreachable (fails closed)
  const write = await request.post(base + '/api/assistant', { data: { input: 'hello' }, headers: { 'x-catnr-user-id': 'ari@example.com', 'x-catnr-user-email': 'ari@example.com' } });
  expect(write.status()).toBe(401);
});
