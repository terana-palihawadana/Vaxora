import logging
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI

try:
    from .config import settings
    from .bookingagent import booking_agent
except ImportError:
    from config import settings
    from bookingagent import booking_agent

try:
    from .inventory.restock_agent import restock_agent
    from .inventory.expiry_agent import expiry_agent
except ImportError:
    from inventory.restock_agent import restock_agent
    from inventory.expiry_agent import expiry_agent

# Optional staff scheduling agent (added on main)
try:
    from .staff_scheduling_agent import staff_scheduling_agent
    STAFF_AGENT_AVAILABLE = True
except ImportError:
    try:
        from staff_scheduling_agent import staff_scheduling_agent
        STAFF_AGENT_AVAILABLE = True
    except ImportError:
        staff_scheduling_agent = None
        STAFF_AGENT_AVAILABLE = False

logger = logging.getLogger("vaxora-orchestrator")

ORCHESTRATOR_SYSTEM_PROMPT = """You are the Vaxora Master Multi-Agent Orchestrator.
Your job is to analyze the user's latest message and route the conversation to the most appropriate specialized agent.

Available Specialized Agents:
1. `BookingAgent` - Handles vaccine discovery, checking hospital stock, finding schedule dates, 20-minute slots, reserving appointments, checking booked appointments, and cancelling appointments.
2. `RestockAgent` - Handles vaccine restock recommendations, low-stock analysis, and purchase order proposals.
3. `ExpiryAgent` - Handles scanning batches for upcoming expiry, wastage risk, and disposal/transfer recommendations.
4. `StaffSchedulingAgent` - Handles hospital staff directory lookups, weekly coverage gaps, proposing shifts for approval, and creating shifts only after hospital approval.
5. `GeneralAgent` - Handles general greetings, platform inquiries, or non-booking queries.

Respond with ONLY a JSON object indicating the target agent:
{"target_agent": "BookingAgent" | "RestockAgent" | "ExpiryAgent" | "StaffSchedulingAgent" | "GeneralAgent", "reason": "brief reason"}
"""


class MultiAgentOrchestrator:
    """
    Google ADK-compliant Master Orchestrator.
    Manages multi-agent routing, coordination, and execution across specialized agents.
    """

    def __init__(self):
        self.client = AsyncOpenAI(
            base_url=settings.openrouter_base_url,
            api_key=settings.openrouter_api_key,
            timeout=60.0,
        )
        self.model = settings.openrouter_model
        self.agents: Dict[str, Any] = {
            "BookingAgent": booking_agent,
        }

        # Inventory agents (this branch)
        self.register_agent(restock_agent)
        self.register_agent(expiry_agent)

        # Staff scheduling agent (main branch)
        if STAFF_AGENT_AVAILABLE and staff_scheduling_agent is not None:
            self.register_agent(staff_scheduling_agent)

    def register_agent(self, agent_instance: Any):
        """Allows team members to register their specialized agents into the orchestrator."""
        self.agents[agent_instance.name] = agent_instance
        logger.info(f"Registered agent: {agent_instance.name}")

    async def route_intent(
        self,
        messages: List[Dict[str, Any]],
        allowed_agents: Optional[List[str]] = None,
    ) -> str:
        """
        Determines which specialized agent should handle the incoming conversation.

        `allowed_agents` comes from the ASP.NET gateway and reflects the caller's role.
        Keyword matches for agents outside that list are ignored, so a non-hospital
        user cannot reach the staff roster agent by wording their message a certain way.
        """
        def permitted(name: str) -> bool:
            return allowed_agents is None or name in allowed_agents

        if not messages:
            return "BookingAgent"

        last_user_message = next(
            (m["content"] for m in reversed(messages) if m.get("role") == "user"),
            "",
        )
        msg_lower = (last_user_message or "").lower()

        # === INVENTORY ROUTING ===
        # Expiry FIRST — must come before restock to avoid keyword overlap
        inventory_expiry_keywords = [
            "expire", "expiry", "expiring", "about to expire",
            "expired batch", "wastage", "dispose", "disposal",
            "near expiry", "expiration",
        ]
        if any(kw in msg_lower for kw in inventory_expiry_keywords) and permitted("ExpiryAgent"):
            return "ExpiryAgent"

        inventory_restock_keywords = [
            "restock", "reorder", "replenish", "low stock",
            "purchase order", "restock order", "what should we order",
            "need to order", "stock level",
        ]
        if any(kw in msg_lower for kw in inventory_restock_keywords) and permitted("RestockAgent"):
            return "RestockAgent"

        # === STAFF ROUTING ===
        # Unambiguous hospital-roster vocabulary — a patient would not use these.
        staff_keywords = [
            "shift", "roster", "coverage", "schedule staff",
            "assign nurse", "assign doctor", "on duty", "duty",
        ]
        if STAFF_AGENT_AVAILABLE and permitted("StaffSchedulingAgent"):
            if any(kw in msg_lower for kw in staff_keywords):
                return "StaffSchedulingAgent"
            if any(kw in msg_lower for kw in ["staff", "doctor", "nurse"]):
                return "StaffSchedulingAgent"

        # === BOOKING ROUTING ===
        booking_keywords = [
            "book", "slot", "appointment", "vaccine", "hospital",
            "date", "payhere", "cancel", "pfizer", "sinopharm",
            "moderna", "influenza", "approve",
        ]
        if any(kw in msg_lower for kw in booking_keywords):
            return "BookingAgent"

        # === LLM FALLBACK ===
        try:
            res = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": ORCHESTRATOR_SYSTEM_PROMPT},
                    {"role": "user", "content": f"User query: '{last_user_message}'"},
                ],
                temperature=0.0,
            )
            content = res.choices[0].message.content or ""
            for agent_name in ("RestockAgent", "ExpiryAgent", "StaffSchedulingAgent", "BookingAgent"):
                if agent_name in content and permitted(agent_name):
                    return agent_name
        except Exception as e:
            logger.warning(f"Orchestrator routing fallback to BookingAgent: {e}")

        return "BookingAgent"

    async def process_message(
        self,
        messages: List[Dict[str, Any]],
        token: Optional[str] = None,
        patient_info: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        allowed_agents: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Orchestrates request: routes to the target agent and returns the agent's output.
        """
        target_agent_name = await self.route_intent(messages, allowed_agents=allowed_agents)
        target_agent = self.agents.get(target_agent_name, booking_agent)

        logger.info(f"Orchestrator routed request to: {target_agent.name}")

        # Inventory agents accept user_id + user_info
        if target_agent.name in ("RestockAgent", "ExpiryAgent"):
            response = await target_agent.run(
                messages,
                token=token,
                user_id=user_id,
                user_info=patient_info,
            )
        else:
            # BookingAgent / StaffSchedulingAgent — teammate's signatures
            try:
                response = await target_agent.run(
                    messages, token=token, patient_info=patient_info
                )
            except TypeError:
                response = await target_agent.run(messages=messages, token=token)

        return response


orchestrator = MultiAgentOrchestrator()