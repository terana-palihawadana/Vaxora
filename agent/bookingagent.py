import json
import logging
import httpx
import re
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI

try:
    from .config import settings
    from .tools import (
        TOOLS_SCHEMA,
        _clean_date_string,
        _clean_slot_string,
        _get_temporal_context,
        _hospital_today,
        tool_get_current_date_time,
        tool_autonomous_find_and_propose,
        tool_get_available_vaccines_and_hospitals,
        tool_get_available_dates,
        tool_get_available_slots,
        tool_book_appointment,
        tool_get_my_appointments,
        tool_cancel_appointment,
        tool_propose_cancellation_for_approval
    )
except ImportError:
    from config import settings
    from tools import (
        TOOLS_SCHEMA,
        _clean_date_string,
        _clean_slot_string,
        _get_temporal_context,
        _hospital_today,
        tool_get_current_date_time,
        tool_autonomous_find_and_propose,
        tool_get_available_vaccines_and_hospitals,
        tool_get_available_dates,
        tool_get_available_slots,
        tool_book_appointment,
        tool_get_my_appointments,
        tool_cancel_appointment,
        tool_propose_cancellation_for_approval
    )

try:
    from .inventory.state_store import state_store
except ImportError:
    try:
        from inventory.state_store import state_store
    except ImportError:
        state_store = None

try:
    from .evaluation.booking_golden import validate_booking_proposal
except ImportError:
    try:
        from evaluation.booking_golden import validate_booking_proposal
    except ImportError:
        def validate_booking_proposal(proposal):
            return {"valid": True, "issues": []}

logger = logging.getLogger("vaxora-booking-agent")

