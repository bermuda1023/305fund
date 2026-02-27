import os from 'os';
import path from 'path';
import request from 'supertest';

describe('LP routes integration', () => {
  let app: any;
  let db: any;
  let gpToken = '';

  async function loginAs(role: 'gp' | 'lp') {
    const resp = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin', password: 'admin', role });
    expect(resp.status).toBe(200);
    expect(resp.body?.token).toBeTruthy();
    return String(resp.body.token);
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PG_BRIDGE_DISABLED = '1';
    process.env.JWT_SECRET = 'test-secret-min-16';
    process.env.DB_PATH = path.join(os.tmpdir(), `brickell-server-test-${Date.now()}.db`);

    jest.resetModules();
    const dbMod = await import('../db/database');
    dbMod.initDb();
    db = dbMod.getDb();

    const serverMod = await import('../index');
    app = serverMod.default;
    gpToken = await loginAs('gp');
  });

  it('enforces auth and GP role on investor list', async () => {
    const noAuth = await request(app).get('/api/lp/investors');
    expect(noAuth.status).toBe(401);

    const lpToken = await loginAs('lp');
    const lpResp = await request(app)
      .get('/api/lp/investors')
      .set('Authorization', `Bearer ${lpToken}`);
    expect(lpResp.status).toBe(403);
  });

  it('supports onboard -> remove -> reactivate flow', async () => {
    const email = `lp-${Date.now()}@example.com`;

    const onboard = await request(app)
      .post('/api/lp/investors')
      .set('Authorization', `Bearer ${gpToken}`)
      .send({
        name: 'Test Investor',
        entityName: 'Test Entity LLC',
        email,
        phone: '3055551212',
        commitment: 250000,
        notes: 'initial onboard',
      });
    expect(onboard.status).toBe(201);
    const lpId = Number(onboard.body?.id);
    expect(lpId).toBeGreaterThan(0);

    const remove = await request(app)
      .post(`/api/lp/investors/${lpId}/remove`)
      .set('Authorization', `Bearer ${gpToken}`)
      .send({ confirmText: `REMOVE ${email}` });
    expect(remove.status).toBe(200);
    expect(remove.body?.status).toBe('inactive');

    const reactivate = await request(app)
      .post('/api/lp/investors')
      .set('Authorization', `Bearer ${gpToken}`)
      .send({
        name: 'Test Investor Reactivated',
        entityName: 'Test Entity LLC',
        email,
        phone: '3055551213',
        commitment: 300000,
        notes: 'reactivated',
      });
    expect(reactivate.status).toBe(200);
    expect(Boolean(reactivate.body?.reactivated)).toBe(true);
    expect(Number(reactivate.body?.id)).toBe(lpId);
  });

  it('records capital-call receipt and updates call item status', async () => {
    const email = `capital-${Date.now()}@example.com`;
    const onboard = await request(app)
      .post('/api/lp/investors')
      .set('Authorization', `Bearer ${gpToken}`)
      .send({
        name: 'Capital Flow LP',
        entityName: 'Capital LP LLC',
        email,
        phone: '3055557788',
        commitment: 400000,
        notes: 'capital-call test',
      });
    expect([200, 201]).toContain(onboard.status);
    const lpId = Number(onboard.body?.id);

    const activate = await request(app)
      .patch(`/api/lp/investors/${lpId}/status`)
      .set('Authorization', `Bearer ${gpToken}`)
      .send({ status: 'active' });
    expect(activate.status).toBe(200);

    const callCreate = await request(app)
      .post('/api/lp/capital-calls/create')
      .set('Authorization', `Bearer ${gpToken}`)
      .send({
        totalAmount: 10000,
        callDate: '2026-02-01',
        dueDate: '2026-02-15',
        purpose: 'Integration test',
        letterTemplate: null,
      });
    expect(callCreate.status).toBe(201);
    const callId = Number(callCreate.body?.callId);
    expect(callId).toBeGreaterThan(0);

    const itemsResp = await request(app)
      .get(`/api/lp/capital-calls/${callId}/items`)
      .set('Authorization', `Bearer ${gpToken}`);
    expect(itemsResp.status).toBe(200);
    expect(Array.isArray(itemsResp.body)).toBe(true);
    const item = (itemsResp.body as any[]).find((r) => Number(r.lp_account_id) === lpId) || itemsResp.body[0];
    expect(item).toBeTruthy();

    const receive = await request(app)
      .put(`/api/lp/capital-calls/${callId}/items/${item.id}/received`)
      .set('Authorization', `Bearer ${gpToken}`)
      .send({ receivedAmount: Number(item.amount) });
    expect(receive.status).toBe(200);
    expect(receive.body?.success).toBe(true);

    const updatedItem = db.prepare('SELECT status, received_amount FROM capital_call_items WHERE id = ?').get(Number(item.id)) as any;
    expect(String(updatedItem?.status)).toBe('received');
    expect(Number(updatedItem?.received_amount || 0)).toBeCloseTo(Number(item.amount), 2);

    const txn = db.prepare('SELECT id, amount FROM capital_transactions WHERE capital_call_item_id = ? AND type = ?').get(Number(item.id), 'call') as any;
    expect(Number(txn?.id || 0)).toBeGreaterThan(0);
    expect(Number(txn?.amount || 0)).toBeCloseTo(Number(item.amount), 2);
  });
});
