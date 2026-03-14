"""add_model_to_messages

Revision ID: e5f6a7b8c9d0
Revises: d405cc65ddce
Create Date: 2026-03-14 22:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd405cc65ddce'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('model', sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'model')
