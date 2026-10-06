import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.models.source import Transaction
from app.models.outputs import CategoryPrediction, AnomalyFlag

def detect_anomalies(
    db: Session,
    account_id: Optional[uuid.UUID] = None
) -> List[Dict[str, Any]]:
    """
    Detect category-level monthly spending anomalies and individual transaction spikes.
    Uses statistical z-scores against historical baselines.
    """
    # 1. Fetch transactions joined with category predictions (or transaction.category)
    query = db.query(
        Transaction.id,
        Transaction.account_id,
        Transaction.txn_date,
        Transaction.amount,
        Transaction.direction,
        Transaction.merchant,
        Transaction.category,
        CategoryPrediction.category.label("predicted_category")
    ).outerjoin(
        CategoryPrediction,
        Transaction.id == CategoryPrediction.transaction_id
    ).filter(
        Transaction.direction == "debit"
    )

    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    records = query.all()
    if not records:
        return []

    rows = []
    for r in records:
        resolved_cat = r.category or r.predicted_category or "Other"
        rows.append({
            "id": r.id,
            "account_id": r.account_id,
            "txn_date": pd.to_datetime(r.txn_date),
            "amount": float(r.amount),
            "merchant": r.merchant or "",
            "category": resolved_cat,
            "month": pd.to_datetime(r.txn_date).strftime("%Y-%m")
        })

    df = pd.DataFrame(rows)
    anomalies: List[Dict[str, Any]] = []

    # -------------------------------------------------------------
    # 2. Category-Month Level Anomalies
    # -------------------------------------------------------------
    # Group by account_id, category, month -> sum amount
    monthly_cat_spend = df.groupby(["account_id", "category", "month"])["amount"].sum().reset_index()

    for (acc_id, cat), group in monthly_cat_spend.groupby(["account_id", "category"]):
        if len(group) < 3:
            continue

        spends = group["amount"].values
        mean_spend = float(np.mean(spends))
        std_spend = float(np.std(spends, ddof=1))

        if std_spend < 1.0:  # Negligible variance
            continue

        for _, row in group.iterrows():
            spend = float(row["amount"])
            z_score = (spend - mean_spend) / std_spend

            # Flag abnormal spikes above normal spending
            if z_score >= 2.0:
                if z_score > 3.0:
                    severity = "high"
                elif z_score > 2.5:
                    severity = "medium"
                else:
                    severity = "low"

                pct_diff = ((spend - mean_spend) / mean_spend) * 100.0 if mean_spend > 0 else 100.0
                reason = (
                    f"{cat} spend in {row['month']} was ₹{spend:,.2f}, which is {pct_diff:.0f}% "
                    f"(+{z_score:.1f}σ) above the monthly average of ₹{mean_spend:,.2f}"
                )

                anomalies.append({
                    "account_id": acc_id,
                    "transaction_id": None,
                    "category": cat,
                    "month": row["month"],
                    "severity": severity,
                    "score": round(z_score, 2),
                    "reason": reason,
                })

    # -------------------------------------------------------------
    # 3. Individual Transaction Anomalies (per merchant/category)
    # -------------------------------------------------------------
    for (acc_id, merchant), m_group in df[df["merchant"] != ""].groupby(["account_id", "merchant"]):
        if len(m_group) < 4:
            continue

        amounts = m_group["amount"].values
        mean_amt = float(np.mean(amounts))
        std_amt = float(np.std(amounts, ddof=1))

        if std_amt < 5.0:
            continue

        for _, row in m_group.iterrows():
            amt = float(row["amount"])
            z = (amt - mean_amt) / std_amt

            if z >= 2.0:
                severity = "high" if z > 3.0 else ("medium" if z > 2.3 else "low")
                reason = (
                    f"Unusually high transaction of ₹{amt:,.2f} at {merchant} "
                    f"(+{z:.1f}σ above merchant average of ₹{mean_amt:,.2f})"
                )
                anomalies.append({
                    "account_id": acc_id,
                    "transaction_id": row["id"],
                    "category": row["category"],
                    "month": row["month"],
                    "severity": severity,
                    "score": round(z, 2),
                    "reason": reason,
                })

    # -------------------------------------------------------------
    # 4. Persist to anomaly_flags
    # -------------------------------------------------------------
    # Clear previous anomalies for this account_id (or all) before writing fresh detections
    delete_q = db.query(AnomalyFlag)
    if account_id is not None:
        delete_q = delete_q.filter(AnomalyFlag.account_id == account_id)
    delete_q.delete(synchronize_session=False)

    for a in anomalies:
        flag = AnomalyFlag(
            account_id=a["account_id"],
            transaction_id=a["transaction_id"],
            category=a["category"],
            month=a["month"],
            severity=a["severity"],
            score=a["score"],
            reason=a["reason"],
            detected_at=datetime.now(timezone.utc)
        )
        db.add(flag)

    db.commit()
    return anomalies
