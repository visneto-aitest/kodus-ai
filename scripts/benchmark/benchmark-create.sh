#!/bin/bash
#
# Step 1: Create benchmark PRs
#
# Usage:
#   ./benchmark-create.sh [TOTAL_PRS]    # default: 20
#
set -euo pipefail

TOTAL_PRS=${1:-20}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "============================================================"
echo "Benchmark — Create PRs"
echo "============================================================"
echo ""

# Clean pipeline
echo "▸ Cleaning pipeline..."
docker exec db_postgres psql -U kodusdev -d kodus_db -c \
  "DELETE FROM kodus_workflow.inbox_messages WHERE status = 'PROCESSING';" -q 2>/dev/null || true
docker exec db_postgres psql -U kodusdev -d kodus_db -c \
  "DELETE FROM kodus_workflow.outbox_messages WHERE status IN ('READY','PROCESSING','FAILED');" -q 2>/dev/null || true
docker exec rabbitmq rabbitmqctl purge_queue -p kodus-ai workflow.jobs.code_review.queue 2>/dev/null || true
docker exec rabbitmq rabbitmqctl purge_queue -p kodus-ai workflow.jobs.webhook.queue 2>/dev/null || true
echo "  ✓ Pipeline cleaned"

# Restart worker
echo "▸ Restarting worker..."
docker exec 1cf0a7d802e5_kodus_worker rm -rf /usr/src/app/node_modules/.cache/webpack 2>/dev/null || true
docker restart 1cf0a7d802e5_kodus_worker > /dev/null 2>&1
sleep 25
COMPILED=$(docker logs 1cf0a7d802e5_kodus_worker 2>&1 | grep "compiled" | tail -1)
if echo "$COMPILED" | grep -q "successfully"; then
  echo "  ✓ Worker compiled successfully"
else
  echo "  ✗ Worker compilation failed"
  exit 1
fi

# Create PRs
echo "▸ Creating $TOTAL_PRS PRs..."
cd "$REPO_DIR/scripts/pr-creator"
RESULT=$(GITHUB_TOKEN=$(gh auth token) TOTAL_PRS=$TOTAL_PRS node create-test-prs.mjs 2>&1)
CREATED=$(echo "$RESULT" | grep "Total:" | grep -o "[0-9]*")
echo "$RESULT" | grep "✅"
echo ""
echo "  ✓ Created $CREATED PRs"
echo ""
echo "Wait for reviews to finish, then run:"
echo "  ./scripts/benchmark/benchmark-evaluate.sh $TOTAL_PRS"
echo ""
echo "Check progress with:"
echo "  docker logs 1cf0a7d802e5_kodus_worker --since 30s 2>&1 | grep -c AGENT"
