import type { GithubPrStatus } from './github-pr.js';

/** Pure PR authorization gate. Keep it independent of I/O for regression tests. */
export interface BoardUpdateAuthorization {
  taskBranch: string;
  taskBase: string;
  boardBranch: string;
  boardRepository: string;
  taskRepository: string;
  pr: GithubPrStatus | null;
}
export function assertBoardUpdateAuthorization(input: BoardUpdateAuthorization): void {
  const { taskBranch, taskBase, boardBranch, boardRepository, taskRepository, pr } = input;
  if (!taskBranch || !taskBase || !boardBranch) throw new Error('Missing task or Board branch');
  if (!pr || pr.state !== 'MERGED') throw new Error('Task PR has not been merged on GitHub');
  if (pr.headRefName !== taskBranch) throw new Error('PR source branch differs from task branch');
  if (pr.baseRefName !== taskBase) throw new Error('PR target differs from task target branch');
  if (pr.baseRefName !== boardBranch) throw new Error('PR target differs from active Board branch');
  if (!boardRepository || !taskRepository || boardRepository.toLowerCase() !== taskRepository.toLowerCase()) {
    throw new Error('Task PR targets a different GitHub repository');
  }
}
