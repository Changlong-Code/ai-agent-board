import { execFileSync } from 'node:child_process';

export interface GithubPrStatus {
  url: string;
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | '';
  baseRefName: string;
  headRefName: string;
}
type Run = (exe: string, args: string[], cwd: string) => string;
const defaultRun: Run = (exe, args, cwd) => execFileSync(exe, args, {
  cwd, stdio: 'pipe', encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
}).trim();

export function parseGithubRemote(url: string): string | null {
  const clean = url.trim();
  const match = clean.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  return match ? match[1] + '/' + match[2].replace(/\.git$/i, '') : null;
}
export function findGithubRemote(cwd: string, run: Run = defaultRun) {
  const remotes = run('git', ['remote'], cwd).split(/\r?\n/).filter(Boolean);
  for (const name of ['source', 'origin', ...remotes]) {
    if (!remotes.includes(name)) continue;
    const repository = parseGithubRemote(run('git', ['remote', 'get-url', name], cwd));
    if (repository) return { name, repository };
  }
  throw new Error('No GitHub remote configured. Add origin or source to this local repository.');
}
function gh(args: string[], cwd: string, run: Run): string {
  try { return run('gh', args, cwd); }
  catch (e) {
    const error = e as Error & { stderr?: Buffer | string };
    const reason = (error.stderr?.toString() || error.message).trim().slice(0, 1200);
    throw new Error('GitHub CLI failed. Check that gh is installed and run gh auth login. ' + reason);
  }
}
export function getGithubPr(cwd: string, branch: string, base?: string, run: Run = defaultRun): GithubPrStatus | null {
  const { repository } = findGithubRemote(cwd, run);
  // "gh pr view <branch>" sometimes fails to resolve an existing PR after
  // changing its base branch. Listing by head is stable and includes OPEN,
  // CLOSED and MERGED PRs.
  const data = gh(['pr', 'list', '--repo', repository, '--head', branch,
    '--state', 'all', '--limit', '100', '--json',
    'url,number,state,isDraft,mergeable,reviewDecision,baseRefName,headRefName'], cwd, run);
  const results = JSON.parse(data) as GithubPrStatus[];
  if (!Array.isArray(results)) throw new Error('Unexpected GitHub PR list response.');
  const matches = results.filter(pr => pr.headRefName === branch);
  const scoped = base ? matches.filter(pr => pr.baseRefName === base) : matches;
  return scoped.find(pr => pr.state === 'OPEN') || scoped[0] || null;
}
export function mergeGithubPr(cwd: string, branch: string, base: string, confirmed: boolean, run: Run = defaultRun): GithubPrStatus {
  if (!confirmed) throw new Error('Explicit user confirmation is required to merge on GitHub.');
  const remote = findGithubRemote(cwd, run);
  const pr = getGithubPr(cwd, branch, base, run);
  if (!pr) throw new Error('Create a GitHub PR before merging.');
  if (pr.state !== 'OPEN') throw new Error('PR is not open.');
  if (pr.isDraft) throw new Error('Mark the draft PR ready for review before merging.');
  if (pr.baseRefName !== base) throw new Error('PR base branch does not match task base branch.');
  if (pr.mergeable === 'CONFLICTING') throw new Error('PR has merge conflicts.');
  if (pr.reviewDecision === 'CHANGES_REQUESTED' || pr.reviewDecision === 'REVIEW_REQUIRED')
    throw new Error('GitHub review is required before merging.');
  gh(['pr', 'merge', String(pr.number), '--repo', remote.repository, '--merge'], cwd, run);
  const merged = getGithubPr(cwd, branch, base, run);
  if (!merged || merged.state !== 'MERGED') throw new Error('GitHub did not confirm the PR as merged.');
  return merged;
}

/**
 * Explicit, non-destructive synchronization of a merged GitHub PR's base
 * branch into a separate local project clone. Never rebase, force reset,
 * auto-stash, or rewrite a working tree.
 */
export function syncMergedGithubPr(cwd: string, headBranch: string, baseBranch: string,
  confirmed: boolean, run: Run = defaultRun): { branch: string; commit: string; changed: boolean } {
  if (!confirmed) throw new Error('Confirm local synchronization before changing branches.');
  const pr = getGithubPr(cwd, headBranch, baseBranch, run);
  if (!pr || pr.state !== 'MERGED') throw new Error('GitHub PR must be merged before local synchronization.');
  if (pr.headRefName !== headBranch || pr.baseRefName !== baseBranch)
    throw new Error('GitHub PR branch does not match this task.');

  const currentBranch = run('git', ['branch', '--show-current'], cwd);
  if (!currentBranch) throw new Error('Cannot synchronize a detached HEAD.');
  if (run('git', ['status', '--porcelain'], cwd)) {
    throw new Error('Local changes detected. Commit, stash or remove them manually before synchronization.');
  }

  const { name: remoteName } = findGithubRemote(cwd, run);
  run('git', ['fetch', '--no-tags', remoteName, baseBranch], cwd);
  const trackingRef = 'refs/remotes/' + remoteName + '/' + baseBranch;
  const remoteCommit = run('git', ['rev-parse', '--verify', trackingRef], cwd);
  const localRef = 'refs/heads/' + baseBranch;
  let previousCommit: string | null = null;
  let exists = false;
  try {
    run('git', ['show-ref', '--verify', '--quiet', localRef], cwd);
    exists = true;
  } catch { /* Local base branch not yet created. */ }

  if (exists) {
    // Reject divergence before switching the checkout; no history rewrite.
    const localCommit = run('git', ['rev-parse', '--verify', localRef], cwd);
    previousCommit = localCommit;
    if (localCommit !== remoteCommit) {
      try { run('git', ['merge-base', '--is-ancestor', localRef, trackingRef], cwd); }
      catch { throw new Error('Local base branch diverged from GitHub. Resolve manually; no changes applied.'); }
    }
    if (currentBranch !== baseBranch) run('git', ['switch', baseBranch], cwd);
    if (localCommit !== remoteCommit) run('git', ['merge', '--ff-only', trackingRef], cwd);
  } else {
    run('git', ['switch', '--track', '-c', baseBranch, remoteName + '/' + baseBranch], cwd);
  }

  const commit = run('git', ['rev-parse', 'HEAD'], cwd);
  if (commit !== remoteCommit) throw new Error('Local branch differs from the fetched remote after synchronization.');
  return { branch: baseBranch, commit, changed: currentBranch !== baseBranch || !exists || previousCommit !== remoteCommit };
}
