import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility (WCAG 2.1 A/AA) checks for the hospital Staff Management pages,
// using axe-core on the real React app against the local API.

const TEST_HOSPITAL = {
  email: 'hospital@vaxora.local',
  password: 'Hospital@123',
};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function loginAsHospital(page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', TEST_HOSPITAL.email);
  await page.fill('input[name="password"]', TEST_HOSPITAL.password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/hospital\//, { timeout: 20000 });
}

function describeViolations(violations) {
  return violations
    .map((v) => {
      const targets = v.nodes.slice(0, 5).map((n) => `      - ${n.target.join(' ')}`).join('\n');
      return `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} element(s))\n${targets}`;
    })
    .join('\n');
}

async function scan(page, testInfo, label) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  expect(results.violations.length, `${label} has WCAG violations:\n${describeViolations(results.violations)}`).toBe(0);
}

test.describe('Staff Management accessibility (axe-core, WCAG 2.1 AA)', () => {
  test('1. Login page has no WCAG violations', async ({ page }, testInfo) => {
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await scan(page, testInfo, 'login');
  });

  test('2. Staff directory has no WCAG violations', async ({ page }, testInfo) => {
    await loginAsHospital(page);
    await page.goto('/hospital/staff');
    await expect(page.getByRole('heading', { name: /medical staff/i })).toBeVisible();
    await scan(page, testInfo, 'staff-directory');
  });

  test('3. Shifts tab has no WCAG violations', async ({ page }, testInfo) => {
    await loginAsHospital(page);
    await page.goto('/hospital/roster');
    await page.getByRole('tab', { name: /shifts/i }).click();
    await expect(page.getByRole('tab', { name: /shifts/i })).toHaveAttribute('aria-selected', 'true');
    await scan(page, testInfo, 'staff-shifts');
  });

  test('4. Cover requests tab has no WCAG violations', async ({ page }, testInfo) => {
    await loginAsHospital(page);
    await page.goto('/hospital/roster');
    await page.getByRole('tab', { name: /cover requests/i }).click();
    await expect(page.getByRole('tab', { name: /cover requests/i })).toHaveAttribute('aria-selected', 'true');
    await scan(page, testInfo, 'staff-cover-requests');
  });

  test('5. Add New Staff modal (with validation error) has no WCAG violations', async ({ page }, testInfo) => {
    await loginAsHospital(page);
    await page.goto('/hospital/staff');
    await page.getByRole('button', { name: /add new staff/i }).click();
    await expect(page.getByRole('heading', { name: /add new staff/i })).toBeVisible();
    await page.getByRole('button', { name: /send request/i }).click();
    await expect(
      page.getByText(/search by name, email, or vaxora id, then select a practitioner/i)
    ).toBeVisible();
    await scan(page, testInfo, 'add-staff-modal');
  });

  test('6. Staff page is keyboard operable: reach Add New Staff with Tab and open it with Enter', async ({ page }) => {
    await loginAsHospital(page);
    await page.goto('/hospital/staff');
    const addButton = page.getByRole('button', { name: /add new staff/i });
    await expect(addButton).toBeVisible();

    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await addButton.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Add New Staff button should be reachable with the Tab key').toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /add new staff/i })).toBeVisible();
  });
});
