#!/usr/bin/env bash
set -euo pipefail

# Configures the existing chatml-docs Vercel project:
# - Sets root directory, framework, and Git repo link
# - Adds docs.chatml.com domain
# - Outputs GitHub Secrets values

PROJECT_NAME="chatml-docs"
ROOT_DIRECTORY="docs-site"
DOMAIN="docs.chatml.com"
REPO_OWNER="chatml"
REPO_NAME="chatml"

echo "=== ChatML Docs Site — Vercel Configuration ==="
echo ""

# Prompt for token
read -rsp "Vercel API Token: " VERCEL_TOKEN
echo ""

# Prompt for team
read -rp "Vercel Team ID (leave empty for personal account): " TEAM_ID
echo ""

TEAM_PARAM=""
if [[ -n "$TEAM_ID" ]]; then
  TEAM_PARAM="?teamId=${TEAM_ID}"
fi

# Fetch existing project
echo "Fetching project '${PROJECT_NAME}'..."

PROJECT_RESPONSE=$(curl -s "https://api.vercel.com/v9/projects/${PROJECT_NAME}${TEAM_PARAM}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}")

PROJECT_ID=$(echo "$PROJECT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: Project '${PROJECT_NAME}' not found."
  echo "Response: $PROJECT_RESPONSE"
  exit 1
fi

echo "Found project: ${PROJECT_ID}"
echo ""

# Update project settings
echo "Updating project settings (rootDirectory, framework, git repo)..."

UPDATE_RESPONSE=$(curl -s -X PATCH "https://api.vercel.com/v9/projects/${PROJECT_ID}${TEAM_PARAM}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"framework\": \"nextjs\",
    \"rootDirectory\": \"${ROOT_DIRECTORY}\"
  }")

UPDATED_ROOT=$(echo "$UPDATE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('rootDirectory',''))" 2>/dev/null || true)

if [[ "$UPDATED_ROOT" == "$ROOT_DIRECTORY" ]]; then
  echo "Project settings updated successfully."
else
  echo "Update response:"
  echo "$UPDATE_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$UPDATE_RESPONSE"
fi
echo ""

# Add domain
echo "Adding domain '${DOMAIN}'..."

DOMAIN_RESPONSE=$(curl -s -X POST "https://api.vercel.com/v10/projects/${PROJECT_ID}/domains${TEAM_PARAM}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"${DOMAIN}\"}")

DOMAIN_VERIFIED=$(echo "$DOMAIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('verified', False))" 2>/dev/null || true)

echo "Domain response:"
echo "$DOMAIN_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$DOMAIN_RESPONSE"
echo ""

# Determine org ID
ORG_ID="${TEAM_ID}"
if [[ -z "$ORG_ID" ]]; then
  USER_RESPONSE=$(curl -s "https://api.vercel.com/v2/user" \
    -H "Authorization: Bearer ${VERCEL_TOKEN}")
  ORG_ID=$(echo "$USER_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('id',''))" 2>/dev/null || true)
fi

echo "==========================================="
echo "  Configuration Complete!"
echo "==========================================="
echo ""
echo "Add these as GitHub Secrets (Settings → Secrets → Actions):"
echo ""
echo "  VERCEL_TOKEN       = <your token>"
echo "  VERCEL_ORG_ID      = ${ORG_ID}"
echo "  VERCEL_PROJECT_ID  = ${PROJECT_ID}"
echo ""
echo "DNS Configuration:"
echo "  Add a CNAME record: docs → cname.vercel-dns.com"
echo ""
if [[ "$DOMAIN_VERIFIED" != "True" ]]; then
  echo "NOTE: Domain may need verification. Check Vercel dashboard for details."
fi
