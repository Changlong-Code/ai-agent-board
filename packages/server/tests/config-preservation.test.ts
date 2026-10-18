import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configModule = new URL('../src/config.ts', import.meta.url).href;
const serverDirectory = fileURLToPath(new URL('..', import.meta.url));

function loadInIsolatedProcess(home: string) {
  return spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e',
    `const { loadConfig } = await import(${JSON.stringify(configModule)}); console.log(JSON.stringify(loadConfig()));`,
  ], {
    cwd: serverDirectory,
    env: { ...process.env, AGENTBOARD_HOME: home },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('malformed or invalid existing config fails closed and preserves every original byte', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'agentboard-config-preserve-'));
  const configPath = path.join(home, 'config.json');
  try {
    const invalid = [
      '{ broken JSON', '{}', 'null', '[]',
      JSON.stringify({ cloneRoot: '' }), JSON.stringify({ cloneRoot: '   ' }),
      JSON.stringify({ cloneRoot: 123 }), JSON.stringify({ cloneRoot: null }),
      JSON.stringify({ cloneRoot: 'invalid\0directory' }),
    ];
    for (const contents of invalid) {
      writeFileSync(configPath, contents);
      const result = loadInIsolatedProcess(home);
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0, `must reject ${contents}`);
      assert.match(result.stderr, /original file was preserved/);
      assert.match(result.stderr, /cloneRoot/);
      assert.equal(readFileSync(configPath, 'utf8'), contents);
      assert.equal(existsSync(path.join(home, 'projects')), false);
      assert.deepEqual(readdirSync(home), ['config.json']);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('valid config retains original formatting and creates only the configured clone root', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'agentboard-config-valid-'));
  const cloneRoot = path.join(home, 'chosen-projects');
  const original = ` { "cloneRoot": ${JSON.stringify(cloneRoot)}, "userMetadata": "keep" }\n`;
  try {
    writeFileSync(path.join(home, 'config.json'), original);
    const result = loadInIsolatedProcess(home);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { cloneRoot });
    assert.equal(readFileSync(path.join(home, 'config.json'), 'utf8'), original);
    assert.equal(existsSync(cloneRoot), true);
    assert.equal(existsSync(path.join(home, 'projects')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('absent configuration still creates the default config and project directory', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'agentboard-config-new-'));
  try {
    const result = loadInIsolatedProcess(home);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const expected = { cloneRoot: path.join(home, 'projects') };
    assert.deepEqual(JSON.parse(result.stdout), expected);
    assert.deepEqual(JSON.parse(readFileSync(path.join(home, 'config.json'), 'utf8')), expected);
    assert.equal(existsSync(expected.cloneRoot), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
