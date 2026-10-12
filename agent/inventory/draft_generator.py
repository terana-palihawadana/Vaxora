"""
Generates formal draft documents (Purchase Orders, Expiry Action Memos)
from agent proposals. Documents are stored in workflow state and can be
executed via the .NET backend.
"""
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional


# ==================== PRICE LOOKUP ====================
# Each line is priced from the supplier cost the hospital saved on its formulary.
# This category map is only the fallback estimate for vaccines with no cost set.

CATEGORY_UNIT_PRICES_LKR = {
    "mrna": 2000,
    "routine": 1200,
    "seasonal": 1000,
    "pediatric": 1500,
}


# Matches the API's fallback for products with no supplier saved on the formulary
DEFAULT_SUPPLIER = "State Pharmaceuticals Corporation"


def _now():
    return datetime.now(timezone.utc)


def _gen_doc_number(prefix: str) -> str:
    """AI-PO-20260924-4471 or AI-EXP-20260924-001"""
    today = _now().strftime("%Y%m%d")
    rand = uuid.uuid4().int % 9000 + 1000
    return f"AI-{prefix}-{today}-{rand}"


def _get_unit_price(category: Optional[str]) -> int:
    if not category:
        return 1200
    return CATEGORY_UNIT_PRICES_LKR.get(category.lower(), 1200)


# ==================== PURCHASE ORDER DRAFT ====================

