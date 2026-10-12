"""
SE3090 Agentic AI evaluation — StaffSchedulingAgent golden cases.

Runs without calling an LLM. Rule-based assertions cover:
planning, allow-listed tools, structured outputs, deterministic validation,
human-approval gate, and safe failure on forbidden / injected write tools.
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

import pytest

from evaluation.staff_scheduling_golden import (
    ALLOWED_STAFF_TOOLS,
    FORBIDDEN_WRITE_TOOLS,
    GOLDEN_CASES,
    evaluate_all,
    evaluate_trajectory,
)
from staff_scheduling_agent import StaffSchedulingAgent
from staff_tools import (
    STAFF_TOOLS_SCHEMA,
    _validate_proposals,
    tool_propose_shift_for_approval,
)
from orchestrator import MultiAgentOrchestrator


def test_golden_cases_all_pass():
    results = evaluate_all()
    failures = {case_id: msgs for case_id, msgs in results.items() if msgs}
    assert not failures, failures


def test_each_shipped_golden_case_is_self_consistent():
    for case_id, case in GOLDEN_CASES.items():
        assert case["id"] == case_id
        assert evaluate_trajectory(case) == []


def test_tool_schema_allow_list_matches_runtime_tools():
    schema_names = {
        item["function"]["name"] for item in STAFF_TOOLS_SCHEMA if "function" in item
    }
    assert schema_names == set(ALLOWED_STAFF_TOOLS)
    assert schema_names.isdisjoint(FORBIDDEN_WRITE_TOOLS)


@pytest.mark.asyncio
async def test_execute_tool_blocks_forbidden_writes():
    agent = StaffSchedulingAgent()
    for tool in ("create_shift", "delete_shift", "suggest_week_coverage"):
        result = await agent.execute_tool(tool, {}, token=None)
        assert result.get("success") is False
        assert "not permitted" in str(result.get("error") or "").lower()

    for tool in ("approve_shift", "assign_staff", "update_shift"):
        result = await agent.execute_tool(tool, {}, token=None)
        # Unknown / non-allow-listed tools must not succeed or create roster writes.
        assert result.get("success") is not True
        assert "error" in result


@pytest.mark.asyncio
async def test_propose_shift_rejects_invalid_inputs():
    past = (date.today() - timedelta(days=2)).isoformat()
    past_result = await tool_propose_shift_for_approval(
        affiliation_id="11111111-1111-1111-1111-111111111111",
        staff_name="Dr. Test",
        shift_date=past,
        start_time="09:00",
        end_time="12:00",
    )
    assert past_result["success"] is False

    inverted = await tool_propose_shift_for_approval(
        affiliation_id="11111111-1111-1111-1111-111111111111",
        staff_name="Dr. Test",
        shift_date=(date.today() + timedelta(days=3)).isoformat(),
        start_time="15:00",
        end_time="09:00",
    )
    assert inverted["success"] is False

    missing = await tool_propose_shift_for_approval(
        affiliation_id="",
        staff_name="Dr. Test",
        shift_date=(date.today() + timedelta(days=3)).isoformat(),
        start_time="09:00",
        end_time="12:00",
    )
    assert missing["success"] is False


@pytest.mark.asyncio
async def test_valid_proposal_is_pending_hospital_approval_only():
    future = (date.today() + timedelta(days=5)).isoformat()
    result = await tool_propose_shift_for_approval(
        affiliation_id="11111111-1111-1111-1111-111111111111",
        staff_name="Dr. Perera",
        shift_date=future,
        start_time="09:00",
        end_time="12:00",
        booth_or_station="B01",
    )
    assert result["success"] is True
    assert result["status"] == "proposal_pending_hospital_approval"
    proposal = result["proposal"]
    assert proposal["affiliationId"]
    assert proposal["shiftDate"] == future
    # Agent must not claim the shift already exists on the roster.
    assert "shiftId" not in proposal


def test_validate_proposals_flags_unknown_staff_and_overlap():
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    staff = [
        {
            "affiliationId": "aff-1",
            "staffName": "Nurse A",
            "staffRole": "NURSE",
        }
    ]
    planned = [
        {"affiliationId": "aff-1", "date": tomorrow, "start": 9 * 60, "end": 12 * 60},
        {"affiliationId": "aff-1", "date": tomorrow, "start": 10 * 60, "end": 13 * 60},
    ]
    proposals = [
        {
            "gapId": "g1",
            "affiliationId": "aff-missing",
            "shiftDate": tomorrow,
            "startTime": "09:00",
            "endTime": "11:00",
        },
        {
            "gapId": "g2",
            "affiliationId": "aff-1",
            "shiftDate": tomorrow,
            "startTime": "09:30",
            "endTime": "11:30",
        },
    ]
    result = _validate_proposals(proposals, staff, planned)
    assert result["valid"] is False
    messages = " ".join(issue["message"] for issue in result["issues"])
    assert "not on the active roster" in messages
    assert "already booked" in messages


@pytest.mark.asyncio
async def test_orchestrator_routes_hospital_roster_to_staff_scheduling():
    orch = MultiAgentOrchestrator()
    target = await orch.route_intent(
        [
            {
                "role": "user",
                "content": "Analyze coverage and suggest shifts for the roster this week",
            }
        ],
        allowed_agents=["StaffSchedulingAgent"],
    )
    assert target == "StaffSchedulingAgent"


def test_malformed_golden_case_fails_loudly():
    bad = {
        "id": "broken",
        "objective": "",
        "plan": [],
        "tool_trace": [],
        "final": {},
    }
    failures = evaluate_trajectory(bad)
    assert failures
