"""
Smart Restock Advisor Agent — Agent 1 of 2.
Multi-step workflow:
  Plan → Fetch data → Analyze → Validate → Propose + Draft PO (pause for approval)
Uses OpenRouter LLM.

Optimization (2026-09-29): When `get_low_stock_items` returns, we auto-generate
the restock proposals directly in Python (they're deterministic). This drops
LLM calls per turn from 12+ down to 2, avoiding rate limits.
"""
import asyncio
import json
import logging
import httpx
from typing import List, Dict, Any, Optional

try:
    from ..config import settings
    from .prompts import RESTOCK_AGENT_SYSTEM_PROMPT
    from .planner import extract_plan_from_response, RESTOCK_DEFAULT_PLAN, mark_step
    from .validator import (
        validate_restock_proposal,
        compute_reorder_quantity,
        compute_urgency,
    )
    from .state_store import state_store
    from .draft_generator import generate_purchase_order_draft
    from .inventory_tools import (
        RESTOCK_TOOLS_SCHEMA,
        tool_get_inventory_summary,
        tool_get_stock_levels,
        tool_get_vaccines,
        tool_get_low_stock_items,
        tool_propose_restock_order,
        get_formulary_pricing,
    )
except ImportError:
    from config import settings
    from inventory.prompts import RESTOCK_AGENT_SYSTEM_PROMPT
    from inventory.planner import extract_plan_from_response, RESTOCK_DEFAULT_PLAN, mark_step
    from inventory.validator import (
        validate_restock_proposal,
        compute_reorder_quantity,
        compute_urgency,
    )
    from inventory.state_store import state_store
    from inventory.draft_generator import generate_purchase_order_draft
    from inventory.inventory_tools import (
        RESTOCK_TOOLS_SCHEMA,
        tool_get_inventory_summary,
        tool_get_stock_levels,
        tool_get_vaccines,
        tool_get_low_stock_items,
        tool_propose_restock_order,
        get_formulary_pricing,
    )

logger = logging.getLogger("vaxora-restock-agent")


