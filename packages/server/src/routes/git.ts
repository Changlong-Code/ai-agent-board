import { assertBoardUpdateAuthorization } from '../services/board-update-authorization.js';
import { boardUpdateReadiness, launchBoardUpdate } from './self-update.js';
import { findGithubRemote } from '../services/github-pr.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGithubPr, mergeGithubPr, syncMergedGithubPr } from '../services/github-pr.js';
import { Router, Request, Response } from 'express';
import { execFileSync } from 'child_process';
import type { TaskRepository } from '../repositories/types.js';
import type { AgentManager } from '../services/agent-manager.js';
import { asyncHandler, paramId, broadcastTaskUpdate } from './helpers.js';

export function createGitRouter(repo: TaskRepository, agentManager: AgentManager): Router {
  const router = Router();

  // GET /api/tasks/:id/git-info — check if repo has a remote
  router.get('/:id/git-info', asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
    if (!task) { res.status(404).json({ error: 'task not found' }); return; }
    if (!task.repoPath) { res.json({ hasRemote: false }); return; }

    try {
      const remotes = execFileSync('git', ['remote'], { cwd: task.repoPath, stdio: 'pipe' }).toString().split(/\r?\n/).filter(Boolean);
      const hasRemote = remotes.some(name => {
        try {
          const url = execFileSync('git', ['remote', 'get-url', name], { cwd: task.repoPath, stdio: 'pipe' }).toString().trim();
          return /github\.com[:/]/i.test(url);
        } catch { return false; }
      });
      res.json({ hasRemote });
    } catch {
      res.json({ hasRemote: false });
    }
  }));

  // POST /api/tasks/:id/create-pr — create a PR from the worktree branch
  router.post('/:id/create-pr', asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (!task.branchName || !task.repoPath) {
      res.status(400).json({ error: 'task has no branch or repo configured' });
      return;
    }
    try {
      const result = agentManager.createPR(task);
      // Keep the worktree until the user explicitly cleans it up.
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create PR' });
    }
  }));

  router.get('/:id/github-pr', asyncHandler(async (req: Request, res: Response) => {
    const task = await repo.getById(paramId(req));
    if (!task) { res.status(404).json({ error: 'task not found' }); return; }
    if (!task.repoPath || !task.branchName) { res.json({ pr: null }); return; }
    try { res.json({ pr: getGithubPr(task.repoPath, task.branchName, task.baseBranch || 'main') }); }
    catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));

  router.post('/:id/merge-github-pr', asyncHandler(async (req: Request, res: Response) => {
    const task = await repo.getById(paramId(req));
    if (!task) { res.status(404).json({ error: 'task not found' }); return; }
    if (!task.repoPath || !task.branchName) {
      res.status(400).json({ error: 'task has no GitHub branch' }); return;
    }
    if (agentManager.isRunning(task.id)) { res.status(409).json({ error: 'agent is running' }); return; }
    try {
      const pr = mergeGithubPr(task.repoPath, task.branchName, task.baseBranch || 'main', req.body?.confirmed === true);
      res.json({ pr });
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));

  router.post('/:id/sync-merged-pr', asyncHandler(async (req: Request, res: Response) => {
    const task = await repo.getById(paramId(req));
    if (!task) { res.status(404).json({ error: 'task not found' }); return; }
    if (!task.repoPath || !task.branchName) { res.status(400).json({ error: 'task has no repository or branch' }); return; }
    if (agentManager.isRunning(task.id)) { res.status(409).json({ error: 'Stop the agent before synchronizing.' }); return; }
    const boardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
    const localPath = path.resolve(task.repoPath);
    if (process.platform === 'win32' ? boardRoot.toLowerCase() === localPath.toLowerCase() : boardRoot === localPath) {
      res.status(409).json({ error: 'Cannot synchronize the running Board repository. Use Self Update for Board itself.' }); return;
    }
    try {
      const result = syncMergedGithubPr(task.repoPath, task.branchName, task.baseBranch || 'main', req.body?.confirmed === true);
      res.json(result);
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));

  const boardUpdateEligible = async (id: string) => {
    const task = await repo.getById(id);
    if (!task || !task.repoPath || !task.branchName) throw new Error('Task has no valid Git repository and branch');
    if (agentManager.isRunning(task.id)) throw new Error('Agent is still running');
    const ready = boardUpdateReadiness();
    const pr = getGithubPr(task.repoPath, task.branchName, task.baseBranch || 'main');
    assertBoardUpdateAuthorization({
      taskBranch: task.branchName, taskBase: task.baseBranch || 'main',
      boardBranch: ready.branch, boardRepository: findGithubRemote(ready.root).repository,
      taskRepository: findGithubRemote(task.repoPath).repository, pr,
    });
    return { ready, pr };
  };

  router.get('/:id/board-update-eligibility', asyncHandler(async (req: Request, res: Response) => {
    try {
      const { ready, pr } = await boardUpdateEligible(paramId(req));
      res.json({ eligible: true, branch: ready.branch, prUrl: pr.url });
    } catch (error) {
      res.json({ eligible: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }));

  router.post('/:id/install-board-update', asyncHandler(async (req: Request, res: Response) => {
    if (req.body?.confirmed !== true) { res.status(400).json({ error: 'Explicit update confirmation required' }); return; }
    try {
      await boardUpdateEligible(paramId(req));
      res.status(202).json(launchBoardUpdate());
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
  }));

  // POST /api/tasks/:id/cleanup-worktree — remove worktree after done
  router.post('/:id/cleanup-worktree', asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (!task.worktreePath) {
      res.json({ success: true, status: 'missing' });
      return;
    }
    if (agentManager.isRunning(id)) {
      res.status(409).json({ error: 'cannot clean up a worktree while its agent is running' });
      return;
    }
    const cleanup = agentManager.removeWorktree(task);
    if (cleanup.status === 'blocked') {
      res.status(409).json({ error: cleanup.reason });
      return;
    }
    const updated = await repo.update(id, { worktreePath: undefined });
    if (updated) broadcastTaskUpdate(updated);
    res.json({ success: true, status: cleanup.status });
  }));

  // POST /api/tasks/:id/merge-local — merge worktree branch into base branch locally
  router.post('/:id/merge-local', asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (!task.branchName || !task.repoPath) {
      res.status(400).json({ error: 'task has no branch or repo configured' });
      return;
    }
    try {
      const result = await agentManager.mergeLocal(task);
      // Clean up worktree after successful merge — branch is merged, directory is no longer needed
      if (task.worktreePath) {
        const cleanup = agentManager.removeWorktree(task);
        if (cleanup.status !== 'blocked') await repo.update(id, { worktreePath: undefined });
      }
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to merge' });
    }
  }));

  return router;
}
