'use strict';
// Runs outside the Board server. Never update tracked code while the launcher is running.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const HOME = path.resolve(process.env.AGENTBOARD_HOME || process.env.ORIGINAL_BOARD_HOME ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AI-Agent-Board', 'original-basic'));
const UPDATES = path.join(HOME, 'updates');
const STATE = path.join(UPDATES, 'state.json');
const LOCK = path.join(UPDATES, 'installer.lock');
const STOP = path.join(HOME, 'update-stop-request.json');
const ACK = path.join(HOME, 'update-stop-ack.json');
const LOG = path.join(UPDATES, 'install.log');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString();
let currentState = {};

function status(phase, extra = {}) {
  currentState = { ...currentState, ...extra, phase, updatedAt: stamp() };
  fs.mkdirSync(UPDATES, { recursive: true });
  const tmp = STATE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(currentState, null, 2), 'utf8');
  fs.renameSync(tmp, STATE);
  process.stdout.write('[update] ' + phase + '\n');
}
function log(text) {
  fs.mkdirSync(UPDATES, { recursive: true });
  fs.appendFileSync(LOG, stamp() + ' ' + text + '\n');
}
function run(program, args, cwd = ROOT, timeout = 300000) {
  const win = process.platform === 'win32' && program === 'npm';
  const exe = win ? 'npm.cmd' : program;
  const result = spawnSync(exe, args, { cwd, encoding: 'utf8', timeout, windowsHide: true, shell: win });
  const output = (result.stdout || '') + (result.stderr || '');
  if (output) log(program + ' ' + args.join(' ') + ': ' + output.slice(-12000));
  if (result.error || result.status !== 0) throw new Error(
    (result.error?.message || output || program + ' exit ' + result.status).trim().slice(-1000));
  return (result.stdout || '').trim();
}
const git = (...args) => run('git', args);
function remoteName() {
  const names = git('remote').split(/\r?\n/).filter(Boolean);
  for (const name of ['source', 'origin', ...names]) {
    if (!names.includes(name)) continue;
    const url = git('remote', 'get-url', name);
    if (/github\.com[:/]/i.test(url)) return name;
  }
  throw new Error('GitHub remote not found');
}
function cleanProject() {
  if (git('status', '--porcelain')) throw new Error('Local changes detected. Commit or stash before updating.');
  const branch = git('branch', '--show-current');
  if (!['main', 'windows-m1'].includes(branch)) throw new Error('Update only supports main or windows-m1.');
  return { branch, old: git('rev-parse', 'HEAD'), remote: remoteName() };
}
function getPorts() {
  const p = path.join(ROOT, 'ORIGINAL_PORTS.json');
  const settings = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  const board = Number(process.env.ORIGINAL_BOARD_PORT || settings.boardPort || 8776);
  const api = Number(process.env.ORIGINAL_API_PORT || settings.apiPort || 8777);
  if (![board, api].every(n => Number.isInteger(n) && n >= 1024 && n <= 65535) || board === api)
    throw new Error('Invalid Board ports');
  return { board, api };
}
function get(url) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1600, () => { req.destroy(); resolve(false); });
  });
}
async function waitForUnlocked(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!fs.existsSync(path.join(HOME, 'original.lock'))) return;
    await sleep(500);
  }
  throw new Error('Board did not stop safely. No changes applied.');
}
async function snapshotDatabase(id) {
  const original = path.join(HOME, 'data', 'agentboard.db');
  if (!fs.existsSync(original)) return null;
  const backup = path.join(UPDATES, 'db-before-' + id + '.db');
  const Database = createRequire(path.join(ROOT, 'packages/server/package.json'))('better-sqlite3');
  const db = new Database(original, { readonly: true, fileMustExist: true });
  try { await db.backup(backup); }
  finally { db.close(); }
  return backup;
}
function restoreDatabase(snapshot) {
  if (!snapshot) return;
  const file = path.join(HOME, 'data', 'agentboard.db');
  fs.copyFileSync(snapshot, file);
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(file + suffix); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
function builds(cwd) {
  run('npm', ['ci'], cwd, 600000);
  for (const target of ['build:shared', 'build:client', 'build:server']) {
    run('npm', ['run', target], cwd, 360000);
  }
}
function launch() {
  const fd = fs.openSync(LOG, 'a');
  const env = {
    ...process.env, ORIGINAL_BOARD_HOME: HOME, ORIGINAL_NO_BROWSER: '1',
    ORIGINAL_ENABLE_AGENT_EXECUTION: process.env.AGENTBOARD_ENABLE_AGENT_EXECUTION === '1' ? '1' : '0'
  };
  const child = spawn(process.execPath, [path.join(ROOT, 'windows', 'original-start.cjs')], {
    cwd: ROOT, env, detached: true, stdio: ['ignore', fd, fd, 'ipc'], windowsHide: true,
  });
  fs.closeSync(fd);
  return child;
}
async function launchAndCheck() {
  const child = launch();
  const ports = getPorts();
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (await get('http://127.0.0.1:' + ports.api + '/api/health') &&
        await get('http://127.0.0.1:' + ports.board + '/')) { ready = true; break; }
    await sleep(1000);
  }
  if (!ready) {
    if (child.connected) child.send({ type: 'original-board-stop' });
    await waitForUnlocked(45000);
    if (child.connected) child.disconnect();
    throw new Error('Restart health checks failed');
  }
  if (child.connected) child.disconnect();
  child.unref();
}
async function install() {
  if (process.platform !== 'win32') throw new Error('Windows-only update requested');
  fs.mkdirSync(UPDATES, { recursive: true });
  let handle;
  try { handle = fs.openSync(LOCK, 'wx'); fs.writeFileSync(handle, String(process.pid)); }
  catch { throw new Error('Another updater is already running. Check ' + LOCK); }
  fs.closeSync(handle);
  const id = Date.now().toString();
  let staging = null, switched = false, snapshot = null, prior = null;
  try {
    const state = cleanProject();
    prior = state.old;
    status('checking', { id, branch: state.branch, from: prior, remote: state.remote });
    git('fetch', state.remote, state.branch);
    const target = git('rev-parse', 'FETCH_HEAD');
    if (git('merge-base', prior, target) !== prior) throw new Error('Branch diverged: fast-forward unavailable.');
    if (prior === target) { status('up-to-date', { to: target }); return; }
    status('preparing', { to: target });
    staging = path.join(UPDATES, 'stage-' + id);
    git('worktree', 'add', '--detach', staging, target);
    builds(staging);
    status('awaiting-stop');
    if (fs.existsSync(STOP) || fs.existsSync(ACK)) throw new Error('Old update stop marker exists; check and recover it before retrying.');
    fs.writeFileSync(STOP, JSON.stringify({ id, root: ROOT, phase: 'prepared', requestedAt: Date.now() }), { flag: 'wx' });
    const ackDeadline = Date.now() + 15000;
    while (Date.now() < ackDeadline) {
      if (fs.existsSync(ACK)) {
        const ack = JSON.parse(fs.readFileSync(ACK, 'utf8'));
        if (ack.id === id) break;
      }
      await sleep(500);
    }
    if (!fs.existsSync(ACK) || JSON.parse(fs.readFileSync(ACK, 'utf8')).id !== id)
      throw new Error('Board launcher did not acknowledge the stop request within 15 seconds. No code changes applied.');
    await waitForUnlocked(30000);
    // Remove the stop request before relaunching. Otherwise the new launcher
    // reads the stale request and shuts itself down immediately.
    const stopRequest = JSON.parse(fs.readFileSync(STOP, 'utf8'));
    if (stopRequest.id !== id || stopRequest.root !== ROOT) throw new Error('Stop request ownership changed.');
    fs.unlinkSync(STOP);
    if (fs.existsSync(ACK)) fs.unlinkSync(ACK);
    // Verify the repository has not been changed by an unrelated process.
    const fresh = cleanProject();
    if (fresh.old !== prior || fresh.branch !== state.branch) throw new Error('Repository changed while preparing update.');
    snapshot = await snapshotDatabase(id);
    status('installing', { dbBackup: snapshot });
    git('merge', '--ff-only', target);
    switched = true;
    builds(ROOT);
    status('restarting');
    await launchAndCheck();
    status('complete');
  } catch (err) {
    log('INSTALL FAILURE: ' + String(err));
    if (switched && prior) {
      try {
        status('rolling-back', { error: String(err) });
        // The repo was verified clean and the only tracked changes were applied by this updater.
        git('reset', '--hard', prior);
        builds(ROOT);
        restoreDatabase(snapshot);
        await launchAndCheck();
        status('rolled-back', { error: String(err) });
      } catch (rollback) {
        log('ROLLBACK FAILURE: ' + String(rollback));
        status('manual-recovery-required', { error: String(err), rollbackError: String(rollback) });
      }
    } else {
      status('failed', { error: String(err) });
    }
    process.exitCode = 1;
  } finally {
    try { if (staging) git('worktree', 'remove', '--force', staging); } catch (e) { log('stage cleanup failed: ' + String(e)); }
    try { if (fs.existsSync(STOP) && JSON.parse(fs.readFileSync(STOP, 'utf8')).id === id) fs.unlinkSync(STOP); } catch (e) { log('stop request cleanup failed: ' + String(e)); }
    try { if (fs.existsSync(ACK) && JSON.parse(fs.readFileSync(ACK, 'utf8')).id === id) fs.unlinkSync(ACK); } catch {}
    try { fs.unlinkSync(LOCK); } catch {}
  }
}
if (require.main === module) {
  if (process.argv.includes('--install')) install().catch(e => { log(String(e)); status('failed', {error:String(e)}); process.exitCode=1; });
  else process.stderr.write('Launch this updater using the Board Settings > Install update button.\n');
}
module.exports = { cleanProject, getPorts };
