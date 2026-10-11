import { test, expect } from '@playwright/test';
import { API, deleteTaskViaAPI } from './helpers';

test.describe('Basic mode execution boundary', () => {
  test('health and repeated refresh keep every provider unavailable', async ({ request }) => {
    const health = await (await request.get(`${API}/api/health`)).json();
    expect(health.agentExecutionEnabled).toBe(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await request.post(`${API}/api/agents/refresh`);
      expect(res.status()).toBe(200);
      const providers = await res.json();
      expect(providers.length).toBeGreaterThan(0);
      expect(providers.every((provider: any) => provider.available === false)).toBe(true);
    }
  });

  test('explicit run is rejected before creating run intent or events', async ({ request }) => {
    const created = await request.post(`${API}/api/tasks`, { data: { title: 'Manual task' } });
    expect(created.status()).toBe(201);
    const task = await created.json();
    const before = (await (await request.get(`${API}/api/tasks`)).json()).find((saved: any) => saved.id === task.id);
    try {
      const run = await request.post(`${API}/api/tasks/${task.id}/run`);
      expect(run.status()).toBe(403);
      expect((await run.json()).code).toBe('AGENT_EXECUTION_DISABLED');
      expect((await (await request.get(`${API}/api/tasks`)).json()).find((saved: any) => saved.id === task.id)).toEqual(before);
      expect(await (await request.get(`${API}/api/tasks/${task.id}/events`)).json()).toEqual([]);
    } finally { await deleteTaskViaAPI(request, task.id); }
  });

  test('auto group and orchestration requests leave all records unchanged', async ({ request }) => {
    const beforeTasks = await (await request.get(`${API}/api/tasks`)).json();
    const beforeGroups = await (await request.get(`${API}/api/groups`)).json();
    for (const [endpoint, data] of [
      ['/api/groups', { title: 'Blocked group', autoRun: true, children: [{ title: 'Child' }] }],
      ['/api/orchestrations', { prompt: 'Blocked default orchestration' }],
      ['/api/orchestrations', { prompt: 'Blocked explicit orchestration', autoStart: true }],
      ['/api/orchestrations', { prompt: 'Blocked snake case orchestration', auto_start: true }],
    ] as const) {
      const res = await request.post(`${API}${endpoint}`, { data });
      expect(res.status()).toBe(403);
      expect((await res.json()).code).toBe('AGENT_EXECUTION_DISABLED');
    }
    expect(await (await request.get(`${API}/api/tasks`)).json()).toEqual(beforeTasks);
    expect(await (await request.get(`${API}/api/groups`)).json()).toEqual(beforeGroups);
  });
});
