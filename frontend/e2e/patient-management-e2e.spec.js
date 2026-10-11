import { test, expect } from '@playwright/test';

const PATIENT_EMAIL = 'patient1@vaxora.lk';
const PATIENT_PASSWORD = 'Patient@123'; // <- adjust to the seeded password

async function loginAsPatient(page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(PATIENT_EMAIL);
  await page.getByLabel(/password/i).fill(PATIENT_PASSWORD);
  await page.getByRole('button', { name: /log in|sign in/i }).click();
  await page.waitForURL('**/patient/**', { timeout: 15000 });
}

test.describe('Patient Management E2E', () => {

  test('Patient dashboard renders after successful login', async ({ page }) => {
    await loginAsPatient(page);
    await expect(page).toHaveURL(/\/patient\/dashboard/);
    await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 10000 });
  });

  test('Patient profile page displays the account fields', async ({ page }) => {
    await loginAsPatient(page);
    await page.goto('/patient/profile');
    await expect(page.getByText(/profile|account/i).first()).toBeVisible({ timeout: 10000 });
    // Email should be visible somewhere on the profile
    await expect(page.getByText(PATIENT_EMAIL).first()).toBeVisible();
  });

  test('Vaccination history page loads without error', async ({ page }) => {
    await loginAsPatient(page);
    await page.goto('/patient/vaccination-history');
    await page.waitForLoadState('networkidle');
    // Either the timeline renders or an empty-state message appears
    const hasTimeline = await page.getByText(/immunisation|vaccination|dose/i).count();
    const hasEmpty = await page.getByText(/no records|no vaccination/i).count();
    expect(hasTimeline + hasEmpty).toBeGreaterThan(0);
  });

  test('Feedback tab opens and shows the form', async ({ page }) => {
    await loginAsPatient(page);
    await page.goto('/patient/feedback');
    await page.waitForLoadState('networkidle');
    // Feedback screen with a rating or comment input
    const hasForm = await page.getByRole('textbox').count();
    expect(hasForm).toBeGreaterThan(0);
  });

  test('Appointments tab shows the booking list', async ({ page }) => {
    await loginAsPatient(page);
    await page.goto('/patient/appointments');
    await page.waitForLoadState('networkidle');
    // Either appointment rows render or an empty state
    const hasRows = await page.locator('table tbody tr').count();
    const hasEmpty = await page.getByText(/no appointments|no bookings/i).count();
    expect(hasRows + hasEmpty).toBeGreaterThan(0);
  });

  test('Protected patient route redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/patient/dashboard');
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page.getByRole('button', { name: /log in|sign in/i })).toBeVisible();
  });

  test('Wrong-role access is blocked (patient cannot open hospital inventory)', async ({ page }) => {
    await loginAsPatient(page);
    await page.goto('/hospital/inventory');
    // Should be redirected to the patient dashboard, not shown hospital data
    await expect(page).not.toHaveURL(/\/hospital\/inventory/);
  });
});