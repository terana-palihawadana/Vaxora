import { test, expect, Page } from '@playwright/test';

const HOSPITAL_EMAIL = process.env.HOSPITAL_EMAIL ?? 'hospital@vaxora.local';
const HOSPITAL_PASSWORD = process.env.HOSPITAL_PASSWORD ?? 'Hospital@123';

async function loginAsHospital(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(HOSPITAL_EMAIL);
  await page.getByLabel(/password/i).fill(HOSPITAL_PASSWORD);
  await page.getByRole('button', { name: /log in|sign in/i }).click();
  await page.waitForURL('**/hospital/**', { timeout: 15_000 });
}

test.describe('Inventory Management E2E', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsHospital(page);
    await page.goto('/hospital/inventory');
    await expect(page.getByRole('heading', { name: /vaccine inventory/i })).toBeVisible();
  });

  test('renders KPI summary cards', async ({ page }) => {
    await expect(page.getByTestId('kpi-total-vials')).toBeVisible();
    await expect(page.getByTestId('kpi-total-vials')).not.toHaveText(/^—?$/); // has a value
  });

  test('batch table renders rows or an explicit empty state', async ({ page }) => {
    const table = page.getByTestId('batch-table');
    const empty = page.getByTestId('batch-empty-state');
    await expect(table.or(empty)).toBeVisible();
  });

  test('search filter narrows the batch list', async ({ page }) => {
    const rows = page.getByTestId('batch-row');
    const before = await rows.count();

    // Skip if there's no data to filter
    test.skip(before === 0, 'No batches seeded');

    // Pick a term that exists in the first row so filtering is provable
    const firstRowText = (await rows.first().innerText()).split(/\s+/)[0];
    await page.getByPlaceholder(/search/i).first().fill(firstRowText);

    await expect
      .poll(async () => rows.count(), { timeout: 5_000 })
      .toBeLessThanOrEqual(before);

    // Every visible row must contain the search term
    for (const row of await rows.all()) {
      await expect(row).toContainText(new RegExp(firstRowText, 'i'));
    }
  });

  test('restock modal blocks empty submission with a validation message', async ({ page }) => {
    await page.getByRole('button', { name: /restock|log shipment|add stock/i }).first().click();

    const modal = page.getByRole('dialog', { name: /log vaccine restock shipment/i });
    await expect(modal).toBeVisible();

    // Intercept the API so we can prove it was NOT called
    let apiCalled = false;
    await page.route('**/api/**/restock**', route => {
      apiCalled = true;
      route.continue();
    });

    await modal.getByRole('button', { name: /commit shipment/i }).click();

    // Real DOM assertion, not a native dialog
    await expect(modal.getByText(/vaccine product name.*required/i)).toBeVisible();
    expect(apiCalled).toBe(false);
  });

  test('restock modal closes via the close button', async ({ page }) => {
    await page.getByRole('button', { name: /restock|log shipment|add stock/i }).first().click();

    const modal = page.getByRole('dialog', { name: /log vaccine restock shipment/i });
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: /close/i }).click();
    await expect(modal).toBeHidden();
  });
});

test.describe('Auth', () => {
  test('unauthenticated user is redirected from /hospital/inventory to /login', async ({ page }) => {
    await page.goto('/hospital/inventory');
    await page.waitForURL('**/login', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: /log in|sign in/i })).toBeVisible();
  });
});