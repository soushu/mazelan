#!/bin/bash
set -euo pipefail

DEPLOY_DIR="/home/yutookiguchi/claudia-staging"
BRANCH="develop"

echo "=== Deploying STAGING (${BRANCH}) ==="

cd "$DEPLOY_DIR"

# Pull latest code
git fetch origin "$BRANCH"
git reset --hard "origin/${BRANCH}"

# Backend: install dependencies + migrate
venv/bin/pip install -q -r requirements.txt
venv/bin/alembic upgrade head

# Frontend: install dependencies + build
cd frontend
npm ci --prefer-offline
NODE_OPTIONS="--max_old_space_size=512" npm run build
cd ..

# Restart services
sudo systemctl restart claudia-staging-backend
sudo systemctl restart claudia-staging-frontend

# Wait for backend to be ready
echo "Waiting for backend..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8001/health > /dev/null 2>&1; then
    echo "Backend is healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Backend failed to start"
    sudo journalctl -u claudia-staging-backend --no-pager -n 20
    exit 1
  fi
  sleep 1
done

echo "=== Staging deploy complete ==="
