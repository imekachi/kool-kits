#!/usr/bin/env bash
# Cursor afterFileEdit hook: run pnpm format on .js, .html, .json files when the agent edits them.
# Runs from project root; receives JSON with file_path (absolute) on stdin.

set -e
json_input=$(cat)
file_path=$(echo "$json_input" | jq -r '.file_path // empty')

if [[ -z "$file_path" ]]; then
  exit 0
fi

# Skip files outside the project directory. The exact-match and slash-prefix
# checks prevent false positives from sibling dirs that share a prefix
# (e.g. /repo-copy when project is /repo).
if [[ -n "${CURSOR_PROJECT_DIR:-}" && "$file_path" != "$CURSOR_PROJECT_DIR" && "$file_path" != "$CURSOR_PROJECT_DIR/"* ]]; then
  exit 0
fi

case "$file_path" in
  *.js|*.html|*.json) ;;
  *) exit 0 ;;
esac

# Send all output to stderr so Cursor doesn't parse it as JSON
pnpm format "$file_path" >&2 2>&1
exit 0
