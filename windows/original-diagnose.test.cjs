'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runDiagnostics } = require('./original-diagnose.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'original-diagnostic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'isolated-home'); fs.mkdirSync(home);
  return { root, home };
}
function deps() { return { probeSqlite() {}, available: async () => {} }; }
function builds(root) {
  for (const file of ['packages/server/dist/index.js', 'packages/client/dist/index.html', 'shared/dist/constants.js']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'fixture only');
  }
}
test('failed checks still save unique Chinese and JSON reports without modifying damaged config', async t => {
  const { root, home } = fixture(t), configPath = path.join(home, 'config.json');
  const original = '{ invalid JSON containing PRIVATE_CONFIG_VALUE'; fs.writeFileSync(configPath, original);
  const result = await runDiagnostics({ root, home, nodeVersion: '20.0.0', env: {}, deps: { probeSqlite() { throw Error('secret SQLITE_ERROR'); }, available: async () => { throw Error('secret PORT_ERROR'); } } });
  assert.equal(result.exitCode, 1); assert.equal(result.report.summary.failed, 5);
  assert.equal(result.report.summary.total, 5);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(home), ['config.json']);
  const json = fs.readFileSync(result.jsonPath, 'utf8'), text = fs.readFileSync(result.textPath, 'utf8');
  assert.equal(JSON.parse(json).summary.exitCode, 1); assert.match(text, /未通过：已有配置文件/); assert.match(text, /原文件保持不变/);
  assert.equal(text.charCodeAt(0), 0xFEFF); assert.match(text, /退出码：1/);
  for (const secret of ['PRIVATE_CONFIG_VALUE', 'SQLITE_ERROR', 'PORT_ERROR']) assert.equal((json + text).includes(secret), false);
  const second = await runDiagnostics({ root, home, nodeVersion: '20.0.0', env: {}, deps: deps() });
  assert.notEqual(second.jsonPath, result.jsonPath); assert.ok(fs.existsSync(result.jsonPath));
});
test('valid config secrets and cloneRoot omitted while success report gives actionable next step', async t => {
  const { root, home } = fixture(t); builds(root);
  const secretPath = path.join(home, 'PRIVATE_CLONE_DIRECTORY');
  const original = JSON.stringify({ cloneRoot: secretPath, apiKey: 'PRIVATE_KEY_VALUE' });
  fs.writeFileSync(path.join(home, 'config.json'), original);
  const reportDir = path.join(root, 'chosen-reports');
  const result = await runDiagnostics({ root, home, reportDir, nodeVersion: '22.12.0', env: { API_KEY: 'ENV_SECRET' }, deps: deps() });
  assert.equal(result.exitCode, 0); assert.deepEqual(result.report.summary, { total: 5, passed: 5, failed: 0, exitCode: 0 });
  const reports = fs.readFileSync(result.jsonPath, 'utf8') + fs.readFileSync(result.textPath, 'utf8');
  for (const secret of [secretPath, 'PRIVATE_KEY_VALUE', 'ENV_SECRET']) assert.equal(reports.includes(secret), false);
  assert.match(reports, /Start-Original-Board.cmd/); assert.equal(fs.readFileSync(path.join(home, 'config.json'), 'utf8'), original);
  assert.equal(fs.existsSync(secretPath), false); assert.equal(path.dirname(result.textPath), reportDir);
});
test('no existing home is created by checks, report directory override is honored', async t => {
  const { root } = fixture(t); builds(root); const home = path.join(root, 'not-created');
  const reportDir = path.join(root, 'override');
  const result = await runDiagnostics({ root, home, nodeVersion: '22.12.0', env: { ORIGINAL_REPORT_DIR: reportDir }, deps: deps() });
  assert.equal(result.exitCode, 0); assert.equal(fs.existsSync(home), false); assert.equal(path.dirname(result.jsonPath), reportDir);
});
test('CLI saves failure reports and exits with diagnostic summary code', t => {
  const { root, home } = fixture(t), original = '{damaged fixture';
  fs.writeFileSync(path.join(home, 'config.json'), original);
  const reportDir = path.join(root, 'cli-reports');
  const result = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'original-diagnose.cjs')], {
    env: { ...process.env, ORIGINAL_BOARD_HOME: home, ORIGINAL_REPORT_DIR: reportDir }, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.match(result.stdout, /中文报告：/);
  const report = JSON.parse(fs.readFileSync(path.join(reportDir, fs.readdirSync(reportDir).find(file => file.endsWith('.json'))), 'utf8'));
  assert.equal(result.status, report.summary.exitCode); assert.equal(report.checks.configuration.ok, false);
  assert.equal(fs.readFileSync(path.join(home, 'config.json'), 'utf8'), original);
});
