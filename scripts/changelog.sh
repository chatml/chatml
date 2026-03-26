#!/usr/bin/env bash
# Generate a categorized changelog for a release.
# Writes to releases/v{VERSION}.md and prints to stdout.
# Usage: ./scripts/changelog.sh VERSION
#   VERSION: semver like 0.1.17 (without v prefix)

set -euo pipefail

VERSION="${1:?Usage: ./scripts/changelog.sh VERSION}"

# Compute previous tag: list all v* tags, exclude the target version, sort by semver, take the last one.
# This works whether or not v${VERSION} tag already exists.
PREV_TAG=$(
  git tag -l 'v*' \
  | grep -v "^v${VERSION}$" \
  | sort -V \
  | tail -1
) || true

if [ -z "$PREV_TAG" ]; then
  echo "Error: No previous version tag found." >&2
  exit 1
fi

echo "Changelog: ${PREV_TAG}..origin/main" >&2

# Categorize commits
features=""
fixes=""
other=""

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^release: ]] && continue

  if [[ "$line" =~ ^feat(\(.+\))?:\ (.+) ]]; then
    features+="- ${BASH_REMATCH[2]}"$'\n'
  elif [[ "$line" =~ ^fix(\(.+\))?:\ (.+) ]]; then
    fixes+="- ${BASH_REMATCH[2]}"$'\n'
  else
    stripped=$(echo "$line" | sed 's/^[a-z]*\([^)]*\): //')
    other+="- ${stripped}"$'\n'
  fi
# Note: origin/main must be up-to-date (make release runs git pull before this script)
done < <(git log "${PREV_TAG}..origin/main" --pretty=format:"%s")

# Build output with frontmatter
DATE=$(date +%Y-%m-%d)
OUTPUT_FILE="releases/v${VERSION}.md"
mkdir -p releases

{
  echo "---"
  echo "version: ${VERSION}"
  echo "date: ${DATE}"
  echo "---"
  echo ""
  echo "## What's Changed"

  if [ -n "$features" ]; then
    echo ""
    echo "### Features"
    printf "%s" "$features"
  fi

  if [ -n "$fixes" ]; then
    echo ""
    echo "### Fixes"
    printf "%s" "$fixes"
  fi

  if [ -n "$other" ]; then
    echo ""
    echo "### Other"
    printf "%s" "$other"
  fi
} > "$OUTPUT_FILE"

echo "Written to ${OUTPUT_FILE}" >&2
