#!/bin/bash
# Setup script for Tauri update signing keys
# Run this once to generate your signing keys

set -e

KEY_DIR="$HOME/.tauri"
KEY_FILE="$KEY_DIR/chatml.key"
PUB_FILE="$KEY_DIR/chatml.key.pub"

echo "=== Tauri Update Signing Key Setup ==="
echo ""

# Create key directory
mkdir -p "$KEY_DIR"

# Check if keys already exist
if [ -f "$KEY_FILE" ]; then
    echo "WARNING: Keys already exist at $KEY_FILE"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Generate signing keys
echo "Generating signing keys..."
echo ""

# Prompt for password
read -s -p "Enter password for the private key (press Enter for no password): " PASSWORD
echo ""

if [ -z "$PASSWORD" ]; then
    npx @tauri-apps/cli signer generate -w "$KEY_FILE"
else
    npx @tauri-apps/cli signer generate -w "$KEY_FILE" -p "$PASSWORD"
fi

echo ""
echo "=== Keys Generated Successfully ==="
echo ""
echo "Private key: $KEY_FILE"
echo "Public key:  $PUB_FILE"
echo ""
echo "=== Next Steps ==="
echo ""
echo "1. Copy your PUBLIC key and update tauri.conf.json:"
echo ""
cat "$PUB_FILE"
echo ""
echo ""
echo "2. Add these secrets to your GitHub repository:"
echo "   Settings → Secrets and variables → Actions → New repository secret"
echo ""
echo "   TAURI_SIGNING_PRIVATE_KEY:"
echo "   (Copy the entire content of $KEY_FILE)"
echo ""
if [ -n "$PASSWORD" ]; then
    echo "   TAURI_SIGNING_PRIVATE_KEY_PASSWORD: <your password>"
    echo ""
fi
echo ""
echo "3. Update the 'endpoints' URL in tauri.conf.json with your GitHub repo:"
echo "   https://github.com/YOUR_USERNAME/chatml/releases/latest/download/latest.json"
echo ""
echo "=== IMPORTANT: Keep your private key safe! ==="
echo "Back it up securely. You'll need it for all future updates."
echo "Anyone with this key can sign fake updates."
