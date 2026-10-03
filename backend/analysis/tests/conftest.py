import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.source import Account, Transaction, CategoryRule
from app.models.outputs import (
    SubscriptionDetection,
    CategoryPrediction,
    AnomalyFlag,
    Forecast
)

@pytest.fixture(scope="session")
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

@pytest.fixture
def test_account(db: Session):
    """Creates an isolated temporary test account using existing consent and cleans up after test."""
    db.rollback()
    existing = db.query(Account).first()
    if not existing:
        pytest.fail("No existing account/consent found in database for testing.")

    acc_id = uuid.uuid4()
    account = Account(
        id=acc_id,
        user_id=existing.user_id,
        consent_id=existing.consent_id,
        bank="Test Bank",
        type="SAVINGS",
        masked_number="XXXX9999",
        balance=100000.00,
        currency="INR",
        fetched_at=datetime.now(timezone.utc)
    )
    db.add(account)
    db.commit()

    yield account

    # Cleanup test account data
    db.rollback()
    db.query(SubscriptionDetection).filter(SubscriptionDetection.account_id == acc_id).delete()
    db.query(Forecast).filter(Forecast.account_id == acc_id).delete()
    db.query(AnomalyFlag).filter(AnomalyFlag.account_id == acc_id).delete()
    
    txn_ids = [t.id for t in db.query(Transaction.id).filter(Transaction.account_id == acc_id).all()]
    if txn_ids:
        db.query(CategoryPrediction).filter(CategoryPrediction.transaction_id.in_(txn_ids)).delete()
        db.query(Transaction).filter(Transaction.id.in_(txn_ids)).delete()

    db.query(Account).filter(Account.id == acc_id).delete()
    db.commit()
