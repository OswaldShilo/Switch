import uuid
from sqlalchemy import Column, String, Numeric, Integer, Date, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base

class SubscriptionDetection(Base):
    __tablename__ = "subscription_detections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    merchant = Column(String, nullable=False)
    typical_amount = Column(Numeric(14, 2), nullable=False)
    cadence_days = Column(Integer, nullable=False)  # e.g. 30 for monthly
    confidence = Column(Numeric(3, 2), nullable=False)  # 0.00 - 1.00
    occurrence_count = Column(Integer, nullable=False)
    last_seen = Column(Date, nullable=False)
    next_expected = Column(Date, nullable=True)
    detected_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("account_id", "merchant", name="uq_subscription_account_merchant"),
    )

class CategoryPrediction(Base):
    __tablename__ = "category_predictions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=False, unique=True)
    category = Column(String, nullable=False)
    confidence = Column(Numeric(3, 2), nullable=False)
    predicted_by = Column(String, nullable=False)  # 'rule' or 'llm'
    predicted_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

class AnomalyFlag(Base):
    __tablename__ = "anomaly_flags"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=True)
    category = Column(String, nullable=True)
    month = Column(String, nullable=True)  # 'YYYY-MM'
    severity = Column(String, nullable=False)  # 'low', 'medium', 'high'
    score = Column(Numeric(6, 2), nullable=False)  # z-score or deviation magnitude
    reason = Column(String, nullable=False)  # human-readable explanation
    detected_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

class Forecast(Base):
    __tablename__ = "forecasts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    target_month = Column(String, nullable=False)  # 'YYYY-MM'
    predicted_spend = Column(Numeric(14, 2), nullable=True)
    predicted_income = Column(Numeric(14, 2), nullable=True)
    predicted_savings_rate = Column(Numeric(5, 4), nullable=True)
    model_name = Column(String, nullable=False)  # e.g. 'AutoETS', 'SeasonalNaive', 'LinearTrend'
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("account_id", "target_month", name="uq_forecast_account_month"),
    )
