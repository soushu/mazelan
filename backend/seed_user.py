"""Seed a credentials user for email/password login.

Usage:
    python -m backend.seed_user <email> <password> [name]
"""

import sys
from passlib.context import CryptContext
from backend.database import SessionLocal
from backend.models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def seed(email: str, password: str, name: str | None = None):
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            existing.password_hash = pwd_context.hash(password)
            if name:
                existing.name = name
            db.commit()
            print(f"Updated user: {email} (id={existing.id})")
        else:
            user = User(
                email=email,
                name=name or email.split("@")[0],
                password_hash=pwd_context.hash(password),
                auth_provider="email",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created user: {email} (id={user.id})")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python -m backend.seed_user <email> <password> [name]")
        sys.exit(1)
    seed(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
