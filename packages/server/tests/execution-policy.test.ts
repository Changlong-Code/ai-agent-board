import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentExecutionDisabledError, isAgentExecutionEnabled,
} from '../src/services/execution-policy.js';
import { AgentManager } from '../src/services/agent-manager.js';
import type { Task, TaskGroup } from '../src/types.js';

test('execution requires an exact opt-in and respects the legacy disable override', () => {
  for (const value of [undefined, '', '0', 'true', 'yes', ' 1', '1 ']) {
    assert.equal(isAgentExecutionEnabled({ AGENTBOARD_ENABLE_AGENT_EXECUTION: value }), false);
  }
  assert.equal(isAgentExecutionEnabled({ AGENTBOARD_ENABLE_AGENT_EXECUTION: '1' }), true);
  for (const disabled of ['1', 'true']) {
    assert.equal(isAgentExecutionEnabled({
      AGENTBOARD_ENABLE_AGENT_EXECUTION: '1', AGENTBOARD_DISABLE_AGENT_STARTUP: disabled,
    }), false);
  }
});

test('basic mode initializes and refreshes without creating providers, and rejects all execution entrances before effects', async () => {
  const priorEnable = process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION;
  const priorDisable = process.env.AGENTBOARD_DISABLE_AGENT_STARTUP;
  delete process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION;
  delete process.env.AGENTBOARD_DISABLE_AGENT_STARTUP;
  try {
    const manager = new AgentManager();
    await manager.initialize();
    const agents = await manager.refresh();
    assert.equal(agents.length, 7);
    assert.ok(agents.every(agent => !agent.available && agent.reason?.includes('basic mode')));
    assert.equal((manager as unknown as { providers: Map<string, unknown> }).providers.size, 0);

    // Poison every downstream callback: policy must reject before reaching it.
    const fail = () => { throw new Error('unexpected downstream side effect'); };
    const task = { id: 'blocked', summary: 'keep prior summary', useWorktree: true } as Task;
    assert.throws(() => manager.startAgent(task, fail, fail), AgentExecutionDisabledError);
    await assert.rejects(manager.sendMessage(task.id, 'do work', ['image']), AgentExecutionDisabledError);
    assert.throws(() => manager.startGroup({ id: 'group' } as TaskGroup, [task], fail, fail, fail), AgentExecutionDisabledError);
    assert.equal(manager.isRunning(task.id), false);
    assert.equal(manager.isGroupRunning('group'), false);
    assert.deepEqual(await manager.getEvents(task.id), []);
    assert.equal(task.summary, 'keep prior summary');

    // Enabling execution cannot bypass the historical test/CI kill switch.
    process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION = '1';
    process.env.AGENTBOARD_DISABLE_AGENT_STARTUP = 'true';
    await manager.initialize();
    assert.ok((await manager.refresh()).every(agent => !agent.available));
    assert.throws(() => manager.startAgent(task, fail), AgentExecutionDisabledError);
  } finally {
    if (priorEnable === undefined) delete process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION;
    else process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION = priorEnable;
    if (priorDisable === undefined) delete process.env.AGENTBOARD_DISABLE_AGENT_STARTUP;
    else process.env.AGENTBOARD_DISABLE_AGENT_STARTUP = priorDisable;
  }
});
