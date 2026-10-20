'use strict';
// Windows-aware persistence for the updater status file. In particular,
// readers and antivirus software may briefly prevent replacing state.json.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const transientCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);
function isTransient(error) {
  return error && transientCodes.has(error.code);
}
function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
function retry(operation, sleep = pause, count = 20) {
  for (let attempt = 0; attempt < count; attempt++) {
    try { return operation(); }
    catch (error) {
      if (!isTransient(error) || attempt === count - 1) throw error;
      sleep(Math.min(200, 40 + attempt * 15));
    }
  }
}
function writeUpdateState(filename, state, options = {}) {
  const io = options.fs || fs;
  const sleep = options.sleep || pause;
  io.mkdirSync(path.dirname(filename), { recursive: true });
  const tmp = filename + '.tmp-' + process.pid + '-' + randomUUID();
  const payload = JSON.stringify(state, null, 2) + '\n';
  io.writeFileSync(tmp, payload, { encoding: 'utf8', flag: 'wx' });
  try {
    try {
      // Preferred: replace atomically. Retry Windows transient sharing errors.
      retry(() => io.renameSync(tmp, filename), sleep);
    } catch (error) {
      if (!isTransient(error)) throw error;
      // If replacement stays blocked, writing existing state is preferable to
      // aborting a valid update. Readers retry incomplete JSON during this rare fallback.
      retry(() => io.writeFileSync(filename, payload, 'utf8'), sleep);
    }
  } finally {
    try { io.unlinkSync(tmp); }
    catch (error) { if (error.code !== 'ENOENT' && options.onCleanupError) options.onCleanupError(error); }
  }
}
module.exports = { writeUpdateState, isTransient };
