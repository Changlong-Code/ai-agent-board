import { Router } from 'express';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const HOME = path.resolve(process.env.AGENTBOARD_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AI-Agent-Board', 'original-basic'));
const STATE = path.join(HOME, 'updates', 'state.json');
const LOCK = path.join(HOME, 'updates', 'installer.lock');
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, stdio: 'pipe', timeout: 15000 }).toString().trim();
}
function githubRemote(): string | undefined {
  const names = git('remote').split(/\r?\n/).filter(Boolean);
  return ['source', 'origin', ...names].find(name => names.includes(name) &&
    /github\.com[:/]/i.test(git('remote', 'get-url', name)));
}
function readState(): unknown {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { phase: 'idle' }; throw err; }
}
export function createSelfUpdateRouter(): Router {
  const router = Router();
  router.get('/status', (_req, res) => {
    try {
      const branch = git('branch', '--show-current');
      const current = git('rev-parse', 'HEAD');
      const dirty = Boolean(git('status', '--porcelain'));
      const remote = githubRemote();
      const busy = fs.existsSync(LOCK);
      res.json({ branch, current, dirty, remote: remote ?? null, busy,
        supported: process.platform === 'win32', state: readState() });
    } catch (e) {
      res.status(409).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
  router.post('/install', (_req, res) => {
    if (process.env.AGENTBOARD_WINDOWS_BASIC !== '1' || process.platform !== 'win32') {
      res.status(403).json({ error: 'Local Windows Board only' }); return;
    }
    try {
      if (fs.existsSync(LOCK)) { res.status(409).json({ error: 'Updater already running' }); return; }
      if (git('status', '--porcelain')) { res.status(409).json({ error: 'Uncommitted code changes; save them first' }); return; }
      if (!['main', 'windows-m1'].includes(git('branch', '--show-current')) || !githubRemote()) {
        res.status(409).json({ error: 'No supported GitHub branch and remote' }); return;
      }
      const script = path.join(ROOT, 'windows', 'self-update.cjs');
      if (!fs.existsSync(script)) { res.status(404).json({ error: 'Updater not installed' }); return; }
      const job = spawn(process.execPath, [script, '--install'], {
        cwd: ROOT, env: { ...process.env, ORIGINAL_BOARD_HOME: HOME },
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      job.unref();
      res.status(202).json({ accepted: true, message: 'Update preparation started. The current Board remains running until the new build is ready.' });
    } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  return router;
}
