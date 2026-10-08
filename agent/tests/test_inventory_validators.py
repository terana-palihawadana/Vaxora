"""
Deterministic validator tests for the inventory agent.
These tests cover the business-rule layer that runs BEFORE any proposal is
shown to the user. The LLM never performs arithmetic; these functions do.
"""
from agent.inventory.validator import (
    validate_restock_proposal,
    validate_expiry_action,
    compute_reorder_quantity,
    compute_urgency,
    compute_expiry_priority,
)


# ==================== validate_restock_proposal ====================

class TestValidateRestockProposal:
    def test_valid_proposal_passes(self):
        ok, errors = validate_restock_proposal({
            "vaccine_id": "v-1",
            "vaccine_name": "Pfizer",
            "current_stock": 30,
            "recommended_quantity": 100,
            "reason": "Below safety threshold",
            "urgency": "high",
        })
        assert ok is True
        assert errors == []

    def test_missing_required_fields_fails(self):
        ok, errors = validate_restock_proposal({})
        assert ok is False
        assert len(errors) >= 6  # all required fields missing

    def test_zero_quantity_fails(self):
        ok, errors = validate_restock_proposal({
            "vaccine_id": "v-1",
            "vaccine_name": "Pfizer",
            "current_stock": 30,
            "recommended_quantity": 0,
            "reason": "Test",
            "urgency": "high",
        })
        assert ok is False
        assert any("positive" in e.lower() for e in errors)

    def test_quantity_above_sane_limit_fails(self):
        ok, errors = validate_restock_proposal({
            "vaccine_id": "v-1",
            "vaccine_name": "Pfizer",
            "current_stock": 30,
            "recommended_quantity": 200_000,
            "reason": "Test",
            "urgency": "high",
        })
        assert ok is False
        assert any("limit" in e.lower() or "100000" in e for e in errors)

    def test_invalid_urgency_fails(self):
        ok, errors = validate_restock_proposal({
            "vaccine_id": "v-1",
            "vaccine_name": "Pfizer",
            "current_stock": 30,
            "recommended_quantity": 100,
            "reason": "Test",
            "urgency": "urgent",  # not in {low, medium, high}
        })
        assert ok is False
        assert any("urgency" in e.lower() for e in errors)

    def test_refuses_restock_when_stock_well_above_threshold(self):
        ok, errors = validate_restock_proposal({
            "vaccine_id": "v-1",
            "vaccine_name": "Pfizer",
            "current_stock": 200,
            "recommended_quantity": 100,
            "reason": "Not really needed",
            "urgency": "low",
            "threshold": 50,  # 200 > 1.5 * 50 = 75
        })
        assert ok is False
        assert any("safety" in e.lower() or "above" in e.lower() for e in errors)


# ==================== validate_expiry_action ====================

