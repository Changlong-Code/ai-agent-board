'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
function checkNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js 22.12 or newer is required.');
}
function port(value, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535) throw new Error(`${name} must be an integer from 1024 to 65535.`);
  return Number(value);
}
function readPorts(root = ROOT, env = process.env) {
  const file = path.join(root, 'ORIGINAL_PORTS.json');
  let config = {};
  if (fs.existsSync(file)) {
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Invalid ORIGINAL_PORTS.json; fix it before startup.'); }
    if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => !['boardPort', 'apiPort'].includes(k))) throw new Error('ORIGINAL_PORTS.json accepts boardPort and apiPort only.');
  }
  const boardPort = port(env.ORIGINAL_BOARD_PORT ?? config.boardPort ?? 8776, 'Board port');
  const apiPort = port(env.ORIGINAL_API_PORT ?? config.apiPort ?? 8777, 'API port');
  if (boardPort === apiPort) throw new Error('Board and API ports must differ.');
  return { boardPort, apiPort };
}
function isolatedEnv(home, ports, source = process.env, enableAgents = false) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^(NODE_OPTIONS|DOTENV_CONFIG_|VITE_|OPENAI_|ANTHROPIC_|DATABASE_URL$|API_KEY$|AGENTBOARD_)/i.test(key)) delete env[key];
  }
  return Object.assign(env, {
    NODE_OPTIONS: '', DOTENV_CONFIG_PATH: path.join(home, '.dotenv-disabled'), DOTENV_CONFIG_OVERRIDE: '',
    DATABASE_URL: '', API_KEY: '', VITE_API_KEY: '',
    AGENTBOARD_ENABLE_AGENT_EXECUTION: enableAgents ? '1' : '0',
    AGENTBOARD_DISABLE_AGENT_STARTUP: enableAgents ? '0' : '1',
    AGENTBOARD_WINDOWS_BASIC: '1', AGENTBOARD_UI_PORT: String(ports.boardPort),
    AGENTBOARD_HOME: home, DB_PATH: path.join(home, 'data', 'agentboard.db'),
    HOST: '127.0.0.1', PORT: String(ports.apiPort), ORIGINAL_BOARD_PORT: String(ports.boardPort),
    ORIGINAL_API_PORT: String(ports.apiPort), ALLOWED_ORIGINS: `http://127.0.0.1:${ports.boardPort},http://localhost:${ports.boardPort}`,
    ALLOWED_HOSTS: '127.0.0.1,localhost',
  });
}
function validateConfig(home) {
  if (fs.existsSync(path.join(home, 'restore-in-progress.json'))) {
    throw new Error('An unfinished restore marker exists: restore-in-progress.json. Startup is blocked. Preserve the data and inspect the recovery marker before manual recovery; do not reset it automatically.');
  }
  const file = path.join(home, 'config.json');
  if (!fs.existsSync(file)) return;
  try {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!config || Array.isArray(config) || typeof config.cloneRoot !== 'string' || !config.cloneRoot.trim() || config.cloneRoot.includes('\0')) throw new Error('Invalid cloneRoot');
  } catch {
    const copy = `${file}.invalid-${Date.now()}`;
    fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
    throw new Error(`Invalid config.json; preserved at ${copy}. Repair the original before startup.`);
  }
}
function lockHome(home) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, 'original.lock');
  const token = `${process.pid}-${require('node:crypto').randomUUID()}`;
  let fd;
  try { fd = fs.openSync(file, 'wx'); fs.writeFileSync(fd, token); fs.closeSync(fd); }
  catch (error) { if (fd !== undefined) fs.closeSync(fd); throw new Error(`Home is locked: ${file}. If a previous launch crashed, confirm its process has stopped before removing this lock. (${error.code})`); }
  return () => { if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === token) fs.unlinkSync(file); };
}
function available(portNumber) {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', () => reject(new Error(`Port ${portNumber} is occupied. Edit ORIGINAL_PORTS.json; the other application will not be stopped.`)));
    socket.listen(portNumber, '127.0.0.1', () => socket.close(resolve));
  });
}
async function backupDatabase(Database, home) {
  const file = path.join(home, 'data', 'agentboard.db');
  if (!fs.existsSync(file)) return null;
  const destination = path.join(home, 'backups', `agentboard-before-start-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.db`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try { await db.backup(destination); } finally { db.close(); }
  return destination;
}
function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, body })); });
    req.on('error', reject); req.setTimeout(1500, () => req.destroy(new Error('Health request timed out')));
  });
}
async function main() {
  checkNode();
  const ports = readPorts();
  const enableAgents = process.env.ORIGINAL_ENABLE_AGENT_EXECUTION === '1';
  const home = path.resolve(process.env.ORIGINAL_BOARD_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AI-Agent-Board', 'original-basic'));
  const server = path.join(ROOT, 'packages/server/dist/index.js');
  for (const file of [server, path.join(ROOT, 'packages/client/dist/index.html'), path.join(ROOT, 'shared/dist/constants.js')]) {
    if (!fs.existsSync(file)) throw new Error(`Missing build: ${file}. Run Setup-Original-Board.cmd first.`);
  }
  const serverRequire = createRequire(path.join(ROOT, 'packages/server/package.json'));
  const Database = serverRequire('better-sqlite3');
  const probe = new Database(':memory:'); probe.prepare('SELECT 1').get(); probe.close();
  const vite = path.join(path.dirname(createRequire(path.join(ROOT, 'packages/client/package.json')).resolve('vite/package.json')), 'bin/vite.js');
  await available(ports.boardPort); await available(ports.apiPort);
  const unlock = lockHome(home);
  const children = []; const streams = []; let stopping = false;
  async function stop(code) {
    if (stopping) return; stopping = true;
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.all(children.map(child => !child.pid || child.exitCode !== null || child.signalCode !== null ? null : new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 6500);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    })));
    for (const stream of streams) stream.end();
    unlock(); if (process.connected) process.disconnect(); process.exitCode = code;
  }
  try {
    validateConfig(home);
    if (fs.existsSync(path.join(home, '.dotenv-disabled'))) throw new Error('Remove the unexpected .dotenv-disabled file from the data home before startup.');
    const backup = await backupDatabase(Database, home);
    process.on('SIGINT', () => void stop(0)); process.on('SIGTERM', () => void stop(0));
    if (process.send) process.on('message', message => {
      if (message && message.type === 'original-board-stop') void stop(0);
    });
    if (stopping) return;
    console.log(`Data: ${home}${backup ? `\nBackup: ${backup}` : ''}`);
    fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
    const env = isolatedEnv(home, ports, process.env, enableAgents);
    function run(name, args) {
      const output = fs.createWriteStream(path.join(home, 'logs', `${name}.log`), { flags: 'a' }); streams.push(output);
      output.on('error', error => { console.error(`Cannot write ${name} log: ${error.message}`); void stop(1); });
      const child = spawn(process.execPath, args, { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      children.push(child); child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
      child.on('error', error => { console.error(`${name}: ${error.message}`); void stop(1); });
      child.on('exit', code => { if (!stopping) { console.error(`${name} stopped (${code}); see ${home}/logs`); void stop(1); } });
    }
    run('server', [server]);
    run('client', [vite, 'preview', '--config', path.join(__dirname, 'original-vite.config.mjs')]);
    const url = `http://127.0.0.1:${ports.boardPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 90 && !stopping; attempt++) {
      try {
        const [api, client] = await Promise.all([request(`http://127.0.0.1:${ports.apiPort}/api/health`), request(url)]);
        if (api.status === 200 && JSON.parse(api.body).agentExecutionEnabled === enableAgents && client.status === 200) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    if (!ready) throw new Error(`Startup health checks failed; see ${home}/logs.`);
    console.log(`Original board ready: ${url}\nAgent execution is ${enableAgents ? 'ENABLED' : 'disabled'}. Press Ctrl+C to stop.`);
    if (process.platform === 'win32' && process.env.ORIGINAL_NO_BROWSER !== '1') {
      // URL is constructed exclusively from validated numeric port and fixed loopback host.
      const browser = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', url], { stdio: 'ignore', windowsHide: true });
      browser.on('error', () => console.log(`Open ${url} in your browser.`));
    }
  } catch (error) { console.error(error.message); await stop(1); }
}
module.exports = { checkNode, port, readPorts, isolatedEnv, validateConfig, lockHome, available, backupDatabase };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