BOOKING_AGENT_SYSTEM_PROMPT = """You are the official Vaxora Autonomous Booking Agent, an advanced goal-oriented agent designed to help patients discover vaccines, check hospital schedules, manage appointments, and complete vaccination bookings with maximum clarity and security.

MANDATORY HUMAN-IN-THE-LOOP APPROVAL POLICY:
You are STRICTLY FORBIDDEN from executing permanent database changes (`book_appointment` or `cancel_appointment`) without explicit prior user approval.

1. ONE-PROMPT GOAL-BASED DELEGATED BOOKING (PRIMARY AUTONOMOUS MODE):
   Whenever the patient expresses an intent to book, schedule, or find an appointment (e.g.:
   - "Book the earliest AstraZeneca appointment at Royal Hospitals"
   - "I want to get vaccinated with AstraZeneca next week"
   - "Schedule AstraZeneca for Wednesday morning"
   - "Book me AstraZeneca"
   - "Find me a slot for Test Vaccine"
   ):
   DO NOT conduct a slow back-and-forth interrogation!
   IMMEDIATELY invoke `autonomous_find_and_propose` with their preferences:
   - `vaccine_name`: The requested vaccine name (e.g. 'AstraZeneca')
   - `hospital_name_or_id`: Hospital name or GUID if specified (or leave empty for best match)
   - `preferred_date`: Specific date ('YYYY-MM-DD'), day of week ('Wednesday', 'Friday'), 'next week', or 'earliest'
   - `time_of_day`: 'morning' (<12:00 PM), 'afternoon' (>=12:00 PM), 'earliest', or 'any'
   
   This autonomously discovers the hospital, fetches upcoming clinic dates, locates open time slots, verifies schedule pricing, and prepares the review card in ONE single action!
   Then, provide a clear, helpful summary:
   "I have matched and prepared your optimal appointment slot: [Vaccine] at [Hospital] on [Date] at [Time Slot] (Fee: [Price]).
   Please review the proposal card below and tap 'Confirm & Book' to finalize."
   NEVER call `book_appointment` directly until the patient has approved the proposal!

2. BOOKING APPROVAL & PAYMENT:
   - The user must explicitly approve the proposal by tapping "Confirm & Book" (or sending "I approve and confirm booking...").
   - Once approved, IMMEDIATELY call `book_appointment` to register the booking in the national immunization registry.
   - For paid vaccines (e.g. AstraZeneca at LKR 1,000.00), inform the user that their booking is registered and they can complete payment using PayHere via the payment button on the booking confirmation card.
   - For free vaccines (0 LKR), the slot is confirmed immediately.

3. MANDATORY CANCELLATION APPROVAL WORKFLOW:
   - When the patient asks to cancel an appointment (e.g. "cancel my appointment", "cancel AstraZeneca", "cancel my booking for Wednesday", "cancel all"):
   - NEVER call `cancel_appointment` directly without user approval!
   - You MUST FIRST call `propose_cancellation_for_approval` with `appointment_id`, `vaccine_name`, or `appointment_date`.
   - This prepares an Appointment Cancellation Review card for the patient to approve or decline.
   - Tell the patient: "I've located your appointment for [Vaccine] at [Hospital] on [Date] at [Time Slot]. Please review the cancellation card below and confirm if you would like to proceed with cancellation."
   - ONLY call `cancel_appointment` AFTER the user explicitly approves/confirms the cancellation (e.g. tapping "Confirm Cancellation" or sending "I approve and confirm cancellation...").
   - If the user says "Keep appointment" or declines cancellation, acknowledge that the appointment will remain active.
   - If they ask "what appointments do I have?", call `get_my_appointments`.

4. EXPLORATORY CHAT:
   If the user asks general questions (e.g. "What vaccines do you have?"), call `get_available_vaccines_and_hospitals` and list the available vaccines with their prices.

5. FORMATTING:
   Keep responses concise, clear, and structured with clean bullet points. Avoid messy asterisks.

6. STRICT MEDICAL / CLINICAL ADVICE BOUNDARY:
   You are an administrative booking agent, NOT a medical doctor.
   You are strictly forbidden from prescribing vaccines, diagnosing conditions, or advising patients on what vaccines they should take based on vague inquiries (e.g. 'What vaccines can I take now?', 'Which vaccine should I take?').
   Always politely decline medical recommendations and advise the patient to consult a qualified physician or healthcare professional.

7. REAL-TIME CALENDAR & TEMPORAL REASONING (MANDATORY):
   You are equipped with a live clock and calendar. You always know today's exact date, current month, current year, day of week, and time.
   - ALWAYS LOOK AT TODAY'S DATE FIRST: Before running queries, checking schedules, or proposing dates, first inspect today's date from the live system context (or call `get_current_date_time`).
   - NATURAL DATE & MONTH CONVERSATION:
     When patients talk to you using dates and months (e.g. "October 16", "16th October", "next Friday", "tomorrow", "this month", "what dates are open in October?", "what is today's date?"):
     - You understand and talk about calendar dates, months, days of the week, and times naturally.
     - You can directly answer questions about today's date, the current day of the week, the current month, and the current time.
     - Always resolve relative terms ("today", "tomorrow", "this Wednesday", "next week", "16th of October") against today's date to standard 'YYYY-MM-DD' before making queries.
     - If the user asks for a month (e.g., "dates in October" or "October"), query available dates and filter or highlight the clinic dates in that month.
     - NEVER propose dates in the past (before today).
     - When presenting proposals, always confirm the complete, friendly date (e.g., "Friday, October 16, 2026 at 09:00 AM").
"""

INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(prior|previous|above|system)\s+instructions?",
    r"disregard\s+(all\s+)?(prior|previous|above|rules?)",
    r"system\s*prompt",
    r"\bjailbreak\b",
    r"developer\s+mode",
    r"you\s+are\s+now\s+in\s+DAN\s+mode",
    r"system\s+override",
    r"admin\s+override",
    r"\bforce_book\b",
    r"\bdirect_book\b",
    r"\bdelete_appointment\b",
    r"\bbypass_payment\b",
    r"\bpurge_appointments\b",
    r"\bdirect_cancel\b",
]

CLINICAL_ADVICE_PATTERNS = [
    r"what\s+vaccines?\s+can\s+i\s+take",
    r"which\s+vaccines?\s+(should|can|must)\s+i\s+take",
    r"what\s+vaccines?\s+(do|should)\s+i\s+need",
    r"what\s+vaccines?\s+am\s+i\s+eligible\s+for",
    r"can\s+i\s+take\s+a?\s*vaccine\s+if",
    r"recommend\s+a\s+vaccine\s+for\s+me",
    r"is\s+it\s+safe\s+for\s+me\s+to\s+take",
    r"should\s+i\s+get\s+vaccinated",
    r"what\s+dose\s+do\s+i\s+need",
    r"\bdiagnos(e|is)\b",
    r"my\s+symptoms?\s+(are|is)",
]


