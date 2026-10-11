import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { API, deleteTaskViaAPI, prepareTestRepo, waitForBoard } from './helpers';

/**
 * E2E tests for the API Improvements (Items 1–5):
 * 1. Single-call task creation + autoRun
 * 2. agent_complete WebSocket event
 * 3. GET /api/tasks/:id/status lightweight endpoint
 * 4. POST /api/tasks/batch endpoint
 * 5. Task result summary events on completion
 */

// ---------------------------------------------------------------------------
// Item 1: Single-call task creation + autoRun
// ---------------------------------------------------------------------------

test.describe('Single-call task creation + autoRun', () => {
  test('POST /api/tasks with all fields creates task with repoPath and agentType', async ({ request }) => {
    const repoPath = prepareTestRepo('api-improvements');
    const res = await request.post(`${API}/api/tasks`, {
      data: {
        title: 'API test task',
        description: 'Test creating with extra fields',
        priority: 'high',
        columnId: 'backlog',
        agentType: 'claude',
        repoPath,
      },
    });
    expect(res.status()).toBe(201);
    const task = await res.json();
    expect(task.title).toBe('API test task');
    expect(task.agentType).toBe('claude');
    expect(task.repoPath).toBe(repoPath);
    expect(task.columnId).toBe('backlog');
    expect(task.agentStatus).toBe('idle');

    // Cleanup
    await deleteTaskViaAPI(request, task.id);
  });

  test('persists a per-task timeout and rejects invalid bounds', async ({ request }) => {
    const created = await request.post(`${API}/api/tasks`, {
      data: { title: 'Long review', timeoutMinutes: 120 },
    });
    expect(created.status()).toBe(201);
    const task = await created.json();
    expect(task.timeoutMinutes).toBe(120);

    const updated = await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { timeoutMinutes: 180 },
    });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).timeoutMinutes).toBe(180);

    const invalid = await request.post(`${API}/api/tasks`, {
      data: { title: 'Invalid timeout', timeoutMinutes: 241 },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error).toContain('between 1 and 240');
    await deleteTaskViaAPI(request, task.id);
  });

  test('basic mode rejects autoRun in backlog without creating a task', async ({ request }) => {
    const before = await (await request.get(`${API}/api/tasks`)).json();
    const res = await request.post(`${API}/api/tasks`, { data: { title: 'Blocked auto-run', columnId: 'backlog', autoRun: true } });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('AGENT_EXECUTION_DISABLED');
    expect(await (await request.get(`${API}/api/tasks`)).json()).toEqual(before);
  });

  test('basic mode rejects autoRun in in-progress without creating a task', async ({ request }) => {
    const before = await (await request.get(`${API}/api/tasks`)).json();
    const res = await request.post(`${API}/api/tasks`, { data: { title: 'Blocked auto-run', columnId: 'in-progress', autoRun: true } });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('AGENT_EXECUTION_DISABLED');
    expect(await (await request.get(`${API}/api/tasks`)).json()).toEqual(before);
  });

  test('POST /api/tasks with autoRun=false (default) does NOT auto-run', async ({ request }) => {
    const res = await request.post(`${API}/api/tasks`, {
      data: {
        title: 'Explicit no auto-run',
        description: 'autoRun defaults to false',
        columnId: 'in-progress',
      },
    });
    expect(res.status()).toBe(201);
    const task = await res.json();
    expect(task.agentStatus).toBe('idle');

    await deleteTaskViaAPI(request, task.id);
  });

  test('POST /api/tasks validates new fields', async ({ request }) => {
    // Invalid autoRun type
    const res1 = await request.post(`${API}/api/tasks`, {
      data: { title: 'Bad autoRun', autoRun: 'yes' },
    });
    expect(res1.status()).toBe(400);
    const body1 = await res1.json();
    expect(body1.error).toContain('autoRun');

    // Invalid branchName
    const res2 = await request.post(`${API}/api/tasks`, {
      data: { title: 'Bad branch', branchName: '..exploit' },
    });
    expect(res2.status()).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toContain('branchName');
  });
});

