import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="claudia")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from backend.routers import auth, chat, contexts, debate, sessions

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(contexts.router)
app.include_router(debate.router)
app.include_router(sessions.router)


@app.get("/health")
def health():
    return {"status": "ok"}
