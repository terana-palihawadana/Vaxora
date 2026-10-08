// k6 performance test for the Staff Management API (hospital-facing endpoints).
//
// Scenarios:
//   browse - hospital dashboard reads (staff directory, shifts, coverage, cover requests, booths),
//            ramping 0 -> 10 -> 20 virtual users.
//   login  - a steady trickle of logins, since password hashing is CPU-heavy.
//
// Run (API on the host at :5004, k6 in Docker):
//   docker run --rm -v "$PWD/perf:/perf" -e BASE_URL=http://host.docker.internal:5004 \
//     grafana/k6 run /perf/k6/staff-api-load.js

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5004';
const EMAIL = __ENV.HOSPITAL_EMAIL || 'hospital@vaxora.local';
const PASSWORD = __ENV.HOSPITAL_PASSWORD || 'Hospital@123';
const OUT_DIR = __ENV.OUT_DIR || '/perf/results';

const endpointErrors = new Rate('endpoint_errors');
const staffListDuration = new Trend('staff_list_duration', true);
const shiftsDuration = new Trend('shifts_duration', true);
const coverageDuration = new Trend('coverage_duration', true);
const coverRequestsDuration = new Trend('cover_requests_duration', true);
const boothsDuration = new Trend('booths_duration', true);

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 20 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
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
    'http_req_duration{scenario:browse}': ['p(95)<500'],
    'http_req_duration{scenario:login}': ['p(95)<1000'],
    staff_list_duration: ['p(95)<500'],
    shifts_duration: ['p(95)<500'],
    coverage_duration: ['p(95)<500'],
    cover_requests_duration: ['p(95)<500'],
    booths_duration: ['p(95)<500'],
  },
};

function isoDate(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function doLogin() {
  return http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/auth/login' } }
  );
}

export function setup() {
  const res = doLogin();
  if (res.status !== 200 || !res.json('token')) {
    throw new Error(`Setup login failed: ${res.status} ${res.body}`);
  }
  return { token: res.json('token') };
}

function getJson(path, name, trend, token) {
  const res = http.get(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name },
  });
  const ok = check(res, {
    [`${name} is 200`]: (r) => r.status === 200,
    [`${name} returns JSON`]: (r) => (r.headers['Content-Type'] || '').includes('application/json'),
  });
  endpointErrors.add(!ok);
  trend.add(res.timings.duration);
  return res;
}

export function browse(data) {
  const from = isoDate(0);
  const to = isoDate(7);

  group('hospital staff dashboard', () => {
    getJson('/api/staff/hospital', 'GET /api/staff/hospital', staffListDuration, data.token);
    getJson(`/api/staff/shifts/hospital?from=${from}&to=${to}`, 'GET /api/staff/shifts/hospital', shiftsDuration, data.token);
    getJson(`/api/staff/coverage?from=${from}&to=${to}`, 'GET /api/staff/coverage', coverageDuration, data.token);
    getJson('/api/staff/shift-swaps/hospital?limit=40', 'GET /api/staff/shift-swaps/hospital', coverRequestsDuration, data.token);
    getJson('/api/staff/booths', 'GET /api/staff/booths', boothsDuration, data.token);
  });

  // Think time between page loads, like a real hospital admin.
  sleep(1);
}

export function login() {
  const res = doLogin();
  const ok = check(res, {
    'login is 200': (r) => r.status === 200,
    'login returns a token': (r) => r.status === 200 && !!r.json('token'),
  });
  endpointErrors.add(!ok);
}

export function handleSummary(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const lines = [];
  lines.push(`Vaxora Staff API - k6 performance run (${new Date().toISOString()})`);
  lines.push(`Target: ${BASE_URL}`);
  lines.push('');

  const m = data.metrics;
  const fmt = (v) => (v === undefined ? '-' : `${v.toFixed(1)} ms`);
  const row = (label, metric) => {
    if (!metric) return;
    const v = metric.values;
    lines.push(`${label.padEnd(36)} avg ${fmt(v.avg).padStart(10)}  p90 ${fmt(v['p(90)']).padStart(10)}  p95 ${fmt(v['p(95)']).padStart(10)}  max ${fmt(v.max).padStart(10)}`);
  };
  row('GET /api/staff/hospital', m.staff_list_duration);
  row('GET /api/staff/shifts/hospital', m.shifts_duration);
  row('GET /api/staff/coverage', m.coverage_duration);
  row('GET /api/staff/shift-swaps/hospital', m.cover_requests_duration);
  row('GET /api/staff/booths', m.booths_duration);
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
    [`${OUT_DIR}/staff-api-load-${stamp}.txt`]: text,
    [`${OUT_DIR}/staff-api-load-${stamp}.json`]: JSON.stringify(data, null, 2),
  };
}
