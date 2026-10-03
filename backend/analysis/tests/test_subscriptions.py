import uuid
from datetime import date, timedelta
from sqlalchemy.orm import Session

from app.models.source import Transaction
from app.models.outputs import SubscriptionDetection
from app.pipelines.subscriptions import detect_subscriptions

def test_detects_monthly_subscription(db: Session, test_account):
    acc_id = test_account.id
    base_date = date(2025, 8, 5)

    # 12 monthly Netflix charges: fixed amount ₹649, every ~30 days
    for i in range(12):
        txn = Transaction(
            id=uuid.uuid4(),
            account_id=acc_id,
            txn_date=base_date + timedelta(days=i * 30),
            amount=649.00,
            direction="debit",
            narration="NETFLIX MONTHLY PLAN",
            merchant="netflix"
        )
        db.add(txn)
    db.commit()

    results = detect_subscriptions(db, account_id=acc_id)
    assert len(results) >= 1

    netflix = next((r for r in results if r["merchant"] == "netflix"), None)
    assert netflix is not None
    assert netflix["cadence_days"] == 30
    assert netflix["typical_amount"] == 649.00
    assert netflix["occurrence_count"] == 12
    assert netflix["confidence"] >= 0.90

    # Verify in DB
    db_row = db.query(SubscriptionDetection).filter(
        SubscriptionDetection.account_id == acc_id,
        SubscriptionDetection.merchant == "netflix"
    ).first()
    assert db_row is not None
    assert float(db_row.typical_amount) == 649.00
    assert db_row.cadence_days == 30

def test_ignores_irregular_shopping(db: Session, test_account):
    acc_id = test_account.id

    # Irregular Amazon debit purchases
    amounts = [799.00, 2499.00, 399.00, 1899.00, 4999.00, 1200.00]
    days_offsets = [5, 12, 18, 45, 80, 110]
    base_date = date(2025, 8, 1)

    for amt, offset in zip(amounts, days_offsets):
        txn = Transaction(
            id=uuid.uuid4(),
            account_id=acc_id,
            txn_date=base_date + timedelta(days=offset),
            amount=amt,
            direction="debit",
            narration="AMAZON INDIA PURCHASE",
            merchant="amazon"
        )
        db.add(txn)
    db.commit()

    results = detect_subscriptions(db, account_id=acc_id)
    amazon_res = next((r for r in results if r["merchant"] == "amazon"), None)
    assert amazon_res is None

def test_ignores_credit_salary(db: Session, test_account):
    acc_id = test_account.id
    base_date = date(2025, 8, 1)

    # Monthly salary credit (credit direction)
    for i in range(12):
        txn = Transaction(
            id=uuid.uuid4(),
            account_id=acc_id,
            txn_date=base_date + timedelta(days=i * 30),
            amount=70000.00,
            direction="credit",
            narration="SALARY CREDIT EMPLOYER XYZ",
            merchant=None
        )
        db.add(txn)
    db.commit()

    results = detect_subscriptions(db, account_id=acc_id)
    salary_res = [r for r in results if r.get("typical_amount") == 70000.00]
    assert len(salary_res) == 0
