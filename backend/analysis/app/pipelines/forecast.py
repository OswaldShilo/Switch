import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from app.models.source import Transaction
from app.models.outputs import Forecast

logger = logging.getLogger(__name__)

def generate_forecasts(
    db: Session,
    account_id: Optional[uuid.UUID] = None,
    horizon_months: int = 3
) -> List[Dict[str, Any]]:
    """
    Generate next 3-month forecast for spend, income, and savings rate.
    Uses StatsForecast AutoETS if available, or Holt-Winters Exponential Smoothing.
    """
    # 1. Fetch all transactions
    query = db.query(
        Transaction.account_id,
        Transaction.txn_date,
        Transaction.amount,
        Transaction.direction
    )
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    records = query.all()
    if not records:
        return []

    df = pd.DataFrame([
        {
            "account_id": r.account_id,
            "txn_date": pd.to_datetime(r.txn_date),
            "amount": float(r.amount),
            "direction": r.direction
        }
        for r in records
    ])

    df["month"] = df["txn_date"].dt.to_period("M").astype(str)

    forecast_results: List[Dict[str, Any]] = []

    # Process each account separately
    for acc_id, acc_df in df.groupby("account_id"):
        # Monthly aggregates
        spend_monthly = (
            acc_df[acc_df["direction"] == "debit"]
            .groupby("month")["amount"]
            .sum()
            .sort_index()
        )
        income_monthly = (
            acc_df[acc_df["direction"] == "credit"]
            .groupby("month")["amount"]
            .sum()
            .sort_index()
        )

        all_months = sorted(list(set(spend_monthly.index).union(set(income_monthly.index))))
        if len(all_months) < 6:
            logger.warning(
                "Account %s has only %d months of data (minimum 6 required). Skipping forecast.",
                acc_id,
                len(all_months)
            )
            continue

        # Fill missing months with 0
        spend_series = [float(spend_monthly.get(m, 0.0)) for m in all_months]
        income_series = [float(income_monthly.get(m, 0.0)) for m in all_months]

        # Determine next target months
        last_period = pd.Period(all_months[-1], freq="M")
        target_months = [str(last_period + i) for i in range(1, horizon_months + 1)]

        # Run forecast
        model_name, spend_pred = _forecast_series(spend_series, horizon_months)
        _, income_pred = _forecast_series(income_series, horizon_months)

        for i, target_month in enumerate(target_months):
            s_val = max(0.0, round(float(spend_pred[i]), 2))
            inc_val = max(0.0, round(float(income_pred[i]), 2))
            
            if inc_val > 0:
                savings_rate = round(float((inc_val - s_val) / inc_val), 4)
            else:
                savings_rate = 0.0

            forecast_data = {
                "account_id": acc_id,
                "target_month": target_month,
                "predicted_spend": s_val,
                "predicted_income": inc_val,
                "predicted_savings_rate": savings_rate,
                "model_name": model_name
            }

            stmt = insert(Forecast).values(
                account_id=acc_id,
                target_month=target_month,
                predicted_spend=s_val,
                predicted_income=inc_val,
                predicted_savings_rate=savings_rate,
                model_name=model_name
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_forecast_account_month",
                set_={
                    "predicted_spend": stmt.excluded.predicted_spend,
                    "predicted_income": stmt.excluded.predicted_income,
                    "predicted_savings_rate": stmt.excluded.predicted_savings_rate,
                    "model_name": stmt.excluded.model_name,
                    "created_at": datetime.now(timezone.utc)
                }
            )
            db.execute(stmt)
            forecast_results.append(forecast_data)

    db.commit()
    return forecast_results

def _forecast_series(series: List[float], horizon: int) -> Tuple[str, List[float]]:
    """
    Attempts AutoETS forecast via statsforecast if installed;
    otherwise falls back to Holt's Linear Exponential Smoothing.
    """
    try:
        from statsforecast import StatsForecast
        from statsforecast.models import AutoETS

        df_sf = pd.DataFrame({
            "unique_id": ["ts"] * len(series),
            "ds": pd.date_range(start="2020-01-01", periods=len(series), freq="MS"),
            "y": series
        })
        sf = StatsForecast(models=[AutoETS(season_length=12)], freq="MS")
        sf.fit(df_sf)
        preds = sf.predict(h=horizon)
        model_col = [c for c in preds.columns if c not in ["unique_id", "ds"]][0]
        return "AutoETS", preds[model_col].tolist()
    except Exception as e:
        logger.info("Using Holt Linear Exponential Smoothing fallback: %s", e)
        return "HoltLinear", _holt_linear_forecast(series, horizon)

def _holt_linear_forecast(series: List[float], horizon: int, alpha: float = 0.3, beta: float = 0.1) -> List[float]:
    """Holt's Linear Exponential Smoothing forecast implementation."""
    n = len(series)
    if n == 0:
        return [0.0] * horizon
    if n == 1:
        return [series[0]] * horizon

    level = series[0]
    trend = series[1] - series[0]

    for i in range(1, n):
        val = series[i]
        last_level = level
        level = alpha * val + (1.0 - alpha) * (level + trend)
        trend = beta * (level - last_level) + (1.0 - beta) * trend

    forecast = [level + (h * trend) for h in range(1, horizon + 1)]
    return forecast
