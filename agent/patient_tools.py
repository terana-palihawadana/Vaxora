"""
Tools for the Patient Management agents (PatientDataAgent + CarePlanningAgent).
These call the Vaxora patient endpoints you built.
"""
import httpx
import re
import json
from typing import Dict, Any, List, Optional

try:
    from .config import settings
except ImportError:
    from config import settings


async def _api_get(endpoint: str, token: Optional[str] = None, params: Optional[Dict[str, Any]] = None) -> Any:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(f"{settings.vaxora_api_base_url}{endpoint}", headers=headers, params=params)
        r.raise_for_status()
        return r.json()


# ============================================================
# PATIENT DATA TOOLS
# ============================================================

async def tool_get_patient_profile(patient_profile_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Get the requested patient's demographics via the ownership-checked timeline endpoint."""
    try:
        data = await _api_get(
            f"/patient-medical-history/patients/{patient_profile_id}/timeline",
            token=token,
        )
        return {
            "success": True,
            "profile": {
                "name": data.get("patientName"),
                "phone": data.get("phoneNumber"),
                "nic": data.get("nicNumber"),
                "date_of_birth": data.get("dateOfBirth"),
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_vaccination_history(patient_profile_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Get the patient's full vaccination timeline: every dose, vaccine, date, administrator."""
    try:
        data = await _api_get(f"/patient-vaccinations/patients/{patient_profile_id}/timeline", token=token)
        return {"success": True, "vaccinations": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_medical_history(patient_profile_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Get the patient's medical history timeline: diagnoses, allergies, surgeries, medications."""
    try:
        data = await _api_get(f"/patient-medical-history/patients/{patient_profile_id}/timeline", token=token)
        return {"success": True, "medical_history": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_active_conditions(patient_profile_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Get ONLY the patient's active/chronic conditions (excludes resolved)."""
    try:
        data = await _api_get(f"/patient-medical-history/patients/{patient_profile_id}/active", token=token)
        return {"success": True, "active_conditions": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_visit_history(patient_profile_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Get the patient's visit timeline: every clinic visit with vitals and diagnosis."""
    try:
        data = await _api_get(f"/patient-visits/patients/{patient_profile_id}/timeline", token=token)
        return {"success": True, "visits": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_upcoming_follow_ups(patient_profile_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Get scheduled follow-up visits for this patient (dates in the future)."""
    try:
        data = await _api_get(f"/patient-visits/patients/{patient_profile_id}/follow-ups", token=token)
        return {"success": True, "follow_ups": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================================
# CLINICAL GUIDELINES TOOL (local, no HTTP)
# ============================================================

# Inline guidelines — small, deterministic, auditable.
# In production this would query a FHIR/SNOMED service.
CLINICAL_GUIDELINES = {
    "diabetes": {
        "screening": "HbA1c every 3-6 months. Annual eye exam. Annual foot exam.",
        "vaccines_due": ["Influenza (annual)", "Pneumococcal (age >= 65 or chronic)"],
        "lifestyle": "HbA1c target < 7%. Blood pressure target < 130/80. Daily 30-min aerobic activity.",
        "referrals": "Endocrinologist if HbA1c > 8% despite therapy."
    },
    "hypertension": {
        "screening": "BP check every visit. Annual ECG.",
        "vaccines_due": ["Influenza (annual)"],
        "lifestyle": "Sodium < 2g/day. DASH diet. Weight management.",
        "referrals": "Cardiologist if uncontrolled despite 3 agents."
    },
    "asthma": {
        "screening": "Spirometry annually. Assess inhaler technique each visit.",
        "vaccines_due": ["Influenza (annual)", "Pneumococcal"],
        "lifestyle": "Avoid triggers. Have rescue inhaler accessible.",
        "referrals": "Pulmonologist if not controlled on step 3 therapy."
    },
    "penicillin_allergy": {
        "warning": "Avoid all beta-lactam antibiotics: penicillins, cephalosporins (cross-reactivity), carbapenems.",
        "safe_alternatives": "Macrolides, tetracyclines, fluoroquinolones, sulfonamides.",
        "vaccines_due": [],
        "lifestyle": "",
        "referrals": "Allergist for confirmation and possible oral challenge if needed."
    },
    "elderly_general": {
        "screening": "Annual comprehensive geriatric assessment. Cognitive screen. Fall risk.",
        "vaccines_due": ["Influenza (annual)", "Shingles (Shingrix, 2 doses)", "Pneumococcal (PCV20)", "Tdap booster every 10y"],
        "lifestyle": "Balance exercises. Vitamin D + calcium. Regular vision/hearing checks.",
        "referrals": "Geriatrician, physiotherapist for fall prevention."
    }
}


async def tool_get_clinical_guidelines(condition_key: str) -> Dict[str, Any]:
    """Look up clinical guidelines for a condition key (e.g., 'diabetes', 'penicillin_allergy')."""
    key = condition_key.lower().strip().replace(" ", "_").replace("type_2_", "").replace("type_1_", "")
    # Try exact match, then substring
    if key in CLINICAL_GUIDELINES:
        return {"success": True, "condition": key, "guidelines": CLINICAL_GUIDELINES[key]}
    for k in CLINICAL_GUIDELINES:
        if k in key or key in k:
            return {"success": True, "condition": k, "guidelines": CLINICAL_GUIDELINES[k]}
    return {"success": False, "error": f"No guidelines found for '{condition_key}'", "available": list(CLINICAL_GUIDELINES.keys())}


async def tool_get_age_based_vaccine_schedule(age_years: int) -> Dict[str, Any]:
    """Return the recommended vaccine schedule for a given age."""
    if age_years < 2:
        return {"success": True, "schedule": ["BCG", "HepB (birth dose)", "OPV/IPV", "Pentavalent (DPT-HepB-Hib)", "Rotavirus", "PCV", "MMR (12-15mo)"]}
    if age_years < 12:
        return {"success": True, "schedule": ["MMR booster", "Varicella booster", "Tdap (11-12y)", "HPV (girls 9-12y)", "Annual Influenza"]}
    if age_years < 18:
        return {"success": True, "schedule": ["Tdap booster", "HPV (if not done)", "Meningococcal", "Annual Influenza"]}
    if age_years < 65:
        return {"success": True, "schedule": ["Tdap every 10y", "Annual Influenza", "HepB (if at risk)"]}
    return {"success": True, "schedule": ["Annual Influenza", "Pneumococcal (PCV20 or PPSV23)", "Shingles (Shingrix 2-dose)", "Tdap every 10y", "RSV (>= 75 or 60+ with risk)"]}


# ============================================================
# TOOL SCHEMAS (OpenAI function-calling format)
# ============================================================

PATIENT_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "get_patient_profile",
            "description": "Get the patient's core demographic profile (name, NIC, date of birth, phone, registration number).",
            "parameters": {
                "type": "object",
                "properties": {
                    "patient_profile_id": {"type": "string", "description": "The patient's profile GUID"}
                },
                "required": ["patient_profile_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_vaccination_history",
            "description": "Get the patient's full vaccination timeline (all administered doses with dates and administrators).",
            "parameters": {
                "type": "object",
                "properties": {"patient_profile_id": {"type": "string"}},
                "required": ["patient_profile_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_medical_history",
            "description": "Get the patient's medical history timeline (all diagnoses, allergies, surgeries, medications).",
            "parameters": {
                "type": "object",
                "properties": {"patient_profile_id": {"type": "string"}},
                "required": ["patient_profile_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_active_conditions",
            "description": "Get ONLY the patient's currently active/chronic conditions.",
            "parameters": {
                "type": "object",
                "properties": {"patient_profile_id": {"type": "string"}},
                "required": ["patient_profile_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_visit_history",
            "description": "Get all past clinic visits with vitals and diagnoses.",
            "parameters": {
                "type": "object",
                "properties": {"patient_profile_id": {"type": "string"}},
                "required": ["patient_profile_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_upcoming_follow_ups",
            "description": "Get scheduled follow-up visits in the future.",
            "parameters": {
                "type": "object",
                "properties": {"patient_profile_id": {"type": "string"}},
                "required": ["patient_profile_id"]
            }
        }
    }
]

CARE_PLANNING_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "get_clinical_guidelines",
            "description": "Look up clinical guidelines for a specific condition (e.g., 'diabetes', 'hypertension', 'penicillin_allergy').",
            "parameters": {
                "type": "object",
                "properties": {
                    "condition_key": {"type": "string", "description": "Lowercase condition key, e.g. 'diabetes' or 'penicillin_allergy'"}
                },
                "required": ["condition_key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_age_based_vaccine_schedule",
            "description": "Get the standard recommended vaccine schedule for a given age in years.",
            "parameters": {
                "type": "object",
                "properties": {
                    "age_years": {"type": "integer", "description": "The patient's age in years"}
                },
                "required": ["age_years"]
            }
        }
    }
]