def check_prompt_injection(text: str) -> Optional[str]:
    if not text:
        return None
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return f"Prohibited instruction or prompt-injection pattern detected: {pattern}"
    return None


def check_clinical_advice_inquiry(text: str) -> Optional[str]:
    if not text:
        return None
    for pattern in CLINICAL_ADVICE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return f"Out-of-scope clinical/medical advice inquiry detected: {pattern}"
    return None


class BookingAgent:
    """
    Google ADK-compliant Dedicated Booking Agent for Vaxora.
    """
    def __init__(self):
        self.name = "BookingAgent"
        self.description = "Specialized agent for searching vaccine inventory, checking hospital clinic schedules, and booking vaccination appointments."
        self.base_url = settings.openrouter_base_url.rstrip("/")
        self.model = settings.openrouter_model
        self.api_key = settings.openrouter_api_key

    async def _call_llm(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Calls the OpenAI-compatible endpoint with full error resilience."""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 500,
        }
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]

    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any], token: Optional[str]) -> Any:
        logger.info(f"[{self.name}] Tool Call: {tool_name} with args: {arguments}")
        
        if tool_name == "get_current_date_time":
            return await tool_get_current_date_time(token=token)
        elif tool_name == "autonomous_find_and_propose":
            return await tool_autonomous_find_and_propose(
                vaccine_name=arguments.get("vaccine_name"),
                hospital_name_or_id=arguments.get("hospital_name_or_id"),
                preferred_date=arguments.get("preferred_date"),
                preferred_slot=arguments.get("preferred_slot"),
                time_of_day=arguments.get("time_of_day"),
                token=token
            )
        elif tool_name == "get_available_vaccines_and_hospitals":
            return await tool_get_available_vaccines_and_hospitals(token=token)
        elif tool_name == "get_available_dates":
            return await tool_get_available_dates(
                hospital_user_id=arguments.get("hospital_user_id"),
                vaccine_name=arguments.get("vaccine_name"),
                month=arguments.get("month"),
                token=token
            )
        elif tool_name == "get_available_slots":
            return await tool_get_available_slots(
                hospital_user_id=arguments.get("hospital_user_id"),
                vaccine_name=arguments.get("vaccine_name"),
                date=arguments.get("date"),
                token=token
            )
        elif tool_name == "propose_booking_for_approval":
            prop = dict(arguments)
            if "appointment_date" in prop:
                prop["appointment_date"] = _clean_date_string(prop["appointment_date"])
            if "time_slot" in prop:
                prop["time_slot"] = _clean_slot_string(prop["time_slot"])
            return {
                "success": True,
                "status": "proposal_pending_user_approval",
                "proposal": prop
            }
        elif tool_name == "propose_cancellation_for_approval":
            return await tool_propose_cancellation_for_approval(
                appointment_id=arguments.get("appointment_id"),
                vaccine_name=arguments.get("vaccine_name"),
                hospital_name=arguments.get("hospital_name"),
                appointment_date=arguments.get("appointment_date"),
                time_slot=arguments.get("time_slot"),
                token=token
            )
        elif tool_name == "book_appointment":
            return await tool_book_appointment(
                hospital_user_id=arguments.get("hospital_user_id"),
                vaccine_name=arguments.get("vaccine_name"),
                appointment_date=arguments.get("appointment_date"),
                time_slot=arguments.get("time_slot"),
                notes=arguments.get("notes"),
                payment_method=arguments.get("payment_method", "Free"),
                vaccine_id=arguments.get("vaccine_id"),
                vaccine_schedule_id=arguments.get("vaccine_schedule_id"),
                token=token
            )
        elif tool_name == "get_my_appointments":
            return await tool_get_my_appointments(token=token)
        elif tool_name == "cancel_appointment":
            return await tool_cancel_appointment(
                appointment_id=arguments.get("appointment_id"),
                token=token
            )
        elif tool_name in (
            "direct_book",
            "force_book",
            "create_appointment",
            "delete_appointment",
            "purge_appointments",
            "bypass_payment",
            "modify_appointment",
            "direct_cancel",
        ):
            logger.warning(f"[{self.name}] Blocked forbidden tool attempt: {tool_name}")
            return {
                "success": False,
                "blocked": True,
                "error": f"Tool '{tool_name}' is not permitted. All bookings and cancellations require explicit user approval.",
            }
        else:
            return {"success": False, "error": f"Unknown tool: {tool_name}"}

    async def run(
        self,
        messages: List[Dict[str, Any]],
        token: Optional[str] = None,
        patient_info: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Runs the conversational tool-calling agent loop with:
        1. Multi-step structured planning (plan + completedSteps tracking)
        2. Runtime deterministic business-rule validation
        3. Durable workflow state persistence
        """
        last_user_message = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user_message = str(m.get("content") or "").strip()
                break

        is_cancellation = any(kw in last_user_message.lower() for kw in ["cancel", "delete appointment", "revoke"])

        if is_cancellation:
            plan = [
                {"step": 1, "action": "Query patient active appointment registry", "status": "in_progress"},
                {"step": 2, "action": "Locate matching appointment details and check cancellation eligibility", "status": "pending"},
                {"step": 3, "action": "Format cancellation review proposal for patient approval", "status": "pending"},
            ]
        else:
            plan = [
                {"step": 1, "action": "Search hospital clinic inventory and scheduled dates", "status": "in_progress"},
                {"step": 2, "action": "Inspect 20-minute open time slots matching patient preferences", "status": "pending"},
                {"step": 3, "action": "Validate slot availability, fee structure, and business rules", "status": "pending"},
                {"step": 4, "action": "Prepare structured booking review proposal for patient approval", "status": "pending"},
            ]

        workflow_id = None
        if state_store:
            try:
                workflow_id = state_store.create(
                    agent_name=self.name,
                    user_id=user_id or (patient_info.get("nic") or patient_info.get("email") if patient_info else "anonymous"),
                    objective=last_user_message or "Vaccine booking and scheduling consultation"
                )
            except Exception as se:
                logger.warning(f"Failed to create workflow in state store: {se}")

        # 1. Deterministic Prompt Injection / Adversarial Jailbreak Check
        injection_issue = check_prompt_injection(last_user_message)
        if injection_issue:
            logger.warning(f"[{self.name}] Prompt injection blocked: {injection_issue}")
            if state_store and workflow_id:
                try:
                    state_store.set_approval(workflow_id, "failed")
                    state_store.set_outcome(workflow_id, "SafeFailure")
                    state_store.set_validation(workflow_id, [{"valid": False, "issues": [injection_issue]}])
                except Exception:
                    pass
            return {
                "agent": self.name,
                "role": "assistant",
                "content": "Security Alert: This request contains prohibited system instructions or prompt injection attempts and was safely blocked. Vaxora booking operations require standard verified user requests.",
                "workflowId": workflow_id,
                "plan": [],
                "completedSteps": [],
                "toolResults": [],
                "validation": {"valid": False, "issues": [injection_issue]},
                "proposal": None,
                "proposals": [],
                "booking": None,
                "cancellation": None,
                "approvalRequired": False,
                "finalOutcome": "SafeFailure",
            }

        # 2. Deterministic Clinical / Medical Advice Boundary Check
        clinical_issue = check_clinical_advice_inquiry(last_user_message)
        if clinical_issue:
            logger.info(f"[{self.name}] Clinical medical advice inquiry redirected: {clinical_issue}")
            if state_store and workflow_id:
                try:
                    state_store.set_approval(workflow_id, "not_required")
                    state_store.set_outcome(workflow_id, "Completed")
                    state_store.set_validation(workflow_id, [{"valid": False, "issues": [clinical_issue]}])
                except Exception:
                    pass
            return {
                "agent": self.name,
                "role": "assistant",
                "content": (
                    "As an administrative appointment booking agent, I cannot provide clinical medical advice "
                    "or determine which vaccines you should receive. Please consult a qualified doctor or healthcare "
                    "professional to evaluate your medical history and clinical eligibility. "
                    "Once you know which vaccine you require (e.g., Pfizer, AstraZeneca, Sinopharm), I would be "
                    "glad to help you find an available clinic and schedule your appointment."
                ),
                "workflowId": workflow_id,
                "plan": [],
                "completedSteps": [],
                "toolResults": [],
                "validation": {"valid": False, "issues": [clinical_issue]},
                "proposal": None,
                "proposals": [],
                "booking": None,
                "cancellation": None,
                "approvalRequired": False,
                "finalOutcome": "Completed",
            }

        if state_store and workflow_id:
            try:
                state_store.set_plan(workflow_id, plan)
            except Exception as se:
                logger.warning(f"Failed to set plan in state store: {se}")

        temporal = _get_temporal_context()
        upcoming_sample = list(temporal["upcoming_calendar"].items())[:7]
        cal_summary = ", ".join([f"{k}={v['date']}" for k, v in upcoming_sample])

        temporal_system_prompt = (
            f"REAL-TIME CLOCK & CALENDAR CONTEXT (GROUND TRUTH):\n"
            f"• Current Date: {temporal['today']} ({temporal['day_of_week']})\n"
            f"• Current Month: {temporal['month']} {temporal['year']} (Month #{temporal['month_number']})\n"
            f"• Current Time: {temporal['time']} ({temporal['time_24']} 24h)\n"
            f"• Reference Anchor: Today is {temporal['formatted_datetime']}.\n"
            f"• Next 7 Days Reference: {cal_summary}\n\n"
            f"DATE & QUERY RESOLUTION RULES:\n"
            f"1. Always anchor any date calculation to today ({temporal['today']}).\n"
            f"2. Resolve patient natural date phrases ('today', 'tomorrow', 'next week', 'Friday', 'October 16th', 'in October') relative to {temporal['today']}.\n"
            f"3. Never propose past dates (dates before {temporal['today']}).\n"
            f"4. You can freely answer questions about today's date, current month, or calendar details."
        )

        conversation = [
            {"role": "system", "content": BOOKING_AGENT_SYSTEM_PROMPT},
            {"role": "system", "content": temporal_system_prompt}
        ]
        if patient_info:
            conversation.append({
                "role": "system",
                "content": f"Active Patient Context: Name={patient_info.get('name')}, Email={patient_info.get('email')}, NIC={patient_info.get('nic')}"
            })
        conversation.extend(messages)

        max_iterations = 6
        iteration = 0
        proposal_data = None
        cancellation_proposal_data = None
        booking_result = None
        cancellation_result = None
        completed_steps = []
        tool_results = []

        while iteration < max_iterations:
            iteration += 1
            
            try:
                msg = await self._call_llm(conversation, tools=TOOLS_SCHEMA)
            except Exception as e:
                logger.error(f"LLM call failed: {e}")
                err_msg = f"I encountered an issue connecting to the AI model service ({self.model}): {str(e)}. Please verify your OpenRouter configuration and API key."
                if state_store and workflow_id:
                    try:
                        state_store.set_approval(workflow_id, "failed")
                        state_store.set_outcome(workflow_id, "Failed")
                        state_store.update(workflow_id, errors_json=json.dumps([str(e)]))
                    except Exception:
                        pass
                return {
                    "agent": self.name,
                    "role": "assistant",
                    "content": err_msg,
                    "workflowId": workflow_id,
                    "plan": plan,
                    "completedSteps": completed_steps,
                    "toolResults": tool_results,
                    "validation": {"valid": False, "issues": [str(e)]},
                    "proposal": None,
                    "proposals": [],
                    "booking": None,
                    "cancellation": None,
                    "approvalRequired": False,
                    "finalOutcome": "Failed"
                }

            tool_calls = msg.get("tool_calls") or []

            # Check if tools are requested
            if tool_calls:
                conversation.append({
                    "role": "assistant",
                    "content": msg.get("content") or "",
                    "tool_calls": tool_calls
                })

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

                    # Update structured plan status based on tool execution
                    if is_cancellation:
                        if fn_name == "get_my_appointments":
                            plan[0]["status"] = "completed"
                            plan[1]["status"] = "in_progress"
                        elif fn_name == "propose_cancellation_for_approval":
                            plan[0]["status"] = "completed"
                            plan[1]["status"] = "completed"
                            plan[2]["status"] = "awaiting_user_approval"
                    else:
                        if fn_name in ("get_available_vaccines_and_hospitals", "get_available_dates"):
                            plan[0]["status"] = "completed"
                            plan[1]["status"] = "in_progress"
                        elif fn_name == "get_available_slots":
                            plan[0]["status"] = "completed"
                            plan[1]["status"] = "completed"
                            plan[2]["status"] = "in_progress"
                        elif fn_name in ("autonomous_find_and_propose", "propose_booking_for_approval"):
                            plan[0]["status"] = "completed"
                            plan[1]["status"] = "completed"
                            plan[2]["status"] = "completed"
                            plan[3]["status"] = "awaiting_user_approval"

                    completed_steps.append(f"{fn_name}")
                    tool_results.append({
                        "tool": fn_name,
                        "arguments": fn_args,
                        "success": tool_output.get("success", True) if isinstance(tool_output, dict) else True,
                    })

                    if state_store and workflow_id:
                        try:
                            state_store.append_tool_call(workflow_id, fn_name, fn_args, tool_output)
                            state_store.append_step(workflow_id, {"step": fn_name, "status": "completed"})
                        except Exception as se:
                            logger.warning(f"Failed to record tool call to state store: {se}")

                    if fn_name == "propose_booking_for_approval":
                        proposal_data = fn_args
                    elif fn_name == "autonomous_find_and_propose" and tool_output.get("proposal"):
                        proposal_data = tool_output.get("proposal")
                    elif fn_name == "propose_cancellation_for_approval" and tool_output.get("proposal"):
                        cancellation_proposal_data = tool_output.get("proposal")

                    if fn_name == "book_appointment" and tool_output.get("success"):
                        booking_result = tool_output
                    elif fn_name == "cancel_appointment" and tool_output.get("success"):
                        cancellation_result = tool_output

                    conversation.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id"),
                        "content": json.dumps(tool_output)
                    })
            else:
                break

        final_content = msg.get("content") or msg.get("reasoning") or "I have processed your booking request."

        # Deterministic validation
        validation_result = {"valid": True, "issues": []}
        if proposal_data:
            validation_result = validate_booking_proposal(proposal_data)
            if not validation_result.get("valid"):
                logger.warning(f"Booking proposal failed validation: {validation_result.get('issues')}")
        elif cancellation_proposal_data:
            c_issues = []
            if not cancellation_proposal_data.get("appointment_id"):
                c_issues.append("Missing appointment_id in cancellation proposal")
            validation_result = {"valid": len(c_issues) == 0, "issues": c_issues}

        proposals_list = []
        if proposal_data:
            proposals_list.append(proposal_data)
        elif cancellation_proposal_data:
            proposals_list.append(cancellation_proposal_data)

        has_proposals = len(proposals_list) > 0
        approval_required = has_proposals
        final_outcome = "AwaitingApproval" if has_proposals else ("Completed" if (booking_result or cancellation_result or not tool_calls) else "Completed")

        # Persist final state to durable store
        if state_store and workflow_id:
            try:
                state_store.set_validation(workflow_id, [validation_result])
                state_store.set_approval(workflow_id, "awaiting_approval" if has_proposals else "completed")
                state_store.set_outcome(workflow_id, final_outcome)
                state_store.set_plan(workflow_id, plan)
            except Exception as se:
                logger.warning(f"Failed to finalize workflow state in store: {se}")

        return {
            "agent": self.name,
            "role": "assistant",
            "content": final_content,
            "workflowId": workflow_id,
            "plan": plan,
            "completedSteps": completed_steps,
            "toolResults": tool_results,
            "validation": validation_result,
            "proposal": proposal_data,
            "proposals": proposals_list,
            "booking": booking_result,
            "cancellation": cancellation_result or cancellation_proposal_data,
            "approvalRequired": approval_required,
            "finalOutcome": final_outcome
        }

booking_agent = BookingAgent()
