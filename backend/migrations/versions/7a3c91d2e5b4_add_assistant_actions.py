"""AI assistant: conversation soft delete and pending actions

Revision ID: 7a3c91d2e5b4
Revises: 2497a7b356fc
Create Date: 2026-10-27 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7a3c91d2e5b4'
down_revision = '2497a7b356fc'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('archived_at', sa.DateTime(), nullable=True))

    op.create_table('assistant_actions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=False),
    sa.Column('message_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=False),
    sa.Column('details', sa.JSON(), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('state', sa.Enum('awaiting_confirmation', 'executing', 'confirmed', 'cancelled', 'failed', 'expired', name='assistantactionstate', native_enum=False, length=32, validate_strings=True), nullable=False),
    sa.Column('result_message', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('resolved_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], name=op.f('fk_assistant_actions_conversation_id_conversations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['message_id'], ['messages.id'], name=op.f('fk_assistant_actions_message_id_messages'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_assistant_actions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_assistant_actions'))
    )
    with op.batch_alter_table('assistant_actions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_assistant_actions_conversation_id'), ['conversation_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_assistant_actions_message_id'), ['message_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_assistant_actions_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('assistant_actions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_assistant_actions_user_id'))
        batch_op.drop_index(batch_op.f('ix_assistant_actions_message_id'))
        batch_op.drop_index(batch_op.f('ix_assistant_actions_conversation_id'))

    op.drop_table('assistant_actions')
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.drop_column('archived_at')
