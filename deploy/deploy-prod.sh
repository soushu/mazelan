#!/bin/bash
set -euo pipefail

DEPLOY_DIR="/home/${DEPLOY_USER:-your-username}/claudia"
BRANCH="main"

echo "=== Deploying PRODUCTION (${BRANCH}) ==="

cd "$DEPLOY_DIR"

# Pull latest code
git fetch origin "$BRANCH"
git reset --hard "origin/${BRANCH}"

# Backend: install dependencies + migrate
venv/bin/pip install -q -r requirements.txt
venv/bin/alembic upgrade head

# Stop services to free memory for build
sudo systemctl stop claudia-backend
sudo systemctl stop claudia-frontend

# Frontend: install dependencies + build
cd frontend
set +e
npm ci 2>&1
NPM_CI_EXIT=$?
set -e
if [ $NPM_CI_EXIT -ne 0 ]; then
  echo "npm ci failed (exit $NPM_CI_EXIT), falling back to npm install..."
  npm install
fi
NODE_OPTIONS="--max_old_space_size=384" npm run build
cd ..

# Start services
sudo systemctl start claudia-backend
sudo systemctl start claudia-frontend

# Wait for backend to be ready
echo "Waiting for backend..."
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8000/health > /dev/null 2>&1; then
    echo "Backend is healthy"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: Backend failed to start"
    sudo journalctl -u claudia-backend --no-pager -n 20
    exit 1
  fi
  sleep 2
done

echo "=== Production deploy complete ==="
