'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const log = path.join(root, 'data', 'self-update.log');
function run(cmd, args, cwd=root) {
  const r = spawnSync(cmd, args, { cwd, shell: process.platform === 'win32', encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error((r.stderr || r.stdout || r.error?.message || cmd).trim());
  return r.stdout.trim();
}
function git(...args) { return run('git', args); }
function main() {
  if (process.platform !== 'win32') throw new Error('This updater is for Windows only');
  if (git('status', '--porcelain')) throw new Error('Local changes found. Commit or stash them before updating.');
  const branch = git('branch', '--show-current');
  if (branch !== 'main' && branch !== 'windows-m1') throw new Error('Switch to main or windows-m1 before updating.');
  const remotes = git('remote').split(/\r?\n/);
  const remote = ['source', 'origin'].find(r => remotes.includes(r) && /github\.com[:/]/i.test(git('remote','get-url',r)));
  if (!remote) throw new Error('No GitHub remote configured.');
  git('fetch', remote, branch);
  const current = git('rev-parse', 'HEAD');
  const target = git('rev-parse', remote + '/' + branch);
  const common = git('merge-base', current, target);
  if (common !== current) throw new Error('Branch diverged. Resolve it manually.');
  if (current === target) { process.stdout.write('Already up to date.\n'); return; }
  // Never update the currently running application: caller should shut Board down first.
  if (!process.argv.includes('--board-stopped')) {
    process.stdout.write('Update available: ' + current.slice(0,7) + ' -> ' + target.slice(0,7) + '\n');
    process.stdout.write('Close AI Agent Board, then run: node windows\\self-update.cjs --board-stopped\n');
    return;
  }
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, new Date().toISOString() + ' updating ' + current + ' -> ' + target + '\n');
  // Preserve a recovery ref, then update only with fast-forward. Never hard-reset user data.
  git('branch', 'backup/pre-update-' + Date.now(), current);
  git('merge', '--ff-only', remote + '/' + branch);
  try {
    run('npm', ['ci', '--ignore-scripts']);
    run('npm', ['run', 'build:shared']);
    run('npm', ['run', 'build:client']);
    run('npm', ['run', 'build:server']);
  } catch (error) {
    fs.appendFileSync(log, 'Build failed: ' + error.message + '\n');
    throw new Error('Build failed. Previous commit preserved in backup/pre-update-* branch. ' + error.message);
  }
  fs.appendFileSync(log, 'Build complete. Restart Board with Start-Original-Board.cmd.\n');
  process.stdout.write('Update completed. Start Board normally.\n');
}
try { main(); } catch (e) { process.stderr.write('Update stopped: ' + e.message + '\n'); process.exitCode = 1; }
