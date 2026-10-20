'use strict';
// One-shot fault injection for isolated Windows rollback acceptance testing.
// This module never enables faults automatically and never accepts a production home.
const fs = require('node:fs');
const path = require('node:path');

const SHA = /^[0-9a-f]{40}$/i;
function samePath(a, b) {
  return path.resolve(a).replace(/[\\/]+$/, '').toLowerCase() ===
    path.resolve(b).replace(/[\\/]+$/, '').toLowerCase();
}
function isIsolatedTest(home, root, ports) {
  const parent = path.dirname(home);
  return process.platform === 'win32' &&
    path.basename(home).toLowerCase() === 'data' &&
    path.basename(parent).toLowerCase() === 'ai-agent-board-selfupdate-test' &&
    samePath(root, path.join(parent, 'code')) &&
    ports && ports.board === 8876 && ports.api === 8877;
}
function validateFaultMarker(marker, context) {
  if (!isIsolatedTest(context.home, context.root, context.ports)) return false;
  if (!marker || marker.kind !== 'rollback-after-build' ||
      typeof marker.prior !== 'string' || typeof marker.target !== 'string' ||
      !SHA.test(marker.prior) || !SHA.test(marker.target) ||
      !SHA.test(context.prior || '') || !SHA.test(context.target || '') ||
      !samePath(marker.home || '', context.home) || !samePath(marker.root || '', context.root)) return false;
  if (marker.prior !== context.prior || marker.target !== context.target ||
      marker.prior === marker.target) return false;
  const now = context.now || Date.now();
  return Number.isSafeInteger(marker.expiresAt) && marker.expiresAt > now &&
    marker.expiresAt <= now + 10 * 60 * 1000;
}
function maybeInjectRollbackFault(context) {
  if (!isIsolatedTest(context.home, context.root, context.ports)) return false;
  const file = path.join(context.home, 'updates', 'rollback-test-once.json');
  if (!fs.existsSync(file)) return false;
  const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!validateFaultMarker(marker, context)) {
    throw new Error('Invalid or expired isolated rollback test marker. No fault injected.');
  }
  // Consume before triggering rollback: the test must never recur on restart.
  fs.unlinkSync(file);
  return true;
}
module.exports = { isIsolatedTest, validateFaultMarker, maybeInjectRollbackFault };
