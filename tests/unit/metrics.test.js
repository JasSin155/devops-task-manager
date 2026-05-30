// tests/unit/metrics.test.js
const { register } = require('../../src/middleware/metrics');

describe('metrics registry', () => {
  test('exposes default Node.js metrics with app_ prefix', async () => {
    const text = await register.metrics();
    expect(text).toMatch(/app_process_cpu_user_seconds_total/);
    expect(text).toMatch(/app_nodejs_eventloop_lag_seconds/);
  });

  test('declares the http requests counter', async () => {
    const text = await register.metrics();
    expect(text).toMatch(/# HELP app_http_requests_total/);
  });

  test('declares the http duration histogram', async () => {
    const text = await register.metrics();
    expect(text).toMatch(/# HELP app_http_request_duration_seconds/);
  });
});