// ---------------------------------------------------------------------------
// Item 3: GET /api/tasks/:id/status
// ---------------------------------------------------------------------------

test.describe('Lightweight status endpoint', () => {
  test('GET /api/tasks/:id/status returns lightweight status', async ({ request }) => {
    // Create a task first
    const createRes = await request.post(`${API}/api/tasks`, {
      data: { title: 'Status test', agentType: 'claude' },
    });
    const task = await createRes.json();

    const statusRes = await request.get(`${API}/api/tasks/${task.id}/status`);
    expect(statusRes.status()).toBe(200);
    const status = await statusRes.json();

    expect(status.id).toBe(task.id);
    expect(status.agentStatus).toBe('idle');
    expect(status.agentType).toBe('claude');
    expect(status.columnId).toBe('backlog');
    expect(status.isRunning).toBe(false);

    // Should NOT include heavy fields like title, description, etc.
    expect(status.title).toBeUndefined();
    expect(status.description).toBeUndefined();

    await deleteTaskViaAPI(request, task.id);
  });

  test('GET /api/tasks/:id/status returns 404 for unknown task', async ({ request }) => {
    const res = await request.get(`${API}/api/tasks/nonexistent-id/status`);
    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Item 4: POST /api/tasks/batch
// ---------------------------------------------------------------------------

test.describe('Batch create endpoint', () => {
  test('POST /api/tasks/batch creates multiple tasks', async ({ request }) => {
    const res = await request.post(`${API}/api/tasks/batch`, {
      data: {
        tasks: [
          { title: 'Batch A', description: 'First', priority: 'low' },
          { title: 'Batch B', description: 'Second', priority: 'high' },
          { title: 'Batch C', description: 'Third' },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.tasks).toHaveLength(3);
    expect(body.tasks[0].title).toBe('Batch A');
    expect(body.tasks[1].title).toBe('Batch B');
    expect(body.tasks[2].title).toBe('Batch C');

    // All should have unique IDs
    const ids = body.tasks.map((t: any) => t.id);
    expect(new Set(ids).size).toBe(3);

    // Cleanup
    for (const t of body.tasks) {
      await deleteTaskViaAPI(request, t.id);
    }
  });

  test('POST /api/tasks/batch validates all tasks before creating any (atomic)', async ({ request }) => {
    // Get current task count
    const beforeRes = await request.get(`${API}/api/tasks`);
    const beforeCount = (await beforeRes.json()).length;

    // Second task has invalid priority — should reject entire batch
    const res = await request.post(`${API}/api/tasks/batch`, {
      data: {
        tasks: [
          { title: 'Valid task' },
          { title: 'Invalid task', priority: 'INVALID' },
        ],
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('task[1]');

    // Verify no tasks were created
    const afterRes = await request.get(`${API}/api/tasks`);
    const afterCount = (await afterRes.json()).length;
    expect(afterCount).toBe(beforeCount);
  });

  test('POST /api/tasks/batch rejects empty array', async ({ request }) => {
    const res = await request.post(`${API}/api/tasks/batch`, {
      data: { tasks: [] },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/tasks/batch rejects non-array', async ({ request }) => {
    const res = await request.post(`${API}/api/tasks/batch`, {
      data: { tasks: 'not-an-array' },
    });
    expect(res.status()).toBe(400);
  });

  test('basic mode rejects a mixed autoRun batch atomically', async ({ request }) => {
    const before = await (await request.get(`${API}/api/tasks`)).json();
    const res = await request.post(`${API}/api/tasks/batch`, { data: { tasks: [
      { title: 'Ordinary task' }, { title: 'Blocked auto-run', autoRun: true, columnId: 'in-progress' },
    ] } });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('AGENT_EXECUTION_DISABLED');
    expect(await (await request.get(`${API}/api/tasks`)).json()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Item 2: agent_complete WebSocket event
// ---------------------------------------------------------------------------

test.describe('Basic mode event safety', () => {
  test('moving a task does not emit agent events or completions', async ({ request }) => {
    const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/ws`);
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const messages: any[] = [];
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
    const create = await request.post(`${API}/api/tasks`, { data: { title: 'Manual workflow' } });
    const task = await create.json();
    try {
      const moved = await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'in-progress' } });
      expect(moved.status()).toBe(200);
      expect((await moved.json()).agentStatus).toBe('idle');
      await expect.poll(() => messages.filter(m => m.type === 'task_updated' && m.payload.id === task.id).length).toBeGreaterThan(0);
      expect(messages.filter(m => ['agent_event', 'agent_complete', 'agent_follow_up'].includes(m.type))).toEqual([]);
      expect(await (await request.get(`${API}/api/tasks/${task.id}/events`)).json()).toEqual([]);
      const status = await (await request.get(`${API}/api/tasks/${task.id}/status`)).json();
      expect(status.isRunning).toBe(false);
      expect(status.agentStatus).toBe('idle');
    } finally { ws.close(); await deleteTaskViaAPI(request, task.id); }
  });
});

// ---------------------------------------------------------------------------
// Item 6: POST /api/tasks/:id/message — follow-up messages
// ---------------------------------------------------------------------------

test.describe('Follow-up execution guard', () => {
  test('basic mode rejects messages before mutation, even for invalid input or unknown tasks', async ({ request }) => {
    const create = await request.post(`${API}/api/tasks`, { data: { title: 'Guarded message' } });
    const task = await create.json();
    const before = (await (await request.get(`${API}/api/tasks`)).json()).find((saved: any) => saved.id === task.id);
    try {
      for (const [id, data] of [[task.id, { message: 'hello' }], [task.id, { message: '' }], [task.id, {}], ['nonexistent-id', { message: 'hello' }]] as const) {
        const res = await request.post(`${API}/api/tasks/${id}/message`, { data });
        expect(res.status()).toBe(403);
        expect((await res.json()).code).toBe('AGENT_EXECUTION_DISABLED');
      }
      expect((await (await request.get(`${API}/api/tasks`)).json()).find((saved: any) => saved.id === task.id)).toEqual(before);
      expect(await (await request.get(`${API}/api/tasks/${task.id}/events`)).json()).toEqual([]);
    } finally { await deleteTaskViaAPI(request, task.id); }
  });
});

// ---------------------------------------------------------------------------
// Existing API backward compatibility
// ---------------------------------------------------------------------------

test.describe('Backward compatibility', () => {
  test('existing POST /api/tasks without new fields works as before', async ({ request }) => {
    const res = await request.post(`${API}/api/tasks`, {
      data: { title: 'Old-style task' },
    });
    expect(res.status()).toBe(201);
    const task = await res.json();
    expect(task.title).toBe('Old-style task');
    expect(task.agentStatus).toBe('idle');
    expect(task.columnId).toBe('backlog');
    expect(task.agentType).toBe('copilot');

    await deleteTaskViaAPI(request, task.id);
  });

  test('existing PATCH, DELETE, events endpoints still work', async ({ request }) => {
    // Create
    const createRes = await request.post(`${API}/api/tasks`, {
      data: { title: 'Compat test' },
    });
    const task = await createRes.json();

    // Patch
    const patchRes = await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { title: 'Updated compat test' },
    });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).title).toBe('Updated compat test');

    // Events
    const eventsRes = await request.get(`${API}/api/tasks/${task.id}/events`);
    expect(eventsRes.status()).toBe(200);

    // Delete
    const deleteRes = await request.delete(`${API}/api/tasks/${task.id}`);
    expect(deleteRes.status()).toBe(204);
  });

  test('board UI still renders correctly', async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);
    for (const col of ['Backlog', 'In Progress', 'Review', 'Done']) {
      await expect(page.getByRole('heading', { name: col, exact: true })).toBeVisible();
    }
  });
});
