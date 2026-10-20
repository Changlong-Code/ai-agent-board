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
  return match ? match[1] + '/' + match[2] : null;
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
export function getGithubPr(cwd: string, branch: string, run: Run = defaultRun): GithubPrStatus | null {
  const { repository } = findGithubRemote(cwd, run);
  try {
    const data = gh(['pr', 'view', branch, '--repo', repository, '--json',
      'url,number,state,isDraft,mergeable,reviewDecision,baseRefName,headRefName'], cwd, run);
    const status = JSON.parse(data) as GithubPrStatus;
    if (status.headRefName !== branch) throw new Error('PR head branch mismatch');
    return status;
  } catch (error) {
    // A missing PR is different from a missing or unauthenticated GitHub CLI.
    const message = error instanceof Error ? error.message : String(error);
    if (/no pull requests found|could not resolve to a pull request/i.test(message)) return null;
    throw error;
  }
}
export function mergeGithubPr(cwd: string, branch: string, base: string, confirmed: boolean, run: Run = defaultRun): GithubPrStatus {
  if (!confirmed) throw new Error('Explicit user confirmation is required to merge on GitHub.');
  const remote = findGithubRemote(cwd, run);
  const pr = getGithubPr(cwd, branch, run);
  if (!pr) throw new Error('Create a GitHub PR before merging.');
  if (pr.state !== 'OPEN') throw new Error('PR is not open.');
  if (pr.isDraft) throw new Error('Mark the draft PR ready for review before merging.');
  if (pr.baseRefName !== base) throw new Error('PR base branch does not match task base branch.');
  if (pr.mergeable === 'CONFLICTING') throw new Error('PR has merge conflicts.');
  if (pr.reviewDecision === 'CHANGES_REQUESTED' || pr.reviewDecision === 'REVIEW_REQUIRED')
    throw new Error('GitHub review is required before merging.');
  gh(['pr', 'merge', String(pr.number), '--repo', remote.repository, '--merge'], cwd, run);
  const merged = getGithubPr(cwd, branch, run);
  if (!merged || merged.state !== 'MERGED') throw new Error('GitHub did not confirm the PR as merged.');
  return merged;
}
