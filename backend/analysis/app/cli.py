import argparse
import uuid
import sys
from app.database import SessionLocal
from app.pipelines.subscriptions import detect_subscriptions
from app.pipelines.categorize import categorize_transactions
from app.pipelines.anomalies import detect_anomalies
from app.pipelines.forecast import generate_forecasts

def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass
    parser = argparse.ArgumentParser(description="Switch Financial Intelligence - ML Analysis CLI")
    parser.add_argument(
        "pipeline",
        choices=["all", "subscriptions", "categorize", "anomalies", "forecast"],
        help="Which pipeline to execute"
    )
    parser.add_argument(
        "--account-id",
        type=str,
        default=None,
        help="Optional Account UUID to filter transactions"
    )

    args = parser.parse_args()
    acc_id = uuid.UUID(args.account_id) if args.account_id else None

    db = SessionLocal()
    try:
        print(f"Executing pipeline: {args.pipeline} (account_id={acc_id or 'ALL'})...")

        if args.pipeline in ["subscriptions", "all"]:
            subs = detect_subscriptions(db, acc_id)
            print(f"==> [Subscriptions] Detected {len(subs)} recurring subscriptions:")
            for s in subs:
                print(f"    - {s['merchant']}: typical ₹{s['typical_amount']:.2f}, cadence {s['cadence_days']}d, confidence {s['confidence']*100:.0f}%")

        if args.pipeline in ["categorize", "all"]:
            cats = categorize_transactions(db, acc_id)
            print(f"==> [Categorization] Processed {cats['total']} txns: {cats['rule_matched']} rule, {cats['llm_matched']} LLM, {cats['default_other']} other")

        if args.pipeline in ["anomalies", "all"]:
            anoms = detect_anomalies(db, acc_id)
            print(f"==> [Anomalies] Detected {len(anoms)} anomalies:")
            for a in anoms:
                print(f"    - [{a['severity'].upper()}] {a['reason']}")

        if args.pipeline in ["forecast", "all"]:
            fcsts = generate_forecasts(db, acc_id)
            print(f"==> [Forecasts] Generated {len(fcsts)} monthly forecasts:")
            for f in fcsts:
                print(f"    - Month {f['target_month']}: Spend ₹{f['predicted_spend']:,.2f}, Income ₹{f['predicted_income']:,.2f}, Savings Rate {f['predicted_savings_rate']*100:.1f}% ({f['model_name']})")

        print("Done!")
    finally:
        db.close()

if __name__ == "__main__":
    main()
