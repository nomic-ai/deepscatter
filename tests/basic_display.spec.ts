import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:3344');
  await page.waitForLoadState('networkidle');
  page.on('console', msg => console.log(msg.text()));
});

test.describe('Draws', () => {
  test('The n_visible counter draws counts of some type.', async ({ page }) => {
    const n_visible = await page.evaluate('window.plot._renderer.n_visible()');
    expect(n_visible).toBeGreaterThan(50);
  });
});