import { execFileSync, spawnSync } from 'node:child_process';
import type { GitMeta } from './types.js';

function gitSync(args: string[], cwd: string): string {
  const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.trim();
}

function gitSafe(args: string[], cwd: string): string | null {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) return null;
  return res.stdout.trim();
}

export function isGitRepo(cwd: string): boolean {
  return gitSafe(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
}

export function getRepoRoot(cwd: string): string {
  const root = gitSafe(['rev-parse', '--show-toplevel'], cwd);
  if (!root) throw new Error('Not inside a git repository.');
  return root;
}

export function currentBranch(cwd: string): string {
  return gitSafe(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) ?? 'detached';
}

export function readCommitMeta(cwd: string, sha?: string): GitMeta {
  const target = sha ?? 'HEAD';
  const full = gitSync(['rev-parse', target], cwd);
  const short = gitSync(['rev-parse', '--short', target], cwd);
  const message = gitSync(['log', '-1', '--pretty=%s', target], cwd);
  const author = gitSync(['log', '-1', '--pretty=%an', target], cwd);
  const authorEmail = gitSync(['log', '-1', '--pretty=%ae', target], cwd);
  const isoTime = gitSync(['log', '-1', '--pretty=%aI', target], cwd);
  const branch = currentBranch(cwd);
  return { sha: full, shortSha: short, message, author, authorEmail, branch, isoTime };
}

export interface CommitListItem {
  sha: string;
  shortSha: string;
  message: string;
  isoTime: string;
  isMerge: boolean;
}

export function listCommits(
  cwd: string,
  options: { branch?: string; from?: string; limit?: number; skipMerges?: boolean } = {},
): CommitListItem[] {
  const range = options.from ? `${options.from}..HEAD` : (options.branch ?? 'HEAD');
  const args = ['log', range, '--reverse', '--pretty=%H%x09%h%x09%aI%x09%P%x09%s'];
  const out = gitSync(args, cwd);
  if (!out) return [];
  const items = out.split('\n').map((line) => {
    const parts = line.split('\t');
    const sha = parts[0] ?? '';
    const shortSha = parts[1] ?? '';
    const isoTime = parts[2] ?? '';
    const parents = (parts[3] ?? '').trim().split(/\s+/).filter(Boolean);
    const message = parts.slice(4).join('\t') ?? '';
    return { sha, shortSha, isoTime, message, isMerge: parents.length > 1 };
  });
  const filtered = options.skipMerges ? items.filter((c) => !c.isMerge) : items;
  return options.limit ? filtered.slice(-options.limit) : filtered;
}

export function addWorktree(cwd: string, dir: string, sha: string): void {
  execFileSync('git', ['worktree', 'add', '--detach', dir, sha], { cwd, stdio: 'ignore' });
}

export function checkoutWorktree(dir: string, sha: string): void {
  execFileSync('git', ['checkout', '--detach', '--force', sha], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['clean', '-fd'], { cwd: dir, stdio: 'ignore' });
}

export function removeWorktree(cwd: string, dir: string): void {
  spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd, stdio: 'ignore' });
}

export function pruneWorktrees(cwd: string): void {
  spawnSync('git', ['worktree', 'prune'], { cwd, stdio: 'ignore' });
}

export interface DiffFile {
  file: string;
  added: number;
  removed: number;
}
export interface CommitDiff {
  parent: string | null;
  files: DiffFile[];
  patch: string;
  truncated: boolean;
}

/** The code changes a commit introduced: per-file line counts + the patch text. */
export function getCommitDiff(cwd: string, sha: string): CommitDiff {
  const parent = gitSafe(['rev-parse', '--verify', `${sha}^`], cwd);
  const numstat = parent
    ? gitSafe(['diff', '--numstat', `${parent}..${sha}`], cwd)
    : gitSafe(['show', '--numstat', '--format=', sha], cwd);
  const files: DiffFile[] = (numstat ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const parts = l.split('\t');
      const added = parts[0] === '-' ? 0 : parseInt(parts[0] ?? '0', 10) || 0;
      const removed = parts[1] === '-' ? 0 : parseInt(parts[1] ?? '0', 10) || 0;
      return { file: parts.slice(2).join('\t'), added, removed };
    });
  const rawPatch = parent
    ? gitSafe(['diff', `${parent}..${sha}`], cwd)
    : gitSafe(['show', '--format=', sha], cwd);
  const LIMIT = 200_000;
  const full = rawPatch ?? '';
  return { parent, files, patch: full.slice(0, LIMIT), truncated: full.length > LIMIT };
}

/**
 * Create (or move) a branch pointing at `sha` so the user can restore that
 * version. Non-destructive: it does NOT switch branches or touch the working
 * tree. Returns the branch name and the command to switch to it.
 */
export function createRestoreBranch(cwd: string, sha: string): { branch: string; switchCommand: string } {
  const short = gitSync(['rev-parse', '--short', sha], cwd);
  const branch = `design-history/restore-${short}`;
  execFileSync('git', ['branch', '-f', branch, sha], { cwd, stdio: 'ignore' });
  return { branch, switchCommand: `git switch ${branch}` };
}