class RestockAdvisorAgent:
    name = "RestockAgent"
    description = (
        "Analyzes hospital vaccine stock levels, thresholds, and usage to recommend "
        "restock quantities. Produces a draft Purchase Order for admin approval."
    )

    def __init__(self):
        self.base_url = settings.openrouter_base_url.rstrip("/")
        self.model = settings.openrouter_model
        self.api_key = settings.openrouter_api_key

    # ---------------- LLM call ----------------

    async def _call_llm(
        self, messages: List[Dict[str, Any]], tools: Optional[List] = None
    ) -> Dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        payload = {"model": self.model, "messages": messages}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        max_retries = 3
        for attempt in range(max_retries + 1):
            async with httpx.AsyncClient(timeout=90.0) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions", headers=headers, json=payload
                )

                # Handle 429 rate limit with exponential backoff
                if resp.status_code == 429:
                    wait_seconds = 10 * (attempt + 1)  # 10s, 20s, 30s, 40s
                    if attempt < max_retries:
                        logger.warning(
                            f"[{self.name}] Rate limited (429). "
                            f"Retry {attempt + 1}/{max_retries} in {wait_seconds}s..."
                        )
                        await asyncio.sleep(wait_seconds)
                        continue
                    else:
                        logger.error(
                            f"[{self.name}] Rate limit exceeded after {max_retries} retries"
                        )
                        resp.raise_for_status()

                # Handle output parse failures if returned
                if resp.status_code == 400 and "output_parse_failed" in resp.text:
                    wait_seconds = 5 * (attempt + 1)
                    if attempt < max_retries:
                        logger.warning(
                            f"[{self.name}] LLM output_parse_failed. "
                            f"Retry {attempt + 1}/{max_retries} in {wait_seconds}s..."
                        )
                        await asyncio.sleep(wait_seconds)
                        continue
                    else:
                        logger.error(
                            f"[{self.name}] output_parse_failed after {max_retries} retries"
                        )
                        resp.raise_for_status()

                if resp.status_code >= 400:
                    logger.error(
                        f"[{self.name}] OpenRouter error {resp.status_code}: {resp.text[:1000]}"
                    )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]

        raise RuntimeError("Unexpected: retry loop exited without result")

    # ---------------- Tool dispatch ----------------

    async def _execute_tool(
        self, name: str, args: Dict[str, Any], token: Optional[str], workflow_id: str
    ) -> Any:
        logger.info(f"[{self.name}] tool={name} args={args}")

        if name == "get_inventory_summary":
            result = await tool_get_inventory_summary(token=token)
        elif name == "get_stock_levels":
            result = await tool_get_stock_levels(token=token)
        elif name == "get_low_stock_items":
            result = await tool_get_low_stock_items(token=token)
        elif name == "get_vaccines":
            result = await tool_get_vaccines(token=token)
        elif name == "propose_restock_order":
            is_valid, errors = validate_restock_proposal(args)
            if not is_valid:
                logger.warning(f"[{self.name}] Proposal rejected by validator: {errors}")
                return {
                    "success": False,
                    "error": "Proposal failed deterministic validation",
                    "details": errors,
                }
            result = await tool_propose_restock_order(
                vaccine_id=args.get("vaccine_id", ""),
                vaccine_name=args.get("vaccine_name", ""),
                current_stock=args.get("current_stock", 0),
                recommended_quantity=args.get("recommended_quantity", 0),
                reason=args.get("reason", ""),
                urgency=args.get("urgency", "low"),
                token=token,
            )
            state_store.set_approval(workflow_id, "pending_admin_approval")
            state_store.set_validation(
                workflow_id, [{"rule": "restock_proposal", "passed": True}]
            )
        else:
            result = {"error": f"Unknown tool: {name}"}

        state_store.append_tool_call(workflow_id, name, args, result)
        return result

    # ---------------- Main workflow ----------------

    async def run(
        self,
        messages: List[Dict[str, Any]],
        token: Optional[str] = None,
        user_id: Optional[str] = None,
        user_info: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        objective = next(
            (m["content"] for m in reversed(messages) if m.get("role") == "user"),
            "Restock recommendation",
        )
        workflow_id = state_store.create(self.name, user_id, objective)

        conversation = [{"role": "system", "content": RESTOCK_AGENT_SYSTEM_PROMPT}]
        hospital_name = "Unknown Hospital"
        if user_info:
            hospital_name = user_info.get("name", hospital_name)
            conversation.append(
                {
                    "role": "system",
                    "content": f"Hospital context: {hospital_name}",
                }
            )
        conversation.extend(messages)

        # Planning — deterministic
        plan: List[Dict[str, Any]] = [dict(s) for s in RESTOCK_DEFAULT_PLAN]
        state_store.set_plan(workflow_id, plan)
        state_store.append_step(
            workflow_id, {"step": "planning", "status": "completed", "plan": plan}
        )

        # With auto-propose enabled (below), the LLM only needs ~2-3 calls:
        #   1) call get_low_stock_items
        #   2) produce final summary
        # max_iter = 4 is plenty of headroom.
        max_iter = 4
        iteration = 0
        restock_proposals: List[Dict[str, Any]] = []
        final_content = ""

        while iteration < max_iter:
            iteration += 1
            try:
                msg = await self._call_llm(conversation, tools=RESTOCK_TOOLS_SCHEMA)
            except Exception as e:
                logger.error(f"[{self.name}] LLM error: {e}")
                # If we already have proposals, we can still return them even
                # if the summary step failed. Fail soft.
                if restock_proposals:
                    logger.warning(
                        f"[{self.name}] Returning {len(restock_proposals)} proposals "
                        f"despite LLM error on summary step."
                    )
                    final_content = (
                        f"Restock analysis complete — {len(restock_proposals)} "
                        f"proposal(s) ready for review."
                    )
                    break
                state_store.set_outcome(workflow_id, "llm_error")
                return {
                    "agent": self.name,
                    "role": "assistant",
                    "content": f"AI service error: {e}",
                    "workflow_id": workflow_id,
                    "plan": plan,
                    "proposal": None,
                    "draft": None,
                }

            tool_calls = msg.get("tool_calls") or []

            if tool_calls:
                conversation.append(
                    {
                        "role": "assistant",
                        "content": msg.get("content") or "",
                        "tool_calls": tool_calls,
                    }
                )
                for tc in tool_calls:
                    fn = tc.get("function", {})
                    fn_name = fn.get("name")
                    raw_args = fn.get("arguments", {})
                    try:
                        fn_args = (
                            json.loads(raw_args)
                            if isinstance(raw_args, str)
                            else (raw_args or {})
                        )
                    except Exception:
                        fn_args = {}

                    tool_result = await self._execute_tool(
                        fn_name, fn_args, token, workflow_id
                    )

                    # Collect proposals from the LLM (it may still choose to call
                    # propose_restock_order itself — we honor that).
                    if fn_name == "propose_restock_order" and tool_result.get("success"):
                        restock_proposals.append(tool_result.get("proposal", {}))

                    # AUTO-PROPOSE: when get_low_stock_items returns, we generate
                    # the restock proposals directly in Python for every low item.
                    # This drops LLM calls per turn from 12+ down to 2.
                    if fn_name == "get_low_stock_items" and tool_result.get("success"):
                        low_items = tool_result.get("low_stock_items", [])
                        auto_created = 0
                        for item in low_items:
                            available = item.get("available", 0)
                            threshold = item.get("minThreshold", 0)
                            if available <= threshold:
                                urgency = "high"
                            elif available <= threshold * 1.5:
                                urgency = "medium"
                            else:
                                urgency = "low"

                            proposal_args = {
                                "vaccine_id": item.get("vaccineId"),
                                "vaccine_name": item.get("vaccineName"),
                                "current_stock": available,
                                "recommended_quantity": item.get("suggested_qty", 0),
                                "reason": f"Stock {available} below threshold {threshold}",
                                "urgency": urgency,
                            }

                            auto_result = await self._execute_tool(
                                "propose_restock_order",
                                proposal_args,
                                token,
                                workflow_id,
                            )
                            if auto_result.get("success"):
                                restock_proposals.append(
                                    auto_result.get("proposal", {})
                                )
                                auto_created += 1

                        # Rewrite the tool result the LLM sees so it knows proposals
                        # have already been created — it just needs to summarize.
                        tool_result = {
                            "success": True,
                            "low_stock_items": low_items,
                            "count": len(low_items),
                            "auto_proposals_created": auto_created,
                            "note": (
                                "Restock proposals have ALREADY been generated "
                                "for every low-stock item. Do NOT call "
                                "propose_restock_order again. Just respond with a "
                                "brief summary of what was proposed."
                            ),
                        }

                    conversation.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.get("id"),
                            "content": json.dumps(tool_result),
                        }
                    )
            else:
                final_content = msg.get("content") or "Analysis complete."
                break

        if not final_content:
            final_content = (
                "Restock analysis complete. Please review the draft purchase order."
            )

        # Dedupe by vaccine_id — if the LLM proposed the same vaccine multiple
        # times (one per low batch), merge into a single line item with the
        # combined quantity and the highest urgency.
        if restock_proposals:
            urgency_rank = {"low": 1, "medium": 2, "high": 3}
            merged: Dict[str, Dict[str, Any]] = {}
            for p in restock_proposals:
                vid = p.get("vaccine_id")
                if not vid:
                    continue
                if vid in merged:
                    merged[vid]["recommended_quantity"] = (
                        merged[vid].get("recommended_quantity", 0)
                        + p.get("recommended_quantity", 0)
                    )
                    if urgency_rank.get(p.get("urgency"), 0) > urgency_rank.get(
                        merged[vid].get("urgency"), 0
                    ):
                        merged[vid]["urgency"] = p.get("urgency")
                else:
                    merged[vid] = dict(p)
            restock_proposals = list(merged.values())

        # Build the draft PO if we have any proposals
        draft = None
        if restock_proposals:
            draft = generate_purchase_order_draft(
                restock_proposals=restock_proposals,
                hospital_name=hospital_name,
                formulary_pricing=await get_formulary_pricing(token=token),
            )

        state_store.set_outcome(
            workflow_id,
            "proposal_pending_approval" if draft else "no_restock_needed",
        )

        return {
            "agent": self.name,
            "role": "assistant",
            "content": final_content,
            "workflow_id": workflow_id,
            "plan": plan,
            "proposal": {"proposals": restock_proposals} if restock_proposals else None,
            "draft": draft,
        }


restock_agent = RestockAdvisorAgent()