#!/usr/bin/env bash
# Checks every file against CHECKSUMS.sha256 and reports any file that is missing, changed or extra.
cd "$(dirname "$0")/.." || exit 1
[ -f CHECKSUMS.sha256 ] || { echo "CHECKSUMS.sha256 is missing"; exit 1; }
bad=0
sha256sum -c --quiet CHECKSUMS.sha256 || bad=1
extra=$(find . -type f -not -path './.git/*' -not -path '*/node_modules/*' -not -name CHECKSUMS.sha256 | sed 's#^\./##' | sort | comm -13 <(cut -c67- CHECKSUMS.sha256 | sort) -)
[ -n "$extra" ] && { echo "Files not in the checksum list:"; echo "$extra"; bad=1; }
[ $bad -eq 0 ] && echo "OK: every file matches CHECKSUMS.sha256" || { echo "MISMATCH: do not install until you know why."; exit 1; }
