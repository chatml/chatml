#!/usr/bin/env bash
# Generate a categorized changelog from conventional commits since the last tag.
# Usage: ./scripts/changelog.sh [FROM_TAG]

set -euo pipefail

FROM_TAG="${1:-$(git describe --tags --abbrev=0 2>/dev/null || echo "")}"

if [ -z "$FROM_TAG" ]; then
  echo "No tags found. Cannot generate changelog."
  exit 1
fi

features=""
fixes=""
other=""

while IFS= read -r line; do
  # Skip release commits
  [[ "$line" =~ ^release: ]] && continue

  # Categorize and strip prefix
  if [[ "$line" =~ ^feat(\(.+\))?:\ (.+) ]]; then
    features+="- ${BASH_REMATCH[2]}"$'\n'
  elif [[ "$line" =~ ^fix(\(.+\))?:\ (.+) ]]; then
    fixes+="- ${BASH_REMATCH[2]}"$'\n'
  else
    # Strip any conventional commit prefix (word + optional scope + colon)
    stripped=$(echo "$line" | sed 's/^[a-z]*\([^)]*\): //')
    other+="- ${stripped}"$'\n'
  fi
done < <(git log "${FROM_TAG}..HEAD" --pretty=format:"%s")

# Build output
output="## What's Changed"$'\n'

if [ -n "$features" ]; then
  output+=$'\n'"### Features"$'\n'
  output+="${features}"
fi

if [ -n "$fixes" ]; then
  output+=$'\n'"### Fixes"$'\n'
  output+="${fixes}"
fi

if [ -n "$other" ]; then
  output+=$'\n'"### Other"$'\n'
  output+="${other}"
fi

echo "$output"
