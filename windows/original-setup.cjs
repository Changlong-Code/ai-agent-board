'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkNode, isolatedEnv } = require('./original-start.cjs');
function main() {
  checkNode();
  const root = path.resolve(__dirname, '..');
  const env = isolatedEnv(path.join(root, '.original-setup-unused'), { boardPort: 8776, apiPort: 8777 });
  // Empty value must remain present: CMD `set VAR=` would delete it and let Vite load a source .env value.
  env.VITE_API_KEY = '';
  const commands = [['ci'], ['run', 'build:shared'], ['run', 'build:client'], ['run', 'build:server']];
  for (const args of commands) {
    console.log(`Running npm ${args.join(' ')}`);
    // Windows npm is a CMD shim. All command text here is fixed; no user paths or values enter it.
    const result = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd: root, env, stdio: 'inherit', windowsHide: true })
      : spawnSync('npm', args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed (${result.status}).`);
  }
  console.log('Setup complete. Run Start-Original-Board.cmd. No Agent was started.');
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
