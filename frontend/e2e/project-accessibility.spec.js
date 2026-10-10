import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility (WCAG 2.1 A/AA) checks for every main page of the Vaxora web app,
// one test per page and role, using axe-core on the real React app against the local API.
// Doctor and nurse portals are not covered: no doctor or nurse account is seeded.

const ACCOUNTS = {
  patient: { email: 'patient1@vaxora.lk', password: 'Password123!', home: /\/patient\// },
  hospital: { email: 'hospital@vaxora.local', password: 'Hospital@123', home: /\/hospital\// },
  admin: { email: 'admin@vaxora.health.gov.lk', password: 'Admin@Vaxora2026', home: /\/admin\// },
};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const PAGES = [
  { role: null, path: '/', label: 'public-landing' },
  { role: null, path: '/login', label: 'public-login' },
  { role: null, path: '/signup', label: 'public-signup' },
  { role: 'patient', path: '/patient/dashboard', label: 'patient-dashboard' },
  { role: 'patient', path: '/patient/appointments', label: 'patient-appointments' },
  { role: 'patient', path: '/patient/vaccination-history', label: 'patient-vaccination-history' },
  { role: 'patient', path: '/patient/feedback', label: 'patient-feedback' },
  { role: 'patient', path: '/patient/profile', label: 'patient-profile' },
  { role: 'hospital', path: '/hospital/dashboard', label: 'hospital-dashboard' },
  { role: 'hospital', path: '/hospital/appointments', label: 'hospital-appointments-today' },
  { role: 'hospital', path: '/hospital/appointments?view=bookings', label: 'hospital-appointments-bookings' },
  { role: 'hospital', path: '/hospital/roster', label: 'hospital-roster' },
  { role: 'hospital', path: '/hospital/inventory', label: 'hospital-inventory' },
  { role: 'hospital', path: '/hospital/sessions', label: 'hospital-sessions' },
  { role: 'hospital', path: '/hospital/sessions?view=booths', label: 'hospital-booths' },
  { role: 'hospital', path: '/hospital/staff', label: 'hospital-staff' },
  { role: 'hospital', path: '/hospital/feedback', label: 'hospital-feedback' },
  { role: 'hospital', path: '/hospital/profile', label: 'hospital-profile' },
  { role: 'admin', path: '/admin/dashboard', label: 'admin-dashboard' },
  { role: 'admin', path: '/admin/users', label: 'admin-users' },
  { role: 'admin', path: '/admin/approvals', label: 'admin-approvals' },
  { role: 'admin', path: '/admin/feedback', label: 'admin-feedback' },
  { role: 'admin', path: '/admin/audit', label: 'admin-audit-logs' },
  { role: 'admin', path: '/admin/profile', label: 'admin-profile' },
];

async function loginAs(page, role) {
  const account = ACCOUNTS[role];
  await page.goto('/login');
  await page.fill('input[name="email"]', account.email);
  await page.fill('input[name="password"]', account.password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(account.home, { timeout: 20000 });
}

function describeViolations(violations) {
  return violations
    .map((v) => {
      const targets = v.nodes.slice(0, 5).map((n) => `      - ${n.target.join(' ')}`).join('\n');
      return `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} element(s))\n${targets}`;
    })
    .join('\n');
}

test.describe('Vaxora web app accessibility (axe-core, WCAG 2.1 AA)', () => {
  PAGES.forEach(({ role, path, label }, i) => {
    test(`${i + 1}. ${label} (${path}) has no WCAG violations`, async ({ page }, testInfo) => {
      if (role) await loginAs(page, role);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));

      // Scroll once through the page so scroll-reveal content has finished
      // fading in before axe checks contrast.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1500);

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      await testInfo.attach(`axe-${label}.json`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
      expect(results.violations.length, `${label} has WCAG violations:\n${describeViolations(results.violations)}`).toBe(0);
    });
  });
});
