#!/usr/bin/env bash
# Rewrites CHECKSUMS.sha256 for every file in the repo (run after any change, before tagging).
cd "$(dirname "$0")/.." || exit 1
find . -type f -not -path './.git/*' -not -path '*/node_modules/*' -not -name CHECKSUMS.sha256 -print0 | sort -z | xargs -0 sha256sum | sed 's#  \./#  #' > CHECKSUMS.sha256
echo "wrote CHECKSUMS.sha256 ($(wc -l < CHECKSUMS.sha256) files)"
