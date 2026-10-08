"""
PatientDataAgent — compiles a structured summary of a patient's full health record.

Architecture note:
  Tool invocation is deterministic (controlled orchestration) rather than
  LLM-driven. This is required because free-tier tool-calling on shared LLM
  providers has documented parsing instability across multiple model families
  (gpt-oss, llama-3.1, qwen3.8). The LLM still performs all reasoning: it
  decides what to include in the summary, computes age, and composes the
  final structured JSON.

  Empty-patient safety: after the six tools return, a deterministic flag
  `has_clinical_data` is computed from the RAW tool results (not from the
  LLM) and attached to the summary. Downstream agents use this flag to
  short-circuit planning for brand-new accounts and avoid fabricating
  personalised recommendations.

Tools invoked: get_patient_profile, get_vaccination_history, get_medical_history,
               get_active_conditions, get_visit_history, get_upcoming_follow_ups
Output: a structured PatientSummary dict.
"""
import json
import asyncio
import logging
import httpx
from typing import List, Dict, Any, Optional

try:
    from .config import settings
    from .patient_tools import (
        tool_get_patient_profile,
        tool_get_vaccination_history,
        tool_get_medical_history,
        tool_get_active_conditions,
        tool_get_visit_history,
        tool_get_upcoming_follow_ups,
    )
except ImportError:
    from config import settings
    from patient_tools import (
        tool_get_patient_profile,
        tool_get_vaccination_history,
        tool_get_medical_history,
        tool_get_active_conditions,
        tool_get_visit_history,
        tool_get_upcoming_follow_ups,
    )

logger = logging.getLogger("vaxora-patient-data-agent")

PATIENT_DATA_SYSTEM_PROMPT = """You are the PATIENT DATA AGENT for Vaxora, a national immunization platform.

You will receive raw JSON results from six data-retrieval tools that have already been called on your behalf.
Your job is to synthesize these results into ONE structured JSON summary.

You do NOT give medical advice. You do NOT generate care plans. You ONLY compile the summary.

Output EXACTLY this JSON schema (no prose, no markdown fences, no commentary):

{
  "demographics": {
    "name": "string",
    "nic": "string",
    "age_years": number,
    "phone": "string or null"
  },
  "chronic_conditions": [{"title": "string", "severity": "string", "icd10": "string or null"}],
  "allergies": [{"allergen": "string", "severity": "string"}],
  "active_medications": ["string"],
  "vaccination_summary": {
    "total_doses": number,
    "distinct_vaccines": number,
    "last_vaccination_date": "YYYY-MM-DD or null",
    "administered": ["vaccine names"]
  },
  "recent_visits": [{"date": "YYYY-MM-DD", "type": "string", "complaint": "string", "diagnosis": "string"}],
  "upcoming_follow_ups": [{"date": "YYYY-MM-DD", "type": "string"}],
  "data_gaps": ["any missing or unavailable information"]
}

Rules:
- Reply with ONLY the JSON object. Do NOT wrap in markdown.
- If a category has no data, use an empty list or null — do NOT invent data.
- Age: compute from dateOfBirth in the profile.
- Include EVERY chronic condition and allergy you find. Do not filter.
- Extract medications from records where recordType == "Medication".
- A "Chronic" status record is a chronic condition.
"""