class TestValidateExpiryAction:
    def test_valid_action_passes(self):
        ok, errors = validate_expiry_action({
            "batch_id": "b-1",
            "lot_number": "LOT-001",
            "vaccine_name": "Pfizer",
            "quantity_available": 100,
            "expiry_date": "2026-11-01",
            "days_until_expiry": 20,
            "priority": "high",
            "recommended_action": "dispense_first",
        })
        assert ok is True
        assert errors == []

    def test_missing_fields_fails(self):
        ok, errors = validate_expiry_action({})
        assert ok is False
        assert len(errors) >= 8

    def test_invalid_priority_fails(self):
        ok, errors = validate_expiry_action({
            "batch_id": "b-1",
            "lot_number": "LOT-001",
            "vaccine_name": "Pfizer",
            "quantity_available": 100,
            "expiry_date": "2026-11-01",
            "days_until_expiry": 20,
            "priority": "extremely urgent",
            "recommended_action": "dispense_first",
        })
        assert ok is False
        assert any("priority" in e.lower() for e in errors)

    def test_invalid_action_fails(self):
        ok, errors = validate_expiry_action({
            "batch_id": "b-1",
            "lot_number": "LOT-001",
            "vaccine_name": "Pfizer",
            "quantity_available": 100,
            "expiry_date": "2026-11-01",
            "days_until_expiry": 20,
            "priority": "high",
            "recommended_action": "sell_to_highest_bidder",
        })
        assert ok is False
        assert any("action" in e.lower() for e in errors)

    def test_negative_days_fails(self):
        ok, errors = validate_expiry_action({
            "batch_id": "b-1",
            "lot_number": "LOT-001",
            "vaccine_name": "Pfizer",
            "quantity_available": 100,
            "expiry_date": "2026-01-01",
            "days_until_expiry": -5,
            "priority": "critical",
            "recommended_action": "dispose",
        })
        assert ok is False
        assert any("negative" in e.lower() for e in errors)

    def test_days_above_sixty_fails(self):
        ok, errors = validate_expiry_action({
            "batch_id": "b-1",
            "lot_number": "LOT-001",
            "vaccine_name": "Pfizer",
            "quantity_available": 100,
            "expiry_date": "2027-06-01",
            "days_until_expiry": 120,
            "priority": "low",
            "recommended_action": "no_action",
        })
        assert ok is False
        assert any("60" in e for e in errors)

    def test_refuses_disposal_when_more_than_fourteen_days_remain(self):
        ok, errors = validate_expiry_action({
            "batch_id": "b-1",
            "lot_number": "LOT-001",
            "vaccine_name": "Pfizer",
            "quantity_available": 100,
            "expiry_date": "2026-11-15",
            "days_until_expiry": 30,  # > 14
            "priority": "high",
            "recommended_action": "dispose",
        })
        assert ok is False
        assert any("disposal" in e.lower() or "dispose" in e.lower() for e in errors)


# ==================== compute_reorder_quantity ====================

class TestComputeReorderQuantity:
    def test_returns_zero_when_stock_above_target(self):
        # target = 2 * 50 = 100, current = 200 > 100, deficit = 0
        assert compute_reorder_quantity(200, 50) == 0

    def test_returns_zero_when_stock_equals_target(self):
        assert compute_reorder_quantity(100, 50) == 0

    def test_rounds_up_to_nearest_fifty(self):
        # target = 100, current = 30, deficit = 70, rounds up to 100
        assert compute_reorder_quantity(30, 50) == 100

    def test_small_deficit_rounds_up(self):
        # target = 100, current = 90, deficit = 10, rounds up to 50
        assert compute_reorder_quantity(90, 50) == 50

    def test_threshold_zero_returns_zero(self):
        assert compute_reorder_quantity(0, 0) == 0


# ==================== compute_urgency ====================

class TestComputeUrgency:
    def test_stock_at_or_below_threshold_returns_high(self):
        assert compute_urgency(50, 50) == "high"
        assert compute_urgency(30, 50) == "high"

    def test_stock_up_to_150_percent_of_threshold_returns_medium(self):
        assert compute_urgency(70, 50) == "medium"
        assert compute_urgency(75, 50) == "medium"

    def test_stock_above_150_percent_returns_low(self):
        assert compute_urgency(100, 50) == "low"

    def test_threshold_zero_returns_low(self):
        assert compute_urgency(10, 0) == "low"


# ==================== compute_expiry_priority ====================

class TestComputeExpiryPriority:
    def test_fourteen_days_or_less_is_critical(self):
        assert compute_expiry_priority(14, 100) == "critical"
        assert compute_expiry_priority(5, 100) == "critical"

    def test_quantity_above_five_hundred_is_critical(self):
        assert compute_expiry_priority(45, 600) == "critical"

    def test_thirty_days_or_less_is_high(self):
        assert compute_expiry_priority(20, 100) == "high"
        assert compute_expiry_priority(30, 100) == "high"

    def test_sixty_days_or_less_is_medium(self):
        assert compute_expiry_priority(50, 100) == "medium"
        assert compute_expiry_priority(60, 100) == "medium"

    def test_more_than_sixty_days_is_low(self):
        assert compute_expiry_priority(90, 100) == "low"