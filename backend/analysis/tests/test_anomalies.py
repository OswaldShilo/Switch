import uuid
from datetime import date
from sqlalchemy.orm import Session

from app.models.source import Transaction
from app.models.outputs import CategoryPrediction, AnomalyFlag
from app.pipelines.anomalies import detect_anomalies

def test_detects_monthly_category_spike(db: Session, test_account):
    acc_id = test_account.id

    # 10 months of normal shopping ~ 5,000 each month
    # 1 month with huge spike of 35,000
    months = [
        ("2025-08", 5000.0),
        ("2025-09", 5200.0),
        ("2025-10", 4900.0),
        ("2025-11", 5100.0),
        ("2025-12", 5300.0),
        ("2026-01", 4800.0),
        ("2026-02", 5050.0),
        ("2026-03", 5150.0),
        ("2026-04", 4950.0),
        ("2026-05", 35000.0),  # Spike!
        ("2026-06", 5100.0),
    ]

    txns = []
    preds = []
    for m_str, amt in months:
        year, month = map(int, m_str.split("-"))
        t_id = uuid.uuid4()
        txn = Transaction(
            id=t_id,
            account_id=acc_id,
            txn_date=date(year, month, 15),
            amount=amt,
            direction="debit",
            narration=f"SHOPPING IN {m_str}",
            merchant="retailstore",
            category="Shopping"
        )
        txns.append(txn)
        pred = CategoryPrediction(
            id=uuid.uuid4(),
            transaction_id=t_id,
            category="Shopping",
            confidence=1.0,
            predicted_by="rule"
        )
        preds.append(pred)

    db.add_all(txns)
    db.commit()

    db.add_all(preds)
    db.commit()

    anomalies = detect_anomalies(db, account_id=acc_id)
    assert len(anomalies) >= 1

    spike_flag = next((a for a in anomalies if a["month"] == "2026-05" and a["category"] == "Shopping"), None)
    assert spike_flag is not None
    assert spike_flag["severity"] in ["medium", "high"]
    assert spike_flag["score"] >= 2.0
    assert "above the monthly average" in spike_flag["reason"]

    # Verify normal months (like 2026-01) are not flagged
    normal_flag = next((a for a in anomalies if a["month"] == "2026-01"), None)
    assert normal_flag is None

def test_individual_transaction_spike(db: Session, test_account):
    acc_id = test_account.id

    # Regular coffee transactions around 250
    for i in range(1, 6):
        db.add(Transaction(
            id=uuid.uuid4(),
            account_id=acc_id,
            txn_date=date(2026, 1, i * 3),
            amount=250.0,
            direction="debit",
            narration="COFFEE SHOP PURCHASE",
            merchant="localcafe",
            category="Food Delivery"
        ))

    # Single massive transaction at same merchant
    spike_id = uuid.uuid4()
    db.add(Transaction(
        id=spike_id,
        account_id=acc_id,
        txn_date=date(2026, 1, 28),
        amount=3800.0,
        direction="debit",
        narration="COFFEE SHOP CATERING ORDER",
        merchant="localcafe",
        category="Food Delivery"
    ))
    db.commit()

    anomalies = detect_anomalies(db, account_id=acc_id)
    txn_anomaly = next((a for a in anomalies if a["transaction_id"] == spike_id), None)
    assert txn_anomaly is not None
    assert txn_anomaly["score"] >= 2.0
    assert "Unusually high transaction" in txn_anomaly["reason"]
