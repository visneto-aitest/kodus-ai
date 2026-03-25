#!/bin/bash
#
# Step 2: Extract from MongoDB + Judge with Sonnet
#
# Usage:
#   ./benchmark-evaluate.sh [TOTAL_PRS]                    # extract + judge
#   ./benchmark-evaluate.sh [TOTAL_PRS] --extract-only     # just extract, skip judge
#
# Requires: ANTHROPIC_API_KEY for judge (or use --extract-only)
#
set -euo pipefail

TOTAL_PRS=${1:-20}
EXTRACT_ONLY=false
if [[ "${2:-}" == "--extract-only" ]]; then
  EXTRACT_ONLY=true
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OWNER="ai-code-review-benchmark"
RESULTS_DIR="$REPO_DIR/scripts/benchmark/results"
mkdir -p "$RESULTS_DIR"

cd "$REPO_DIR"

# Always load from .env — the shell may have a different ANTHROPIC_API_KEY (e.g. Claude Code's key)
if [ -f ".env" ]; then
  _KEY=$(grep -E "^API_ANTHROPIC_API_KEY=|^ANTHROPIC_API_KEY=" .env | head -1 | cut -d= -f2-)
  if [ -n "$_KEY" ]; then
    export ANTHROPIC_API_KEY="$_KEY"
  fi
fi

echo "============================================================"
echo "Benchmark — Evaluate"
echo "============================================================"
echo ""

# ── Extract from MongoDB ─────────────────────────────────────────
echo "▸ Extracting suggestions from MongoDB..."

node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const benchmark = JSON.parse(fs.readFileSync('scripts/benchmark/prs-benchmark.json', 'utf8'));
const owner = '$OWNER';
const totalPrs = $TOTAL_PRS;
const repos = ['sentry', 'grafana-codex', 'discourse-cursor', 'cal.com', 'keycloak'];
const perRepo = Math.ceil(totalPrs / repos.length);

const byRepo = {};
for (const pr of benchmark.prs) {
  const repo = pr.repo.split('/').pop();
  if (!byRepo[repo]) byRepo[repo] = [];
  byRepo[repo].push(pr);
}

const mongoCmd = (query) => {
  return execSync(
    \"docker exec mongodb mongosh -u kodusdev -p 123456 --authenticationDatabase admin kodus_db --quiet --eval '\" + query.replace(/'/g, \"'\\\\''\") + \"'\",
    { encoding: 'utf8', timeout: 30000 }
  ).trim();
};

const results = { all: [], issueOnly: [], issueCritical: [] };
const golden = [];

for (const repo of repos) {
  const benchPrs = (byRepo[repo] || []).slice(0, perRepo);

  for (const bpr of benchPrs) {
    golden.push(bpr);

    let prData;
    try {
      const query = 'JSON.stringify(db.pullRequests.findOne({headBranchRef: \"' + bpr.head + '\"}, {number: 1, files: 1}))';
      const raw = mongoCmd(query);
      prData = JSON.parse(raw);
    } catch { prData = null; }

    const suggestions = { issueCritical: [], withWarning: [] };

    if (prData && prData.files) {
      for (const file of prData.files) {
        if (!file.suggestions) continue;
        for (const s of file.suggestions) {
          if (!s.suggestionContent || s.suggestionContent.length < 20) continue;
          const entry = {
            comment: (s.suggestionContent || '').substring(0, 500),
            location: (s.relevantFile || file.filename) + ':' + (s.relevantLinesStart || 'general'),
            level: s.level || 'unknown',
            severity: s.severity || 'unknown',
            label: s.label || 'unknown',
            deliveryStatus: s.deliveryStatus || 'unknown',
          };
          if (s.level === 'issue' || s.level === 'critical') suggestions.issueCritical.push(entry);
          if (s.level === 'issue' || s.level === 'critical' || s.level === 'warning') suggestions.withWarning.push(entry);
        }
      }
    }

    const prInfo = { pr_title: bpr.title, head: bpr.head, repo: repo, tool: 'kodus' };
    results.issueCritical.push({ ...prInfo, issues: suggestions.issueCritical });
    results.withWarning.push({ ...prInfo, issues: suggestions.withWarning });

    const prNum = prData ? prData.number : '?';
    console.log(repo.padEnd(18) + ' PR#' + String(prNum).padEnd(5) + ' issue+critical=' + String(suggestions.issueCritical.length).padStart(2) + '  +warning=' + String(suggestions.withWarning.length).padStart(2));
  }
}

