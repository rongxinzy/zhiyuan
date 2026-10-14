#!/usr/bin/env bash
set -euo pipefail

# Audit child package graphs without running lifecycle scripts or rewriting the
# checkout. Only committed lockfiles define dependency graphs to audit.
report_root="${1:?Usage: audit-npm-projects.sh <report-directory>}"
mkdir -p "$report_root"
report_root="$(cd "$report_root" && pwd)"
status=0
index=0
printf 'project\tgraph\tresult\n' > "$report_root/summary.tsv"
# A failing Git command in process substitution would otherwise be ignored.
git ls-files -z -- '*/package.json' > "$report_root/manifests.list"

while IFS= read -r -d '' manifest; do
  project="${manifest%/package.json}"
  git ls-files --error-unmatch "$project/package-lock.json" > /dev/null 2>&1 || continue
  index=$((index + 1))
  snapshot="$report_root/project-$index"
  mkdir -p "$snapshot"
  cp "$manifest" "$snapshot/package.json"
  graph='locked'
  cp "$project/package-lock.json" "$snapshot/package-lock.json"
  printf 'Auditing %s (%s)\n' "$project" "$graph"
  if (cd "$snapshot" && npm audit --package-lock-only --ignore-scripts --audit-level=high --json > audit.json 2> audit.stderr); then
    printf '%s\t%s\tpassed\n' "$project" "$graph" >> "$report_root/summary.tsv"
  else
    printf '%s\t%s\tfailed\n' "$project" "$graph" >> "$report_root/summary.tsv"
    cat "$snapshot/audit.json" "$snapshot/audit.stderr"
    status=1
  fi
done < "$report_root/manifests.list"

cat "$report_root/summary.tsv"
exit "$status"
