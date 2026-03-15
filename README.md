# Mazelan

AI-powered travel planning assistant.

## Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Backend**: FastAPI (Python)
- **Auth**: Google OAuth 2.0 + Email/Password (NextAuth.js)
- **DB**: PostgreSQL + SQLAlchemy + Alembic
- **AI**: Anthropic Claude + OpenAI GPT + Google Gemini
- **Hosting**: GCP Compute Engine (e2-small)

## Development

```bash
# Backend
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

## Deploy (GCP)

### Prerequisites
- GCP Compute Engine instance (e2-small, Debian/Ubuntu)
- DNS: `mazelan.ai` → instance static IP

### Steps

```bash
# 1. Clone repo on GCP instance
git clone <repo-url> ~/mazelan
cd ~/mazelan

# 2. Create .env files
cp .env.example .env          # edit with production values
cp frontend/.env.example frontend/.env.local  # edit with production values

# 3. Run setup script
bash deploy/setup.sh
```

The setup script handles: PostgreSQL, Python venv, Node.js, npm build, Alembic migrations, systemd services, Nginx, and SSL (certbot).
