import { test, expect } from '@playwright/test';

const TEST_HOSPITAL = {
  email: 'hospital@vaxora.local',
  password: 'Hospital@123',
};

async function loginAsHospital(page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', TEST_HOSPITAL.email);
  await page.fill('input[name="password"]', TEST_HOSPITAL.password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/hospital\//, { timeout: 20000 });
}

test.describe('Staff Management E2E', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
  });

  test('1. Hospital can open Staff directory after login', async ({ page }) => {
    await loginAsHospital(page);

    await page.goto('/hospital/staff');
    await expect(page).toHaveURL(/\/hospital\/staff/);

    await expect(
      page.getByRole('heading', { name: /medical staff/i })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /add new staff/i })).toBeVisible();
  });

  test('2. Add New Staff modal validates missing practitioner selection', async ({ page }) => {
    await loginAsHospital(page);
    await page.goto('/hospital/staff');

    await page.getByRole('button', { name: /add new staff/i }).click();
    await expect(page.getByRole('heading', { name: /add new staff/i })).toBeVisible();

    await page.getByRole('button', { name: /send request/i }).click();
    await expect(
      page.getByText(/search by name, email, or vaxora id, then select a practitioner/i)
    ).toBeVisible();
  });

  test('3. Roster views switch between Shifts and Cover requests', async ({ page }) => {
    await loginAsHospital(page);
    await page.goto('/hospital/roster');

    await page.getByRole('tab', { name: /shifts/i }).click();
    await expect(page.getByRole('tab', { name: /shifts/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await page.getByRole('tab', { name: /cover requests/i }).click();
    await expect(page.getByRole('tab', { name: /cover requests/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await page.getByRole('tab', { name: /shifts/i }).click();
    await expect(page.getByRole('tab', { name: /shifts/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('4. Unauthenticated users cannot open hospital staff page', async ({ page }) => {
    await page.goto('/hospital/staff');
    await expect(page).toHaveURL(/\/login/);
  });

  test('5. Complete StaffSchedulingAgent workflow through React → API', async ({ page }) => {
    test.setTimeout(90000);

    // Seed hospital auth so this agent flow can run even when the live API is offline.
    await page.addInitScript(() => {
      localStorage.setItem('vaxora_token', 'e2e-hospital-token');
      localStorage.setItem(
        'vaxora_user',
        JSON.stringify({
          id: 'hosp-e2e-1',
          role: 'HOSPITAL',
          status: 'Active',
          name: 'E2E Staff Hospital',
          email: 'hospital@vaxora.local',
        })
      );
    });

    await page.route('**/api/staff/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/staff/hospital') || url.includes('/staff/shifts')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '[]',
        });
        return;
      }
      if (url.includes('/staff/shift-swaps')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '[]',
        });
        return;
      }
      if (url.includes('/staff/coverage') || url.includes('/staff/booths')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ days: [], booths: [] }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // Deterministic agent responses so E2E proves the client/API contract without LLM flakiness.
    await page.route('**/api/agent/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          online: true,
          agents: ['StaffSchedulingAgent', 'ShiftSwapAgent'],
        }),
      });
    });

    let chatPayload = null;
    await page.route('**/api/agent/chat', async (route) => {
      chatPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agent: 'StaffSchedulingAgent',
          content: 'I prepared coverage proposals for the week.',
          plan: { steps: ['analyze', 'validate', 'propose'] },
          completedSteps: ['analyze', 'validate'],
          toolResults: [{ tool: 'get_coverage', success: true }],
          validation: { businessRulesPassed: true },
          proposals: [
            {
              affiliationId: 'aff-demo-1',
              staffName: 'Dr Demo',
              shiftDate: '2026-11-20',
              startTime: '09:00',
              endTime: '13:00',
            },
          ],
          workflowId: '00000000-0000-4000-8000-000000000099',
        }),
      });
    });

    await page.goto('/hospital/roster');
    await expect(page).toHaveURL(/\/hospital\/roster/);

    await expect(page.getByRole('button', { name: /scheduling agent/i })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: /scheduling agent/i }).click();

    await expect(
      page.getByRole('heading', { name: /vaxora staff scheduling agent/i })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/agent online/i)).toBeVisible({ timeout: 15000 });

    const input = page.locator('textarea[placeholder*="Ask about coverage"]').first();
    await expect(input).toBeVisible();
    await input.fill('Staff the rest of the week with balanced doctor and nurse coverage.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect
      .poll(() => chatPayload, { timeout: 20000 })
      .not.toBeNull();
    expect(String(chatPayload.targetAgent || chatPayload.TargetAgent)).toMatch(
      /StaffSchedulingAgent/i
    );
    expect(JSON.stringify(chatPayload)).toMatch(/Staff the rest of the week/i);

    await expect(
      page.getByText(/prepared coverage proposals|coverage/i).first()
    ).toBeVisible({ timeout: 15000 });
  });
});
