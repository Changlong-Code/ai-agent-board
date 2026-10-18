'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const Database = createRequire(path.resolve(__dirname, '../packages/server/package.json'))('better-sqlite3');
const { backup, previewRestore, validateSnapshot, defaultHome } = require('./original-backup.cjs');
const { lockHome } = require('./original-start.cjs');
function fixture(t) {
 const home = fs.mkdtempSync(path.join(os.tmpdir(), 'original-backup-')); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
 fs.mkdirSync(path.join(home, 'data/uploads'), { recursive: true });
 fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ cloneRoot: path.join(home, 'projects') }));
 fs.writeFileSync(path.join(home, 'data/uploads/example.txt'), 'attachment');
 const db = new Database(path.join(home, 'data/agentboard.db')); db.pragma('journal_mode = WAL'); db.exec('CREATE TABLE tasks (title TEXT); INSERT INTO tasks VALUES (\'committed WAL\')');
 t.after(() => { if (db.open) db.close(); }); return { home, db };
}
test('home matches launcher and honors explicit override', () => {
 assert.equal(defaultHome({ LOCALAPPDATA: '/tmp/local' }), path.resolve('/tmp/local/AI-Agent-Board/original-basic'));
 assert.equal(defaultHome({ ORIGINAL_BOARD_HOME: '/tmp/custom' }), path.resolve('/tmp/custom'));
});
test('snapshot includes committed WAL, uploads and config only; preview never modifies data', async t => {
 const { home, db } = fixture(t);
 for (const name of ['projects', 'logs', 'node_modules']) { fs.mkdirSync(path.join(home, name)); fs.writeFileSync(path.join(home, name, 'excluded.txt'), 'secret'); }
 const snapshot = await backup(home, Database);
 assert.equal(snapshot.manifest.fileCount, 3);
 const copy = new Database(path.join(snapshot.destination, 'data/agentboard.db'), { readonly: true });
 assert.equal(copy.prepare('SELECT title FROM tasks').get().title, 'committed WAL'); copy.close();
 db.exec("INSERT INTO tasks VALUES ('later')");
 const preview = await previewRestore(home, snapshot.destination, Database);
 assert.equal(preview.mode, 'preview-only'); assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n, 2);
 assert.equal(fs.existsSync(path.join(home, 'original.lock')), false);
});
test('hash mismatch, extra file and traversal rejected', async t => {
 const { home } = fixture(t); const s = await backup(home, Database);
 fs.appendFileSync(path.join(s.destination, 'data/uploads/example.txt'), 'tamper');
 assert.throws(() => validateSnapshot(s.destination, Database), /mismatch/);
 const s2 = await backup(home, Database); fs.writeFileSync(path.join(s2.destination, 'extra'), 'x');
 assert.throws(() => validateSnapshot(s2.destination, Database), /extra files/);
 const s3 = await backup(home, Database); const m = s3.manifest; m.files[0].path = '../config.json'; fs.writeFileSync(path.join(s3.destination, 'manifest.json'), JSON.stringify(m));
 assert.throws(() => validateSnapshot(s3.destination, Database), /Invalid snapshot file entry/);
});
test('live lock excludes backup and preview without deleting owner lock', async t => {
 const { home } = fixture(t); const s = await backup(home, Database); const unlock = lockHome(home);
 try { await assert.rejects(backup(home, Database), /locked/); await assert.rejects(previewRestore(home, s.destination, Database), /locked/); assert.equal(fs.existsSync(path.join(home, 'original.lock')), true); } finally { unlock(); }
});
test('symlink source and snapshot file refused', async t => {
 const { home } = fixture(t); const s = await backup(home, Database);
 fs.symlinkSync(path.join(home, 'config.json'), path.join(home, 'data/uploads/link'));
 await assert.rejects(backup(home, Database), /Unsupported file/);
 fs.symlinkSync(path.join(home, 'config.json'), path.join(s.destination, 'data/uploads/link'));
 assert.throws(() => validateSnapshot(s.destination, Database), /Unsupported file/);
});
test('corrupt existing DB preserved and config secrets rejected', async t => {
 const { home, db } = fixture(t); db.close(); const file = path.join(home, 'data/agentboard.db'); fs.writeFileSync(file, 'broken');
 await assert.rejects(backup(home, Database)); assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
 assert.equal(fs.existsSync(path.join(home, 'original.lock')), false);
 fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ cloneRoot: '/tmp/projects', apiKey: 'excluded' }));
 await assert.rejects(backup(home, Database), /Unsupported config/);
});
test('apply requires exact confirmation; restores with safety backup and preserved previous files', async t => {
 const { home, db } = fixture(t); const s = await backup(home, Database);
 db.exec("INSERT INTO tasks VALUES ('later')"); db.close();
 fs.writeFileSync(path.join(home, 'data/unknown.keep'), 'preserve');
 const { applyRestore } = require('./original-backup.cjs');
 await assert.rejects(applyRestore(home, s.destination, 'wrong', Database), /Confirmation/);
 const result = await applyRestore(home, s.destination, s.id, Database);
 const current = new Database(path.join(home, 'data/agentboard.db')); assert.equal(current.prepare('SELECT count(*) AS n FROM tasks').get().n, 1); current.close();
 const previous = new Database(path.join(result.safetySnapshot, 'data/agentboard.db')); assert.equal(previous.prepare('SELECT count(*) AS n FROM tasks').get().n, 2); previous.close();
 assert.equal(fs.readFileSync(path.join(result.preservedPreviousData, 'previous-data/unknown.keep'), 'utf8'), 'preserve');
});
test('apply rollback after partial install restores original DB/config/uploads and retains all files', async t => {
 const { home, db } = fixture(t); const s = await backup(home, Database);
 db.exec("INSERT INTO tasks VALUES ('later')"); db.close();
 fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ cloneRoot: '/changed' }));
 fs.writeFileSync(path.join(home, 'data/uploads/example.txt'), 'changed upload');
 const { applyRestore } = require('./original-backup.cjs');
 await assert.rejects(applyRestore(home, s.destination, s.id, Database, { afterMove(name) { if (name === 'config.json') throw new Error('injected failure'); } }), /original files restored/);
 const current = new Database(path.join(home, 'data/agentboard.db')); assert.equal(current.prepare('SELECT count(*) AS n FROM tasks').get().n, 2); current.close();
 assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'))).cloneRoot, '/changed');
 assert.equal(fs.readFileSync(path.join(home, 'data/uploads/example.txt'), 'utf8'), 'changed upload');
 assert.equal(fs.existsSync(path.join(home, 'original.lock')), false);
 assert.equal(fs.readdirSync(path.join(home, 'restore-recovery')).length, 1);
});
test('apply refuses corrupt current DB before moving it', async t => {
 const { home, db } = fixture(t); const s = await backup(home, Database); db.close();
 fs.writeFileSync(path.join(home, 'data/agentboard.db'), 'corrupt current');
 const { applyRestore } = require('./original-backup.cjs');
 await assert.rejects(applyRestore(home, s.destination, s.id, Database));
 assert.equal(fs.readFileSync(path.join(home, 'data/agentboard.db'), 'utf8'), 'corrupt current');
 assert.equal(fs.existsSync(path.join(home, 'restore-recovery')), false);
});
test('rehashed unsupported config and Windows aliases are rejected', async t => {
 const { home } = fixture(t); const s = await backup(home, Database); const crypto = require('node:crypto');
 const file = path.join(s.destination, 'config.json'); fs.writeFileSync(file, JSON.stringify({ cloneRoot: '/tmp', apiKey: 'not allowed' }));
 const m = s.manifest; const entry = m.files.find(f => f.path === 'config.json'); const old = entry.bytes;
 entry.bytes = fs.statSync(file).size; entry.sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); m.totalBytes += entry.bytes - old;
 fs.writeFileSync(path.join(s.destination, 'manifest.json'), JSON.stringify(m));
 assert.throws(() => validateSnapshot(s.destination, Database), /Unsupported config/);
 const { allowed } = require('./original-backup.cjs');
 for (const p of ['data/uploads/CON.txt', 'data/uploads/name.', 'data/uploads/name ', 'data/uploads/x:stream']) assert.equal(allowed(p), false);
});
test('incomplete rollback retains durable recovery marker and blocks further mutations', async t => {
 const { home, db } = fixture(t); const s = await backup(home, Database); db.close();
 const { applyRestore, assertNoPendingRestore } = require('./original-backup.cjs');
 await assert.rejects(applyRestore(home, s.destination, s.id, Database, {
   afterMove() { throw new Error('injected rename failure'); },
   beforeRollback() { throw new Error('injected rollback failure'); },
 }), /rollback incomplete/);
 const marker = JSON.parse(fs.readFileSync(path.join(home, 'restore-in-progress.json')));
 assert.equal(marker.snapshotId, s.id); assert.equal(fs.existsSync(path.join(marker.recovery, 'previous-data/agentboard.db')), true);
 assert.throws(() => assertNoPendingRestore(home), /manual recovery/);
 await assert.rejects(backup(home, Database), /manual recovery/);
 await assert.rejects(applyRestore(home, s.destination, s.id, Database), /manual recovery/);
});
