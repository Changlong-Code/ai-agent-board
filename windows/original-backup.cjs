'use strict';
// Stopped-instance snapshots only. Project directories and credential stores are never traversed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { lockHome } = require('./original-start.cjs');
const ROOT = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(ROOT, 'packages/server/package.json'));
function defaultHome(env = process.env) {
  return path.resolve(env.ORIGINAL_BOARD_HOME || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AI-Agent-Board', 'original-basic'));
}
function assertSafePath(file) {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) || fs.lstatSync(path.dirname(current)).isDirectory()) {
      let stat; try { stat = fs.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') break; throw e; }
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${current}`);
    }
  }
}
function assertNoPendingRestore(home) {
  if (fs.existsSync(path.join(home, 'restore-in-progress.json'))) throw new Error('An interrupted restore requires manual recovery: inspect restore-in-progress.json before starting or changing data.');
}
function allowed(relative) {
  return typeof relative === 'string' && !relative.includes('\\') && !relative.includes('\0') &&
    !relative.split('/').some(p => !p || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) &&
    (relative === 'config.json' || relative === 'data/agentboard.db' || relative.startsWith('data/uploads/'));
}
function filesUnder(dir, prefix = '') {
  assertSafePath(dir);
  if (!fs.existsSync(dir)) return [];
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name); const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Unsupported file: ${file}`);
    if (stat.isDirectory()) output.push(...filesUnder(file, rel)); else output.push(rel);
  }
  return output.sort();
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function validateConfigFile(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || Array.isArray(parsed) || Object.keys(parsed).some(k => k !== 'cloneRoot') || typeof parsed.cloneRoot !== 'string' || !parsed.cloneRoot.trim() || parsed.cloneRoot.includes('\0')) throw new Error('Unsupported config.json; snapshot refused.');
}
function integrity(Database, file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try { const result = db.pragma('integrity_check'); if (result.length !== 1 || Object.values(result[0])[0] !== 'ok') throw new Error('SQLite integrity check failed.'); }
  finally { db.close(); }
}
async function snapshotUnlocked(home, Database) {
  assertSafePath(home);
  const snapshots = path.join(home, 'snapshots'); assertSafePath(snapshots); fs.mkdirSync(snapshots, { recursive: true });
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
  const stage = path.join(snapshots, `.staging-${id}`); fs.mkdirSync(stage);
  try {
    const config = path.join(home, 'config.json'); assertSafePath(config);
    if (fs.existsSync(config)) {
      validateConfigFile(config);
      fs.copyFileSync(config, path.join(stage, 'config.json'), fs.constants.COPYFILE_EXCL);
    }
    const database = path.join(home, 'data/agentboard.db'); assertSafePath(database);
    for (const suffix of ['-wal', '-shm']) assertSafePath(database + suffix);
    if (fs.existsSync(database)) {
      integrity(Database, database);
      fs.mkdirSync(path.join(stage, 'data'), { recursive: true });
      const db = new Database(database, { readonly: true, fileMustExist: true });
      try { await db.backup(path.join(stage, 'data/agentboard.db')); } finally { db.close(); }
      const copy = new Database(path.join(stage, 'data/agentboard.db'));
      try { copy.pragma('journal_mode = DELETE'); } finally { copy.close(); }
      integrity(Database, path.join(stage, 'data/agentboard.db'));
    }
    const uploads = path.join(home, 'data/uploads');
    for (const relative of filesUnder(uploads)) {
      const target = path.join(stage, 'data/uploads', relative); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(uploads, relative), target, fs.constants.COPYFILE_EXCL);
    }
    const files = filesUnder(stage).map(relative => {
      if (!allowed(relative)) throw new Error('Unexpected snapshot path.');
      const file = path.join(stage, relative); return { path: relative, bytes: fs.statSync(file).size, sha256: hash(file) };
    });
    const manifest = { formatVersion: 1, id, createdAt: new Date().toISOString(), fileCount: files.length, totalBytes: files.reduce((n, f) => n + f.bytes, 0), files };
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    validateSnapshot(stage, Database);
    const destination = path.join(snapshots, id); fs.renameSync(stage, destination);
    return { id, destination, manifest };
  } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
}
async function backup(home = defaultHome(), Database = serverRequire('better-sqlite3')) {
  assertSafePath(home); const unlock = lockHome(home);
  try { assertNoPendingRestore(home); return await snapshotUnlocked(home, Database); } finally { unlock(); }
}
function validateSnapshot(source, Database) {
  assertSafePath(source);
  const actual = filesUnder(source);
  if (!actual.includes('manifest.json')) throw new Error('Missing manifest.json.');
  const m = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (!m || Object.keys(m).some(k => !['formatVersion', 'id', 'createdAt', 'fileCount', 'totalBytes', 'files'].includes(k)) || m.formatVersion !== 1 || typeof m.id !== 'string' || !/^[0-9TZ-]+-[0-9a-f-]{36}$/.test(m.id) || !Array.isArray(m.files) || m.fileCount !== m.files.length) throw new Error('Invalid snapshot manifest.');
  const seen = new Set(); let bytes = 0;
  for (const file of m.files) {
    if (!file || Object.keys(file).some(k => !['path', 'bytes', 'sha256'].includes(k)) || !allowed(file.path) || seen.has(file.path.toLowerCase()) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('Invalid snapshot file entry.');
    seen.add(file.path.toLowerCase()); const full = path.join(source, file.path);
    if (!actual.includes(file.path) || fs.statSync(full).size !== file.bytes || hash(full) !== file.sha256) throw new Error(`Snapshot hash or size mismatch: ${file.path}`);
    bytes += file.bytes;
  }
  if (m.totalBytes !== bytes || actual.length !== m.files.length + 1) throw new Error('Snapshot contains extra files or invalid counts.');
  if (seen.has('config.json')) validateConfigFile(path.join(source, 'config.json'));
  if (seen.has('data/agentboard.db')) {
    const file = path.join(source, 'data/agentboard.db');
    const header = Buffer.alloc(20); const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, header, 0, 20, 0); } finally { fs.closeSync(fd); }
    if (header[18] !== 1 || header[19] !== 1) throw new Error('Snapshot SQLite must be standalone rollback journal format.');
    integrity(Database, file);
  }
  return m;
}
async function previewRestore(home, source, Database = serverRequire('better-sqlite3')) {
  assertSafePath(home); const unlock = lockHome(home);
  try {
    const manifest = validateSnapshot(path.resolve(source), Database);
    return { mode: 'preview-only', snapshotId: manifest.id, home, files: manifest.files.map(f => f.path), message: 'No files restored. To apply, pass --apply --confirm with this exact snapshot ID.' };
  } finally { unlock(); }
}
async function applyRestore(home, source, confirmation, Database = serverRequire('better-sqlite3'), options = {}) {
  assertSafePath(home); const unlock = lockHome(home);
  let recovery;
  try {
    assertNoPendingRestore(home);
    source = path.resolve(source);
    const manifest = validateSnapshot(source, Database);
    if (confirmation !== manifest.id) throw new Error('Confirmation must exactly match snapshot ID.');
    // Refuse before mutation if existing known data cannot be backed up and checked.
    const safety = await snapshotUnlocked(home, Database);
    const recoveryRoot = path.join(home, 'restore-recovery'); assertSafePath(recoveryRoot);
    fs.mkdirSync(recoveryRoot, { recursive: true });
    recovery = path.join(recoveryRoot, crypto.randomUUID()); fs.mkdirSync(recovery);
    const stage = path.join(recovery, 'staged'); fs.mkdirSync(stage);
    for (const entry of manifest.files) {
      const target = path.join(stage, entry.path); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(source, entry.path), target, fs.constants.COPYFILE_EXCL);
      if (hash(target) !== entry.sha256) throw new Error('Snapshot changed while staging.');
    }
    const marker = path.join(home, 'restore-in-progress.json');
    const markerFd = fs.openSync(marker, 'wx');
    try { fs.writeFileSync(markerFd, JSON.stringify({ snapshotId: manifest.id, recovery, safetySnapshot: safety.destination, startedAt: new Date().toISOString() }, null, 2)); fs.fsyncSync(markerFd); } finally { fs.closeSync(markerFd); }
    // Persist the directory entry where supported. Windows directory fsync is not portable.
    if (process.platform !== 'win32') { const dirFd = fs.openSync(home, 'r'); try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); } }
    const moved = []; const installed = [];
    try {
      // Moving the complete data directory preserves stale WAL/SHM and unknown files intact.
      for (const name of ['data', 'config.json']) {
        const current = path.join(home, name); assertSafePath(current);
        if (fs.existsSync(current)) { fs.renameSync(current, path.join(recovery, `previous-${name}`)); moved.push(name); }
        if (options.afterMove) options.afterMove(name);
        const incoming = path.join(stage, name);
        if (fs.existsSync(incoming)) { fs.renameSync(incoming, current); installed.push(name); }
      }
      fs.unlinkSync(marker);
      return { mode: 'applied', snapshotId: manifest.id, safetySnapshot: safety.destination, preservedPreviousData: recovery, home };
    } catch (cause) {
      try {
        if (options.beforeRollback) options.beforeRollback();
        for (const name of installed.reverse()) fs.renameSync(path.join(home, name), path.join(recovery, `failed-${name}`));
        for (const name of moved.reverse()) fs.renameSync(path.join(recovery, `previous-${name}`), path.join(home, name));
        fs.unlinkSync(marker);
      } catch (rollbackError) {
        throw new Error(`Restore failed; automatic rollback incomplete. All preserved files remain at ${recovery}. Original error: ${cause.message}; rollback: ${rollbackError.message}`);
      }
      throw new Error(`Restore failed; original files restored. Recovery files retained at ${recovery}. ${cause.message}`);
    }
  } finally { unlock(); }
}
async function main(args = process.argv.slice(2)) {
  const home = defaultHome();
  if (args[0] === 'backup' && args.length === 1) { const result = await backup(home); console.log(`Snapshot created: ${result.destination}\nFiles: ${result.manifest.fileCount}`); return; }
  if (args[0] === 'preview' && args.length <= 2) {
    let source = args[1];
    if (!source) { const rl = require('node:readline/promises').createInterface({ input: process.stdin, output: process.stdout }); try { source = (await rl.question('Snapshot folder (preview only): ')).trim().replace(/^"(.*)"$/, '$1'); } finally { rl.close(); } }
    if (!source) throw new Error('Snapshot folder is required.');
    console.log(JSON.stringify(await previewRestore(home, source), null, 2)); return;
  }
  if (args[0] === 'restore' && args.length === 5 && args[2] === '--apply' && args[3] === '--confirm') {
    console.log(JSON.stringify(await applyRestore(home, args[1], args[4]), null, 2)); return;
  }
  if (args[0] === 'interactive-restore' && args.length === 1) {
    const rl = require('node:readline/promises').createInterface({ input: process.stdin, output: process.stdout });
    try {
      const source = (await rl.question('Snapshot folder: ')).trim().replace(/^"(.*)"$/, '$1');
      if (!source) throw new Error('Snapshot folder is required.');
      const preview = await previewRestore(home, source);
      console.log(JSON.stringify(preview, null, 2));
      const confirmed = await rl.question('Type the exact snapshot ID to apply (Enter cancels): ');
      if (!confirmed) { console.log('Cancelled. No files restored.'); return; }
      console.log(JSON.stringify(await applyRestore(home, source, confirmed), null, 2));
    } finally { rl.close(); }
    return;
  }
  throw new Error('Usage: backup | preview [folder] | restore <folder> --apply --confirm <snapshot-id> | interactive-restore');
}
module.exports = { defaultHome, assertSafePath, assertNoPendingRestore, allowed, integrity, backup, validateSnapshot, previewRestore, applyRestore };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
