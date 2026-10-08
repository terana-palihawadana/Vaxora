import json
import logging
import re
from datetime import date, timedelta
from typing import List, Dict, Any, Optional, Tuple

import httpx

try:
    from .config import settings
    from .staff_tools import (
        STAFF_TOOLS_SCHEMA,
        STAFF_WEEK_BUILD_TOOLS,
        tool_get_active_staff,
        tool_get_coverage,
        tool_get_hospital_shifts,
        tool_analyze_staffing_needs,
        tool_build_staffing_plan,
        tool_propose_alternative_for_gap,
        tool_propose_shift_for_approval,
        parse_decline_payload,
        _hospital_today,
        bind_hospital,
        note_decline_message,
    )
except ImportError:
    from config import settings
    from staff_tools import (
        STAFF_TOOLS_SCHEMA,
        STAFF_WEEK_BUILD_TOOLS,
        tool_get_active_staff,
        tool_get_coverage,
        tool_get_hospital_shifts,
        tool_analyze_staffing_needs,
        tool_build_staffing_plan,
        tool_propose_alternative_for_gap,
        tool_propose_shift_for_approval,
        parse_decline_payload,
        _hospital_today,
        bind_hospital,
        note_decline_message,
    )

logger = logging.getLogger("vaxora-staff-scheduling-agent")

STAFF_SCHEDULING_SYSTEM_PROMPT = """You are the official Vaxora Staff Scheduling Agent for hospital users.
You help with coverage and shift proposals. You only suggest shifts. The hospital presses Approve or Decline on each one. Never say "UI".

Staffing workflow (always agentic — you must use tools and decide):
1. analyze_staffing_needs(from_date, to_date) — read gaps and each gap's free candidates (names + specialization).
2. Think: match vaccine/booth work to specialization, prefer people with no shift that day before stacking a second session, then balance weekly load.
3. build_staffing_plan(from_date, to_date, preferred_assignments=[...]) — pass your picks as compact
   {gap_id, affiliation_id} entries for every gap you want filled. Do not omit preferred_assignments for a full week;
   that is your job. If a preferred person is busy, the tool falls back fairly.
4. On "reroll", exclude the named affiliation ids (or prior picks) and choose different candidates where possible.
5. Summarize briefly who covers which booth/window and tell them to Approve or Decline.

Posted vaccine routines define the full clinic window. Booth capacity is windowMinutes/20 × 3 patients per band (not a fixed 12). Extra demand above that opens more booths.
Avoid proposing anyone with an overlapping shift (including at another hospital).

Other tools:
- get_active_staff — list doctors/nurses
- get_coverage — Low / Partial / Good per day when they only ask how busy it is
- get_hospital_shifts — who is already scheduled
- propose_shift_for_approval — one custom shift they named
- propose_alternative_for_gap — after a decline, when gap_id and exclude_affiliation_ids are given

Rules:
- Never invent staff or dates. Never claim shifts were saved.
- Be concise. Never mention tool names or JSON field names.
- preferred_assignments must stay compact: only gap_id and affiliation_id per entry (no names, no essays).
- liveClockStatus Off does NOT mean unavailable. Only mention clock-in if they ask who is in the building now.
"""


def _rest_of_week(today: date) -> Tuple[str, str]:
    tomorrow = today + timedelta(days=1)
    sunday = today + timedelta(days=6 - today.weekday())
    if tomorrow > sunday:
        sunday = tomorrow + timedelta(days=6)
    return tomorrow.isoformat(), sunday.isoformat()


def _parse_suggest_dates_from_messages(
    messages: List[Dict[str, Any]],
    fallback_from: str,
    fallback_to: str,
) -> Tuple[str, str]:
    """Pull from/to dates out of the latest user Suggest Week prompt."""
    for m in reversed(messages):
        if m.get("role") != "user":
            continue
        text = str(m.get("content") or "")
        match = re.search(
            r"from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})",
            text,
            re.I,
        )
        if match:
            return match.group(1), match.group(2)
    return fallback_from, fallback_to


def _build_follow_ups(
    messages: List[Dict[str, Any]],
    proposals: Optional[List[Dict[str, Any]]] = None,
) -> List[str]:
    if proposals:
        return [
            "Staff the next day as well",
            "Who is working tomorrow?",
            "Who is on my staff?",
        ]
    return [
        "Staff the rest of the week",
        "Who is working tomorrow?",
        "Who is on my staff?",
        "How busy are we this week?",
    ]


