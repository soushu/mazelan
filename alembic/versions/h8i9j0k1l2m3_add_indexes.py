"""add indexes for performance

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-03-15 11:00:00.000000

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'h8i9j0k1l2m3'
down_revision: Union[str, None] = 'g7h8i9j0k1l2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE INDEX IF NOT EXISTS ix_chat_sessions_user_id ON chat_sessions (user_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_messages_session_id ON messages (session_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_messages_created_at ON messages (created_at)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_contexts_user_id ON contexts (user_id)')


def downgrade() -> None:
    op.drop_index('ix_contexts_user_id', 'contexts')
    op.drop_index('ix_messages_created_at', 'messages')
    op.drop_index('ix_messages_session_id', 'messages')
    op.drop_index('ix_chat_sessions_user_id', 'chat_sessions')
