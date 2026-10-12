"""
A doctor's days off and the hours they offer a hospital reach the agent as busy
blocks. These cases check the agent never proposes a shift inside them, and still
uses the doctor fairly on the days they are free.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

import staff_tools as tools
from staff_scheduling_agent import StaffSchedulingAgent

WEEKEND_DOCTOR = "aaaaaaaa-0000-0000-0000-000000000001"
OTHER_DOCTOR = "aaaaaaaa-0000-0000-0000-000000000002"
NURSE = "aaaaaaaa-0000-0000-0000-000000000003"
BOOTH = "bbbbbbbb-0000-0000-0000-000000000001"


def _next_week():
    today = date.fromisoformat(tools._hospital_today())
    monday = today + timedelta(days=7 - today.weekday())
    return [monday + timedelta(days=offset) for offset in range(7)]


def _unavailable(day, start, end):
    return {
        "localAffiliationId": WEEKEND_DOCTOR,
        "shiftDate": day.isoformat(),
        "startTime": start,
        "endTime": end,
        "isExternal": False,
        "isUnavailable": True,
    }


@pytest.fixture
def weekend_only_doctor(monkeypatch):
    """One doctor offers only Sat/Sun 07:00-21:00; a morning session runs every day."""
    week = _next_week()
    busy = []
    for day in week:
        if day.weekday() < 5:
            busy.append(_unavailable(day, "00:00:00", "23:59:59"))
        else:
            busy.append(_unavailable(day, "00:00:00", "07:00:00"))
            busy.append(_unavailable(day, "21:00:00", "23:59:59"))

    responses = {
        "/staff/hospital": [
            {"affiliationId": WEEKEND_DOCTOR, "staffName": "Dr Weekend", "staffRole": "DOCTOR"},
            {"affiliationId": OTHER_DOCTOR, "staffName": "Dr Other", "staffRole": "DOCTOR"},
            {"affiliationId": NURSE, "staffName": "Nurse One", "staffRole": "NURSE"},
        ],
        "/staff/shifts/hospital": [],
        "/staff/shifts/busy": busy,
        "/staff/booths": [
            {"boothId": BOOTH, "code": "B01", "name": "Adult", "displayLabel": "B01", "isActive": True}
        ],
        "/schedule/hospital": [
            {
                "id": "cccccccc-0000-0000-0000-000000000001",
                "status": "Active",
                "scheduleType": "Weekly",
                "daysOfWeek": "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
                "startDate": week[0].isoformat(),
                "endDate": week[6].isoformat(),
                "startTime": "09:00",
                "endTime": "12:00",
                "vaccineName": "Influenza",
                "boothId": BOOTH,
                "boothLabel": "B01",
            }
        ],
    }

    async def fake_get(path, token=None, params=None):
        return responses.get(path, [])

    monkeypatch.setattr(tools, "api_get", fake_get)
    tools._hospital_key.set(f"availability-test-{id(busy)}")
    return week


async def test_plan_keeps_a_doctor_off_days_they_do_not_offer(weekend_only_doctor):
    week = weekend_only_doctor

    plan = await tools.tool_build_staffing_plan(week[0].isoformat(), week[6].isoformat(), token="t")

    assert plan["success"] is True
    theirs = [p for p in plan["proposals"] if p["affiliationId"] == WEEKEND_DOCTOR]
    assert all(date.fromisoformat(p["shiftDate"]).weekday() >= 5 for p in theirs)
    # Unavailable hours are not shifts, so the doctor is still used when they are free.
    assert theirs, "weekend-only doctor should be proposed on the weekend"
    assert any("days off" in finding for finding in plan["findings"])


def _pick(workload):
    pool = [
        {"affiliationId": WEEKEND_DOCTOR, "staffName": "Dr Weekend"},
        {"affiliationId": OTHER_DOCTOR, "staffName": "Dr Other"},
    ]
    saturday = _next_week()[5].isoformat()
    # Dr Weekend offers 07:00-21:00 that day; the session is 09:00-12:00.
    planned = [
        {"affiliationId": WEEKEND_DOCTOR, "date": saturday, "start": 0, "end": 420, "unavailable": True},
    ]
    return tools._pick_lightest_free(pool, planned, workload, saturday, 540, 720)


def test_part_week_doctor_goes_first_only_while_behind_on_shifts():
    behind = _pick({WEEKEND_DOCTOR: 0, OTHER_DOCTOR: 2})
    assert behind["affiliationId"] == WEEKEND_DOCTOR

    # Once they have more than their share, the flexible colleague is picked.
    ahead = _pick({WEEKEND_DOCTOR: 3, OTHER_DOCTOR: 2})
    assert ahead["affiliationId"] == OTHER_DOCTOR


async def test_named_proposal_is_refused_outside_offered_hours(weekend_only_doctor):
    week = weekend_only_doctor

    weekday = await tools.tool_propose_shift_for_approval(
        affiliation_id=WEEKEND_DOCTOR,
        staff_name="Dr Weekend",
        shift_date=week[1].isoformat(),
        start_time="09:00",
        end_time="12:00",
        token="t",
    )
    assert weekday["success"] is False
    assert "outside the hours" in weekday["error"]

    weekend = await tools.tool_propose_shift_for_approval(
        affiliation_id=WEEKEND_DOCTOR,
        staff_name="Dr Weekend",
        shift_date=week[5].isoformat(),
        start_time="09:00",
        end_time="12:00",
        token="t",
    )
    assert weekend["success"] is True


async def test_suggest_week_still_plans_from_sessions_when_the_model_is_down(weekend_only_doctor, monkeypatch):
    week = weekend_only_doctor
    agent = StaffSchedulingAgent()

    async def model_down(*args, **kwargs):
        raise RuntimeError("429 Too Many Requests: free-models-per-day")

    monkeypatch.setattr(agent, "_call_llm", model_down)

    result = await agent.run(
        [
            {
                "role": "user",
                "content": f"Suggest shifts for booked appointments from {week[0].isoformat()} to {week[6].isoformat()}",
            }
        ],
        token="t",
    )

    proposals = result["proposals"] or []
    assert proposals, "the roster should still be planned without the model"
    # Session hours, not fixed morning/afternoon slots.
    assert {p["startTime"][:5] for p in proposals} == {"09:00"}
    assert {p["endTime"][:5] for p in proposals} == {"12:00"}
    # The reply is honest that the model was not used.
    assert result["modelUnavailable"] is True
    assert "unavailable" in result["content"].lower()
