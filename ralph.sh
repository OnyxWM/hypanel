#!/bin/bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

iterations="$1"

for ((i = 1; i <= iterations; i++)); do
  result="$(
    opencode run "@PRD.json" "@progress.txt" \
      "1. Read the PRD and progress file.
2. Find the highest-priority task and implement it.
3. Commit your changes.
4. Update the PRD with what was done.
5. Update progress.txt with what you did.
ONLY DO ONE TASK AT A TIME.
If the PRD is complete, output <promise>COMPLETE</promise>."
  )"

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "PRD complete after $i iterations."
    exit 0
  fi
done
