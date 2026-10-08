// k6 performance test for the whole Vaxora API (every module, every seeded role).
//
// Scenarios (run in parallel, 20 virtual users at peak):
//   public   - anonymous visitors: vaccine catalogue, hospitals offering vaccines, open schedules, feedback.
//   patient  - patient portal: profile, my appointments, my feedback.
//   hospital - hospital admin: appointments, schedules, inventory (batches, expiry, vaults, summary,
//              formulary) and staff (directory, booths).
//   admin    - system admin: dashboard stats, pending verifications, users, audit log, all feedback.
//   login    - a steady trickle of logins across the three roles, since password hashing is CPU-heavy.
//
// Run (API on the host at :5004, k6 in Docker):
//   docker run --rm -v "$PWD/perf:/perf" -e BASE_URL=http://host.docker.internal:5004 \
//     grafana/k6 run /perf/k6/project-api-load.js

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5004';
const OUT_DIR = __ENV.OUT_DIR || '/perf/results';

const ACCOUNTS = {
  patient: { email: __ENV.PATIENT_EMAIL || 'patient1@vaxora.lk', password: __ENV.PATIENT_PASSWORD || 'Password123!' },
  hospital: { email: __ENV.HOSPITAL_EMAIL || 'hospital@vaxora.local', password: __ENV.HOSPITAL_PASSWORD || 'Hospital@123' },
  admin: { email: __ENV.ADMIN_EMAIL || 'admin@vaxora.health.gov.lk', password: __ENV.ADMIN_PASSWORD || 'Admin@Vaxora2026' },
};

const endpointErrors = new Rate('endpoint_errors');
const trends = {
  public: new Trend('public_duration', true),
  patient: new Trend('patient_duration', true),
  booking: new Trend('booking_duration', true),
  inventory: new Trend('inventory_duration', true),
  staff: new Trend('staff_duration', true),
  admin: new Trend('admin_duration', true),
};

function roleScenario(exec) {
  return {
    executor: 'ramping-vus',
    exec,
    startVUs: 0,
    stages: [
      { duration: '30s', target: 3 },
      { duration: '1m', target: 5 },
      { duration: '30s', target: 0 },
    ],
    gracefulRampDown: '10s',
  };
}

