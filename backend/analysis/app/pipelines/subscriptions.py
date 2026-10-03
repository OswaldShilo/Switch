import uuid
from datetime import datetime, timedelta, date, timezone
from typing import Optional, List, Dict, Any
import numpy as np
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from app.models.source import Transaction, Account
from app.models.outputs import SubscriptionDetection

def detect_subscriptions(
    db: Session,
    account_id: Optional[uuid.UUID] = None
) -> List[Dict[str, Any]]:
    """
    Detect recurring subscription charges from debit transactions.
    Groups by (account_id, merchant) and checks for regular cadence and consistent amounts.
    """
    query = db.query(
        Transaction.id,
        Transaction.account_id,
        Transaction.txn_date,
        Transaction.amount,
        Transaction.direction,
        Transaction.merchant
    ).filter(
        Transaction.direction == "debit",
        Transaction.merchant.isnot(None),
        Transaction.merchant != ""
    )

    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    records = query.all()
    if not records:
        return []

    df = pd.DataFrame([
        {
            "id": str(r.id),
            "account_id": r.account_id,
            "txn_date": pd.to_datetime(r.txn_date),
            "amount": float(r.amount),
            "merchant": r.merchant.strip().lower()
        }
        for r in records
    ])

    detected_results = []

    # Group by (account_id, merchant)
    for (acc_id, merchant), group in df.groupby(["account_id", "merchant"]):
        if len(group) < 3:
            continue

        sorted_group = group.sort_values("txn_date").reset_index(drop=True)
        
        amounts = sorted_group["amount"].values
        mean_amount = float(np.mean(amounts))
        std_amount = float(np.std(amounts, ddof=1)) if len(amounts) > 1 else 0.0
        cv_amount = (std_amount / mean_amount) if mean_amount > 0 else 1.0

        # Amounts must be relatively uniform (CV < 0.15)
        if cv_amount >= 0.15:
            continue

        dates = sorted_group["txn_date"].values
        intervals = (dates[1:] - dates[:-1]).astype("timedelta64[D]").astype(int)

        if len(intervals) < 2:
            continue

        median_interval = float(np.median(intervals))
        std_interval = float(np.std(intervals, ddof=1))

        # Detect cadence
        cadence_days = None
        if 25 <= median_interval <= 35:
            cadence_days = 30  # Monthly
        elif 6 <= median_interval <= 8:
            cadence_days = 7   # Weekly
        elif 12 <= median_interval <= 16:
            cadence_days = 14  # Bi-weekly
        elif 80 <= median_interval <= 100:
            cadence_days = 90  # Quarterly
        elif 350 <= median_interval <= 380:
            cadence_days = 365 # Annual

        if cadence_days is None:
            continue

        # Intervals must be regular (std < 6 days)
        if std_interval >= 6.0:
            continue

        # Confidence calculation
        amount_score = max(0.0, 1.0 - (cv_amount / 0.15))
        interval_score = max(0.0, 1.0 - (std_interval / 6.0))
        count_score = min(1.0, len(amounts) / 12.0)
        confidence = round(float(0.40 * amount_score + 0.40 * interval_score + 0.20 * count_score), 2)
        confidence = min(1.0, max(0.0, confidence))

        last_seen_ts = pd.to_datetime(dates[-1])
        last_seen_date = last_seen_ts.date()
        next_expected_date = last_seen_date + timedelta(days=cadence_days)
        typical_amount = round(float(np.median(amounts)), 2)

        detection_data = {
            "account_id": acc_id,
            "merchant": merchant,
            "typical_amount": typical_amount,
            "cadence_days": cadence_days,
            "confidence": confidence,
            "occurrence_count": len(amounts),
            "last_seen": last_seen_date,
            "next_expected": next_expected_date,
        }

        # Upsert into subscription_detections
        stmt = insert(SubscriptionDetection).values(
            account_id=acc_id,
            merchant=merchant,
            typical_amount=typical_amount,
            cadence_days=cadence_days,
            confidence=confidence,
            occurrence_count=len(amounts),
            last_seen=last_seen_date,
            next_expected=next_expected_date,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_subscription_account_merchant",
            set_={
                "typical_amount": stmt.excluded.typical_amount,
                "cadence_days": stmt.excluded.cadence_days,
                "confidence": stmt.excluded.confidence,
                "occurrence_count": stmt.excluded.occurrence_count,
                "last_seen": stmt.excluded.last_seen,
                "next_expected": stmt.excluded.next_expected,
                "detected_at": datetime.now(timezone.utc),
            }
        )
        db.execute(stmt)
        detected_results.append(detection_data)

    db.commit()
    return detected_results
