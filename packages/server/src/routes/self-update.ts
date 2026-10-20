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

/**
 * Keep all Board updater launching in one place: Settings and task PR actions
 * must obey exactly the same safety checks.
 */
export function boardUpdateReadiness(): { branch: string; remote: string; root: string; current: string } {
  if (process.env.AGENTBOARD_WINDOWS_BASIC !== '1' || process.platform !== 'win32') {
    throw new Error('Local Windows Board only');
  }
  if (fs.existsSync(LOCK)) throw new Error('Updater already running');
  if (git('status', '--porcelain')) throw new Error('Uncommitted Board code changes; save them first');
  const branch = git('branch', '--show-current');
  const remote = githubRemote();
  if (!['main', 'windows-m1'].includes(branch) || !remote) {
    throw new Error('Board is not on a supported GitHub branch');
  }
  const script = path.join(ROOT, 'windows', 'self-update.cjs');
  if (!fs.existsSync(script)) throw new Error('Board updater not installed');
  return { branch, remote, root: ROOT, current: git('rev-parse', 'HEAD') };
}

export function launchBoardUpdate(): { accepted: true; message: string } {
  boardUpdateReadiness();
  const script = path.join(ROOT, 'windows', 'self-update.cjs');
  const job = spawn(process.execPath, [script, '--install'], {
    cwd: ROOT, env: { ...process.env, ORIGINAL_BOARD_HOME: HOME },
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  job.unref();
  return { accepted: true, message: 'Update preparation started. Board remains available until build finishes.' };
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
    try { res.status(202).json(launchBoardUpdate()); }
    catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  return router;
}