def _briefing(payload: Dict[str, Any], proposals: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    openings = payload.get("openings") or []
    if not openings and not proposals:
        return None
    days: List[Dict[str, Any]] = []
    for item in openings:
        day = next((row for row in days if row["date"] == item.get("date")), None)
        if day is None:
            day = {"date": item.get("date"), "slots": []}
            days.append(day)
        day["slots"].append(
            {
                "name": item.get("slot"),
                "count": item.get("count") or 0,
                "vaccine": item.get("vaccine") or "",
                "booths": list(item.get("booths") or []),
            }
        )
    return {
        "days": days,
        "shiftCount": len(proposals),
    }


COVER_RANK_MARKER = "RANK_COVER_REPLACEMENTS"
COVER_RANK_PROMPT = """You rank already-filtered staff who can cover a specific shift.
Every candidate is the same role as the requester and is free in that window.
Do not invent people. Do not drop a candidate because their specialty differs. Do not build a week plan or call tools.

Return JSON only (no markdown):
{"reviews":[{"requestId":"...","summary":"one short sentence","ranked":[{"affiliationId":"...","why":"one short human reason"}]}]}

Put matching specialization / booth first, then other colleagues of the same role.
Within each group, prefer fewer other shifts that day. Keep every candidate in ranked. Keep why to one sentence.
"""


def _strip_thinking(content: Any) -> str:
    text = content if isinstance(content, str) else ""
    if "</think>" in text:
        return text.split("</think>", 1)[-1].strip()
    return text.strip()


class StaffSchedulingAgent:
    """Dedicated Staff Scheduling Agent for hospital roster / coverage workflows."""

    def __init__(self):
        self.name = "StaffSchedulingAgent"
        self.description = (
            "Specialized agent for hospital staff coverage analysis, shift proposals, "
            "and approved shift creation."
        )
        self.base_url = settings.openrouter_base_url.rstrip("/")
        self.model = settings.openrouter_model
        self.api_key = settings.openrouter_api_key

    async def _call_llm(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        max_tokens: Optional[int] = None,
        force_tool: Optional[str] = None,
    ) -> Dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        # Rough char→token estimate so input+output stays within model context budget.
        approx_input = max(1, sum(len(json.dumps(m, default=str)) for m in messages) // 4)
        if tools:
            approx_input += max(1, len(json.dumps(tools)) // 4)
        budget = 8000
        auto_max = max(384, min(1200, budget - approx_input - 64))
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": int(max_tokens if max_tokens is not None else auto_max),
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if tools:
            payload["tools"] = tools
            if force_tool:
                payload["tool_choice"] = {
                    "type": "function",
                    "function": {"name": force_tool},
                }
            else:
                payload["tool_choice"] = "auto"

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            if resp.status_code >= 400:
                detail = resp.text
                logger.error("LLM HTTP %s: %s", resp.status_code, detail[:500])
                raise httpx.HTTPStatusError(
                    f"{resp.status_code} {resp.reason_phrase} for url '{resp.url}': {detail}",
                    request=resp.request,
                    response=resp,
                )
            data = resp.json()
            return data["choices"][0]["message"]

    @staticmethod
    def _tool_message_content(tool_name: str, tool_output: Any) -> str:
        """Send compact tool payloads to the model (context budget)."""
        if (
            tool_name == "analyze_staffing_needs"
            and isinstance(tool_output, dict)
            and isinstance(tool_output.get("llm"), dict)
        ):
            return json.dumps(tool_output["llm"])
        if tool_name == "build_staffing_plan" and isinstance(tool_output, dict):
            return json.dumps(
                {
                    "success": tool_output.get("success"),
                    "proposalCount": tool_output.get("proposalCount"),
                    "message": tool_output.get("message"),
                    "validation": tool_output.get("validation"),
                    "proposals": [
                        {
                            "affiliationId": p.get("affiliationId"),
                            "staffName": p.get("staffName"),
                            "shiftDate": p.get("shiftDate"),
                            "startTime": p.get("startTime"),
                            "endTime": p.get("endTime"),
                            "boothLabel": p.get("boothLabel") or p.get("station"),
                        }
                        for p in (tool_output.get("proposals") or [])[:40]
                    ],
                }
            )
        return json.dumps(tool_output)

    @staticmethod
    def _last_user_text(messages: List[Dict[str, Any]]) -> str:
        for m in reversed(messages):
            if m.get("role") == "user":
                return str(m.get("content") or "")
        return ""

    def _reply(
        self,
        messages: List[Dict[str, Any]],
        content: str,
        proposals: Optional[List[Dict[str, Any]]] = None,
        briefing: Optional[Dict[str, Any]] = None,
        fairness_summary: Optional[Dict[str, Any]] = None,
        validation: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return {
            "agent": self.name,
            "role": "assistant",
            "content": content,
            "briefing": briefing,
            "fairnessSummary": fairness_summary,
            "validation": validation,
            "proposals": proposals or None,
            "suggestedFollowUps": _build_follow_ups(messages, proposals),
        }

    async def _rank_cover_replacements(
        self,
        messages: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        blob = self._last_user_text(messages)
        conversation = [
            {"role": "system", "content": COVER_RANK_PROMPT},
            {"role": "user", "content": blob},
        ]
        try:
            msg = await self._call_llm(conversation, tools=None, max_tokens=500)
            content = _strip_thinking(msg.get("content"))
        except Exception as exc:
            logger.error("Cover ranking LLM failed: %s", exc)
            content = ""
        return self._reply(messages, content or "{}")

    async def _handle_decline_alternative(
        self,
        messages: List[Dict[str, Any]],
        token: Optional[str],
        decline_data: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        gap_id = decline_data.get("gapId") or decline_data.get("gap_id")
        if not gap_id:
            return None
        exclude = []
        if decline_data.get("affiliationId"):
            exclude.append(str(decline_data["affiliationId"]))
        for item in decline_data.get("excludeAffiliationIds") or []:
            exclude.append(str(item))
        result = await tool_propose_alternative_for_gap(
            gap_id=str(gap_id),
            exclude_affiliation_ids=exclude or None,
            token=token,
        )
        if not result.get("success"):
            return self._reply(
                messages,
                result.get("error") or "No alternative staff member is free for that slot.",
            )
        proposal = result.get("proposal")
        proposals = [proposal] if proposal else []
        return self._reply(
            messages,
            f"Alternative proposal: {proposal.get('staffName')} for {proposal.get('boothOrStation')}. "
            "Press Approve or Decline.",
            proposals=proposals,
            fairness_summary={
                "before": None,
                "after": result.get("workloadAfter"),
            },
            validation=result.get("validation"),
        )

    async def execute_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        token: Optional[str],
    ) -> Any:
        logger.info(f"[{self.name}] Tool Call: {tool_name} with args: {arguments}")

        if tool_name == "get_active_staff":
            return await tool_get_active_staff(
                token=token,
                role=arguments.get("role"),
            )
        if tool_name == "get_coverage":
            return await tool_get_coverage(
                from_date=arguments.get("from_date"),
                to_date=arguments.get("to_date"),
                token=token,
            )
        if tool_name == "get_hospital_shifts":
            return await tool_get_hospital_shifts(
                from_date=arguments.get("from_date"),
                to_date=arguments.get("to_date"),
                token=token,
            )
        if tool_name == "analyze_staffing_needs":
            return await tool_analyze_staffing_needs(
                from_date=arguments.get("from_date"),
                to_date=arguments.get("to_date"),
                token=token,
            )
        if tool_name == "build_staffing_plan":
            return await tool_build_staffing_plan(
                from_date=arguments.get("from_date"),
                to_date=arguments.get("to_date"),
                exclude_affiliation_ids=arguments.get("exclude_affiliation_ids"),
                gap_ids=arguments.get("gap_ids"),
                preferred_assignments=arguments.get("preferred_assignments"),
                token=token,
            )
        if tool_name == "propose_alternative_for_gap":
            return await tool_propose_alternative_for_gap(
                gap_id=arguments.get("gap_id"),
                exclude_affiliation_ids=arguments.get("exclude_affiliation_ids"),
                token=token,
            )
        if tool_name == "propose_shift_for_approval":
            return await tool_propose_shift_for_approval(
                affiliation_id=arguments.get("affiliation_id"),
                staff_name=arguments.get("staff_name"),
                shift_date=arguments.get("shift_date"),
                start_time=arguments.get("start_time"),
                end_time=arguments.get("end_time"),
                booth_or_station=arguments.get("booth_or_station"),
                booth_id=arguments.get("booth_id"),
                notes=arguments.get("notes"),
                reason=arguments.get("reason"),
            )
        if tool_name in ("create_shift", "delete_shift", "suggest_week_coverage"):
            logger.warning(f"[{self.name}] Blocked tool attempt: {tool_name}")
            return {
                "success": False,
                "error": "Not permitted. Use analyze_staffing_needs then build_staffing_plan with preferred_assignments.",
            }
        return {"error": f"Unknown tool: {tool_name}"}

    async def run(
        self,
        messages: List[Dict[str, Any]],
        token: Optional[str] = None,
        patient_info: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        bind_hospital(patient_info, token)
        user_text = self._last_user_text(messages)
        decline_data = parse_decline_payload(user_text)
        if decline_data is not None:
            note_decline_message(user_text)
            alt = await self._handle_decline_alternative(messages, token, decline_data)
            if alt is not None:
                return alt
            return {
                "agent": self.name,
                "role": "assistant",
                "content": "Noted.",
                "proposals": None,
                "suggestedFollowUps": [],
            }

        if COVER_RANK_MARKER in user_text:
            return await self._rank_cover_replacements(messages)

        today = date.fromisoformat(_hospital_today())
        tomorrow = today + timedelta(days=1)
        week_start, week_end = _rest_of_week(today)

        conversation = [
            {"role": "system", "content": STAFF_SCHEDULING_SYSTEM_PROMPT},
            {
                "role": "system",
                "content": (
                    f"Today is {today.isoformat()} ({today.strftime('%A')}). "
                    f"Tomorrow is {tomorrow.isoformat()}. "
                    f"The rest of this week is {week_start} through {week_end}. "
                    "For Suggest Week / full-range staffing: analyze_staffing_needs, "
                    "choose staff from each gap's candidates, then build_staffing_plan "
                    "with preferred_assignments. Do not skip the model judgment step."
                ),
            },
        ]
        if patient_info:
            conversation.append(
                {
                    "role": "system",
                    "content": (
                        "Active Hospital Context: "
                        f"Name={patient_info.get('name') or patient_info.get('hospitalName')}, "
                        f"Email={patient_info.get('email')}"
                    ),
                }
            )
        conversation.extend(messages)

        proposals: List[Dict[str, Any]] = []
        briefing = None
        fairness_summary: Optional[Dict[str, Any]] = None
        validation: Optional[Dict[str, Any]] = None
        last_plan: Optional[Dict[str, Any]] = None
        msg: Dict[str, Any] = {}
        analyze_done = False

        for _ in range(10):
            tools = STAFF_WEEK_BUILD_TOOLS if analyze_done else STAFF_TOOLS_SCHEMA
            force_tool = "build_staffing_plan" if analyze_done else None
            try:
                msg = await self._call_llm(
                    conversation, tools=tools, force_tool=force_tool
                )
            except Exception as e:
                logger.error("LLM call failed: %s", e)
                detail = str(e)
                if "maximum context length" in detail or "input_tokens" in detail:
                    # One retry with a hard-capped output budget.
                    try:
                        msg = await self._call_llm(
                            conversation,
                            tools=tools,
                            max_tokens=384,
                            force_tool=force_tool,
                        )
                    except Exception as retry_err:
                        logger.error("LLM retry failed: %s", retry_err)
                        # Still try deterministic build so Suggest Week isn't empty.
                        if analyze_done and not proposals:
                            suggest_range = _parse_suggest_dates_from_messages(
                                messages, week_start, week_end
                            )
                            from_date, to_date = suggest_range
                            try:
                                tool_output = await tool_build_staffing_plan(
                                    from_date=from_date,
                                    to_date=to_date,
                                    token=token,
                                )
                            except Exception as build_err:
                                logger.error("Fallback build failed: %s", build_err)
                                tool_output = {"success": False}
                            if tool_output.get("success"):
                                proposals = list(tool_output.get("proposals") or [])
                                return self._reply(
                                    messages,
                                    tool_output.get("message")
                                    or f"Prepared {len(proposals)} suggested shift(s).",
                                    proposals,
                                    _briefing(tool_output, proposals),
                                    {
                                        "before": tool_output.get("workloadBefore"),
                                        "after": tool_output.get("workloadAfter"),
                                    },
                                    tool_output.get("validation"),
                                )
                        return self._reply(
                            messages,
                            "The staffing plan is too large for the model context window. "
                            "Try a shorter date range, or raise --max-model-len on the pod.",
                        )
                else:
                    return self._reply(
                        messages,
                        "The model could not be reached, so no shifts were suggested.",
                    )

            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                # After analyze, the model sometimes writes a chat essay instead of
                # calling build_staffing_plan — build in code so the calendar still gets cards.
                if analyze_done and not proposals:
                    suggest_range = _parse_suggest_dates_from_messages(messages, week_start, week_end)
                    from_date, to_date = suggest_range
                    logger.info(
                        "[%s] Model skipped build_staffing_plan; auto-building %s → %s",
                        self.name,
                        from_date,
                        to_date,
                    )
                    try:
                        tool_output = await tool_build_staffing_plan(
                            from_date=from_date,
                            to_date=to_date,
                            token=token,
                        )
                    except Exception as build_err:
                        logger.error("Auto build failed: %s", build_err)
                        tool_output = {"success": False}
                    if tool_output.get("success"):
                        proposals = list(tool_output.get("proposals") or [])
                        fairness_summary = {
                            "before": tool_output.get("workloadBefore"),
                            "after": tool_output.get("workloadAfter"),
                        }
                        validation = tool_output.get("validation")
                        briefing = _briefing(tool_output, proposals)
                        content = (
                            tool_output.get("message")
                            or f"Prepared {len(proposals)} suggested shift(s). Approve or Decline on each card."
                        )
                        return self._reply(
                            messages,
                            content,
                            proposals,
                            briefing,
                            fairness_summary,
                            validation,
                        )
                content = _strip_thinking(
                    msg.get("content")
                    or msg.get("reasoning")
                    or "How else can I help with staff coverage or shifts?"
                )
                if validation and not validation.get("valid"):
                    content += " Some proposals need review before approval."
                return self._reply(
                    messages,
                    content,
                    proposals,
                    briefing,
                    fairness_summary,
                    validation,
                )

            conversation.append(
                {
                    "role": "assistant",
                    "content": msg.get("content") or "",
                    "tool_calls": tool_calls,
                }
            )

            build_success_this_round = False
            for tc in tool_calls:
                fn = tc.get("function", {})
                fn_name = fn.get("name")
                fn_args_raw = fn.get("arguments", {})
                if isinstance(fn_args_raw, str):
                    try:
                        fn_args = json.loads(fn_args_raw)
                    except Exception:
                        fn_args = {}
                else:
                    fn_args = fn_args_raw or {}

                tool_output = await self.execute_tool(fn_name, fn_args, token)

                if fn_name == "analyze_staffing_needs" and tool_output.get("success"):
                    analyze_done = True
                if fn_name == "propose_shift_for_approval" and tool_output.get("success"):
                    prop = tool_output.get("proposal")
                    if prop:
                        proposals.append(prop)
                elif fn_name == "build_staffing_plan" and tool_output.get("success"):
                    last_plan = tool_output
                    proposals = list(tool_output.get("proposals") or [])
                    fairness_summary = {
                        "before": tool_output.get("workloadBefore"),
                        "after": tool_output.get("workloadAfter"),
                    }
                    validation = tool_output.get("validation")
                    briefing = _briefing(tool_output, proposals)
                    build_success_this_round = True
                elif fn_name == "propose_alternative_for_gap" and tool_output.get("success"):
                    prop = tool_output.get("proposal")
                    if prop:
                        proposals.append(prop)
                    fairness_summary = {
                        "before": fairness_summary.get("before") if fairness_summary else None,
                        "after": tool_output.get("workloadAfter"),
                    }
                    validation = tool_output.get("validation")

                conversation.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.get("id"),
                        "content": self._tool_message_content(fn_name, tool_output),
                    }
                )

            # Short-circuit: once the plan is built, skip the LLM summary round.
            # Conversation is already ~7k tokens on 8k-context pods; another call would 400.
            if build_success_this_round and proposals:
                content = (
                    (last_plan or {}).get("message")
                    or f"Prepared {len(proposals)} suggested shift(s). Approve or Decline on each card."
                )
                if validation and not validation.get("valid"):
                    content += " Some proposals need review before approval."
                return self._reply(
                    messages,
                    content,
                    proposals,
                    briefing,
                    fairness_summary,
                    validation,
                )

        content = _strip_thinking(
            msg.get("content")
            or msg.get("reasoning")
            or (last_plan or {}).get("message")
            or "I have processed your staff scheduling request."
        )
        return self._reply(
            messages,
            content,
            proposals,
            briefing,
            fairness_summary,
            validation,
        )


staff_scheduling_agent = StaffSchedulingAgent()
