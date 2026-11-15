#!/usr/bin/env bash
# Before publishing: fails if the repo holds personal data, memory files, logs, or absolute home paths.
cd "$(dirname "$0")/.." || exit 1
bad=0
bad_files=$(find . -type f \( -name '*.jsonl' -o -name 'memory.json' -o -name 'cold.json.gz' -o -name 'corrections.json' -o -name 'config.env' -o -name 'window-*.json' -o -name '*.bak-*' -o -name '.env' -o -name '*.log' \) -not -path './.git/*' -not -path '*/node_modules/*')
[ -n "$bad_files" ] && { echo "Data or backup files present:"; echo "$bad_files"; bad=1; }
hits=$(grep -rnIE "/home/[a-z]+|/Users/[a-z]+|/media/[a-z]+|@gmail|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20}|gho_[A-Za-z0-9]{20}|password *=|BEGIN (RSA|OPENSSH|PRIVATE)" . --exclude-dir=.git --exclude-dir=node_modules --exclude=check-clean.sh --exclude=SAFETY.md | grep -vE "/home/\\\$|/home/josh/\.config" )
[ -n "$hits" ] && { echo "Possible personal paths or secrets:"; echo "$hits"; bad=1; }
[ $bad -eq 0 ] && echo "CLEAN: no personal data, secrets or home paths found" || exit 1