class PatientDataAgent:
    name = "PatientDataAgent"
    description = "Retrieves and compiles a structured summary of a patient's full health record."

    def __init__(self):
        self.base_url = settings.openrouter_base_url.rstrip("/")
        self.model = settings.openrouter_model
        self.api_key = settings.openrouter_api_key

    async def _call_llm(self, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Single-shot LLM call — no tools, no streaming. Retries on 429."""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.1,
            "reasoning_effort": "low",
        }

        max_retries = 6
        for attempt in range(max_retries):
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions", headers=headers, json=payload
                )
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("retry-after", "20"))
                    # Provider retry-after is often too small; enforce a 20s
                    # floor so the rolling rate-limit window can reset.
                    wait = max(retry_after, 20) + (5 * attempt)
                    logger.warning(
                        f"[{self.name}] Rate limited (429). Waiting {wait}s "
                        f"before retry {attempt + 1}/{max_retries}..."
                    )
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code >= 400:
                    logger.warning(
                        f"[{self.name}] LLM {resp.status_code}: {resp.text[:500]}"
                    )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]

        raise RuntimeError(
            f"Max retries ({max_retries}) exceeded due to LLM rate limiting."
        )

    async def run(self, patient_profile_id: str, token: Optional[str] = None) -> Dict[str, Any]:
        """Deterministically call all 6 tools, then synthesize with one LLM call."""
        steps: List[Dict[str, Any]] = []

        # ---- Phase 1: Deterministic tool invocation ----
        tool_plan = [
            ("get_patient_profile", tool_get_patient_profile),
            ("get_medical_history", tool_get_medical_history),
            ("get_active_conditions", tool_get_active_conditions),
            ("get_vaccination_history", tool_get_vaccination_history),
            ("get_visit_history", tool_get_visit_history),
            ("get_upcoming_follow_ups", tool_get_upcoming_follow_ups),
        ]

        tool_results: Dict[str, Any] = {}
        for tool_name, tool_fn in tool_plan:
            logger.info(f"[{self.name}] tool={tool_name}")
            try:
                out = await tool_fn(patient_profile_id, token=token)
            except Exception as e:
                out = {"success": False, "error": str(e)}
            tool_results[tool_name] = out
            steps.append({
                "tool": tool_name,
                "ok": out.get("success", True) if isinstance(out, dict) else True,
            })

        # Compute the empty-patient flag from RAW tool results (not from the
        # LLM), so downstream agents can trust it. Deterministic and not
        # affected by LLM hallucination.
        has_clinical_data = self._has_clinical_data_from_tools(tool_results)

        # ---- Phase 2: LLM synthesis (no tools) ----
        user_prompt = (
            "Here are the raw results from all six tools, as JSON:\n\n"
            + json.dumps(tool_results, indent=2, default=str)
            + "\n\nNow output ONLY the JSON summary object per the schema."
        )

        conversation = [
            {"role": "system", "content": PATIENT_DATA_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        try:
            msg = await self._call_llm(conversation)
        except Exception as e:
            return {
                "success": False,
                "error": f"LLM synthesis error: {e}",
                "steps": steps,
            }

        content = msg.get("content") or ""
        summary = self._try_parse_json(content)

        if isinstance(summary, dict) and "raw_text" in summary and len(summary) == 1:
            logger.warning(
                f"[{self.name}] JSON parse failed — raw content (first 500 chars): "
                f"{content[:500]}"
            )

        # Attach the deterministic flag as an authoritative field. Do this
        # AFTER the LLM so it can't be overwritten by the model.
        if isinstance(summary, dict):
            summary["has_clinical_data"] = has_clinical_data

        return {
            "success": True,
            "summary": summary,
            "has_clinical_data": has_clinical_data,
            "raw": content,
            "steps": steps,
        }

    @staticmethod
    def _has_clinical_data_from_tools(tool_results: Dict[str, Any]) -> bool:
        """Deterministic check: does this patient have any real clinical data?

        Returns False only when ALL of the following are empty:
          - medical history records
          - active conditions
          - vaccination records
          - visits
          - upcoming follow-ups
        A profile alone is not enough — a new signup with no history is
        considered 'no clinical data'.
        """
        def _list_len(payload: Any, *keys: str) -> int:
            # The API returns timelines as objects with the list nested inside
            # (e.g. {"records": [...]} or {"visits": [...]}), and some endpoints
            # return a bare list, so look one level down as well.
            if isinstance(payload, list):
                return len(payload)
            if not isinstance(payload, dict):
                return 0
            for k in keys:
                v = payload.get(k)
                if isinstance(v, list):
                    return len(v)
                if isinstance(v, dict):
                    nested = _list_len(v, *keys)
                    if nested:
                        return nested
            return 0

        mh = tool_results.get("get_medical_history") or {}
        ac = tool_results.get("get_active_conditions") or {}
        vh = tool_results.get("get_vaccination_history") or {}
        vs = tool_results.get("get_visit_history") or {}
        fu = tool_results.get("get_upcoming_follow_ups") or {}

        medical_count = _list_len(mh, "medical_history", "records")
        active_count = _list_len(ac, "active_conditions", "records")
        vaccine_count = _list_len(vh, "vaccinations", "records")
        visit_count = _list_len(vs, "visits", "records")
        follow_up_count = _list_len(fu, "follow_ups", "records")

        has_data = any([
            medical_count > 0,
            active_count > 0,
            vaccine_count > 0,
            visit_count > 0,
            follow_up_count > 0,
        ])
        logger.info(
            f"[{PatientDataAgent.name}] data check — "
            f"medical={medical_count}, active={active_count}, "
            f"vaccines={vaccine_count}, visits={visit_count}, "
            f"follow_ups={follow_up_count} → has_clinical_data={has_data}"
        )
        return has_data

    @staticmethod
    def _try_parse_json(text: str) -> Any:
        """Robust JSON extraction — strips fences, finds first {...} block."""
        if not text:
            return None
        t = text.strip()

        if t.startswith("```"):
            t = t.strip("`")
            if t.lower().startswith("json"):
                t = t[4:]
            t = t.strip()
            if t.endswith("```"):
                t = t[:-3].strip()

        try:
            return json.loads(t)
        except Exception:
            pass

        first = t.find("{")
        last = t.rfind("}")
        if first != -1 and last > first:
            try:
                return json.loads(t[first:last + 1])
            except Exception:
                pass

        return {"raw_text": text}


patient_data_agent = PatientDataAgent()
