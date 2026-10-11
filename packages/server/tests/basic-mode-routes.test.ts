import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import express from 'express';
import { createAgentRouter } from '../src/routes/agent.js';
import { createTaskRouter } from '../src/routes/tasks.js';
import { createGroupsRouter } from '../src/routes/groups.js';
import { createOrchestrationsRouter } from '../src/routes/orchestrations.js';
import { startAgentForTask } from '../src/routes/helpers.js';

// Fail on ANY repository/provider access: rejection must precede state changes.
const forbidden = new Proxy({}, { get(_target, key) {
  throw new Error(`disabled execution touched dependency: ${String(key)}`);
} });

test('basic mode rejects all explicit execution routes before dependencies or mutations', async () => {
  const original = process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION;
  delete process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION;
  const app = express();
  app.use(express.json());
  app.use('/tasks', createAgentRouter(forbidden as any, forbidden as any));
  app.use('/tasks', createTaskRouter(forbidden as any, forbidden as any, forbidden as any));
  app.use('/groups', createGroupsRouter(forbidden as any, forbidden as any, forbidden as any, forbidden as any));
  app.use('/orchestrations', createOrchestrationsRouter(forbidden as any, forbidden as any, forbidden as any));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    for (const [url, body] of [
      ['/tasks/id/run', {}], ['/tasks/id/message', { message: 'hi' }],
      ['/tasks', { autoRun: true }], ['/tasks/batch', { tasks: [{ autoRun: true }] }],
      ['/groups/id/run', {}], ['/groups', { autoRun: true }],
      ['/orchestrations', {}], ['/orchestrations', { auto_start: true }],
      ['/orchestrations/id/retry', {}], ['/orchestrations/id/message', { message: 'hi' }],
    ] as const) {
      const response = await fetch(`http://127.0.0.1:${address.port}${url}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 403, url);
      assert.equal((await response.json() as any).code, 'AGENT_EXECUTION_DISABLED', url);
    }
    for (const autoRun of ['true', 1, {}, []]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/groups`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoRun }),
      });
      assert.equal(response.status, 400, `malformed autoRun ${JSON.stringify(autoRun)}`);
      assert.equal((await response.json() as any).error, 'autoRun must be a boolean');
    }
    await assert.rejects(startAgentForTask({ id: 'id' } as any, forbidden as any, forbidden as any),
      (error: any) => error.code === 'AGENT_EXECUTION_DISABLED');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (original === undefined) delete process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION;
    else process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION = original;
  }
});
