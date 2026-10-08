import { expect } from '@playwright/test';

// A real (tiny) PNG, so the browser's own image decoder and canvas resize run exactly as they do for a phone photo.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFUlEQVR4nGP8z8Dwn4EIwESMolGFhAEAfNQCEfTIN7MAAAAASUVORK5CYII=', 'base64');

export const home = async (page) => { await page.goto('/'); await expect(page.getByText('What happened today?')).toBeVisible();
  // the records have loaded, so the page is interactive (React has taken over)
  await expect(page.getByText('Loading your records')).toBeHidden(); };
export const tab = (page, name) => page.getByRole('button', { name: new RegExp(`${name}$`) }).last();

/** Opens Records > section from the bottom tab bar. */
export async function records(page, section) {
  await page.getByRole('button', { name: /Records$/ }).last().click();
  await page.getByRole('tab', { name: section }).click();
}

/** Types an update to the assistant and presses the main button, as Ari would. */
export async function tell(page, words, { ask = false } = {}) {
  await page.getByRole('button', { name: ask ? /Ask your assistant/ : /TYPE AN UPDATE|Open text window/i }).first().click();
  const box = page.getByRole('textbox', { name: ask ? 'Your question' : 'What happened' });
  await box.fill(words);
  await page.getByRole('button', { name: ask ? 'Ask' : 'Review & record' }).click();
}
