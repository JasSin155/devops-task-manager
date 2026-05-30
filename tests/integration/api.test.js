// tests/integration/api.test.js
const request = require('supertest');
const { createApp } = require('../../src/app');

describe('Task Manager API (integration)', () => {
  let app;
  let token;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret';
    app = createApp();
  });

  test('GET / returns service metadata', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('devops-task-manager');
  });

  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /metrics returns prometheus text', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/app_http_requests_total/);
  });

  test('rejects task access without a token', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  test('registers a user, logs in, and obtains a token', async () => {
    const username = `user-${Date.now()}`;
    const password = 'StrongPass!1';

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username, password });
    expect(reg.status).toBe(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username, password });
    expect(login.status).toBe(200);
    expect(typeof login.body.token).toBe('string');
    token = login.body.token;
  });

  test('full task CRUD lifecycle', async () => {
    // CREATE
    const created = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Write report', description: 'HD task report' });
    expect(created.status).toBe(201);
    const taskId = created.body.id;

    // READ list
    const list = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    // READ one
    const one = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(one.status).toBe(200);
    expect(one.body.title).toBe('Write report');

    // UPDATE
    const updated = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completed: true });
    expect(updated.status).toBe(200);
    expect(updated.body.completed).toBe(true);

    // DELETE
    const del = await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    // CONFIRM gone
    const gone = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(gone.status).toBe(404);
  });

  test('rejects malformed register payload', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'short', password: '123' }); // password too short
    expect(res.status).toBe(400);
  });
});