fs.writeFileSync('$RESULTS_DIR/golden.json', JSON.stringify(golden, null, 2));
fs.writeFileSync('$RESULTS_DIR/candidates-issue-critical.json', JSON.stringify(results.issueCritical, null, 2));
fs.writeFileSync('$RESULTS_DIR/candidates-with-warning.json', JSON.stringify(results.withWarning, null, 2));

const totalGolden = golden.reduce((s,p) => s + p.golden_comments.length, 0);
console.log('');
console.log('Golden: ' + totalGolden + ' comments across ' + golden.length + ' PRs');
console.log('Candidates: issue+critical=' + results.issueCritical.reduce((s,c) => s + c.issues.length, 0) + '  +warning=' + results.withWarning.reduce((s,c) => s + c.issues.length, 0));
"

echo "  ✓ Extracted to $RESULTS_DIR/"

if [ "$EXTRACT_ONLY" = true ]; then
  echo ""
  echo "Extract only — skipping judge."
  echo "Run with ANTHROPIC_API_KEY to judge, or use /benchmark agent mode."
  exit 0
fi

# ── Judge with Sonnet ────────────────────────────────────────────
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo ""
  echo "  ⚠ ANTHROPIC_API_KEY not set — skipping judge"
  echo "  Set it and re-run, or use /benchmark agent mode"
  exit 0
fi

echo ""
echo "▸ Judging with Sonnet..."
echo "  Key: ${ANTHROPIC_API_KEY:0:15}... (len=${#ANTHROPIC_API_KEY})"

for LEVEL in "issue-critical" "with-warning"; do
  echo "  ▸ $LEVEL..."
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" node "$SCRIPT_DIR/judge-sonnet.js" \
    "$RESULTS_DIR/golden.json" \
    "$RESULTS_DIR/candidates-${LEVEL}.json" \
    "$RESULTS_DIR/results-${LEVEL}.json" \
    "$LEVEL" 2>&1
done

# ── Print Results ────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "BENCHMARK RESULTS"
echo "============================================================"

for LEVEL in "issue-critical" "with-warning"; do
  OUTPUT="$RESULTS_DIR/results-${LEVEL}.json"
  [ -f "$OUTPUT" ] || continue

  node -e "
const d = JSON.parse(require('fs').readFileSync('$OUTPUT', 'utf8'));

console.log('');
console.log('── ' + d.level.toUpperCase() + ' ──────────────────────────────────────');
console.log('F1=' + d.f1.toFixed(3) + '  Precision=' + d.precision.toFixed(3) + '  Recall=' + d.recall.toFixed(3) + '  TP=' + d.tp + '  FP=' + d.fp + '  FN=' + d.fn);
console.log('');

// Per-repo
console.log('  ' + 'Repo'.padEnd(18) + ' PRs  Golden  Cand   TP  FP  FN  Recall');
console.log('  ' + '-'.repeat(65));
for (const [repo, s] of Object.entries(d.repoStats)) {
  const rr = (s.tp + s.fn) > 0 ? (s.tp / (s.tp + s.fn)).toFixed(3) : 'N/A';
  console.log('  ' + repo.padEnd(18) + ' ' + String(s.prs).padStart(3) + '  ' + String(s.golden).padStart(6) + '  ' + String(s.candidates).padStart(4) + '   ' + String(s.tp).padStart(2) + '  ' + String(s.fp).padStart(2) + '  ' + String(s.fn).padStart(2) + '  ' + rr);
}
console.log('');

// Per-PR
for (const pr of d.prResults) {
  const icon = pr.tp > 0 ? '✓' : '·';
  console.log('  ' + icon + ' ' + pr.repo.padEnd(18) + pr.title.padEnd(52) + ' TP=' + pr.tp + ' FP=' + pr.fp + ' FN=' + pr.fn + ' (' + pr.tp + '/' + pr.golden + ')');
  for (const f of pr.found) console.log('      ✓ [' + f.severity + '] ' + f.comment);
  for (const m of pr.missed) console.log('      ✗ [' + m.severity + '] ' + m.comment);
  for (const n of pr.noise) console.log('      ~ ' + n);
}
"
done

echo ""
echo "============================================================"
echo "Results saved to: $RESULTS_DIR/results-{issue-critical,with-warning}.json"
