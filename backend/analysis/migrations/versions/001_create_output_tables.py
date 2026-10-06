"""Create 4 ML output tables

Revision ID: 001_create_output_tables
Revises: 
Create Date: 2026-09-10 23:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = '001_create_output_tables'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. subscription_detections
    op.create_table(
        'subscription_detections',
        sa.Column('id', UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('account_id', UUID(as_uuid=True), sa.ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('merchant', sa.Text(), nullable=False),
        sa.Column('typical_amount', sa.Numeric(14, 2), nullable=False),
        sa.Column('cadence_days', sa.Integer(), nullable=False),
        sa.Column('confidence', sa.Numeric(3, 2), nullable=False),
        sa.Column('occurrence_count', sa.Integer(), nullable=False),
        sa.Column('last_seen', sa.Date(), nullable=False),
        sa.Column('next_expected', sa.Date(), nullable=True),
        sa.Column('detected_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('account_id', 'merchant', name='uq_subscription_account_merchant')
    )

    # 2. category_predictions
    op.create_table(
        'category_predictions',
        sa.Column('id', UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('transaction_id', UUID(as_uuid=True), sa.ForeignKey('transactions.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('category', sa.Text(), nullable=False),
        sa.Column('confidence', sa.Numeric(3, 2), nullable=False),
        sa.Column('predicted_by', sa.Text(), nullable=False),
        sa.Column('predicted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False)
    )

    # 3. anomaly_flags
    op.create_table(
        'anomaly_flags',
        sa.Column('id', UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('account_id', UUID(as_uuid=True), sa.ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('transaction_id', UUID(as_uuid=True), sa.ForeignKey('transactions.id', ondelete='CASCADE'), nullable=True),
        sa.Column('category', sa.Text(), nullable=True),
        sa.Column('month', sa.Text(), nullable=True),
        sa.Column('severity', sa.Text(), nullable=False),
        sa.Column('score', sa.Numeric(6, 2), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('detected_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False)
    )

    # 4. forecasts
    op.create_table(
        'forecasts',
        sa.Column('id', UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), primary_key=True),
        sa.Column('account_id', UUID(as_uuid=True), sa.ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('target_month', sa.Text(), nullable=False),
        sa.Column('predicted_spend', sa.Numeric(14, 2), nullable=True),
        sa.Column('predicted_income', sa.Numeric(14, 2), nullable=True),
        sa.Column('predicted_savings_rate', sa.Numeric(5, 4), nullable=True),
        sa.Column('model_name', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('account_id', 'target_month', name='uq_forecast_account_month')
    )


def downgrade() -> None:
    op.drop_table('forecasts')
    op.drop_table('anomaly_flags')
    op.drop_table('category_predictions')
    op.drop_table('subscription_detections')
