import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBoardUpdateAuthorization } from '../src/services/board-update-authorization.js';
import type { GithubPrStatus } from '../src/services/github-pr.js';

const pr: GithubPrStatus = {
  url: 'https://github.com/example/board/pull/3', number: 3, state: 'MERGED',
  isDraft: false, mergeable: 'MERGEABLE', reviewDecision: '',
  headRefName: 'feature/new-ui', baseRefName: 'windows-m1',
};
const good = () => ({
  taskBranch: 'feature/new-ui', taskBase: 'windows-m1', boardBranch: 'windows-m1',
  boardRepository: 'example/board', taskRepository: 'example/board', pr,
});
test('merged PR for same repo and Board branch is eligible', () => assert.doesNotThrow(() => assertBoardUpdateAuthorization(good())));
test('unmerged PR is rejected', () => assert.throws(() => assertBoardUpdateAuthorization({ ...good(), pr: { ...pr, state: 'OPEN' } }), /not been merged/));
test('PR for a different base does not upgrade Board', () => assert.throws(() => assertBoardUpdateAuthorization({ ...good(), pr: { ...pr, baseRefName: 'test/pr-base' } }), /target/));
test('task branch mismatch is rejected', () => assert.throws(() => assertBoardUpdateAuthorization({ ...good(), taskBranch: 'feature/other' }), /source branch/));
test('different repository is rejected', () => assert.throws(() => assertBoardUpdateAuthorization({ ...good(), taskRepository: 'someone/other' }), /different GitHub repository/));
test('Board branch mismatch is rejected', () => assert.throws(() => assertBoardUpdateAuthorization({ ...good(), boardBranch: 'main' }), /active Board branch/));
test('missing PR is rejected', () => assert.throws(() => assertBoardUpdateAuthorization({ ...good(), pr: null }), /not been merged/));
