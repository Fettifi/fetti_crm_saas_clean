#!/bin/bash
set -e

echo "🔍 Running Validation..."

echo "1️⃣  Type Checking..."
npx tsc --noEmit
echo "✅ Type Check Passed"

echo "🎉 All checks passed! Safe to push."
