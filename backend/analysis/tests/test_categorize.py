import uuid
from datetime import date
from sqlalchemy.orm import Session

from app.models.source import Transaction, CategoryRule
from app.models.outputs import CategoryPrediction
from app.pipelines.categorize import categorize_transactions

def test_rule_categorization(db: Session, test_account):
    acc_id = test_account.id

    # Add test rules
    rule1 = CategoryRule(id=uuid.uuid4(), pattern="swiggy|zomato", category="Food Delivery", priority=10)
    rule2 = CategoryRule(id=uuid.uuid4(), pattern="netflix|spotify", category="Subscriptions", priority=10)
    rule3 = CategoryRule(id=uuid.uuid4(), pattern="uber|ola", category="Transport", priority=10)
    db.add_all([rule1, rule2, rule3])
    db.commit()

    txn1 = Transaction(
        id=uuid.uuid4(),
        account_id=acc_id,
        txn_date=date(2026, 1, 10),
        amount=450.00,
        direction="debit",
        narration="UPI-SWIGGY-ORDER-1234",
        merchant="swiggy"
    )
    txn2 = Transaction(
        id=uuid.uuid4(),
        account_id=acc_id,
        txn_date=date(2026, 1, 15),
        amount=649.00,
        direction="debit",
        narration="NETFLIX SUBSCRIPTION",
        merchant="netflix"
    )
    txn3 = Transaction(
        id=uuid.uuid4(),
        account_id=acc_id,
        txn_date=date(2026, 1, 18),
        amount=280.00,
        direction="debit",
        narration="UBER TRIP BANGALORE",
        merchant="uber"
    )
    db.add_all([txn1, txn2, txn3])
    db.commit()

    summary = categorize_transactions(db, account_id=acc_id)
    assert summary["rule_matched"] >= 3

    # Verify predictions
    p1 = db.query(CategoryPrediction).filter(CategoryPrediction.transaction_id == txn1.id).first()
    p2 = db.query(CategoryPrediction).filter(CategoryPrediction.transaction_id == txn2.id).first()
    p3 = db.query(CategoryPrediction).filter(CategoryPrediction.transaction_id == txn3.id).first()

    assert p1 is not None and p1.category == "Food Delivery" and p1.predicted_by == "rule"
    assert p2 is not None and p2.category == "Subscriptions" and p2.predicted_by == "rule"
    assert p3 is not None and p3.category == "Transport" and p3.predicted_by == "rule"

    # Clean up test rules
    db.query(CategoryRule).filter(CategoryRule.id.in_([rule1.id, rule2.id, rule3.id])).delete()
    db.commit()

def test_salary_credit_income(db: Session, test_account):
    acc_id = test_account.id
    txn = Transaction(
        id=uuid.uuid4(),
        account_id=acc_id,
        txn_date=date(2026, 2, 1),
        amount=70000.00,
        direction="credit",
        narration="SALARY CREDIT FEB 2026",
        merchant=None
    )
    db.add(txn)
    db.commit()

    categorize_transactions(db, account_id=acc_id)

    pred = db.query(CategoryPrediction).filter(CategoryPrediction.transaction_id == txn.id).first()
    assert pred is not None
    assert pred.category == "Income"

def test_unmatched_defaults_to_other(db: Session, test_account):
    acc_id = test_account.id
    txn = Transaction(
        id=uuid.uuid4(),
        account_id=acc_id,
        txn_date=date(2026, 2, 5),
        amount=999.00,
        direction="debit",
        narration="NONEXISTENT_RANDOM_VENDOR_XYZ",
        merchant="xyzunknown"
    )
    db.add(txn)
    db.commit()

    summary = categorize_transactions(db, account_id=acc_id)
    pred = db.query(CategoryPrediction).filter(CategoryPrediction.transaction_id == txn.id).first()
    assert pred is not None
    assert pred.category in ["Other", "Shopping"]
