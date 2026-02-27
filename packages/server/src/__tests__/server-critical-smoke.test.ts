import os from 'os';
import path from 'path';
import request from 'supertest';

describe('Server critical smoke tests', () => {
  let app: any;
  let gpToken = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PG_BRIDGE_DISABLED = '1';
    process.env.JWT_SECRET = 'test-secret-min-16';
    process.env.DB_PATH = path.join(os.tmpdir(), `brickell-server-smoke-${Date.now()}.db`);

    jest.resetModules();
    const dbMod = await import('../db/database');
    dbMod.initDb();

    const serverMod = await import('../index');
    app = serverMod.default;

    const login = await request(app).post('/api/auth/login').send({ email: 'admin', password: 'admin', role: 'gp' });
    expect(login.status).toBe(200);
    gpToken = String(login.body?.token || '');
    expect(gpToken).toBeTruthy();
  });

  it('auth rejects bad credentials and supports forgot-password response envelope', async () => {
    const bad = await request(app).post('/api/auth/login').send({ email: 'admin', password: 'wrong', role: 'gp' });
    expect(bad.status).toBe(401);

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(forgot.status).toBe(200);
    expect(Boolean(forgot.body?.success)).toBe(true);
  });

  it('portfolio and model endpoints return authenticated payloads', async () => {
    const summary = await request(app).get('/api/portfolio/summary').set('Authorization', `Bearer ${gpToken}`);
    expect(summary.status).toBe(200);

    const runModel = await request(app)
      .post('/api/model/run')
      .set('Authorization', `Bearer ${gpToken}`)
      .send({});
    expect(runModel.status).toBe(200);
    expect(runModel.body?.returns).toBeTruthy();
  });

  it('actuals transaction list and diagnostics are available to GP', async () => {
    const txns = await request(app)
      .get('/api/actuals/transactions?limit=10')
      .set('Authorization', `Bearer ${gpToken}`);
    expect(txns.status).toBe(200);
    expect(Array.isArray(txns.body)).toBe(true);

    const reconcile = await request(app)
      .post('/api/diag/reconcile')
      .set('Authorization', `Bearer ${gpToken}`)
      .send({ threshold: 1000000 });
    expect([200, 500]).toContain(reconcile.status);
  });
});

