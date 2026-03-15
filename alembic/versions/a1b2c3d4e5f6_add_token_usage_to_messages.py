"""add token usage to messages

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-03-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('input_tokens', sa.Integer(), nullable=True))
    op.add_column('messages', sa.Column('output_tokens', sa.Integer(), nullable=True))
    op.add_column('messages', sa.Column('cost', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'cost')
    op.drop_column('messages', 'output_tokens')
    op.drop_column('messages', 'input_tokens')
