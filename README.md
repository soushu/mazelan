# claudia

Personal AI chat app powered by Anthropic Claude API.

## Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Backend**: FastAPI (Python)
- **Auth**: Google OAuth 2.0 + Email/Password (NextAuth.js)
- **DB**: PostgreSQL + SQLAlchemy + Alembic
- **AI**: Anthropic Claude API
- **Hosting**: AWS Lightsail

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
