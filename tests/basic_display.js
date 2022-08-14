import { test, expect, Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:3000');
});

test.describe('Draws', () => {
  test('Points are drawing', async ({ page }) => {
    // Create 1st todo.

    const status = await page.evaluate(async () => {
      const response = page.evaluate('plot._renderer.n_visible()');
      expect(response).toBeGreaterThan(7000);
    });
  });
})