"""
High-priority BookingAgent tests.

These exercise the real agent loop and tool code (not the hand-written golden
fixtures). The LLM and the Vaxora REST API are replaced with in-memory fakes,
so no network access is needed.

Covered:
- human-in-the-loop approval gate for book_appointment / cancel_appointment
- proposals that fail validation must not reach the approval step
- cancellation targets the right appointment (no wrong-appointment fallback,
  never Completed / past / already-cancelled ones)
- autonomous_find_and_propose (the primary booking mode)
- payment method selection in tool_book_appointment
- full cancellation run through the agent loop
- LLM service failure
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

import pytest

import tools
from bookingagent import BookingAgent

HOSPITAL_ID = "22222222-2222-2222-2222-222222222222"
VACCINE_ID = "44444444-4444-4444-4444-444444444444"
SCHEDULE_ID = "55555555-5555-5555-5555-555555555555"


def _days(n: int) -> str:
    return (date.today() + timedelta(days=n)).isoformat()


class FakeApi:
    """Records every API call made by the tools and serves canned responses."""

    def __init__(
        self,
        *,
        appointments: Optional[List[Dict[str, Any]]] = None,
        schedules: Optional[List[Dict[str, Any]]] = None,
        inventory: Optional[List[Dict[str, Any]]] = None,
        dates: Optional[List[Dict[str, Any]]] = None,
        slots_by_date: Optional[Dict[str, List[Dict[str, Any]]]] = None,
        booking_response: Optional[Dict[str, Any]] = None,
        post_error: Optional[Exception] = None,
    ):
        self.appointments = appointments or []
        self.schedules = schedules or []
        self.inventory = inventory or []
        self.dates = dates or []
        self.slots_by_date = slots_by_date or {}
        self.booking_response = booking_response or {"id": "apt-new", "status": "Confirmed", "fee": 0.0}
        self.post_error = post_error
        self.gets: List[tuple] = []
        self.posts: List[tuple] = []
        self.deletes: List[str] = []

    async def get(self, endpoint: str, token: Optional[str] = None, params: Optional[Dict[str, Any]] = None):
        self.gets.append((endpoint, params))
        if endpoint == "/appointments/patient":
            return self.appointments
        if endpoint == "/schedule/available":
            return self.schedules
        if endpoint == "/inventory/vaccines-with-hospitals":
            return self.inventory
        if endpoint == "/appointments/available-dates":
            return self.dates
        if endpoint == "/appointments/available-slots":
            return self.slots_by_date.get((params or {}).get("date"), [])
        return []

    async def post(self, endpoint: str, data: Dict[str, Any], token: Optional[str] = None):
        self.posts.append((endpoint, data))
        if self.post_error:
            raise self.post_error
        if endpoint == "/appointments":
            return self.booking_response
        if endpoint == "/payment/payhere-init":
            return {"merchant_id": "test", "order_id": data.get("appointmentId")}
        return {}

    async def delete(self, endpoint: str, token: Optional[str] = None):
        self.deletes.append(endpoint)
        return {"success": True}

    def install(self, monkeypatch) -> "FakeApi":
        monkeypatch.setattr(tools, "api_get", self.get)
        monkeypatch.setattr(tools, "api_post", self.post)
        monkeypatch.setattr(tools, "api_delete", self.delete)
        return self

    @property
    def booking_posts(self) -> List[tuple]:
        return [p for p in self.posts if p[0] == "/appointments"]


def _tool_call(name: str, args: Dict[str, Any], call_id: str = "call_1") -> Dict[str, Any]:
    return {
        "role": "assistant",
        "content": "",
        "tool_calls": [{"id": call_id, "function": {"name": name, "arguments": args}}],
    }


def _scripted_llm(*replies: Dict[str, Any]):
    """Return the given assistant messages in order, then a plain text reply."""
    queue = list(replies)

    async def fake(conversation, tools=None):
        if queue:
            return queue.pop(0)
        return {"role": "assistant", "content": "Done.", "tool_calls": None}

    return fake


def _agent_with(monkeypatch, *replies: Dict[str, Any]) -> BookingAgent:
    agent = BookingAgent()
    monkeypatch.setattr(agent, "_call_llm", _scripted_llm(*replies))
    return agent


def _booking_args(appointment_date: Optional[str] = None, **overrides) -> Dict[str, Any]:
    args = {
        "hospital_user_id": HOSPITAL_ID,
        "hospital_name": "Royal Hospital",
        "vaccine_name": "AstraZeneca",
        "appointment_date": appointment_date or _days(5),
        "time_slot": "09:00 AM - 09:20 AM",
        "is_free": True,
    }
    args.update(overrides)
    return args


# ---------------------------------------------------------------------------
# 1. Human-in-the-loop approval gate
# ---------------------------------------------------------------------------


class TestApprovalGate:
    async def test_book_appointment_without_approval_is_refused(self, monkeypatch):
        api = FakeApi().install(monkeypatch)
        agent = _agent_with(monkeypatch, _tool_call("book_appointment", _booking_args()))

        result = await agent.run(
            messages=[{"role": "user", "content": "Book AstraZeneca at Royal Hospital"}],
            token="patient-token",
        )

        assert api.booking_posts == [], "book_appointment must not reach the API before the patient approves"
        assert result["booking"] is None
        assert result["toolResults"][0]["success"] is False

    async def test_cancel_appointment_without_approval_is_refused(self, monkeypatch):
        api = FakeApi(
            appointments=[
                {"id": "apt-1", "vaccineName": "AstraZeneca", "appointmentDate": _days(3), "status": "Confirmed"},
                {"id": "apt-2", "vaccineName": "Pfizer", "appointmentDate": _days(9), "status": "Confirmed"},
            ]
        ).install(monkeypatch)
        agent = _agent_with(monkeypatch, _tool_call("cancel_appointment", {"appointment_id": "all"}))

        result = await agent.run(
            messages=[{"role": "user", "content": "cancel my appointments"}],
            token="patient-token",
        )

        assert api.deletes == [], "cancel_appointment must not reach the API before the patient approves"
        assert result["finalOutcome"] != "Completed" or result["cancellation"] is None
        assert result["toolResults"][0]["success"] is False

    async def test_book_appointment_runs_after_explicit_approval(self, monkeypatch):
        api = FakeApi().install(monkeypatch)
        agent = _agent_with(monkeypatch, _tool_call("book_appointment", _booking_args()))

        result = await agent.run(
            messages=[
                {"role": "user", "content": "Book AstraZeneca at Royal Hospital"},
                {"role": "assistant", "content": "Please review the proposal card and tap 'Confirm & Book'."},
                {"role": "user", "content": "I approve and confirm booking this appointment."},
            ],
            token="patient-token",
        )

        assert len(api.booking_posts) == 1
        assert result["booking"] is not None
        assert result["booking"]["success"] is True

    async def test_cancel_appointment_runs_after_explicit_approval(self, monkeypatch):
        api = FakeApi(
            appointments=[
                {"id": "apt-1", "vaccineName": "AstraZeneca", "appointmentDate": _days(3), "status": "Confirmed"},
            ]
        ).install(monkeypatch)
        agent = _agent_with(monkeypatch, _tool_call("cancel_appointment", {"appointment_id": "apt-1"}))

        result = await agent.run(
            messages=[
                {"role": "user", "content": "cancel my AstraZeneca appointment"},
                {"role": "assistant", "content": "Please review the cancellation card below."},
                {"role": "user", "content": "I approve and confirm cancellation of this appointment."},
            ],
            token="patient-token",
        )

        assert api.deletes == ["/appointments/apt-1/cancel"]
        assert result["cancellation"] is not None


# ---------------------------------------------------------------------------
# 2. Proposals that fail validation must not reach the approval step
# ---------------------------------------------------------------------------


class TestInvalidProposalIsNotOffered:
    @pytest.mark.parametrize(
        "bad_args",
        [
            pytest.param(_booking_args(appointment_date=_days(-2)), id="past-date"),
            pytest.param(_booking_args(time_slot="whenever"), id="malformed-slot"),
            pytest.param(_booking_args(hospital_user_id=""), id="missing-hospital"),
        ],
    )
    async def test_invalid_proposal_is_not_sent_for_approval(self, monkeypatch, bad_args):
        FakeApi().install(monkeypatch)
        agent = _agent_with(monkeypatch, _tool_call("propose_booking_for_approval", bad_args))

        result = await agent.run(messages=[{"role": "user", "content": "Book AstraZeneca"}], token=None)

        assert result["validation"]["valid"] is False
        assert result["approvalRequired"] is False
        assert result["proposals"] == []
        assert result["finalOutcome"] != "AwaitingApproval"

    async def test_valid_proposal_is_sent_for_approval(self, monkeypatch):
        FakeApi().install(monkeypatch)
        agent = _agent_with(monkeypatch, _tool_call("propose_booking_for_approval", _booking_args()))

        result = await agent.run(messages=[{"role": "user", "content": "Book AstraZeneca"}], token=None)

        assert result["validation"]["valid"] is True
        assert result["approvalRequired"] is True
        assert result["finalOutcome"] == "AwaitingApproval"
        assert len(result["proposals"]) == 1


# ---------------------------------------------------------------------------
# 3. Cancellation targets the right appointment
# ---------------------------------------------------------------------------


class TestCancellationTargeting:
    async def test_proposal_picks_the_matching_appointment(self, monkeypatch):
        FakeApi(
            appointments=[
                {"id": "apt-pfizer", "vaccineName": "Pfizer", "appointmentDate": _days(4), "status": "Confirmed"},
                {"id": "apt-az", "vaccineName": "AstraZeneca", "appointmentDate": _days(6), "status": "Confirmed"},
            ]
        ).install(monkeypatch)

        res = await tools.tool_propose_cancellation_for_approval(vaccine_name="AstraZeneca", token="t")

        assert res["success"] is True
        assert res["proposal"]["appointment_id"] == "apt-az"

    async def test_proposal_with_no_match_does_not_fall_back_to_another_appointment(self, monkeypatch):
        FakeApi(
            appointments=[
                {"id": "apt-pfizer", "vaccineName": "Pfizer", "appointmentDate": _days(4), "status": "Confirmed"},
            ]
        ).install(monkeypatch)

        res = await tools.tool_propose_cancellation_for_approval(vaccine_name="AstraZeneca", token="t")

        assert res["success"] is False
        assert "proposal" not in res or res["proposal"]["appointment_id"] != "apt-pfizer"

    async def test_proposal_skips_completed_and_past_appointments(self, monkeypatch):
        FakeApi(
            appointments=[
                {"id": "apt-done", "vaccineName": "Pfizer", "appointmentDate": _days(-30), "status": "Completed"},
                {"id": "apt-up", "vaccineName": "Pfizer", "appointmentDate": _days(5), "status": "Confirmed"},
            ]
        ).install(monkeypatch)

        res = await tools.tool_propose_cancellation_for_approval(vaccine_name="Pfizer", token="t")

        assert res["success"] is True
        assert res["proposal"]["appointment_id"] == "apt-up"

    async def test_cancel_tool_with_no_match_sends_no_delete(self, monkeypatch):
        api = FakeApi(
            appointments=[
                {"id": "apt-pfizer", "vaccineName": "Pfizer", "appointmentDate": _days(4), "status": "Confirmed"},
            ]
        ).install(monkeypatch)

        res = await tools.tool_cancel_appointment(appointment_id="Moderna", token="t")

        assert res["success"] is False
        assert api.deletes == []

    async def test_cancel_tool_by_id_cancels_only_that_appointment(self, monkeypatch):
        api = FakeApi(
            appointments=[
                {"id": "apt-1", "vaccineName": "Pfizer", "appointmentDate": _days(4), "status": "Confirmed"},
                {"id": "apt-2", "vaccineName": "Pfizer", "appointmentDate": _days(8), "status": "Confirmed"},
            ]
        ).install(monkeypatch)

        res = await tools.tool_cancel_appointment(appointment_id="apt-2", token="t")

        assert res["success"] is True
        assert api.deletes == ["/appointments/apt-2/cancel"]

    async def test_cancel_latest_skips_completed_appointments(self, monkeypatch):
        api = FakeApi(
            appointments=[
                {"id": "apt-done", "vaccineName": "Pfizer", "appointmentDate": _days(-30), "status": "Completed"},
                {"id": "apt-up", "vaccineName": "Pfizer", "appointmentDate": _days(5), "status": "Confirmed"},
            ]
        ).install(monkeypatch)

        await tools.tool_cancel_appointment(appointment_id="latest", token="t")

        assert api.deletes == ["/appointments/apt-up/cancel"]

    async def test_cancel_all_only_touches_active_upcoming_appointments(self, monkeypatch):
        api = FakeApi(
            appointments=[
                {"id": "apt-done", "vaccineName": "Pfizer", "appointmentDate": _days(-30), "status": "Completed"},
                {"id": "apt-gone", "vaccineName": "Pfizer", "appointmentDate": _days(2), "status": "Cancelled"},
                {"id": "apt-up-1", "vaccineName": "Pfizer", "appointmentDate": _days(5), "status": "Confirmed"},
                {"id": "apt-up-2", "vaccineName": "AstraZeneca", "appointmentDate": _days(9), "status": "Pending"},
            ]
        ).install(monkeypatch)

        res = await tools.tool_cancel_appointment(appointment_id="all", token="t")

        assert res["success"] is True
        assert sorted(api.deletes) == ["/appointments/apt-up-1/cancel", "/appointments/apt-up-2/cancel"]


# ---------------------------------------------------------------------------
# 4. autonomous_find_and_propose (primary booking mode)
# ---------------------------------------------------------------------------


def _slot(label: str, start: str, booked: bool = False) -> Dict[str, Any]:
    return {"slot": label, "startTime": start, "isBooked": booked}


def _schedule(price: float = 0.0) -> Dict[str, Any]:
    return {
        "id": SCHEDULE_ID,
        "hospitalUserId": HOSPITAL_ID,
        "hospitalName": "Royal Hospital",
        "vaccineName": "AstraZeneca",
        "vaccineId": VACCINE_ID,
        "price": price,
        "formattedPrice": f"LKR {price:,.2f}" if price else "Free",
    }


MORNING = _slot("09:00 AM - 09:20 AM", "09:00")
MORNING_2 = _slot("09:20 AM - 09:40 AM", "09:20")
AFTERNOON = _slot("02:00 PM - 02:20 PM", "14:00")


class TestAutonomousFindAndPropose:
    async def _run(self, monkeypatch, **kwargs) -> Dict[str, Any]:
        args = {"vaccine_name": "AstraZeneca", "hospital_name_or_id": HOSPITAL_ID}
        args.update(kwargs.pop("call", {}))
        FakeApi(**kwargs).install(monkeypatch)
        return await tools.tool_autonomous_find_and_propose(token="t", **args)

    async def test_proposes_first_open_slot_on_earliest_date(self, monkeypatch):
        d1, d2 = _days(2), _days(5)
        res = await self._run(
            monkeypatch,
            schedules=[_schedule()],
            dates=[{"date": d1}, {"date": d2}],
            slots_by_date={d1: [MORNING, AFTERNOON], d2: [MORNING]},
            call={"preferred_date": "earliest"},
        )

        assert res["success"] is True
        assert res["status"] == "proposal_pending_user_approval"
        p = res["proposal"]
        assert p["hospital_user_id"] == HOSPITAL_ID
        assert p["hospital_name"] == "Royal Hospital"
        assert p["appointment_date"] == d1
        assert p["time_slot"] == MORNING["slot"]

    async def test_skips_booked_slots(self, monkeypatch):
        d1 = _days(2)
        res = await self._run(
            monkeypatch,
            schedules=[_schedule()],
            dates=[{"date": d1}],
            slots_by_date={d1: [_slot("09:00 AM - 09:20 AM", "09:00", booked=True), MORNING_2]},
        )

        assert res["proposal"]["time_slot"] == MORNING_2["slot"]

    async def test_moves_to_next_date_when_chosen_day_is_full(self, monkeypatch):
        d1, d2 = _days(2), _days(5)
        res = await self._run(
            monkeypatch,
            schedules=[_schedule()],
            dates=[{"date": d1}, {"date": d2}],
            slots_by_date={d1: [_slot("09:00 AM - 09:20 AM", "09:00", booked=True)], d2: [AFTERNOON]},
        )

        assert res["success"] is True
        assert res["proposal"]["appointment_date"] == d2
        assert res["proposal"]["time_slot"] == AFTERNOON["slot"]

    async def test_errors_when_there_are_no_clinic_dates(self, monkeypatch):
        res = await self._run(monkeypatch, schedules=[_schedule()], dates=[])

        assert res["success"] is False
        assert "No clinic sessions found" in res["error"]
        assert "proposal" not in res

    async def test_errors_when_every_slot_is_booked(self, monkeypatch):
        d1, d2 = _days(2), _days(5)
        full = [_slot("09:00 AM - 09:20 AM", "09:00", booked=True)]
        res = await self._run(
            monkeypatch,
            schedules=[_schedule()],
            dates=[{"date": d1}, {"date": d2}],
            slots_by_date={d1: full, d2: full},
        )

        assert res["success"] is False
        assert "All slots are currently booked" in res["error"]
        assert "proposal" not in res

    async def test_respects_morning_preference(self, monkeypatch):
        d1 = _days(2)
        res = await self._run(
            monkeypatch,
            schedules=[_schedule()],
            dates=[{"date": d1}],
            slots_by_date={d1: [AFTERNOON, MORNING]},
            call={"time_of_day": "morning"},
        )

        assert res["proposal"]["time_slot"] == MORNING["slot"]

    async def test_respects_afternoon_preference(self, monkeypatch):
        d1 = _days(2)
        res = await self._run(
            monkeypatch,
            schedules=[_schedule()],
            dates=[{"date": d1}],
            slots_by_date={d1: [MORNING, MORNING_2, AFTERNOON]},
            call={"time_of_day": "afternoon"},
        )

        assert res["proposal"]["time_slot"] == AFTERNOON["slot"]

    async def test_never_proposes_a_past_date(self, monkeypatch):
        past, future = _days(-3), _days(4)
        res = await self._run(
            monkeypatch,
            schedules=[_schedule()],
            dates=[{"date": past}, {"date": future}],
            slots_by_date={past: [MORNING], future: [MORNING]},
            call={"preferred_date": "earliest"},
        )

        assert res["proposal"]["appointment_date"] == future

    async def test_paid_schedule_sets_price_and_is_free_false(self, monkeypatch):
        d1 = _days(2)
        res = await self._run(
            monkeypatch,
            schedules=[_schedule(price=1000.0)],
            dates=[{"date": d1}],
            slots_by_date={d1: [MORNING]},
        )

        p = res["proposal"]
        assert p["price"] == 1000.0
        assert p["is_free"] is False
        assert p["vaccine_schedule_id"] == SCHEDULE_ID
        assert p["vaccine_id"] == VACCINE_ID

    async def test_free_schedule_sets_is_free_true(self, monkeypatch):
        d1 = _days(2)
        res = await self._run(
            monkeypatch,
            schedules=[_schedule(price=0.0)],
            dates=[{"date": d1}],
            slots_by_date={d1: [MORNING]},
        )

        assert res["proposal"]["price"] == 0.0
        assert res["proposal"]["is_free"] is True


# ---------------------------------------------------------------------------
# 5. Payment method selection in tool_book_appointment
# ---------------------------------------------------------------------------


class TestBookAppointmentPayment:
    async def test_paid_schedule_uses_payhere_and_initialises_payment(self, monkeypatch):
        api = FakeApi(
            schedules=[_schedule(price=1000.0)],
            booking_response={"id": "apt-paid", "status": "PendingPayment", "fee": 1000.0},
        ).install(monkeypatch)

        res = await tools.tool_book_appointment(
            hospital_user_id=HOSPITAL_ID,
            vaccine_name="AstraZeneca",
            appointment_date=_days(4),
            time_slot="09:00 AM - 09:20 AM",
            token="t",
        )

        assert res["success"] is True
        _, payload = api.booking_posts[0]
        assert payload["paymentMethod"] == "PayHere"
        assert payload["vaccineScheduleId"] == SCHEDULE_ID
        assert payload["vaccineId"] == VACCINE_ID
        assert ("/payment/payhere-init", {"appointmentId": "apt-paid"}) in api.posts
        assert res["is_free"] is False
        assert res["fee"] == 1000.0
        assert res["payhere_payload"] is not None

    async def test_free_schedule_uses_free_and_skips_payment(self, monkeypatch):
        api = FakeApi(
            schedules=[_schedule(price=0.0)],
            booking_response={"id": "apt-free", "status": "Confirmed", "fee": 0.0},
        ).install(monkeypatch)

        res = await tools.tool_book_appointment(
            hospital_user_id=HOSPITAL_ID,
            vaccine_name="AstraZeneca",
            appointment_date=_days(4),
            time_slot="09:00 AM - 09:20 AM",
            token="t",
        )

        assert res["success"] is True
        _, payload = api.booking_posts[0]
        assert payload["paymentMethod"] == "Free"
        assert not any(endpoint == "/payment/payhere-init" for endpoint, _ in api.posts)
        assert res["is_free"] is True
        assert res["payhere_payload"] is None

    async def test_booking_payload_uses_cleaned_date_and_slot(self, monkeypatch):
        api = FakeApi(schedules=[_schedule()]).install(monkeypatch)
        target = _days(4)

        await tools.tool_book_appointment(
            hospital_user_id=HOSPITAL_ID,
            vaccine_name="AstraZeneca",
            appointment_date=f"{target} (Friday)",
            time_slot="Slot: 09:00 AM - 09:20 AM (Available)",
            token="t",
        )

        _, payload = api.booking_posts[0]
        assert payload["appointmentDate"] == target
        assert payload["timeSlot"] == "09:00 AM - 09:20 AM"
        assert payload["hospitalUserId"] == HOSPITAL_ID

    async def test_booking_api_error_returns_failure(self, monkeypatch):
        FakeApi(
            schedules=[_schedule()],
            post_error=Exception("API Error (400): This slot has already reached maximum capacity."),
        ).install(monkeypatch)

        res = await tools.tool_book_appointment(
            hospital_user_id=HOSPITAL_ID,
            vaccine_name="AstraZeneca",
            appointment_date=_days(4),
            time_slot="09:00 AM - 09:20 AM",
            token="t",
        )

        assert res["success"] is False
        assert "maximum capacity" in res["error"]


# ---------------------------------------------------------------------------
# 6. Full cancellation run through the agent loop
# ---------------------------------------------------------------------------


class TestCancellationRun:
    async def test_cancellation_request_ends_with_a_proposal_awaiting_approval(self, monkeypatch):
        api = FakeApi(
            appointments=[
                {
                    "id": "apt-az",
                    "vaccineName": "AstraZeneca",
                    "hospitalName": "Royal Hospital",
                    "appointmentDate": _days(6),
                    "timeSlot": "09:00 AM - 09:20 AM",
                    "status": "Confirmed",
                },
            ]
        ).install(monkeypatch)
        agent = _agent_with(
            monkeypatch,
            _tool_call("get_my_appointments", {}, "call_1"),
            _tool_call("propose_cancellation_for_approval", {"vaccine_name": "AstraZeneca"}, "call_2"),
        )

        result = await agent.run(
            messages=[{"role": "user", "content": "Please cancel my AstraZeneca appointment"}],
            token="patient-token",
            user_id="user-123",
        )

        plan = result["plan"]
        assert len(plan) == 3
        assert [s["status"] for s in plan] == ["completed", "completed", "awaiting_user_approval"]
        assert result["completedSteps"] == ["get_my_appointments", "propose_cancellation_for_approval"]

        assert result["approvalRequired"] is True
        assert result["finalOutcome"] == "AwaitingApproval"
        assert result["validation"]["valid"] is True
        assert len(result["proposals"]) == 1
        proposal = result["proposals"][0]
        assert proposal["type"] == "cancellation"
        assert proposal["appointment_id"] == "apt-az"
        assert result["booking"] is None

        # Proposing must not cancel anything.
        assert api.deletes == []

        from inventory.state_store import state_store

        persisted = state_store.get(result["workflowId"])
        assert persisted["approval_status"] == "awaiting_approval"
        assert persisted["final_outcome"] == "AwaitingApproval"


# ---------------------------------------------------------------------------
# 7. LLM service failure
# ---------------------------------------------------------------------------


class TestLlmFailure:
    async def test_llm_failure_returns_failed_outcome_without_proposals(self, monkeypatch):
        api = FakeApi().install(monkeypatch)
        agent = BookingAgent()

        async def broken_llm(conversation, tools=None):
            raise RuntimeError("503 Service Unavailable")

        monkeypatch.setattr(agent, "_call_llm", broken_llm)

        result = await agent.run(
            messages=[{"role": "user", "content": "Book AstraZeneca next week"}],
            token="patient-token",
            user_id="user-123",
        )

        assert result["finalOutcome"] == "Failed"
        assert result["approvalRequired"] is False
        assert result["proposals"] == []
        assert result["proposal"] is None
        assert result["booking"] is None
        assert result["validation"]["valid"] is False
        assert "503 Service Unavailable" in result["content"]
        assert api.posts == [] and api.deletes == []

        from inventory.state_store import state_store

        persisted = state_store.get(result["workflowId"])
        assert persisted["final_outcome"] == "Failed"
        assert persisted["approval_status"] == "failed"
        assert "503 Service Unavailable" in json.loads(persisted["errors_json"])[0]
