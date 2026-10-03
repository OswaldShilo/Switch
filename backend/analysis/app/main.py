import uuid
from typing import Optional, Dict, Any
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import settings
from app.pipelines.subscriptions import detect_subscriptions
from app.pipelines.categorize import categorize_transactions
from app.pipelines.anomalies import detect_anomalies
from app.pipelines.forecast import generate_forecasts
from app.models.outputs import (
    SubscriptionDetection,
    CategoryPrediction,
    AnomalyFlag,
    Forecast,
)
from app.models.source import Transaction

app = FastAPI(
    title="Switch Financial Intelligence - Analysis Service",
    description="Python analytics and ML pipelines for transaction insights",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "switch-analysis"}

@app.post("/run/all")
def run_all_pipelines(
    account_id: Optional[uuid.UUID] = Query(None, description="Optional account UUID to scope pipelines"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Execute all four pipelines in sequence."""
    sub_results = detect_subscriptions(db, account_id)
    cat_results = categorize_transactions(db, account_id)
    anomaly_results = detect_anomalies(db, account_id)
    forecast_results = generate_forecasts(db, account_id)

    return {
        "status": "success",
        "subscriptions": {"count": len(sub_results)},
        "categorization": cat_results,
        "anomalies": {"count": len(anomaly_results)},
        "forecasts": {"count": len(forecast_results)},
    }

@app.post("/run/{pipeline}")
def run_pipeline(
    pipeline: str,
    account_id: Optional[uuid.UUID] = Query(None, description="Optional account UUID to scope pipeline"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    pipeline_lower = pipeline.lower()

    if pipeline_lower == "all":
        return run_all_pipelines(account_id, db)

    elif pipeline_lower in ["subscriptions", "pipeline_1"]:
        results = detect_subscriptions(db, account_id)
        return {"pipeline": "subscriptions", "count": len(results), "detections": results}

    elif pipeline_lower in ["categorize", "categorization", "pipeline_2"]:
        summary = categorize_transactions(db, account_id)
        return {"pipeline": "categorize", **summary}

    elif pipeline_lower in ["anomalies", "pipeline_3"]:
        results = detect_anomalies(db, account_id)
        return {"pipeline": "anomalies", "count": len(results), "anomalies": results}

    elif pipeline_lower in ["forecast", "forecasts", "pipeline_4"]:
        results = generate_forecasts(db, account_id)
        return {"pipeline": "forecast", "count": len(results), "forecasts": results}

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown pipeline: '{pipeline}'. Expected one of: subscriptions, categorize, anomalies, forecast"
        )
    """Execute all four pipelines in sequence."""
    sub_results = detect_subscriptions(db, account_id)
    cat_results = categorize_transactions(db, account_id)
    anomaly_results = detect_anomalies(db, account_id)
    forecast_results = generate_forecasts(db, account_id)

    return {
        "status": "success",
        "subscriptions": {"count": len(sub_results)},
        "categorization": cat_results,
        "anomalies": {"count": len(anomaly_results)},
        "forecasts": {"count": len(forecast_results)},
    }

@app.get("/results/subscriptions/{account_id}")
def get_subscriptions(account_id: uuid.UUID, db: Session = Depends(get_db)):
    rows = db.query(SubscriptionDetection).filter(SubscriptionDetection.account_id == account_id).all()
    return [
        {
            "merchant": r.merchant,
            "typical_amount": float(r.typical_amount),
            "cadence_days": r.cadence_days,
            "confidence": float(r.confidence),
            "occurrence_count": r.occurrence_count,
            "last_seen": r.last_seen.isoformat(),
            "next_expected": r.next_expected.isoformat() if r.next_expected else None,
        }
        for r in rows
    ]

@app.get("/results/categorize/{account_id}")
def get_categories(account_id: uuid.UUID, db: Session = Depends(get_db)):
    rows = (
        db.query(CategoryPrediction, Transaction)
        .join(Transaction, CategoryPrediction.transaction_id == Transaction.id)
        .filter(Transaction.account_id == account_id)
        .all()
    )
    return [
        {
            "transaction_id": str(pred.transaction_id),
            "merchant": txn.merchant,
            "narration": txn.narration,
            "category": pred.category,
            "confidence": float(pred.confidence),
            "predicted_by": pred.predicted_by,
        }
        for pred, txn in rows
    ]

@app.get("/results/anomalies/{account_id}")
def get_anomalies(account_id: uuid.UUID, db: Session = Depends(get_db)):
    rows = db.query(AnomalyFlag).filter(AnomalyFlag.account_id == account_id).order_by(AnomalyFlag.score.desc()).all()
    return [
        {
            "id": str(r.id),
            "transaction_id": str(r.transaction_id) if r.transaction_id else None,
            "category": r.category,
            "month": r.month,
            "severity": r.severity,
            "score": float(r.score),
            "reason": r.reason,
        }
        for r in rows
    ]

@app.get("/results/forecast/{account_id}")
def get_forecasts(account_id: uuid.UUID, db: Session = Depends(get_db)):
    rows = db.query(Forecast).filter(Forecast.account_id == account_id).order_by(Forecast.target_month.asc()).all()
    return [
        {
            "target_month": r.target_month,
            "predicted_spend": float(r.predicted_spend) if r.predicted_spend else None,
            "predicted_income": float(r.predicted_income) if r.predicted_income else None,
            "predicted_savings_rate": float(r.predicted_savings_rate) if r.predicted_savings_rate else None,
            "model_name": r.model_name,
        }
        for r in rows
    ]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
