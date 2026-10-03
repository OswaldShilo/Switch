import uuid
from sqlalchemy import Column, String, Numeric, Integer, Date, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base

class Account(Base):
    __tablename__ = "accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    consent_id = Column(UUID(as_uuid=True), nullable=True)
    bank = Column(String, nullable=False)
    type = Column(String, nullable=False)
    masked_number = Column(String, nullable=False)
    balance = Column(Numeric(14, 2), nullable=False)
    currency = Column(String, default="INR")
    fetched_at = Column(DateTime(timezone=True), nullable=False)

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    txn_date = Column(Date, nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    direction = Column(String, nullable=False)  # 'credit' or 'debit'
    narration = Column(String, nullable=False)
    merchant = Column(String, nullable=True)
    category = Column(String, nullable=True)
    confidence = Column(Numeric(3, 2), nullable=True)
    categorized_by = Column(String, nullable=True)  # 'rule', 'llm', 'user'
    source_metadata = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))

class CategoryRule(Base):
    __tablename__ = "category_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=True)
    pattern = Column(String, nullable=False)
    category = Column(String, nullable=False)
    priority = Column(Integer, nullable=False, default=0)
