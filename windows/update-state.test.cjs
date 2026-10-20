'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeUpdateState } = require('./update-state.cjs');

test('publishes state JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-update-state-'));
  try {
    const file = path.join(dir, 'state.json');
    writeUpdateState(file, { phase: 'preparing', startedAt: '2026-10-20T19:00:00Z' });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).phase, 'preparing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('retries transient EPERM on rename without aborting update', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-update-state-'));
  try {
    const file = path.join(dir, 'state.json');
    let tries = 0;
    const io = { ...fs, renameSync: (...args) => {
      if (++tries < 3) { const error = new Error('busy'); error.code = 'EPERM'; throw error; }
      return fs.renameSync(...args);
    } };
    writeUpdateState(file, { phase: 'complete' }, { fs: io, sleep: () => {} });
    assert.equal(tries, 3);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).phase, 'complete');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fallback write when all atomic replace attempts are blocked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-update-state-'));
  try {
    const file = path.join(dir, 'state.json');
    fs.writeFileSync(file, '{}');
    const io = { ...fs, renameSync: () => { const error = new Error('blocked'); error.code = 'EPERM'; throw error; } };
    writeUpdateState(file, { phase: 'failed' }, { fs: io, sleep: () => {} });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).phase, 'failed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
