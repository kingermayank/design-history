#!/usr/bin/env bash
# design-history post-commit hook
# Runs capture in the background so it never blocks your commit.
# Logs to .design-history/hook.log

set -u
LOG=".design-history/hook.log"
mkdir -p .design-history
SHA="$(git rev-parse HEAD 2>/dev/null || echo HEAD)"

# Detach: nohup + & so the commit returns instantly.
nohup npx --no-install design-history capture --commit "$SHA" \
  >> "$LOG" 2>&1 &

# Disown if available (bash/zsh) so the process is fully detached.
disown 2>/dev/null || true
exit 0
