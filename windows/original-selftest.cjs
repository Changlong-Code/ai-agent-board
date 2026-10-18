'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { checkNode } = require('./original-start.cjs');
const ROOT = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
function request(base, route, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(base + route, { method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => { let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, text, json }); });
    });
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('Request timed out'))); req.end(data);
  });
}
async function runSelfTest(options = {}) {
  const report = { createdAt: new Date().toISOString(), environment: { platform: process.platform, release: os.release(), architecture: process.arch, node: process.versions.node }, scope: '原版编译服务、React 静态资源和 SQLite 接口验收；不包含浏览器点击或真实 AI 调用。', passed: false, checks: [] };
  let home, child, childState, output = '', safeToRemove = true, interrupted = false, stopping;
  const onSignal = () => { interrupted = true; void stop().catch(() => {}); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  const reportDir = path.resolve(options.reportDir || process.env.ORIGINAL_REPORT_DIR || path.join(ROOT, 'reports'));
  async function step(name, action) {
    try { if (interrupted) throw new Error('用户中断了本机验收。'); await action(); if (interrupted) throw new Error('用户中断了本机验收。'); report.checks.push({ name, passed: true }); console.log(`[通过] ${name}`); }
    catch (error) { report.checks.push({ name, passed: false, error: error.message }); throw error; }
  }
  async function stop() {
    if (stopping) return stopping;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null || childState.closed) {
      if (!childState.confirmed) { safeToRemove = false; throw new Error('测试启动器意外退出，无法确认所有子进程已停止；临时数据已保留。'); }
      child = undefined; return;
    }
    const target = child;
    const state = childState;
    state.shutdownRequested = true;
    stopping = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { safeToRemove = false; reject(new Error('无法确认测试进程已停止；已保留临时目录，未执行删除。')); }, 12000);
      target.once('close', (code, signal) => {
        clearTimeout(timer);
        state.confirmed = code === 0 && !signal;
        if (!state.confirmed) { safeToRemove = false; reject(new Error('测试启动器未正常完成停止；临时数据已保留。')); return; }
        child = undefined; resolve();
      });
      if (target.connected) target.send({ type: 'original-board-stop' }, error => { if (error) { clearTimeout(timer); safeToRemove = false; reject(error); } });
      else { clearTimeout(timer); safeToRemove = false; reject(new Error('测试进程 IPC 不可用，无法安全停止。')); }
    });
    try { await stopping; } finally { stopping = undefined; }
  }
  try {
    checkNode();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'original-board-selftest-'));
    const repo = path.join(home, 'test-project'); fs.mkdirSync(repo);
    const boardPort = await freePort(); let apiPort = await freePort(); while (apiPort === boardPort) apiPort = await freePort();
    const base = `http://127.0.0.1:${boardPort}`;
    async function launch() {
      output = '';
      child = spawn(process.execPath, [path.join(__dirname, 'original-start.cjs')], { cwd: ROOT, env: { ...process.env, NODE_OPTIONS: '', ORIGINAL_BOARD_HOME: home, ORIGINAL_BOARD_PORT: String(boardPort), ORIGINAL_API_PORT: String(apiPort), ORIGINAL_NO_BROWSER: '1', ALLOWED_REPO_ROOTS: home }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
      childState = { closed: false, shutdownRequested: false, confirmed: false };
      const state = childState;
      child.once('close', () => { state.closed = true; if (!state.shutdownRequested) safeToRemove = false; });
      let spawnError; child.on('error', error => { spawnError = error; });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-12000); });
      for (let attempt = 0; attempt < 150; attempt++) {
        if (interrupted) throw new Error('用户中断了本机验收。');
        if (spawnError) throw spawnError;
        if (output.includes('Original board ready:')) return;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`原版启动失败：${output}`);
        await delay(200);
      }
      throw new Error(`原版启动超时：${output}`);
    }
    await step('隔离临时目录、动态端口启动原版', launch);
    await step('健康检查：Agent 执行明确禁用', async () => { const result = await request(base, '/api/health'); assert.equal(result.status, 200); assert.equal(result.json.agentExecutionEnabled, false); });
    await step('原版 React 首页静态资源返回 200', async () => { const result = await request(base, '/'); assert.equal(result.status, 200); assert.match(result.text, /<div id="root"><\/div>/); assert.match(result.text, /assets\//); const asset = result.text.match(/src="([^"]+\.js)"/); assert.ok(asset, 'React JavaScript bundle reference exists'); const bundle = await request(base, asset[1]); assert.equal(bundle.status, 200); assert.ok(bundle.text.length > 1000); });
    let task;
    await step('创建任务并保持 idle', async () => { const result = await request(base, '/api/tasks', 'POST', { title: '本机原版验收任务', description: '隔离自检，不运行 AI', repoPath: repo, columnId: 'backlog', agentType: 'codex', priority: 'medium', useWorktree: false, autoRun: false }); assert.equal(result.status, 201); task = result.json; assert.equal(task.agentStatus, 'idle'); });
    await step('编辑和手动移动任务不会启动 AI', async () => { const result = await request(base, `/api/tasks/${task.id}`, 'PATCH', { description: '编辑和移动后应保留', columnId: 'in-progress' }); assert.equal(result.status, 200); assert.equal(result.json.agentStatus, 'idle'); assert.equal(result.json.columnId, 'in-progress'); });
    await step('运行请求被 403 拒绝，事件记录为空', async () => { assert.equal((await request(base, `/api/tasks/${task.id}/run`, 'POST', {})).status, 403); assert.deepEqual((await request(base, `/api/tasks/${task.id}/events`)).json, []); });
    await step('仅停止自己的测试启动器与子进程', stop);
    await step('重启同一隔离数据库，任务内容与 idle 状态保留', async () => { await launch(); const result = await request(base, '/api/tasks'); assert.equal(result.status, 200); const saved = result.json.find(row => row.id === task.id); assert.ok(saved); assert.equal(saved.description, '编辑和移动后应保留'); assert.equal(saved.columnId, 'in-progress'); assert.equal(saved.agentStatus, 'idle'); });
    await step('迁移前备份存在且 SQLite 快照可读取任务', () => {
      const files = fs.readdirSync(path.join(home, 'backups')).filter(file => file.endsWith('.db')); assert.ok(files.length > 0);
      const Database = createRequire(path.join(ROOT, 'packages/server/package.json'))('better-sqlite3');
      const db = new Database(path.join(home, 'backups', files[0]), { readonly: true, fileMustExist: true });
      try { const saved = db.prepare('SELECT description, column_id, agent_status FROM tasks WHERE id = ?').get(task.id); assert.equal(saved.description, '编辑和移动后应保留'); assert.equal(saved.column_id, 'in-progress'); assert.equal(saved.agent_status, 'idle'); } finally { db.close(); }
    });
    report.passed = true;
  } catch (error) { report.error = error.message; }
  finally {
    try { await stop(); } catch (error) { report.passed = false; report.cleanupError = error.message; }
    if (home && safeToRemove) {
      try { fs.rmSync(home, { recursive: true, force: true }); }
      catch (error) { safeToRemove = false; report.passed = false; report.cleanupError = error.message; }
    }
    report.cleanup = safeToRemove ? '测试进程已停止，临时测试数据已清理。' : '停止未确认，临时数据已保留。';
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    const redact = value => typeof value === 'string' ? value.split(home || '\0').join('[临时测试目录]').split(ROOT).join('[应用目录]') : value;
    for (const check of report.checks) if (check.error) check.error = redact(check.error);
    if (report.error) report.error = redact(report.error);
    if (report.cleanupError) report.cleanupError = redact(report.cleanupError);
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stem = `original-selftest-${stamp}-${process.pid}`;
    fs.writeFileSync(path.join(reportDir, `${stem}.json`), JSON.stringify(report, null, 2));
    const lines = ['# 原版 Windows 基础版本机验收报告', '', `结果：${report.passed ? '通过' : '失败'}`, `运行环境：${process.platform} ${os.release()} / ${process.arch} / Node ${process.versions.node}`, '', report.scope, '', ...report.checks.map(check => `- ${check.passed ? '通过' : '失败'}：${check.name}${check.error ? `：${check.error}` : ''}`), '', report.cleanup, '', process.platform === 'win32' ? '本报告对应本机 Windows 运行；Windows 1909 仅在版本号 10.0.18363 时得到本机覆盖。' : '本报告来自 Linux，不能据此声明 Windows 1909 已通过。', ...(report.error ? ['', `错误：${report.error}`] : [])];
    fs.writeFileSync(path.join(reportDir, `${stem}.md`), lines.join('\n'));
    console.log(`报告已保存：${reportDir}`);
  }
  return report;
}
module.exports = { runSelfTest };
if (require.main === module) runSelfTest().then(report => { process.exitCode = report.passed ? 0 : 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
