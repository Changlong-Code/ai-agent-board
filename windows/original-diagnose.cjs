'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { checkNode, readPorts, available } = require('./original-start.cjs');

const labels = {
  node: 'Node.js 运行环境', sqliteNative: 'SQLite 原生模块', builds: '原版程序构建文件',
  ports: '本地服务端口', configuration: '已有配置文件',
};
function probeSqlite(root) {
  const req = createRequire(path.join(root, 'packages/server/package.json'));
  const Database = req('better-sqlite3');
  const db = new Database(':memory:');
  try { db.prepare('SELECT 1').get(); } finally { db.close(); }
}
function defaultHome(env) {
  return path.resolve(env.ORIGINAL_BOARD_HOME || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AI-Agent-Board', 'original-basic'));
}
function chineseReport(report) {
  const lines = [
    'AI Agent Board 原版基础模式 — 本机诊断报告',
    `生成时间：${report.createdAt}`,
    `系统：${report.platform} ${report.osRelease} / ${report.architecture}`,
    `Node.js：${report.nodeVersion}`,
    '',
    '本次仅检查环境、内存数据库及文件是否存在。',
    '没有启动看板、运行 Agent、登录账号或读取项目代码；没有修改配置和已有数据库。',
    '报告不包含 cloneRoot 目录、配置原文或环境变量。',
    '',
  ];
  for (const [key, value] of Object.entries(report.checks)) {
    lines.push(`${value.ok ? '通过' : '未通过'}：${labels[key]}`, `  ${value.detail}`);
  }
  lines.push('', `检查结果：共 ${report.summary.total} 项，通过 ${report.summary.passed} 项，未通过 ${report.summary.failed} 项。`,
    `退出码：${report.summary.exitCode}`,
    report.summary.failed ? '下一步：按未通过项目处理后重新运行 Diagnose-Original-Board.cmd；需要帮助时提供本报告。' : '下一步：可以运行 Start-Original-Board.cmd。环境检查通过不等于 Windows 1909 实机验收完成。');
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
async function runDiagnostics(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..'));
  const env = options.env || process.env;
  const home = path.resolve(options.home || defaultHome(env));
  const deps = options.deps || {};
  const report = {
    createdAt: new Date().toISOString(), mode: 'original-basic',
    platform: process.platform, osRelease: os.release(), architecture: process.arch,
    nodeVersion: options.nodeVersion || process.versions.node, checks: {},
  };
  async function check(name, action, failure) {
    try { report.checks[name] = { ok: true, detail: await action() }; }
    catch { report.checks[name] = { ok: false, detail: failure }; }
  }
  await check('node', () => {
    (deps.checkNode || checkNode)(report.nodeVersion);
    return 'Node.js 版本满足 22.12 或更新版本要求。';
  }, 'Node.js 版本不满足要求。请安装兼容本机系统的 Node.js 22.12 或更新版本；不要修改已有项目。');
  await check('sqliteNative', async () => {
    await (deps.probeSqlite || probeSqlite)(root);
    return 'SQLite 原生模块已加载，纯内存查询通过；未打开已有数据库。';
  }, 'SQLite 原生模块无法加载或查询失败。请运行 Setup-Original-Board.cmd 重新准备依赖，并核对 Node.js 版本与系统架构。');
  await check('builds', () => {
    const needed = ['packages/server/dist/index.js', 'packages/client/dist/index.html', 'shared/dist/constants.js'];
    if (needed.some(file => !fs.existsSync(path.join(root, file)))) throw new Error('Missing build');
    return '服务端、React 看板和共享模块的构建入口均存在。';
  }, '构建文件缺失。请先运行 Setup-Original-Board.cmd；诊断不会自动安装或构建。');
  await check('ports', async () => {
    const ports = (deps.readPorts || readPorts)(root, env);
    await (deps.available || available)(ports.boardPort);
    await (deps.available || available)(ports.apiPort);
    return `看板端口 ${ports.boardPort}、服务端端口 ${ports.apiPort} 可绑定，仅使用 127.0.0.1。`;
  }, '端口配置无效或已被占用。请核对 ORIGINAL_PORTS.json，也可设置 ORIGINAL_BOARD_PORT / ORIGINAL_API_PORT；不会停止占用端口的程序。');
  await check('configuration', () => {
    const file = path.join(home, 'config.json');
    if (!fs.existsSync(file)) return '没有已有配置；首次正式启动会创建独立配置。';
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!config || Array.isArray(config) || typeof config.cloneRoot !== 'string' || !config.cloneRoot.trim() || config.cloneRoot.includes('\0')) throw new Error('Invalid config');
    return '已有配置格式和 cloneRoot 字段有效；目录路径已从报告中省略。';
  }, '已有 config.json 无法读取、JSON 格式损坏或 cloneRoot 无效。原文件保持不变；请从备份修复后重试，不要直接删除已有数据。');
  const values = Object.values(report.checks);
  const failed = values.filter(value => !value.ok).length;
  report.summary = { total: values.length, passed: values.length - failed, failed, exitCode: failed ? 1 : 0 };
  const reportDir = path.resolve(options.reportDir || env.ORIGINAL_REPORT_DIR || path.join(root, 'reports'));
  fs.mkdirSync(reportDir, { recursive: true });
  const stem = `original-diagnose-${report.createdAt.replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
  const jsonPath = path.join(reportDir, stem + '.json');
  const textPath = path.join(reportDir, stem + '.txt');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(textPath, chineseReport(report), { encoding: 'utf8', flag: 'wx' });
  return { report, jsonPath, textPath, exitCode: report.summary.exitCode };
}
module.exports = { runDiagnostics, chineseReport };
if (require.main === module) {
  runDiagnostics().then(result => {
    console.log(`诊断完成：共 ${result.report.summary.total} 项，通过 ${result.report.summary.passed} 项，未通过 ${result.report.summary.failed} 项。`);
    console.log(`中文报告：${result.textPath}\nJSON 报告：${result.jsonPath}`);
    console.log('未运行 Agent、登录账号或修改已有配置与数据库。');
    process.exitCode = result.exitCode;
  }).catch(() => { console.error('无法完成或保存诊断报告。请检查程序目录或 ORIGINAL_REPORT_DIR 是否可写。'); process.exitCode = 1; });
}
