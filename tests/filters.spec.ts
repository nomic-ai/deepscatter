import { test, expect } from '@playwright/test';

const sleep = async (timeout) => {
  await new Promise((resolve) => setTimeout(resolve, timeout));
};

test.describe('Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log(msg.text()));
    await page.goto('http://localhost:3344/integers.html');
    //   await page.waitForLoadState('networkidle');
    await sleep(2000);
  });

  test('Primes', async ({ page }) => {
    const primes = await page.getByTestId('primes');
    await expect(primes).toBeVisible();
    await primes.click();
    await sleep(500);
    await expect(page).toHaveScreenshot('primes.png');
  });

  test('Evens', async ({ page }) => {
    const evens = await page.getByTestId('evens');
    await expect(evens).toBeVisible();
    await evens.click();
    await sleep(500);
    await expect(page).toHaveScreenshot('evens.png');
  });

  test('Products', async ({ page }) => {
    // await page.locator('#filter').getByTestId('prodcuts5');
    // await page.locator('#filter2').getByTestId('prodcuts5');

    const prodcuts5 = await page.getByTestId('products5').first();
    await expect(prodcuts5).toBeVisible();
    await prodcuts5.click();
    await sleep(500);
    await expect(page).toHaveScreenshot('products.png');
  });

  //   test('Screeen.', async ({ page }) => {
  //     await page.goto('http://localhost:3344/integers.html');
  //     await page.getByTestId('evens').click();
  //     await sleep(500);
  //     await expect(page).toHaveScreenshot('evens.png');
  //   });
});
