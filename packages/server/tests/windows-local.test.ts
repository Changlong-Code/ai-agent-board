import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createWindowsLocalGuard } from '../src/middleware/windows-local.js';

test('Windows local profile accepts proxy traffic and rejects foreign Origin and Host', async () => {
  const app = express();
  app.use(createWindowsLocalGuard({ enabled: true, apiPort: 8777, uiPort: 8776 }));
  app.post('/api/test', (_req, res) => res.json({ accepted: true }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  async function request(host: string, origin?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: address.port, path: '/api/test', method: 'POST', headers: { host, ...(origin ? { origin } : {}) } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode!));
      });
      req.on('error', reject); req.end();
    });
  }
  try {
    assert.equal(await request('127.0.0.1:8776', 'http://127.0.0.1:8776'), 200);
    assert.equal(await request('127.0.0.1:8777'), 200);
    assert.equal(await request('localhost:8777', 'http://localhost:8776'), 200);
    assert.equal(await request('127.0.0.1:8777', 'https://foreign.example'), 403);
    assert.equal(await request('foreign.example:8777'), 403);
    assert.equal(await request('127.0.0.1:8765'), 403);
    assert.equal(await request('127.0.0.1:8777', 'null'), 403);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Windows local guard fails closed on invalid ports', () => {
  assert.throws(() => createWindowsLocalGuard({ enabled: true, apiPort: 8777, uiPort: NaN }), /valid API and UI ports/);
});