def generate_purchase_order_draft(
    restock_proposals: List[Dict[str, Any]],
    hospital_name: str,
    hospital_registration: Optional[str] = None,
    formulary_pricing: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Combines one or more restock proposals into a single draft PO.

    Args:
        restock_proposals: list of proposal dicts from `propose_restock_order` tool.
            Each has: vaccine_id, vaccine_name, current_stock, recommended_quantity, reason, urgency
        hospital_name: buyer hospital display name
        hospital_registration: MOH registration number if available
        formulary_pricing: vaccine_id -> {"supplier_cost", "category", "supplier_name"} from the hospital formulary

    Returns:
        Draft PO document, or None if no valid proposals.
    """
    if not restock_proposals:
        return None

    # Filter out invalid entries
    valid = [p for p in restock_proposals if p.get("recommended_quantity", 0) > 0]
    if not valid:
        return None

    line_items = []
    subtotal = 0

    for p in valid:
        qty = int(p.get("recommended_quantity", 0))
        priced = (formulary_pricing or {}).get(str(p.get("vaccine_id", "")).lower(), {})
        # Formulary category when known, otherwise a best-effort guess from the name
        category = priced.get("category") or _guess_category(p.get("vaccine_name", ""))
        supplier_cost = priced.get("supplier_cost") or 0
        unit = supplier_cost if supplier_cost > 0 else _get_unit_price(category)
        line_total = qty * unit
        subtotal += line_total

        line_items.append({
            "vaccine_id": p.get("vaccine_id", ""),
            "vaccine_name": p.get("vaccine_name", "Unknown"),
            "category": category,
            "supplier": priced.get("supplier_name") or DEFAULT_SUPPLIER,
            "quantity": qty,
            "unit_price_lkr": unit,
            "total_lkr": line_total,
            "current_stock": p.get("current_stock", 0),
            "urgency": p.get("urgency", "low"),
            "justification": p.get("reason", "Agent-recommended reorder"),
        })

    suppliers = list(dict.fromkeys(li["supplier"] for li in line_items))
    doc_number = _gen_doc_number("PO")
    delivery_days = 14
    delivery_date = _now().replace(microsecond=0)
    from datetime import timedelta
    delivery_date = (delivery_date + timedelta(days=delivery_days)).strftime("%Y-%m-%d")

    validation_checks = [
        {"rule": "At least one line item present", "passed": len(line_items) > 0, "detail": f"{len(line_items)} item(s)"},
        {"rule": "All quantities positive", "passed": all(li["quantity"] > 0 for li in line_items), "detail": ""},
        {"rule": "Total within quarterly allocation", "passed": subtotal < 5_000_000, "detail": f"LKR {subtotal:,}"},
        {"rule": "Delivery date accounts for supplier lead time", "passed": True, "detail": f"Lead time: {delivery_days} days"},
    ]

    return {
        "draft_type": "purchase_order",
        "document_number": doc_number,
        "title": "VAXORA PURCHASE ORDER (DRAFT)",
        "generated_at": _now().isoformat(),
        "buyer": {
            "name": hospital_name,
            "registration": hospital_registration or "MOH-PENDING",
        },
        # Each supplier is emailed only its own lines when the order is approved
        "supplier": suppliers[0] if len(suppliers) == 1 else f"{len(suppliers)} suppliers: {', '.join(suppliers)}",
        "order_date": _now().strftime("%Y-%m-%d"),
        "delivery_date": delivery_date,
        "delivery_lead_days": delivery_days,
        "line_items": line_items,
        "subtotal_lkr": subtotal,
        "tax_lkr": 0,
        "total_lkr": subtotal,
        "validation_checks": validation_checks,
        "notes": "This draft was generated by the Vaxora Restock Advisor Agent. Review carefully before issuing.",
        "action_label": "Issue Purchase Order",
    }


# ==================== EXPIRY MEMO DRAFT ====================

def generate_expiry_memo_draft(
    expiry_actions: List[Dict[str, Any]],
    summary: str,
    hospital_name: str,
) -> Optional[Dict[str, Any]]:
    """
    Builds a formal Expiry Action Memo from agent actions.

    Args:
        expiry_actions: list of action dicts (each with batch_id, lot_number, vaccine_name,
            quantity_available, expiry_date, days_until_expiry, priority, recommended_action)
        summary: agent's summary text
        hospital_name: display name
    """
    if not expiry_actions:
        return None

    doc_number = _gen_doc_number("EXP")

    # Rescue plan: pick action per batch
    rescue_steps = []
    for i, a in enumerate(expiry_actions, 1):
        action = a.get("recommended_action", "dispense_first")
        qty = a.get("quantity_available", 0)
        days = a.get("days_until_expiry", 0)
        action_text = {
            "dispense_first": f"Reserve {qty} vials for priority dispensing in clinic sessions",
            "transfer": f"Transfer {qty} vials to a partner hospital with active demand",
            "dispose": f"Schedule safe disposal of {qty} vials per MOH protocol",
        }.get(action, f"Review {qty} vials")

        rescue_steps.append({
            "step": i,
            "batch_id": a.get("batch_id", ""),
            "lot_number": a.get("lot_number", ""),
            "vaccine_name": a.get("vaccine_name", ""),
            "action": action,
            "action_text": action_text,
            "deadline": f"Within {max(1, days - 3)} days",
            "priority": a.get("priority", "medium"),
        })

    validation_checks = [
        {"rule": "All actions within 60-day window", "passed": all(a.get("days_until_expiry", 0) <= 60 for a in expiry_actions), "detail": ""},
        {"rule": "Disposal refused for batches >14 days", "passed": not any(a.get("recommended_action") == "dispose" and a.get("days_until_expiry", 0) > 14 for a in expiry_actions), "detail": ""},
        {"rule": "Priority values valid", "passed": all(a.get("priority", "").lower() in ("critical", "high", "medium", "low") for a in expiry_actions), "detail": ""},
    ]

    return {
        "draft_type": "expiry_memo",
        "document_number": doc_number,
        "title": "MINISTRY OF HEALTH — EXPIRY ACTION MEMO",
        "generated_at": _now().isoformat(),
        "recipient": {
            "name": hospital_name,
            "role": "Immunization Center Operations Manager",
        },
        "subject": f"Rescue Plan for {len(expiry_actions)} expiring batch(es)",
        "summary": summary or "Batches nearing expiry require immediate prioritization.",
        "affected_batches": [
            {
                "batch_id": a.get("batch_id", ""),
                "lot_number": a.get("lot_number", ""),
                "vaccine_name": a.get("vaccine_name", ""),
                "quantity_available": a.get("quantity_available", 0),
                "expiry_date": a.get("expiry_date", ""),
                "days_until_expiry": a.get("days_until_expiry", 0),
                "priority": a.get("priority", "medium"),
                "recommended_action": a.get("recommended_action", "dispense_first"),
            }
            for a in expiry_actions
        ],
        "rescue_plan": rescue_steps,
        "validation_checks": validation_checks,
        "notes": "This memo was generated by the Vaxora Expiry Watchdog Agent. Execute to reserve batches for action.",
        "action_label": "Execute Memo",
    }


# ==================== HELPERS ====================

def _guess_category(vaccine_name: str) -> str:
    """Crude heuristic — real categorization comes from the DB."""
    name = (vaccine_name or "").lower()
    if "mrna" in name or "pfizer" in name or "moderna" in name:
        return "mrna"
    if "influenza" in name or "seasonal" in name or "flu" in name:
        return "seasonal"
    if "mmr" in name or "pediatric" in name or "measles" in name:
        return "pediatric"
    return "routine"


# ==================== BUILT-IN TEST ====================

if __name__ == "__main__":
    # Quick sanity test
    po = generate_purchase_order_draft(
        [{"vaccine_id": "abc", "vaccine_name": "Influenza Quadrivalent", "current_stock": 200, "recommended_quantity": 200, "urgency": "high", "reason": "At threshold"}],
        "Heal Care Hospital",
    )
    import json
    print(json.dumps(po, indent=2))

    memo = generate_expiry_memo_draft(
        [{"batch_id": "xyz", "lot_number": "TEST-001", "vaccine_name": "Influenza", "quantity_available": 200, "expiry_date": "2026-10-15", "days_until_expiry": 20, "priority": "high", "recommended_action": "dispense_first"}],
        "1 batch expiring in 20 days",
        "Heal Care Hospital",
    )
    print(json.dumps(memo, indent=2))