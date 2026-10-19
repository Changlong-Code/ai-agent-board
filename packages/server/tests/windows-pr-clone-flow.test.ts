import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Task } from '../src/types.js';
import { cloneRepoAsync } from '../src/routes/helpers.js';
import { commitManagedWorktreeChanges } from '../src/services/agent-manager.js';

function tempDir(t: { after: (fn: () => void) => void }, prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
}

function initRepo(t: { after: (fn: () => void) => void }): string {
  const repo = tempDir(t, 'agentboard-pr-repo-');
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'Test User']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['branch', '-M', 'main']);
  return repo;
}

test('cloneRepoAsync clones a locally accessible git repository', async (t) => {
  const source = initRepo(t);
  const parent = tempDir(t, 'agentboard-clone-target-');
  const target = path.join(parent, 'clone');

  await cloneRepoAsync(source, target, 10_000);

  assert.equal(fs.readFileSync(path.join(target, 'README.md'), 'utf8'), 'base\n');
  assert.equal(git(target, ['branch', '--show-current']), 'main');
});

test('commitManagedWorktreeChanges commits dirty changes only in a task worktree', (t) => {
  const repo = initRepo(t);
  const worktreeParent = tempDir(t, 'agentboard-worktree-parent-');
  const worktree = path.join(worktreeParent, 'task');
  git(repo, ['worktree', 'add', '-b', 'task/test', worktree, 'main']);

  fs.appendFileSync(path.join(worktree, 'README.md'), 'agent change\n');

  const task = {
    id: 'task-1',
    title: 'README test',
    repoPath: repo,
    worktreePath: worktree,
    branchName: 'task/test',
  } as Task;

  assert.equal(commitManagedWorktreeChanges(task), true);
  assert.equal(git(worktree, ['status', '--porcelain']), '');
  assert.equal(git(worktree, ['rev-list', '--count', 'main..HEAD']), '1');
  assert.match(git(worktree, ['log', '-1', '--pretty=%s']), /^Agent Board: README test$/);
});

test('commitManagedWorktreeChanges does not auto-commit a main checkout', (t) => {
  const repo = initRepo(t);
  fs.appendFileSync(path.join(repo, 'README.md'), 'user change\n');

  const task = {
    id: 'task-2',
    title: 'Do not commit main',
    repoPath: repo,
    worktreePath: repo,
    branchName: 'main',
  } as Task;

  assert.equal(commitManagedWorktreeChanges(task), false);
  assert.match(git(repo, ['status', '--porcelain']), /README\.md/);
});
