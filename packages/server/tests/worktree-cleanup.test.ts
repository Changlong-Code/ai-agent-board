import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Task } from '../src/types.js';
import type { TaskRepository } from '../src/repositories/types.js';
import {
  cleanupTaskWorktree,
  inspectWorktreeProcessUse,
  type WorktreeProcessInspector,
  reconcileManagedWorktrees,
} from '../src/services/worktree-cleanup.js';

// Use the real scanner over a controlled process table, independent of host /proc permissions.
const processFixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'agentboard-proc-fixture-'));
const fixtureInspector: WorktreeProcessInspector = (worktreePath) =>
  inspectWorktreeProcessUse(worktreePath, 'linux', processFixtureRoot);
test.after(() => rmSync(processFixtureRoot, { recursive: true, force: true }));

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
}

function fixture(): { repoPath: string; worktreePath: string; branchName: string; task: Task; dispose(): void } {
  const repoPath = mkdtempSync(path.join(os.tmpdir(), 'agentboard-cleanup-repo-'));
  const id = randomUUID();
  const worktreePath = path.join(os.tmpdir(), `agentboard-${id}-${randomUUID().slice(0, 6)}`);
  const branchName = `agent/test-${id}`;
  git(['init', '-b', 'main'], repoPath);
  git(['config', 'user.email', 'agentboard-tests@example.invalid'], repoPath);
  git(['config', 'user.name', 'Agent Board Tests'], repoPath);
  writeFileSync(path.join(repoPath, 'README.md'), 'base\n');
  writeFileSync(path.join(repoPath, '.gitignore'), '.env\nnode_modules/\n');
  git(['add', 'README.md', '.gitignore'], repoPath);
  git(['commit', '-m', 'base'], repoPath);
  git(['worktree', 'add', '-b', branchName, worktreePath, 'main'], repoPath);
  const task: Task = {
    id,
    title: 'Cleanup fixture',
    description: '',
    priority: 'medium',
    columnId: 'done',
    agentStatus: 'complete',
    createdAt: Date.now(),
    projectId: 'project-1',
    repoPath,
    branchName,
    baseBranch: 'main',
    useWorktree: true,
    worktreePath,
  };
  return {
    repoPath,
    worktreePath,
    branchName,
    task,
    dispose() {
      try { git(['worktree', 'remove', worktreePath, '--force'], repoPath); } catch { /* already removed */ }
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
    },
  };
}

test('clean managed worktree is removed while its branch is preserved', () => {
  const f = fixture();
  try {
    const result = cleanupTaskWorktree(f.task, fixtureInspector);
    assert.deepEqual(result, { status: 'removed' });
    assert.equal(existsSync(f.worktreePath), false);
    assert.equal(git(['branch', '--list', f.branchName], f.repoPath).replace(/^\*?\s*/, ''), f.branchName);
  } finally {
    f.dispose();
  }
});

test('dirty managed worktree is retained without losing uncommitted files', () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.worktreePath, 'uncommitted.txt'), 'keep me\n');
    const result = cleanupTaskWorktree(f.task, fixtureInspector);
    assert.equal(result.status, 'blocked');
    assert.match(result.status === 'blocked' ? result.reason : '', /uncommitted/i);
    assert.equal(existsSync(path.join(f.worktreePath, 'uncommitted.txt')), true);
  } finally {
    f.dispose();
  }
});

test('cleanup rejects paths outside the Board-managed temp namespace', () => {
  const f = fixture();
  try {
    const result = cleanupTaskWorktree({ ...f.task, worktreePath: f.repoPath });
    assert.equal(result.status, 'blocked');
    assert.match(result.status === 'blocked' ? result.reason : '', /managed worktree path/i);
    assert.equal(existsSync(f.repoPath), true);
  } finally {
    f.dispose();
  }
});

test('cleanup requires the exact managed suffix and expected branch', () => {
  const f = fixture();
  try {
    for (const task of [
      { ...f.task, worktreePath: `${f.worktreePath}-extra` },
      { ...f.task, branchName: undefined },
      { ...f.task, branchName: 'agent/wrong-branch' },
    ]) {
      const result = cleanupTaskWorktree(task, fixtureInspector);
      assert.equal(result.status, 'blocked');
    }
    assert.equal(existsSync(f.worktreePath), true);
  } finally {
    f.dispose();
  }
});

test('cleanup permits generated dependencies but blocks ignored files that may contain data', () => {
  const generated = fixture();
  const valuable = fixture();
  try {
    mkdirSync(path.join(generated.worktreePath, 'node_modules'));
    writeFileSync(path.join(generated.worktreePath, 'node_modules', 'cache.txt'), 'generated\n');
    assert.deepEqual(cleanupTaskWorktree(generated.task, fixtureInspector), { status: 'removed' });

    writeFileSync(path.join(valuable.worktreePath, '.env'), 'do-not-delete\n');
    const blocked = cleanupTaskWorktree(valuable.task, fixtureInspector);
    assert.equal(blocked.status, 'blocked');
    assert.match(blocked.status === 'blocked' ? blocked.reason : '', /non-disposable ignored/i);
    assert.equal(existsSync(path.join(valuable.worktreePath, '.env')), true);
  } finally {
    generated.dispose();
    valuable.dispose();
  }
});

