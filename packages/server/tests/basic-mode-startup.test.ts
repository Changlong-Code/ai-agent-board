import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrateSqliteDatabase } from '../src/db.js';

test('default basic startup preserves pending, orphaned and group records plus worktree files', { timeout: 20_000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agentboard-basic-startup-'));
  const dbPath = path.join(directory, 'board.db');
  const worktreePath = path.join(directory, 'existing-worktree.txt');
  writeFileSync(worktreePath, 'preserve user work');
  const db = new Database(dbPath);
  migrateSqliteDatabase(db);
  db.prepare("INSERT INTO task_groups (id,title,column_id,created_at) VALUES ('group','Active group','in-progress',1)").run();
  const insert = db.prepare(`INSERT INTO tasks
    (id,project_id,title,description,priority,column_id,agent_status,agent_type,created_at,run_requested_at,worktree_path,group_id)
    VALUES (?, 'default', ?, '', 'medium', 'in-progress', ?, 'codex', 1, ?, ?, ?)`);
  insert.run('pending', 'Pending', 'idle', 1, worktreePath, null);
  insert.run('orphan', 'Orphan', 'executing', null, worktreePath, null);
  insert.run('child', 'Child', 'planning', null, worktreePath, 'group');
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id').all();
  const groups = db.prepare('SELECT * FROM task_groups ORDER BY id').all();
  db.close();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, AGENTBOARD_ENABLE_AGENT_EXECUTION: '', AGENTBOARD_DISABLE_AGENT_STARTUP: '', DATABASE_URL: '', DB_PATH: dbPath, PORT: '0', AGENTBOARD_HOME: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`startup timed out: ${output}`)), 15_000);
      const capture = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('[server] listening on')) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', capture); child.stderr.on('data', capture);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`early exit ${code}: ${output}`)); });
    });
    const after = new Database(dbPath);
    try {
      assert.deepEqual(after.prepare('SELECT * FROM tasks ORDER BY id').all(), tasks);
      assert.deepEqual(after.prepare('SELECT * FROM task_groups ORDER BY id').all(), groups);
      assert.equal(readFileSync(worktreePath, 'utf8'), 'preserve user work');
      assert.match(output, /basic mode/);
    } finally { after.close(); }
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill('SIGTERM'); await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
