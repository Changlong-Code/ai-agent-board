'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { checkNode, readPorts, available } = require('./original-start.cjs');
async function main() {
  const root = path.resolve(__dirname, '..');
  const report = { createdAt: new Date().toISOString(), mode: 'original-basic', platform: process.platform, osRelease: os.release(), architecture: process.arch, nodeVersion: process.versions.node, checks: {} };
  async function check(name, action) {
    try { report.checks[name] = { ok: true, detail: await action() }; }
    catch (error) { report.checks[name] = { ok: false, detail: error.message }; }
  }
  await check('node', () => { checkNode(); return 'Node.js version satisfies 22.12+'; });
  await check('sqliteNative', () => {
    const req = createRequire(path.join(root, 'packages/server/package.json'));
    const Database = req('better-sqlite3'); const db = new Database(':memory:');
    try { db.prepare('SELECT 1').get(); } finally { db.close(); }
    return 'Native SQLite loaded; in-memory query passed';
  });
  await check('builds', () => {
    const needed = ['packages/server/dist/index.js', 'packages/client/dist/index.html', 'shared/dist/constants.js'];
    const missing = needed.filter(file => !fs.existsSync(path.join(root, file)));
    if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);
    return 'Server, React client and shared build entries exist';
  });
  await check('ports', async () => {
    const ports = readPorts(root); await available(ports.boardPort); await available(ports.apiPort); return ports;
  });
  await check('configuration', () => {
    const home = path.resolve(process.env.ORIGINAL_BOARD_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AI-Agent-Board', 'original-basic'));
    const file = path.join(home, 'config.json');
    if (!fs.existsSync(file)) return 'No existing config; first startup will create isolated data';
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!config || Array.isArray(config) || typeof config.cloneRoot !== 'string' || !config.cloneRoot.trim() || config.cloneRoot.includes('\0')) throw new Error('Existing config has invalid cloneRoot');
    return 'Existing config parses correctly (paths omitted)';
  });
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(report.checks).some(check => !check.ok)) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
