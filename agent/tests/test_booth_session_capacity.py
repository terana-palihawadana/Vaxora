"""Booth throughput capacity: window minutes / 20 × PATIENTS_PER_SLOT."""

from staff_tools import (
    PATIENTS_PER_SLOT,
    _place_vaccine_demand,
    _session_patient_capacity,
)


def test_session_capacity_two_hour_window():
    # 09:00–11:00 → 6 bands × 3 = 18
    assert _session_patient_capacity(9 * 60, 11 * 60) == 6 * PATIENTS_PER_SLOT
    assert _session_patient_capacity(9 * 60, 11 * 60) == 18


def test_session_capacity_four_hour_fallback_and_explicit():
    # Classic AM half-day 08:00–12:00 → 12 × 3 = 36
    assert _session_patient_capacity(8 * 60, 12 * 60) == 36
    # Missing / invalid window uses same 4h fallback length
    assert _session_patient_capacity(None, None) == 36
    assert _session_patient_capacity(10 * 60, 9 * 60) == 36


def test_place_demand_uses_window_room_not_fixed_twelve():
    booth = {
        "id": "b1",
        "displayLabel": "B01",
        "vaccineIds": ["v1"],
        "vaccineNames": ["Rabies"],
    }
    group = {
        "key": "v1",
        "label": "Rabies",
        "count": 18,
        "slotStart": 9 * 60,
        "slotEnd": 11 * 60,
    }
    open_booths = []
    booth_room = {}
    placed, leftover = _place_vaccine_demand([booth], group, open_booths, booth_room)
    assert leftover == 0
    assert placed == [booth]
    assert booth_room["b1"] == 0

    # One more patient needs another booth — room was 18, not 12
    group2 = {**group, "count": 1}
    placed2, leftover2 = _place_vaccine_demand([booth], group2, open_booths, booth_room)
    assert leftover2 == 1
    assert placed2 == []
