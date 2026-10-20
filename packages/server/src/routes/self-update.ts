import { Router } from 'express';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function createSelfUpdateRouter(): Router {
  const router = Router();
  // Read-only preflight. Git fetch/update and process termination are intentionally not performed by the live server.
  router.get('/status', (_req, res) => {
    const cwd = process.cwd();
    const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 10000 }).toString().trim();
    try {
      const branch = git('branch', '--show-current');
      const current = git('rev-parse', '--short', 'HEAD');
      const dirty = Boolean(git('status', '--porcelain'));
      const remotes = git('remote').split(/\r?\n/);
      const remote = ['source', 'origin'].find(name => remotes.includes(name) &&
        /github\.com[:/]/i.test(git('remote', 'get-url', name)));
      res.json({ branch, current, dirty, remote: remote || null, supported: process.platform === 'win32',
        updateCommand: 'node windows\\self-update.cjs', restartCommand: 'Start-Original-Board.cmd',
        note: 'Close Board before applying update; the updater runs outside the server.' });
    } catch (e) {
      res.status(409).json({ error: 'Update preflight failed', detail: e instanceof Error ? e.message : 'unknown' });
    }
  });
  return router;
}
