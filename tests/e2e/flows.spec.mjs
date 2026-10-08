// Real user flows in a real browser (phone-sized), against the real app, real migrated database and a scripted AI provider.
// The flows share one database and run in order: each builds on the records the one before it left behind.
import { test, expect } from '@playwright/test';
import { PNG, home, records, tell } from './helpers.mjs';

test.describe.configure({ mode: 'serial' });

test('signed in: the app opens for the signed-in person and ignores an identity the browser invents', async ({ page, request }) => {
  await home(page);
  await expect(page.getByRole('button', { name: /Records$/ }).last()).toBeVisible();
  // A client-supplied identity header must never be believed: the worker replaces it with the verified one.
  const spoofed = await request.get('/api/assistant', { headers: { 'x-catnr-user-id': 'someone-else', 'x-catnr-user-email': 'someone-else@example.com' } });
  expect(spoofed.status()).toBe(200);
  const plain = await request.get('/api/assistant');
  expect(await spoofed.json()).toEqual(await plain.json());
});

test('add a cat by hand, with no name', async ({ page }) => {
  await home(page);
  await records(page, 'Cats');
  await expect(page.getByText('No cats yet')).toBeVisible();
  await page.getByRole('button', { name: '+ Add a cat' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a cat' });
  await sheet.getByLabel('Appearance').fill('gray tabby, white paws');
  await sheet.getByLabel('Distinguishing marks').fill('torn left ear');
  await sheet.getByLabel('Status').selectOption('captured');
  await sheet.getByRole('button', { name: 'Add cat' }).click();
  // the new cat opens straight away, unnamed but recognisable
  const cat = page.getByRole('dialog').last();
  await expect(cat.getByText('torn left ear').first()).toBeVisible();
  await expect(cat.getByText('captured').first()).toBeVisible();
  await expect(cat.getByText('Change log')).toBeVisible();
});

test('record an event on the cat, and it appears in its history', async ({ page }) => {
  await home(page);
  await records(page, 'Cats');
  await page.getByRole('button', { name: /torn left ear|gray tabby/ }).first().click();
  await page.getByRole('button', { name: '+ Add to history' }).click();
  const form = page.getByRole('dialog', { name: 'Add to history' });
  await form.getByLabel('What happened').selectOption('vet_visit');
  await form.getByLabel('Where').fill('Maple Vet Clinic');
  await form.getByLabel('Notes').fill('Checked teeth, all good');
  await form.getByRole('button', { name: 'Add entry' }).click();
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByText('Vet Visit')).toBeVisible();
  await expect(history.getByText('Maple Vet Clinic')).toBeVisible();
  await expect(history.getByText('Checked teeth, all good')).toBeVisible();
});

test('upload a photo to the cat and see it in the gallery', async ({ page }) => {
  await home(page);
  await records(page, 'Cats');
  await page.getByRole('button', { name: /torn left ear|gray tabby/ }).first().click();
  const gallery = page.getByRole('region', { name: /^Photos of/ });
  await expect(gallery.getByRole('heading', { name: 'Photos (0)' })).toBeVisible();
  await gallery.locator('input[type=file]').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG });
  await expect(gallery.getByRole('heading', { name: 'Photos (1)' })).toBeVisible();
  // the stored photo really comes back from the server, as an image
  const src = await gallery.locator('img').first().getAttribute('src');
  const served = await page.request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toMatch(/^image\//);
});

test('edit the cat and the change is kept and logged', async ({ page }) => {
  await home(page);
  await records(page, 'Cats');
  await page.getByRole('button', { name: /torn left ear|gray tabby/ }).first().click();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Name (optional)').fill('Smoke');
  await page.getByLabel('Where is the cat now?').fill('Foster garage');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog').last().getByText('Foster garage').first()).toBeVisible();
  await expect(page.getByRole('dialog').last().getByRole('heading', { name: 'Smoke' }).or(page.getByText('Smoke').first())).toBeVisible();
  await expect(page.getByRole('region', { name: 'Changes' }).getByText(/Update/i).first()).toBeVisible();
  // and it survives a reload
  await page.reload();
  await records(page, 'Cats');
  await expect(page.getByRole('button', { name: /Smoke/ })).toBeVisible();
});

