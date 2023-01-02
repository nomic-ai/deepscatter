import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('console', (msg) => console.log(msg.text()));
  await page.goto('http://localhost:3344');
  await page.waitForLoadState('networkidle');
});

test.describe('Draws', () => {
  test('The n_visible counter draws counts of some type.', async ({ page }) => {
    const n_visible = await page.evaluate('window.plot._renderer.n_visible()');
    expect(n_visible).toBeGreaterThan(50);
  });
});

test.describe('Filters', () => {
  test('Filters reduce number of points drawn.', async ({ page }) => {
    const n_visible = await page.evaluate('window.plot._renderer.n_visible()');
    const encoding = {
      filter: {
        field: 'x',
        transform: 'lt',
        value: 0,
      },
    };
    await page.evaluate(`window.plot.plotAPI(
      {encoding: {
        filter: {
          field: 'x',
          transform: 'lt',
          value: 0,
        }
      }})`);
    const n_visible_after = await page.evaluate(
      'window.plot._renderer.n_visible()'
    );
    expect(n_visible_after).toBeLessThan(n_visible * 0.75);
  });
});
