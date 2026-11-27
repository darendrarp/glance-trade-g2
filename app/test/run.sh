#!/bin/bash
# Unit-test runner: bundle the TS sources the tests import, then run Node.
# The bundle is written to a temp file (never committed); the test file
# imports it via the absolute /tmp path it is built to.
set -e
cd "$(dirname "$0")/.."
ENTRY=/tmp/gt-test-entry.ts
BUNDLE=/tmp/gt-bundle.mjs
printf 'export * from "%s/src/voice.ts"\nexport * from "%s/src/engine.ts"\n' "$PWD" "$PWD" > "$ENTRY"
npx esbuild "$ENTRY" --bundle --format=esm --outfile="$BUNDLE" \
  --define:import.meta.env.VITE_BACKEND_URL='"http://localhost:3001"' --log-level=error
node test/voice-engine.test.mjs
