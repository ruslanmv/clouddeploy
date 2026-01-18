#!/usr/bin/env bash
# Build Composer UI and copy dist to clouddeploy/web/composer

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSER_UI="$PROJECT_ROOT/composer-ui"
TARGET="$PROJECT_ROOT/clouddeploy/web/composer"

echo "Building Composer UI..."
pushd "$COMPOSER_UI" > /dev/null

npm install
npm run build

popd > /dev/null

echo "Copying build artifacts to $TARGET..."
mkdir -p "$TARGET"
cp -R "$COMPOSER_UI/dist/"* "$TARGET/"

echo "Composer UI build complete!"
