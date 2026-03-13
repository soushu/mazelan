#!/bin/bash
set -euo pipefail

DEPLOY_DIR="/home/yutookiguchi/claudia"
BRANCH="main"

echo "=== Deploying PRODUCTION (${BRANCH}) ==="

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
sudo systemctl restart claudia-backend
sudo systemctl restart claudia-frontend

# Wait for backend to be ready
echo "Waiting for backend..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8000/health > /dev/null 2>&1; then
    echo "Backend is healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Backend failed to start"
    sudo journalctl -u claudia-backend --no-pager -n 20
    exit 1
  fi
  sleep 1
done

echo "=== Production deploy complete ==="
