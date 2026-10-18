'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { checkNode, readPorts, isolatedEnv, validateConfig, lockHome, available, backupDatabase } = require('./original-start.cjs');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'original-launcher-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('preflight rejects unsupported Node and invalid or conflicting ports', t => {
  const dir = temp(t);
  assert.throws(() => checkNode('22.11.0')); assert.throws(() => checkNode('20.99.0')); checkNode('22.12.0');
  assert.deepEqual(readPorts(dir, {}), { boardPort: 8776, apiPort: 8777 });
  assert.throws(() => readPorts(dir, { ORIGINAL_BOARD_PORT: '8766x' }));
  assert.throws(() => readPorts(dir, { ORIGINAL_BOARD_PORT: '8777' }));
  fs.writeFileSync(path.join(dir, 'ORIGINAL_PORTS.json'), '{invalid'); assert.throws(() => readPorts(dir, {}));
});
test('launcher home lock is exclusive and never unlocks another owner', t => {
  const dir = temp(t); const unlock = lockHome(dir); assert.throws(() => lockHome(dir));
  fs.writeFileSync(path.join(dir, 'original.lock'), 'someone-else'); unlock();
  assert.equal(fs.readFileSync(path.join(dir, 'original.lock'), 'utf8'), 'someone-else');
});
test('invalid configuration is preserved and refuses startup', t => {
  const dir = temp(t); fs.writeFileSync(path.join(dir, 'config.json'), '{invalid');
  assert.throws(() => validateConfig(dir));
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), '{invalid');
  assert.equal(fs.readdirSync(dir).filter(file => file.startsWith('config.json.invalid-')).length, 1);
});
test('isolated environment overrides inherited execution, database and dotenv configuration', () => {
  const env = isolatedEnv('/isolated', { boardPort: 8776, apiPort: 8777 }, { NODE_OPTIONS: '--require evil', DOTENV_CONFIG_OVERRIDE: 'true', DATABASE_URL: 'postgres://other', AGENTBOARD_ENABLE_AGENT_EXECUTION: '1', API_KEY: 'unwanted', VITE_OTHER: 'unwanted', OPENAI_API_KEY: 'unwanted', PATH: '/safe' });
  assert.equal(env.AGENTBOARD_ENABLE_AGENT_EXECUTION, '0'); assert.equal(env.AGENTBOARD_DISABLE_AGENT_STARTUP, '1');
  assert.equal(env.AGENTBOARD_WINDOWS_BASIC, '1'); assert.equal(env.DATABASE_URL, ''); assert.equal(env.API_KEY, ''); assert.equal(env.NODE_OPTIONS, '');
  assert.equal(env.VITE_OTHER, undefined); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.PATH, '/safe');
  assert.equal(env.DOTENV_CONFIG_OVERRIDE, ''); assert.equal(env.HOST, '127.0.0.1');
});
test('occupied port is rejected without touching its service', async t => {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(available(server.address().port), /occupied/); assert.equal(server.listening, true);
});
test('pre-migration backup awaits SQLite backup and closes read-only connection on failure', async t => {
  const dir = temp(t); fs.mkdirSync(path.join(dir, 'data')); fs.writeFileSync(path.join(dir, 'data/agentboard.db'), 'sentinel');
  let closed = false;
  class BrokenDatabase { constructor(file, options) { assert.equal(options.readonly, true); assert.equal(options.fileMustExist, true); } async backup() { throw new Error('backup failed'); } close() { closed = true; } }
  await assert.rejects(backupDatabase(BrokenDatabase, dir), /backup failed/); assert.equal(closed, true);
  assert.equal(fs.readFileSync(path.join(dir, 'data/agentboard.db'), 'utf8'), 'sentinel');
});

test('unfinished restore marker blocks startup before touching valid config or database', t => {
  const dir = temp(t);
  const marker = path.join(dir, 'restore-in-progress.json');
  fs.writeFileSync(marker, '{"phase":"data-renamed"}');
  const config = JSON.stringify({ cloneRoot: path.join(dir, 'projects') });
  fs.writeFileSync(path.join(dir, 'config.json'), config);
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'agentboard.db'), 'unchanged-database');
  assert.throws(() => validateConfig(dir), /unfinished restore marker/);
  assert.equal(fs.readFileSync(marker, 'utf8'), '{"phase":"data-renamed"}');
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), config);
  assert.equal(fs.readFileSync(path.join(dir, 'data', 'agentboard.db'), 'utf8'), 'unchanged-database');
  assert.equal(fs.readdirSync(dir).filter(file => file.includes('.invalid-')).length, 0);
});
