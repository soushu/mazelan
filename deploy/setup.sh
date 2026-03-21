#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/${DEPLOY_USER:-your-username}/claudia"
DOMAIN="${DEPLOY_DOMAIN:-your-domain.example.com}"

echo "=== Claudia Deploy Setup ==="

# ---- 0. Swap (2GB) ----
if [ ! -f /swapfile ]; then
    echo ">>> Adding 2GB swap..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
else
    echo ">>> Swap already exists, skipping."
fi

# ---- 1. System packages ----
echo ">>> Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3 python3-venv python3-pip \
    postgresql postgresql-contrib \
    nginx certbot python3-certbot-nginx \
    git curl

# ---- 2. Node.js (v20 LTS) ----
if ! command -v node &> /dev/null; then
    echo ">>> Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
else
    echo ">>> Node.js already installed: $(node -v)"
fi

# ---- 3. PostgreSQL setup ----
echo ">>> Configuring PostgreSQL..."
sudo systemctl enable --now postgresql

# Create user and DB (ignore errors if already exist)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='claudia'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER claudia WITH PASSWORD 'changeme';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='claudia'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE claudia OWNER claudia;"

# Apply lightweight config
PG_VERSION=$(ls /etc/postgresql/ | sort -V | tail -1)
PG_CONF_DIR="/etc/postgresql/${PG_VERSION}/main/conf.d"
sudo mkdir -p "$PG_CONF_DIR"
sudo cp "$APP_DIR/deploy/postgresql.conf.d/claudia.conf" "$PG_CONF_DIR/claudia.conf"
sudo systemctl restart postgresql

# ---- 4. Python venv + dependencies ----
echo ">>> Setting up Python venv..."
cd "$APP_DIR"
python3 -m venv venv
./venv/bin/pip install --upgrade pip -q
./venv/bin/pip install -r requirements.txt -q

# ---- 5. Alembic migration ----
echo ">>> Running Alembic migrations..."
cd "$APP_DIR"
./venv/bin/alembic upgrade head

# ---- 6. Frontend build ----
echo ">>> Building frontend..."
cd "$APP_DIR/frontend"
npm ci --silent
npm run build

# ---- 7. systemd services ----
echo ">>> Installing systemd services..."
sudo cp "$APP_DIR/deploy/claudia-backend.service" /etc/systemd/system/
sudo cp "$APP_DIR/deploy/claudia-frontend.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now claudia-backend
sudo systemctl enable --now claudia-frontend

# Wait for backend to start
echo ">>> Waiting for backend..."
sleep 3
curl -sf http://127.0.0.1:8000/health && echo " OK" || echo " WARNING: backend health check failed"

# ---- 8. Nginx ----
echo ">>> Configuring Nginx..."
sudo cp "$APP_DIR/deploy/nginx/claudia.conf" /etc/nginx/sites-available/claudia
sudo ln -sf /etc/nginx/sites-available/claudia /etc/nginx/sites-enabled/claudia
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# ---- 9. SSL (certbot) ----
echo ">>> Setting up SSL with certbot..."
echo "Make sure DNS for ${DOMAIN} points to this server's IP before running certbot."
read -rp "Run certbot now? [y/N] " yn
if [[ "$yn" =~ ^[Yy]$ ]]; then
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "${CERTBOT_EMAIL:-admin@example.com}"
fi

echo ""
echo "=== Setup complete ==="
echo "  Backend:  systemctl status claudia-backend"
echo "  Frontend: systemctl status claudia-frontend"
echo "  Nginx:    systemctl status nginx"
echo "  URL:      https://${DOMAIN}"
