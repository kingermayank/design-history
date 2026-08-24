/**
 * Decide whether a commit can be skipped because its diff is entirely
 * non-visual (docs, tests, lockfile-only, CI config, etc.). The default
 * pattern list is intentionally CONSERVATIVE — only skip when we're confident
 * the rendered UI cannot have changed. False negatives (capturing a no-op
 * commit) are fine; false positives (skipping a visual change) are not.
 */
import { spawnSync } from 'node:child_process';
import type { SkipPatternsConfig } from './types.js';

/**
 * Glob-ish patterns matched against POSIX-style repo-relative paths.
 * Supports:  `**` = any segments, `*` = anything-but-slash, `?` = single char.
 * Trailing `/` is treated as a directory marker (matches files inside).
 */
export const DEFAULT_SKIP_PATTERNS: string[] = [
  // Docs
  '**/*.md',
  '**/*.mdx',
  '**/*.txt',
  '**/README*',
  '**/CHANGELOG*',
  '**/LICENSE*',
  '**/CONTRIBUTING*',
  '**/CODE_OF_CONDUCT*',
  'docs/**',

  // Tests
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/__mocks__/**',
  'test/**',
  'tests/**',
  'e2e/**',
  'cypress/**',
  'playwright/**',
  '**/vitest.config.*',
  '**/jest.config.*',
  '**/jest.setup.*',
  '**/playwright.config.*',
  '**/cypress.config.*',

  // CI / repo meta
  '.github/**',
  '.gitlab-ci.yml',
  '.circleci/**',
  '.travis.yml',
  '.husky/**',

  // Editor / lint / format config (touching these shouldn't change runtime UI)
  '.vscode/**',
  '.idea/**',
  '.editorconfig',
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  '.nvmrc',
  '.node-version',
  '.tool-versions',
  '.eslintrc*',
  '.eslintignore',
  '.prettierrc*',
  '.prettierignore',
  'eslint.config.*',
  'prettier.config.*',
  '.stylelintrc*',
  '.commitlintrc*',
  'commitlint.config.*',

  // TypeScript configs that only affect typecheck, not runtime
  'tsconfig*.json',

  // Lockfiles — when they change ALONE without package.json, the visual
  // surface is almost never affected (it's dep tree shuffling, not new code).
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',

  // Server-only / build-tooling (cautiously skipped — opinionated)
  '**/*.dockerfile',
  'Dockerfile*',
  '.dockerignore',
  'docker-compose*.y*ml',
];

export interface SkipDecision {
  skip: boolean;
  /** Short human-readable explanation when skip=true. */
  reason?: string;
  /** Number of changed files we evaluated. */
  fileCount: number;
}

export function buildPatternSet(cfg: SkipPatternsConfig | undefined): string[] {
  const base = cfg?.patterns ?? DEFAULT_SKIP_PATTERNS;
  const extra = cfg?.extend ?? [];
  const removed = new Set(cfg?.remove ?? []);
  return [...base, ...extra].filter((p) => !removed.has(p));
}

export function shouldSkipCommit(
  projectRoot: string,
  sha: string,
  parentSha: string | null,
  patterns: string[],
): SkipDecision {
  if (!parentSha) {
    // Root commit — nothing to diff against. Always capture.
    return { skip: false, fileCount: 0 };
  }

  const changed = diffFiles(projectRoot, parentSha, sha);
  if (changed.length === 0) {
    // Empty diff (e.g. an amend with no file changes). Skip — nothing to render.
    return { skip: true, reason: 'no file changes', fileCount: 0 };
  }

  const unmatched: string[] = [];
  for (const file of changed) {
    if (!matchesAny(file, patterns)) {
      unmatched.push(file);
      if (unmatched.length > 3) break; // early exit; only need to know it's non-empty
    }
  }

  if (unmatched.length === 0) {
    return {
      skip: true,
      reason: summarize(changed),
      fileCount: changed.length,
    };
  }
  return { skip: false, fileCount: changed.length };
}

function diffFiles(projectRoot: string, parentSha: string, sha: string): string[] {
  const res = spawnSync(
    'git',
    ['diff', '--name-only', '-z', `${parentSha}..${sha}`],
    { cwd: projectRoot, encoding: 'utf8' },
  );
  if (res.status !== 0) return [];
  const out = res.stdout ?? '';
  return out
    .split('\0')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function summarize(files: string[]): string {
  if (files.length === 1) return `only changed ${files[0]}`;
  if (files.length <= 3) return `only changed ${files.join(', ')}`;
  return `${files.length} files, all non-visual (e.g. ${files[0]}, ${files[1]}, …)`;
}

// --- glob matcher --------------------------------------------------------
// Minimal, dependency-free. Sufficient for the patterns we ship.

const compileCache = new Map<string, RegExp>();

function compile(pattern: string): RegExp {
  const cached = compileCache.get(pattern);
  if (cached) return cached;
  // Build a regex from the glob.
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      // ** matches any number of segments (including empty + crossing /).
      // Consume an optional trailing slash so `docs/**` matches `docs/x/y`.
      if (pattern[i + 2] === '/') {
        re += '(?:.*\\/)?';
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
      continue;
    }
    if (c === '*') {
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }
    if (c === '.' || c === '+' || c === '(' || c === ')' || c === '|' || c === '^' || c === '$' || c === '[' || c === ']' || c === '{' || c === '}' || c === '\\') {
      re += '\\' + c;
      i += 1;
      continue;
    }
    re += c;
    i += 1;
  }
  // Anchor full string. Also allow the pattern to match nested files when it
  // doesn't include a slash (e.g. `package-lock.json` matches at any depth).
  const hasSlash = pattern.includes('/');
  const compiled = new RegExp(`^${hasSlash ? '' : '(?:.*\\/)?'}${re}$`);
  compileCache.set(pattern, compiled);
  return compiled;
}

function matchesAny(file: string, patterns: string[]): boolean {
  const normalized = file.replace(/\\/g, '/');
  return patterns.some((p) => compile(p).test(normalized));
}
