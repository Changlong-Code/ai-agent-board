'use strict';
/** Decide if a rollback may touch tracked files. No side effects here. */
function rollbackDecision({ switched, prior, target, head, dirty }) {
  if (!switched) return 'skip';
  if (!prior || !target) return 'manual-recovery-required';
  if (dirty) return 'manual-recovery-required';
  if (head === prior) return 'already-restored';
  if (head !== target) return 'manual-recovery-required';
  return 'restore-prior';
}
module.exports = { rollbackDecision };
