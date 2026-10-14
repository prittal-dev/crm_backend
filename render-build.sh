#!/usr/bin/env bash
# Exit immediately if a command exits with a non-zero status
set -o errexit

echo ">>> Installing dependencies..."
npm install

echo ">>> Installing Chrome for Puppeteer into project cache..."
npx puppeteer browsers install chrome

echo ">>> Build completed successfully!"
