"""Analysis Pipelines."""
from app.pipelines.subscriptions import detect_subscriptions
from app.pipelines.categorize import categorize_transactions
from app.pipelines.anomalies import detect_anomalies
from app.pipelines.forecast import generate_forecasts

__all__ = [
    "detect_subscriptions",
    "categorize_transactions",
    "detect_anomalies",
    "generate_forecasts",
]
