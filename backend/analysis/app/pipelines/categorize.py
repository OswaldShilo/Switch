import re
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

import httpx
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from app.models.source import Transaction, CategoryRule, Account
from app.models.outputs import CategoryPrediction
from app.config import settings

logger = logging.getLogger(__name__)

CATEGORIES = [
    "Food Delivery",
    "Groceries",
    "Transport",
    "Shopping",
    "Subscriptions",
    "Utilities",
    "Rent",
    "Income",
    "Cash Withdrawal",
    "Transfers",
    "Entertainment",
    "Other",
]

def categorize_transactions(
    db: Session,
    account_id: Optional[uuid.UUID] = None,
    sync_to_transactions: bool = True
) -> Dict[str, Any]:
    """
    Two-stage categorization pipeline:
    Stage 1: Regex rules from category_rules table ordered by priority DESC.
    Stage 2: LLM fallback for unmatched transactions via OpenRouter (if key provided).
    Writes results to category_predictions table.
    """
    # 1. Fetch rules
    rules = db.query(CategoryRule).order_by(CategoryRule.priority.desc()).all()
    compiled_rules = []
    for r in rules:
        try:
            compiled_rules.append((re.compile(r.pattern, re.IGNORECASE), r.category))
        except re.error as e:
            logger.warning("Invalid regex pattern '%s': %s", r.pattern, e)

    # 2. Fetch transactions
    query = db.query(
        Transaction.id,
        Transaction.account_id,
        Transaction.narration,
        Transaction.merchant,
        Transaction.direction
    )
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)

    txns = query.all()
    if not txns:
        return {"total": 0, "rule_matched": 0, "llm_matched": 0, "unmatched": 0}

    matched_by_rule = []
    unmatched = []

    # 3. Stage 1: Match with rules
    for t in txns:
        haystack = f"{t.merchant or ''} {t.narration}".strip()
        matched_cat = None

        for pattern_re, cat in compiled_rules:
            if pattern_re.search(haystack):
                matched_cat = cat
                break

        # If direction is credit and narration mentions salary, default to Income if not matched
        if not matched_cat and t.direction == "credit" and "salary" in haystack.lower():
            matched_cat = "Income"

        if matched_cat:
            matched_by_rule.append({
                "transaction_id": t.id,
                "category": matched_cat,
                "confidence": 1.0,
                "predicted_by": "rule"
            })
        else:
            unmatched.append({
                "txnId": str(t.id),
                "narration": t.narration,
                "merchant": t.merchant
            })

    # 4. Stage 2: LLM Fallback for unmatched
    matched_by_llm = []
    if unmatched and settings.OPENROUTER_API_KEY:
        try:
            matched_by_llm = _classify_with_llm(unmatched, settings.OPENROUTER_API_KEY)
        except Exception as e:
            logger.error("LLM fallback failed: %s", e)

    # For any still unmatched, default to 'Other' with lower confidence
    llm_txn_ids = {m["transaction_id"] for m in matched_by_llm}
    default_other = []
    for u in unmatched:
        t_id = uuid.UUID(u["txnId"])
        if t_id not in llm_txn_ids:
            default_other.append({
                "transaction_id": t_id,
                "category": "Other",
                "confidence": 0.5,
                "predicted_by": "default"
            })

    all_predictions = matched_by_rule + matched_by_llm + default_other

    # 5. Persist to category_predictions table
    for p in all_predictions:
        stmt = insert(CategoryPrediction).values(
            transaction_id=p["transaction_id"],
            category=p["category"],
            confidence=p["confidence"],
            predicted_by=p["predicted_by"],
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["transaction_id"],
            set_={
                "category": stmt.excluded.category,
                "confidence": stmt.excluded.confidence,
                "predicted_by": stmt.excluded.predicted_by,
                "predicted_at": datetime.now(timezone.utc)
            }
        )
        db.execute(stmt)

        if sync_to_transactions:
            db.query(Transaction).filter(Transaction.id == p["transaction_id"]).update({
                "category": p["category"],
                "confidence": p["confidence"],
                "categorized_by": "rule" if p["predicted_by"] == "rule" else "llm"
            })

    db.commit()

    return {
        "total": len(txns),
        "rule_matched": len(matched_by_rule),
        "llm_matched": len(matched_by_llm),
        "default_other": len(default_other),
    }

def _classify_with_llm(unmatched_txns: List[Dict[str, Any]], api_key: str) -> List[Dict[str, Any]]:
    """Batch classify unmatched transactions using OpenRouter."""
    results = []
    batch_size = 50
    client = httpx.Client(timeout=30.0)

    for i in range(0, len(unmatched_txns), batch_size):
        batch = unmatched_txns[i:i + batch_size]
        prompt = (
            f"Categorize each transaction into exactly one of: {', '.join(CATEGORIES)}. "
            "Return only a JSON array of {\"txn_id\",\"category\",\"confidence\"} (confidence 0-1), one per input.\n"
            f"Transactions: {json.dumps(batch)}"
        )

        response = client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "anthropic/claude-haiku-4.5",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
            }
        )
        response.raise_for_status()
        data = response.json()
        raw_text = data["choices"][0]["message"]["content"].strip()

        # Parse JSON from response
        # In case response wrapped in markdown code fence
        if raw_text.startswith("```"):
            raw_text = re.sub(r"^```(?:json)?\n?", "", raw_text)
            raw_text = re.sub(r"\n?```$", "", raw_text)

        parsed = json.loads(raw_text)
        for item in parsed:
            cat = item.get("category", "Other")
            if cat not in CATEGORIES:
                cat = "Other"
            results.append({
                "transaction_id": uuid.UUID(item["txn_id"]),
                "category": cat,
                "confidence": float(item.get("confidence", 0.8)),
                "predicted_by": "llm"
            })

    return results