test('process-use inspection fails closed when the platform or process table cannot be verified', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agentboard-process-check-'));
  try {
    assert.equal(inspectWorktreeProcessUse(root, 'darwin'), 'unknown');
    assert.equal(inspectWorktreeProcessUse(root, 'linux', path.join(root, 'missing-proc')), 'unknown');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('process-use inspection detects executable and file descriptor references', () => {
  const f = fixture();
  try {
    for (const reference of ['exe', path.join('fd', '3')]) {
      const procRoot = mkdtempSync(path.join(os.tmpdir(), 'agentboard-proc-reference-'));
      try {
        mkdirSync(path.join(procRoot, '123', 'fd'), { recursive: true });
        symlinkSync(f.repoPath, path.join(procRoot, '123', 'cwd'), 'dir');
        symlinkSync(reference === 'exe' ? path.join(f.worktreePath, 'README.md') : process.execPath,
          path.join(procRoot, '123', 'exe'), 'file');
        if (reference !== 'exe') {
          symlinkSync(path.join(f.worktreePath, 'README.md'), path.join(procRoot, '123', reference), 'file');
        }
        assert.equal(inspectWorktreeProcessUse(f.worktreePath, 'linux', procRoot), 'in-use');
      } finally {
        rmSync(procRoot, { recursive: true, force: true });
      }
    }
  } finally {
    f.dispose();
  }
});

test('cleanup blocks while a process is using the worktree', () => {
  const f = fixture();
  const procRoot = mkdtempSync(path.join(os.tmpdir(), 'agentboard-proc-in-use-'));
  mkdirSync(path.join(procRoot, '123', 'fd'), { recursive: true });
  symlinkSync(f.worktreePath, path.join(procRoot, '123', 'cwd'), 'dir');
  try {
    const result = cleanupTaskWorktree(f.task, (root) => inspectWorktreeProcessUse(root, 'linux', procRoot));
    assert.equal(result.status, 'blocked');
    assert.match(result.status === 'blocked' ? result.reason : '', /running process/i);
    assert.equal(existsSync(f.worktreePath), true);
  } finally {
    rmSync(procRoot, { recursive: true, force: true });
    f.dispose();
  }
});

test('cleanup retains worktree when process inspection is unknown', () => {
  const f = fixture();
  try {
    const result = cleanupTaskWorktree(f.task, (root) => inspectWorktreeProcessUse(root, 'linux', path.join(f.repoPath, 'missing-proc')));
    assert.equal(result.status, 'blocked');
    assert.match(result.status === 'blocked' ? result.reason : '', /Could not verify that no process/i);
    assert.equal(existsSync(f.worktreePath), true);
  } finally {
    f.dispose();
  }
});

test('missing worktree is idempotent and can be cleared from persisted task state', () => {
  const f = fixture();
  try {
    git(['worktree', 'remove', f.worktreePath], f.repoPath);
    const result = cleanupTaskWorktree(f.task, fixtureInspector);
    assert.deepEqual(result, { status: 'missing' });
  } finally {
    f.dispose();
  }
});

test('startup reconciliation removes clean terminal worktrees and clears persisted paths', async () => {
  const f = fixture();
  const updates: Array<Partial<Task>> = [];
  const repo = {
    update: async (_id: string, update: Partial<Task>) => {
      updates.push(update);
      return { ...f.task, ...update };
    },
  } as unknown as TaskRepository;
  try {
    const report = await reconcileManagedWorktrees([f.task], [f.repoPath], repo, fixtureInspector);
    assert.deepEqual(report, { removed: [f.worktreePath], missing: [], blocked: [] });
    assert.deepEqual(updates, [{ worktreePath: undefined }]);
    assert.equal(existsSync(f.worktreePath), false);
  } finally {
    f.dispose();
  }
});

test('startup reconciliation retains review and dirty terminal worktrees', async () => {
  const review = fixture();
  const dirty = fixture();
  dirty.task.archived = true;
  writeFileSync(path.join(dirty.worktreePath, 'uncommitted.txt'), 'keep me\n');
  const repo = { update: async () => { throw new Error('must not update retained worktrees'); } } as unknown as TaskRepository;
  try {
    const report = await reconcileManagedWorktrees([
      { ...review.task, columnId: 'review' },
      dirty.task,
    ], [review.repoPath, dirty.repoPath], repo, fixtureInspector);
    assert.deepEqual(report.removed, []);
    assert.deepEqual(report.missing, []);
    assert.equal(report.blocked.length, 1);
    assert.equal(report.blocked[0]?.path, dirty.worktreePath);
    assert.equal(existsSync(review.worktreePath), true);
    assert.equal(existsSync(dirty.worktreePath), true);
  } finally {
    review.dispose();
    dirty.dispose();
  }
});

test('startup reconciliation removes only clean unreferenced Board worktrees', async () => {
  const clean = fixture();
  const dirty = fixture();
  writeFileSync(path.join(dirty.worktreePath, 'uncommitted.txt'), 'keep me\n');
  const repo = { update: async () => { throw new Error('orphan cleanup must not update task state'); } } as unknown as TaskRepository;
  try {
    const report = await reconcileManagedWorktrees([], [clean.repoPath, dirty.repoPath], repo, fixtureInspector);
    assert.deepEqual(report.removed, [clean.worktreePath]);
    assert.equal(report.blocked.length, 1);
    assert.equal(report.blocked[0]?.path, dirty.worktreePath);
    assert.equal(existsSync(clean.worktreePath), false);
    assert.equal(existsSync(dirty.worktreePath), true);
  } finally {
    clean.dispose();
    dirty.dispose();
  }
});
