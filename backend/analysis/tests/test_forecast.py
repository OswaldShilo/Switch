import uuid
from datetime import date
from sqlalchemy.orm import Session

from app.models.source import Transaction
from app.models.outputs import Forecast
from app.pipelines.forecast import generate_forecasts

def test_generate_forecast_3_months(db: Session, test_account):
    acc_id = test_account.id

    # 12 months of data (Aug 2025 -> Jul 2026)
    for i in range(12):
        month = (i % 12) + 1
        year = 2025 if i < 5 else 2026
        
        # Monthly salary: ₹70,000
        db.add(Transaction(
            id=uuid.uuid4(),
            account_id=acc_id,
            txn_date=date(year, month, 1),
            amount=70000.00,
            direction="credit",
            narration="SALARY CREDIT",
            merchant=None
        ))

        # Monthly total debits: around ₹50,000
        db.add(Transaction(
            id=uuid.uuid4(),
            account_id=acc_id,
            txn_date=date(year, month, 15),
            amount=50000.00,
            direction="debit",
            narration="REGULAR LIVING EXPENSES",
            merchant="various"
        ))

    db.commit()

    results = generate_forecasts(db, account_id=acc_id, horizon_months=3)
    assert len(results) == 3

    # Check forecasted income and spend
    f1 = results[0]
    assert 60000.00 <= f1["predicted_income"] <= 80000.00
    assert 40000.00 <= f1["predicted_spend"] <= 60000.00
    assert f1["predicted_savings_rate"] > 0.15

    # Check persistence in forecasts table
    db_forecasts = db.query(Forecast).filter(Forecast.account_id == acc_id).all()
    assert len(db_forecasts) == 3

def test_skips_insufficient_history(db: Session, test_account):
    acc_id = test_account.id

    # Only 2 months of data
    db.add(Transaction(
        id=uuid.uuid4(),
        account_id=acc_id,
        txn_date=date(2026, 1, 1),
        amount=70000.00,
        direction="credit",
        narration="SALARY",
        merchant=None
    ))
    db.add(Transaction(
        id=uuid.uuid4(),
        account_id=acc_id,
        txn_date=date(2026, 2, 1),
        amount=70000.00,
        direction="credit",
        narration="SALARY",
        merchant=None
    ))
    db.commit()

    results = generate_forecasts(db, account_id=acc_id, horizon_months=3)
    assert len(results) == 0