export const options = {
  scenarios: {
    public: roleScenario('publicVisitor'),
    patient: roleScenario('patient'),
    hospital: roleScenario('hospital'),
    admin: roleScenario('admin'),
    login: {
      executor: 'constant-arrival-rate',
      exec: 'login',
      rate: 2,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 5,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    endpoint_errors: ['rate<0.01'],
    'http_req_duration{scenario:login}': ['p(95)<1000'],
    public_duration: ['p(95)<500'],
    patient_duration: ['p(95)<500'],
    booking_duration: ['p(95)<500'],
    inventory_duration: ['p(95)<500'],
    staff_duration: ['p(95)<500'],
    admin_duration: ['p(95)<500'],
  },
};

function isoDate(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function doLogin(role) {
  const a = ACCOUNTS[role];
  return http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: a.email, password: a.password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/auth/login' } }
  );
}

export function setup() {
  const tokens = {};
  for (const role of Object.keys(ACCOUNTS)) {
    const res = doLogin(role);
    if (res.status !== 200 || !res.json('token')) {
      throw new Error(`Setup login failed for ${role}: ${res.status} ${res.body}`);
    }
    tokens[role] = res.json('token');
  }
  return tokens;
}

function getJson(path, module, token) {
  const name = `GET ${path.split('?')[0]}`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = http.get(`${BASE_URL}${path}`, { headers, tags: { name, module } });
  const ok = check(res, {
    [`${name} is 200`]: (r) => r.status === 200,
    [`${name} returns JSON`]: (r) => (r.headers['Content-Type'] || '').includes('application/json'),
  });
  endpointErrors.add(!ok);
  trends[module].add(res.timings.duration);
  return res;
}

export function publicVisitor() {
  group('public visitor', () => {
    getJson('/api/inventory/vaccines', 'public');
    getJson('/api/inventory/vaccines-with-hospitals', 'public');
    getJson('/api/schedule/available', 'public');
    getJson('/api/feedback/public/random', 'public');
  });
  sleep(1);
}

export function patient(tokens) {
  group('patient portal', () => {
    getJson('/api/auth/me', 'patient', tokens.patient);
    getJson('/api/appointments/my', 'patient', tokens.patient);
    getJson('/api/feedback/my', 'patient', tokens.patient);
  });
  sleep(1);
}

export function hospital(tokens) {
  const t = tokens.hospital;
  group('hospital booking', () => {
    getJson('/api/appointments/hospital', 'booking', t);
    getJson('/api/schedule/hospital', 'booking', t);
  });
  group('hospital inventory', () => {
    getJson('/api/inventory/batches', 'inventory', t);
    getJson('/api/inventory/batches/expiring', 'inventory', t);
    getJson('/api/inventory/vaults', 'inventory', t);
    getJson('/api/inventory/summary', 'inventory', t);
    getJson('/api/inventory/formulary', 'inventory', t);
  });
  group('hospital staff', () => {
    getJson('/api/staff/hospital', 'staff', t);
    getJson('/api/staff/booths', 'staff', t);
    getJson(`/api/staff/coverage?from=${isoDate(0)}&to=${isoDate(7)}`, 'staff', t);
  });
  sleep(1);
}

export function admin(tokens) {
  group('admin console', () => {
    getJson('/api/admin/verification/dashboard-stats', 'admin', tokens.admin);
    getJson('/api/admin/verification/pending', 'admin', tokens.admin);
    getJson('/api/admin/verification/users', 'admin', tokens.admin);
    getJson('/api/admin/verification/audit-logs?limit=100', 'admin', tokens.admin);
    getJson('/api/feedback', 'admin', tokens.admin);
  });
  sleep(1);
}

const LOGIN_ROLES = ['patient', 'hospital', 'admin'];
let loginCounter = 0;

export function login() {
  const role = LOGIN_ROLES[loginCounter++ % LOGIN_ROLES.length];
  const res = doLogin(role);
  const ok = check(res, {
    'login is 200': (r) => r.status === 200,
    'login returns a token': (r) => r.status === 200 && !!r.json('token'),
  });
  endpointErrors.add(!ok);
}

export function handleSummary(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const lines = [];
  lines.push(`Vaxora API (all modules) - k6 performance run (${new Date().toISOString()})`);
  lines.push(`Target: ${BASE_URL}`);
  lines.push('');

  const m = data.metrics;
  const fmt = (v) => (v === undefined ? '-' : `${v.toFixed(1)} ms`);
  const row = (label, metric) => {
    if (!metric) return;
    const v = metric.values;
    lines.push(`${label.padEnd(36)} avg ${fmt(v.avg).padStart(10)}  p90 ${fmt(v['p(90)']).padStart(10)}  p95 ${fmt(v['p(95)']).padStart(10)}  max ${fmt(v.max).padStart(10)}`);
  };
  row('Public (catalogue, schedules)', m.public_duration);
  row('Patient portal', m.patient_duration);
  row('Booking (hospital appointments)', m.booking_duration);
  row('Inventory', m.inventory_duration);
  row('Staff management', m.staff_duration);
  row('Admin console', m.admin_duration);
  row('Login (POST /api/auth/login)', m['http_req_duration{scenario:login}']);
  row('All requests', m.http_req_duration);
  lines.push('');
  lines.push(`Requests: ${m.http_reqs.values.count}  (${m.http_reqs.values.rate.toFixed(1)}/s)`);
  lines.push(`HTTP failure rate: ${(m.http_req_failed.values.rate * 100).toFixed(2)}%`);
  lines.push(`Endpoint check failure rate: ${(m.endpoint_errors.values.rate * 100).toFixed(2)}%`);
  lines.push(`Peak VUs: ${m.vus_max.values.max}`);
  lines.push('');
  lines.push('Thresholds:');
  for (const [name, metric] of Object.entries(m)) {
    if (!metric.thresholds) continue;
    for (const [expr, res] of Object.entries(metric.thresholds)) {
      lines.push(`  ${res.ok ? 'PASS' : 'FAIL'}  ${name}: ${expr}`);
    }
  }
  const text = lines.join('\n') + '\n';

  return {
    stdout: text,
    [`${OUT_DIR}/project-api-load-${stamp}.txt`]: text,
    [`${OUT_DIR}/project-api-load-${stamp}.json`]: JSON.stringify(data, null, 2),
  };
}