test('tell the assistant about a new cat by typing, then add to it', async ({ page }) => {
  await home(page);
  await tell(page, 'New kitten at Maple Street, gray tabby girl, named Pepper');
  await expect(page.getByText('Records added')).toBeVisible();
  await tell(page, 'Pepper got her rabies shot today');
  await expect(page.getByText('Records added')).toBeVisible();
  await page.getByRole('button', { name: /Cats$/ }).last().click();
  await page.getByRole('button', { name: /Pepper/ }).first().click();
  const history = page.getByRole('dialog').last();
  await expect(history.getByText(/rabies/i).first()).toBeVisible();
});

test('an unclear update asks a question, and answering it applies the update once', async ({ page }) => {
  await home(page);
  await tell(page, 'The gray one got neutered today');
  // the assistant is unsure which gray cat, so it asks and saves nothing
  await expect(page.getByText('One quick question')).toBeVisible();
  await expect(page.getByText('Which gray cat got neutered?')).toBeVisible();
  await page.getByRole('button', { name: /Close/ }).click();
  const card = page.getByRole('region', { name: 'Questions waiting for your answer' });
  await expect(card.getByText('Which gray cat got neutered?')).toBeVisible();
  // Ari's words are with the question now, not also sitting there as an "unsent update"
  await expect(page.getByRole('region', { name: 'Unsent update' })).toHaveCount(0);
  // the question survives a reload
  await page.reload();
  await expect(card.getByText('Which gray cat got neutered?')).toBeVisible();
  await card.getByLabel('Your answer').fill('the one with the white paws');
  await card.getByRole('button', { name: 'Send answer' }).click();
  await expect(card).toBeHidden();
  // exactly one neuter entry exists, on the cat with white paws (Smoke)
  const smoke = await (await page.request.get('/api/assistant')).json();
  const id = smoke.cats.find((c) => c.displayName === 'Smoke').id;
  const detail = await (await page.request.get(`/api/assistant?catId=${id}`)).json();
  expect(detail.events.filter((e) => e.event_type === 'neuter')).toHaveLength(1);
  const pepper = smoke.cats.find((c) => c.displayName === 'Pepper');
  expect((await (await page.request.get(`/api/assistant?catId=${pepper.id}`)).json()).events.some((e) => e.event_type === 'neuter')).toBe(false);
});

test('search finds cats by what Ari remembers, and says so when nothing matches', async ({ page }) => {
  await home(page);
  await records(page, 'Cats');
  await expect(page.getByRole('button', { name: /Smoke/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pepper/ })).toBeVisible();
  const search = page.getByRole('searchbox', { name: /Search name/ });
  await search.fill('Maple');
  await expect(page.getByRole('button', { name: /Pepper/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Smoke/ })).toBeHidden();
  await search.fill('zzz-no-such-cat');
  await expect(page.getByText('No cats match those filters.')).toBeVisible();
});

test('record a donation by hand and an expense by voice-style typing', async ({ page }) => {
  await home(page);
  await records(page, 'Money');
  await page.getByRole('button', { name: '+ Record money or supplies' }).click();
  const form = page.getByRole('dialog', { name: /Record/ });
  await form.getByLabel('What kind').selectOption('cash_donation');
  await form.getByLabel('Amount').fill('100');
  await form.getByLabel('Description').fill('Sarah Yunker donated $100');
  await form.getByRole('button', { name: 'Record it' }).click();
  await expect(page.getByText('Sarah Yunker donated $100')).toBeVisible();
  await page.getByRole('button', { name: /Home$/ }).last().click();
  await tell(page, 'I spent $45 on brand stickers');
  await expect(page.getByText('Records added')).toBeVisible();
});

test('the report adds up exactly what was recorded', async ({ page }) => {
  await home(page);
  await records(page, 'Reports');
  const tiles = page.locator('.stats').filter({ hasText: 'Cash received' });
  await expect(tiles.getByText('$100.00')).toBeVisible();
  await expect(tiles.getByText('$45.00')).toBeVisible();
  await expect(tiles.getByText('$55.00')).toBeVisible();
  await expect(page.getByText('spent — supply purchase (1): $45.00')).toBeVisible();
  // the cats recorded in the earlier flows are counted: two cats in care, one with a recorded neuter
  await expect(page.getByText(/2 in care: 1 sterilized/)).toBeVisible();
  // the home screen's lifetime totals agree with the report
  await page.getByRole('button', { name: /Dashboard$/ }).last().click();
  await expect(page.locator('.summaryCard')).toContainText('$100.00');
  await expect(page.locator('.summaryCard')).toContainText('$45.00');
});
