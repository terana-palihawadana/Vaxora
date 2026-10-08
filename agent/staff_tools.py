"""
Staff scheduling tools for the StaffSchedulingAgent.
These call Vaxora hospital staff APIs using the caller's Bearer token.

Read and propose only: creating or deleting a shift is done by the hospital user
through the Vaxora UI, so the agent has no tool that can write to the roster.
"""
import asyncio
import json
import re
import time
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

try:
    from .tools import api_get, _clean_date_string
except ImportError:
    from tools import api_get, _clean_date_string

# Kept in this process only. Closing the chat does not clear it. Restarting the agent does.
_DECLINE_PREFIX = "__shift_declined__"
_hospital_key: ContextVar[str] = ContextVar("vaxora_hospital_key", default="")
_declined_slots: Dict[str, set] = {}
_gap_catalog: Dict[str, Dict[str, Any]] = {}
# Short-lived roster state cache so analyze + build in one Suggest Week share loaded data.
_ROSTER_CACHE_TTL_SEC = 30.0
_roster_cache: Dict[Tuple[str, str, str], Tuple[float, Dict[str, Any]]] = {}
MAX_WEEKLY_SHIFTS = 7

# Mirrors the 12-hour single-shift cap enforced by StaffManagementService.
MAX_SHIFT_MINUTES = 12 * 60


def bind_hospital(patient_info: Optional[Dict[str, Any]], token: Optional[str]) -> None:
    email = ""
    if isinstance(patient_info, dict):
        email = str(patient_info.get("email") or patient_info.get("Email") or "").strip().lower()
    _hospital_key.set(email or str(token or ""))


def parse_decline_payload(text: str) -> Optional[Dict[str, Any]]:
    raw = str(text or "").strip()
    if not raw.startswith(_DECLINE_PREFIX):
        return None
    try:
        data = json.loads(raw[len(_DECLINE_PREFIX):].strip())
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def note_decline_message(text: str) -> bool:
    """Remember a Decline click. Returns True when this message is only that note."""
    data = parse_decline_payload(text)
    if data is None:
        return False
    key = _hospital_key.get()
    if key:
        slot = (
            str(data.get("affiliationId") or ""),
            str(data.get("shiftDate") or "")[:10],
            _normalize_time(data.get("startTime"))[:5],
            _normalize_time(data.get("endTime"))[:5],
        )
        if slot[0] and slot[1]:
            _declined_slots.setdefault(key, set()).add(slot)
    if data.get("requestAlternative"):
        return False
    return True


def _remembered_declines() -> List[Tuple[str, str, str, str]]:
    return list(_declined_slots.get(_hospital_key.get(), ()))


def _normalize_time(value: Any) -> str:
    """Normalize to HH:mm:ss for the ASP.NET TimeOnly binder."""
    if value is None:
        return "08:00:00"
    s = str(value).strip()
    if len(s) == 5 and s[2] == ":":
        return f"{s}:00"
    return s


async def tool_get_active_staff(token: Optional[str] = None, role: Optional[str] = None) -> Dict[str, Any]:
    """List active affiliated doctors/nurses for the logged-in hospital."""
    try:
        params: Dict[str, Any] = {"status": "Active"}
        if role:
            params["role"] = role
        data = await api_get("/staff/hospital", token=token, params=params)
        staff = data if isinstance(data, list) else []
        return {
            "success": True,
            "count": len(staff),
            "staff": [
                {
                    "affiliationId": s.get("affiliationId") or s.get("AffiliationId"),
                    "staffUserId": s.get("staffUserId") or s.get("StaffUserId"),
                    "staffName": s.get("staffName") or s.get("StaffName"),
                    "staffRole": s.get("staffRole") or s.get("StaffRole"),
                    "specialization": s.get("specialization") or s.get("Specialization") or "",
                    "registrationNumber": s.get("staffRegistrationNumber") or s.get("StaffRegistrationNumber"),
                }
                for s in staff
            ],
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_coverage(from_date: str, to_date: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Fetch weekly coverage report for the hospital (Low / Partial / Good per day)."""
    try:
        clean_from = _clean_date_string(from_date)
        clean_to = _clean_date_string(to_date)
        data = await api_get(
            "/staff/coverage",
            token=token,
            params={"from": clean_from, "to": clean_to},
        )
        return {"success": True, "coverage": data}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_hospital_shifts(
    from_date: str,
    to_date: str,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """List hospital shifts in a date range."""
    try:
        clean_from = _clean_date_string(from_date)
        clean_to = _clean_date_string(to_date)
        data = await api_get(
            "/staff/shifts/hospital",
            token=token,
            params={"from": clean_from, "to": clean_to},
        )
        shifts = data if isinstance(data, list) else []
        return {"success": True, "count": len(shifts), "shifts": shifts}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_staff_busy_blocks(
    from_date: str,
    to_date: str,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Busy times for affiliated staff across every hospital (matches CreateShift overlap rules)."""
    try:
        clean_from = _clean_date_string(from_date)
        clean_to = _clean_date_string(to_date)
        data = await api_get(
            "/staff/shifts/busy",
            token=token,
            params={"from": clean_from, "to": clean_to},
        )
        blocks = data if isinstance(data, list) else []
        return {"success": True, "count": len(blocks), "blocks": blocks}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_propose_shift_for_approval(
    affiliation_id: str,
    staff_name: str,
    shift_date: str,
    start_time: str,
    end_time: str,
    booth_or_station: Optional[str] = None,
    booth_id: Optional[str] = None,
    notes: Optional[str] = None,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Build a suggested shift. The hospital presses Approve or Decline.
    Does NOT create the shift yet.

    The same schedule rules the API enforces are checked here so the agent cannot
    surface a proposal that is guaranteed to be rejected on approval.
    """
    clean_date = _clean_date_string(shift_date)
    clean_start = _normalize_time(start_time)
    clean_end = _normalize_time(end_time)

    if not str(affiliation_id or "").strip():
        return {
            "success": False,
            "error": "affiliation_id is required. Call get_active_staff to find the roster id.",
        }

    if clean_date < _hospital_today():
        return {
            "success": False,
            "error": f"{clean_date} is in the past. Propose a date on or after {_hospital_today()}.",
        }

    start_minutes = _minutes(clean_start)
    end_minutes = _minutes(clean_end)
    if end_minutes <= start_minutes:
        return {
            "success": False,
            "error": "End time must be after start time.",
        }

    if (end_minutes - start_minutes) > MAX_SHIFT_MINUTES:
        return {
            "success": False,
            "error": f"A single shift cannot exceed {MAX_SHIFT_MINUTES // 60} hours.",
        }

    proposal: Dict[str, Any] = {
        "affiliationId": affiliation_id,
        "staffName": staff_name,
        "shiftDate": clean_date,
        "startTime": clean_start,
        "endTime": clean_end,
        "boothOrStation": booth_or_station,
        "notes": notes,
        "reason": reason or "Suggested by Staff Scheduling Agent",
    }
    if booth_id:
        proposal["boothId"] = booth_id
    return {
        "success": True,
        "status": "proposal_pending_hospital_approval",
        "proposal": proposal,
    }


def _hospital_clock() -> datetime:
    return datetime.now(timezone(timedelta(hours=5, minutes=30)))


def _hospital_today() -> str:
    return _hospital_clock().date().isoformat()


def _week_bounds(start: str, end: str) -> Tuple[str, str]:
    """Monday through Sunday covering the days being staffed."""
    start_day = datetime.fromisoformat(start).date()
    end_day = datetime.fromisoformat(end).date()
    week_start = start_day - timedelta(days=start_day.weekday())
    week_end = end_day + timedelta(days=6 - end_day.weekday())
    return week_start.isoformat(), week_end.isoformat()


def _hospital_now_minutes() -> int:
    clock = _hospital_clock()
    return clock.hour * 60 + clock.minute


def _day_key(value: Any) -> str:
    return str(value or "")[:10]


def _minutes(value: Any) -> int:
    raw = str(value or "00:00")[:5]
    hour, minute = raw.split(":")
    return int(hour) * 60 + int(minute)


async def _load_active_booths(token: Optional[str]) -> Optional[List[Dict[str, Any]]]:
    """Return active booths, or None when the booth API cannot be reached."""
    try:
        data = await api_get("/staff/booths", token=token, params={"activeOnly": True})
    except Exception:
        return None
    return data if isinstance(data, list) else None


def _booth_id(booth: Optional[Dict[str, Any]]) -> Optional[str]:
    if not booth:
        return None
    return booth.get("boothId") or booth.get("BoothId") or booth.get("id") or booth.get("Id")


def _booth_label(booth: Dict[str, Any]) -> str:
    return (
        booth.get("displayLabel")
        or booth.get("DisplayLabel")
        or booth.get("name")
        or booth.get("Name")
        or booth.get("code")
        or booth.get("Code")
        or "Booth"
    )


# Clinical booth throughput: several patients can move through each 20-minute band.
SLOT_BAND_MINUTES = 20
PATIENTS_PER_SLOT = 3
# When no real window is known, assume a classic 4-hour half-day (AM/PM fallback).
_FALLBACK_WINDOW_MINUTES = 4 * 60


def _session_patient_capacity(slot_start_minutes=None, slot_end_minutes=None) -> int:
    """Max patients one booth can handle in a clinic window.

    seats = floor(windowMinutes / 20) * PATIENTS_PER_SLOT
    Example: 2h → 6 bands × 3 = 18; 4h → 12 × 3 = 36.
    """
    try:
        start = int(slot_start_minutes) if slot_start_minutes is not None else None
        end = int(slot_end_minutes) if slot_end_minutes is not None else None
    except (TypeError, ValueError):
        start = end = None

    if start is None or end is None or end <= start:
        minutes = _FALLBACK_WINDOW_MINUTES
    else:
        minutes = end - start

    bands = max(1, minutes // SLOT_BAND_MINUTES)
    return bands * PATIENTS_PER_SLOT


def _sorted_booths(booths):
    if not booths:
        return []
    return sorted(
        booths,
        key=lambda booth: (
            booth.get("sortOrder") if booth.get("sortOrder") is not None else booth.get("SortOrder") or 0,
            str(booth.get("code") or booth.get("Code") or ""),
        ),
    )


async def _load_hospital_appointments(token: Optional[str]) -> Optional[List[Dict[str, Any]]]:
    try:
        data = await api_get("/appointments/hospital", token=token)
    except Exception:
        return None
    return data if isinstance(data, list) else None


async def _load_hospital_schedules(token: Optional[str]) -> Optional[List[Dict[str, Any]]]:
    """Active posted immunization sessions for this hospital. None = API failure."""
    try:
        data = await api_get("/schedule/hospital", token=token)
    except Exception:
        return None
    return data if isinstance(data, list) else []


def _hm_label(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _day_matches_schedule(day_name: str, days_of_week: Any) -> bool:
    if not days_of_week:
        return False
    items = days_of_week if isinstance(days_of_week, list) else str(days_of_week).split(",")
    day_short = day_name[:3]
    for item in items:
        token = str(item or "").strip()
        if not token:
            continue
        if token.lower() in (day_name.lower(), day_short.lower()):
            return True
    return False


def _expand_schedule_sessions(
    schedules: List[Dict[str, Any]],
    range_from: str,
    range_to: str,
) -> List[Dict[str, Any]]:
    """Turn OneTime/Weekly VaccineSchedules into concrete date+time clinic windows."""
    sessions: List[Dict[str, Any]] = []
    start_day = datetime.fromisoformat(range_from).date()
    end_day = datetime.fromisoformat(range_to).date()

    for sch in schedules or []:
        status = str(sch.get("status") or sch.get("Status") or "Active")
        if status.lower() == "cancelled":
            continue
        start_m = _minutes(sch.get("startTime") or sch.get("StartTime"))
        end_m = _minutes(sch.get("endTime") or sch.get("EndTime"))
        if end_m <= start_m:
            continue
        vaccine_name = str(sch.get("vaccineName") or sch.get("VaccineName") or "").strip()
        vaccine_id = sch.get("vaccineId") or sch.get("VaccineId")
        booth_id = sch.get("boothId") or sch.get("BoothId")
        booth_label = sch.get("boothLabel") or sch.get("BoothLabel") or ""
        schedule_id = sch.get("id") or sch.get("Id")
        slot_name = f"{_hm_label(start_m)}-{_hm_label(end_m)}"
        schedule_type = str(sch.get("scheduleType") or sch.get("ScheduleType") or "OneTime")

        dates: List[str] = []
        if schedule_type.lower() == "weekly":
            window_start = sch.get("startDate") or sch.get("StartDate") or range_from
            window_end = sch.get("endDate") or sch.get("EndDate") or range_to
            try:
                ws = datetime.fromisoformat(str(window_start)[:10]).date()
                we = datetime.fromisoformat(str(window_end)[:10]).date()
            except ValueError:
                continue
            cursor = max(start_day, ws)
            last = min(end_day, we)
            days = sch.get("daysOfWeek") or sch.get("DaysOfWeek") or []
            while cursor <= last:
                if _day_matches_schedule(cursor.strftime("%A"), days):
                    dates.append(cursor.isoformat())
                cursor += timedelta(days=1)
        else:
            specific = sch.get("specificDate") or sch.get("SpecificDate")
            if not specific:
                continue
            day = str(specific)[:10]
            if range_from <= day <= range_to:
                dates.append(day)

        for day in dates:
            sessions.append(
                {
                    "date": day,
                    "slot": slot_name,
                    "slotStart": start_m,
                    "slotEnd": end_m,
                    "vaccineName": vaccine_name,
                    "vaccineId": str(vaccine_id) if vaccine_id else "",
                    "boothId": booth_id,
                    "boothLabel": booth_label,
                    "scheduleId": schedule_id,
                }
            )
    return sessions


def _clock_to_minutes(text: str) -> Optional[int]:
    raw = str(text or "").strip().upper()
    if not raw:
        return None
    mer = None
    if raw.endswith("AM"):
        mer = "AM"
        raw = raw[:-2].strip()
    elif raw.endswith("PM"):
        mer = "PM"
        raw = raw[:-2].strip()
    if ":" not in raw:
        return None
    hour_text, minute_text = raw.split(":", 1)
    minute_digits = "".join(ch for ch in minute_text if ch.isdigit())[:2]
    if not hour_text.isdigit() or len(minute_digits) < 2:
        return None
    hour = int(hour_text)
    minute = int(minute_digits)
    if mer == "PM" and hour < 12:
        hour += 12
    if mer == "AM" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return hour * 60 + minute


def _appt_start_minutes(appt: Dict[str, Any]) -> Optional[int]:
    raw = str(appt.get("startTime") or appt.get("StartTime") or "").strip()
    if raw:
        if "M" in raw.upper():
            parsed = _clock_to_minutes(raw)
            if parsed is not None:
                return parsed
        elif ":" in raw:
            return _minutes(raw)
    slot = str(appt.get("timeSlot") or appt.get("TimeSlot") or "")
    for index, ch in enumerate(slot):
        if not ch.isdigit():
            continue
        chunk = slot[index:].split("-", 1)[0].strip()
        parsed = _clock_to_minutes(chunk)
        if parsed is not None:
            return parsed
    return None


def _slot_for_minutes(minutes: int) -> str:
    return "Morning" if minutes < 12 * 60 else "Afternoon"


def _is_active_booking(appt: Dict[str, Any]) -> bool:
    status = str(appt.get("status") or appt.get("Status") or "").lower()
    return status not in ("cancelled", "canceled", "rejected", "completed")


def _vaccine_key(appt: Dict[str, Any]) -> str:
    vaccine_id = appt.get("vaccineId") or appt.get("VaccineId")
    if vaccine_id:
        return str(vaccine_id)
    name = str(appt.get("vaccineName") or appt.get("VaccineName") or "").strip().lower()
    return name or "unknown"


def _vaccine_label(appt: Dict[str, Any]) -> str:
    name = str(appt.get("vaccineName") or appt.get("VaccineName") or "").strip()
    return name or "Unknown vaccine"


def _demand_groups(
    appointments: List[Dict[str, Any]],
    start: str,
    end: str,
    sessions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[tuple, List[Dict[str, Any]]]:
    """Bucket bookings into posted clinic windows when possible; else Morning/Afternoon."""
    sessions_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for session in sessions or []:
        sessions_by_date.setdefault(session["date"], []).append(session)

    buckets: Dict[tuple, Dict[str, Dict[str, Any]]] = {}
    for appt in appointments:
        if not _is_active_booking(appt):
            continue
        date = _day_key(appt.get("appointmentDate") or appt.get("AppointmentDate"))
        if not date or date < start or date > end:
            continue
        minutes = _appt_start_minutes(appt)
        if minutes is None:
            continue

        vaccine_key = _vaccine_key(appt)
        vaccine_label = _vaccine_label(appt)
        slot_name = _slot_for_minutes(minutes)
        preferred_booth_id = None
        slot_start = 8 * 60 if slot_name == "Morning" else 13 * 60
        slot_end = 12 * 60 if slot_name == "Morning" else 17 * 60

        day_sessions = sessions_by_date.get(date) or []
        matched = None
        for session in day_sessions:
            if not (session["slotStart"] <= minutes < session["slotEnd"]):
                continue
            session_vid = str(session.get("vaccineId") or "")
            session_name = str(session.get("vaccineName") or "").strip().lower()
            appt_name = vaccine_label.strip().lower()
            vaccine_ok = False
            if session_vid and vaccine_key == session_vid:
                vaccine_ok = True
            elif session_name and (session_name in appt_name or appt_name in session_name):
                vaccine_ok = True
            if not vaccine_ok:
                continue
            matched = session
            break

        if matched:
            slot_name = matched["slot"]
            slot_start = matched["slotStart"]
            slot_end = matched["slotEnd"]
            preferred_booth_id = matched.get("boothId")

        slot_key = (date, slot_name)
        slot_bucket = buckets.setdefault(slot_key, {})
        row = slot_bucket.setdefault(
            vaccine_key,
            {
                "key": vaccine_key,
                "label": vaccine_label,
                "count": 0,
                "slotStart": slot_start,
                "slotEnd": slot_end,
                "preferredBoothId": preferred_booth_id,
            },
        )
        row["count"] += 1
        # Keep the tightest / first schedule window for this vaccine bucket.
        if preferred_booth_id and not row.get("preferredBoothId"):
            row["preferredBoothId"] = preferred_booth_id
        row["slotStart"] = slot_start
        row["slotEnd"] = slot_end
    return {slot_key: list(rows.values()) for slot_key, rows in buckets.items()}


def _seed_posted_schedule_demand(
    demand: Dict[tuple, List[Dict[str, Any]]],
    sessions: List[Dict[str, Any]],
) -> int:
    """
    Ensure every hospital-posted vaccine routine (full start–end window) gets
    booth coverage so staff can be scheduled for that entire clinic time —
    even before patients book. Bookings only increase demand beyond this baseline.
    """
    seeded = 0
    for session in sessions or []:
        date = session.get("date")
        slot_name = session.get("slot")
        if not date or not slot_name:
            continue
        vaccine_id = str(session.get("vaccineId") or "").strip()
        vaccine_name = str(session.get("vaccineName") or "").strip()
        vaccine_key = vaccine_id or vaccine_name.lower() or "unknown"
        label = vaccine_name or "Clinic vaccine"
        slot_key = (date, slot_name)
        groups = demand.setdefault(slot_key, [])
        existing = None
        for group in groups:
            if group.get("key") == vaccine_key:
                existing = group
                break
            if vaccine_name and str(group.get("label") or "").strip().lower() == vaccine_name.lower():
                existing = group
                break
        if existing is None:
            groups.append(
                {
                    "key": vaccine_key,
                    "label": label,
                    "count": 1,
                    "slotStart": session["slotStart"],
                    "slotEnd": session["slotEnd"],
                    "preferredBoothId": session.get("boothId"),
                    "fromSchedule": True,
                }
            )
            seeded += 1
            continue
        if existing.get("count", 0) < 1:
            existing["count"] = 1
            existing["fromSchedule"] = True
            seeded += 1
        if session.get("boothId") and not existing.get("preferredBoothId"):
            existing["preferredBoothId"] = session.get("boothId")
        # Always cover the hospital's declared full vaccine window.
        existing["slotStart"] = session["slotStart"]
        existing["slotEnd"] = session["slotEnd"]
    return seeded


def _booth_serves(booth: Dict[str, Any], vaccine_key: str, label: str) -> bool:
    ids = {str(item) for item in (booth.get("vaccineIds") or booth.get("VaccineIds") or [])}
    if vaccine_key in ids:
        return True
    names = {
        str(name).strip().lower()
        for name in (booth.get("vaccineNames") or booth.get("VaccineNames") or [])
    }
    return bool(label) and label.strip().lower() in names


def _place_vaccine_demand(booths, group, open_booths, booth_room, preferred_booth_id=None):
    """Fill booths that list this vaccine. Room = window length × PATIENTS_PER_SLOT."""
    capable = [booth for booth in booths if _booth_serves(booth, group["key"], group["label"])]
    if preferred_booth_id:
        preferred = [
            booth
            for booth in booths
            if str(_booth_id(booth) or "") == str(preferred_booth_id)
        ]
        # Schedule booth wins even if vaccine tags are incomplete — hospital assigned it.
        for booth in preferred:
            if booth not in capable:
                capable.insert(0, booth)
            else:
                capable.remove(booth)
                capable.insert(0, booth)
    if not capable:
        return [], group["count"]
    default_room = _session_patient_capacity(group.get("slotStart"), group.get("slotEnd"))
    remaining = group["count"]
    used = []
    for booth in capable:
        if remaining <= 0:
            break
        room_key = str(_booth_id(booth) or id(booth))
        room = booth_room.get(room_key, default_room)
        if room <= 0:
            continue
        take = min(room, remaining)
        booth_room[room_key] = room - take
        remaining -= take
        used.append(booth)
        if booth not in open_booths:
            open_booths.append(booth)
    return used, remaining


def _booth_has_role(planned, booth, date, slot_start, slot_end, role) -> bool:
    booth_key = str(_booth_id(booth) or "")
    return any(
        item.get("date") == date
        and str(item.get("role") or "").upper() == role
        and str(item.get("boothId") or "") == booth_key
        and item["start"] < slot_end
        and slot_start < item["end"]
        for item in planned
    )


def _specialty_fit_score(vaccine_label: Optional[str], specialization: Optional[str]) -> int:
    """Lower is better: 0 = text match, 1 = neutral / empty."""
    vac = str(vaccine_label or "").lower()
    spec = str(specialization or "").lower()
    if not vac or not spec:
        return 1
    vac_tokens = set(re.findall(r"[a-z]{4,}", vac))
    spec_tokens = set(re.findall(r"[a-z]{4,}", spec))
    if vac_tokens & spec_tokens:
        return 0
    pairs = (
        ("pedia", "pedia"),
        ("child", "pedia"),
        ("infant", "pedia"),
        ("immuno", "immuno"),
        ("travel", "travel"),
        ("yellow", "travel"),
        ("pregnant", "obste"),
        ("maternal", "obste"),
        ("gyn", "gyn"),
        ("adult", "general"),
        ("general", "general"),
        ("family", "family"),
    )
    for left, right in pairs:
        if left in vac and right in spec:
            return 0
        if right in vac and left in spec:
            return 0
    return 1


def _day_session_count(planned, affiliation_id: str, date: str) -> int:
    """How many shifts this person already has on this calendar day (roster + in-progress plan)."""
    aid = str(affiliation_id)
    return sum(
        1
        for item in planned
        if str(item.get("affiliationId")) == aid and item.get("date") == date
    )


def _pick_lightest_free(
    pool,
    planned,
    workload,
    date: str,
    slot_start: int,
    slot_end: int,
    vaccine_label: Optional[str] = None,
    exclude_ids: Optional[set] = None,
    pick_offset: int = 0,
    soft_exclude: bool = False,
):
    """Pick free person: prefer unused that day before stacking, then specialty, then weekly load."""
    if not pool:
        return None
    ranked = sorted(pool, key=lambda person: str(person.get("staffName") or "").lower())
    order = {person["affiliationId"]: index for index, person in enumerate(ranked)}
    day_offset = datetime.fromisoformat(date).weekday()
    pool_size = len(ranked)

    def tie_break(person) -> int:
        return (order[person["affiliationId"]] - day_offset) % pool_size

    free = []
    for person in pool:
        busy = any(
            item["affiliationId"] == person["affiliationId"]
            and item["date"] == date
            and slot_start < item["end"]
            and item["start"] < slot_end
            for item in planned
        )
        if not busy:
            free.append(person)
    if not free:
        return None
    free.sort(
        key=lambda person: (
            # Prefer someone with no shift that day before stacking a 2nd/3rd session.
            _day_session_count(planned, person["affiliationId"], date),
            _specialty_fit_score(vaccine_label, person.get("specialization")),
            workload.get(person["affiliationId"], 0),
            tie_break(person),
        )
    )
    blocked = exclude_ids or set()
    preferred = [person for person in free if person["affiliationId"] not in blocked]
    if preferred:
        candidates = preferred
    elif soft_exclude:
        candidates = free
    elif blocked:
        return None
    else:
        candidates = free
    offset = max(0, int(pick_offset or 0)) % len(candidates)
    return candidates[offset]


def _station_label(booth, slot_name: str) -> str:
    if not booth:
        return slot_name
    label = (
        str(_booth_label(booth))
        .replace("\u00b7", "-")
        .replace("·", "-")
        .replace("\u2014", "-")
        .replace("—", "-")
        .strip()
    )
    return f"{label} - {slot_name}"


def _pick_alternatives(
    pool,
    planned,
    workload,
    date: str,
    slot_start: int,
    slot_end: int,
    exclude_ids: Optional[set] = None,
    limit: int = 3,
    vaccine_label: Optional[str] = None,
):
    del vaccine_label
    exclude_ids = exclude_ids or set()
    ranked = sorted(pool, key=lambda person: str(person.get("staffName") or "").lower())
    order = {person["affiliationId"]: index for index, person in enumerate(ranked)}
    day_offset = datetime.fromisoformat(date).weekday()
    pool_size = len(ranked) or 1

    def tie_break(person) -> int:
        return (order[person["affiliationId"]] - day_offset) % pool_size

    free = []
    for person in pool:
        if person["affiliationId"] in exclude_ids:
            continue
        busy = any(
            item["affiliationId"] == person["affiliationId"]
            and item["date"] == date
            and slot_start < item["end"]
            and item["start"] < slot_end
            for item in planned
        )
        if not busy:
            free.append(person)
    free.sort(
        key=lambda person: (
            _day_session_count(planned, person["affiliationId"], date),
            workload.get(person["affiliationId"], 0),
            tie_break(person),
        )
    )
    return free[:limit]


def _free_candidates_for_gap(
    state: Dict[str, Any],
    gap: Dict[str, Any],
    limit: int = 2,
) -> List[Dict[str, Any]]:
    """Free roster people for a gap — compact fields for small LLM context windows."""
    pool = state.get("doctors") if gap.get("role") == "DOCTOR" else state.get("nurses")
    pool = pool or []
    planned = state.get("planned") or []
    workload = state.get("workload") or {}
    free = _pick_alternatives(
        pool,
        planned,
        workload,
        gap["date"],
        gap["slotStart"],
        gap["slotEnd"],
        exclude_ids=set(),
        limit=limit,
    )
    return [
        {
            "id": person["affiliationId"],
            "spec": (person.get("specialization") or "")[:28],
            "day": _day_session_count(planned, person["affiliationId"], gap["date"]),
        }
        for person in free
    ]


def _compact_analyze_for_llm(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Shrink analyze_staffing_needs output so week plans fit model context limits."""
    aliases: Dict[str, str] = {}
    gaps = []
    for index, gap in enumerate(payload.get("gaps") or []):
        short_id = str(index)
        full_id = str(gap.get("gapId") or "")
        if full_id:
            aliases[short_id] = full_id
        gaps.append(
            {
                "g": short_id,
                "d": gap.get("date"),
                "s": gap.get("slot"),
                "r": gap.get("role"),
                "b": str(gap.get("boothLabel") or "")[:18],
                "v": str(gap.get("vaccineName") or "")[:36],
                "c": gap.get("candidates") or [],
            }
        )
    return {
        "ok": True,
        "from": payload.get("from"),
        "to": payload.get("to"),
        "n": payload.get("gapCount") or len(gaps),
        "gaps": gaps,
        "note": (
            "gap_id in preferred_assignments = gaps[].g (short id). "
            "affiliation_id = gaps[].c[].id. Prefer day=0 before stacking."
        ),
        "_aliases": aliases,
    }


def _gap_id(date: str, slot_name: str, booth_id: Optional[str], role: str) -> str:
    return f"{date}|{slot_name}|{booth_id or 'none'}|{role.upper()}"


def _workload_summary(workload: Dict[str, int], staff: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    counts = list(workload.values()) or [0]
    lightest = min(counts)
    overloaded_ids = {
        affiliation_id
        for affiliation_id, count in workload.items()
        if count - lightest >= 2 and count > 0
    }
    rows = []
    for person in staff:
        count = workload.get(person["affiliationId"], 0)
        flag = (
            "heavy"
            if person["affiliationId"] in overloaded_ids
            else "light"
            if count == lightest
            else "even"
        )
        rows.append(
            {
                "affiliationId": person["affiliationId"],
                "staffName": person["staffName"],
                "staffRole": person["staffRole"],
                "shiftCount": count,
                "load": flag,
            }
        )
    rows.sort(key=lambda row: (-row["shiftCount"], row["staffName"] or ""))
    return rows


def _validate_proposals(
    proposals: List[Dict[str, Any]],
    staff: List[Dict[str, Any]],
    planned: List[Dict[str, Any]],
) -> Dict[str, Any]:
    staff_by_id = {s["affiliationId"]: s for s in staff}
    today = _hospital_today()
    issues = []
    for proposal in proposals:
        gap_id = proposal.get("gapId") or proposal.get("affiliationId")
        affiliation_id = proposal.get("affiliationId")
        date = str(proposal.get("shiftDate") or "")[:10]
        start = _minutes(proposal.get("startTime"))
        end = _minutes(proposal.get("endTime"))
        person = staff_by_id.get(affiliation_id)
        if not person:
            issues.append({"gapId": gap_id, "message": "Staff member is not on the active roster."})
            continue
        if date < today:
            issues.append({"gapId": gap_id, "message": "Shift date is in the past."})
        if end <= start:
            issues.append({"gapId": gap_id, "message": "Shift end time must be after start time."})
        overlap_blocks = [
            item
            for item in planned
            if item.get("affiliationId") == affiliation_id
            and item.get("date") == date
            and start < item["end"]
            and item["start"] < end
        ]
        if len(overlap_blocks) > 1:
            issues.append({"gapId": gap_id, "message": "Staff member is already booked for this slot."})
        week_shifts = sum(1 for item in planned if item.get("affiliationId") == affiliation_id)
        if week_shifts > MAX_WEEKLY_SHIFTS:
            issues.append(
                {
                    "gapId": gap_id,
                    "message": f"{person.get('staffName')} would exceed {MAX_WEEKLY_SHIFTS} shifts this week.",
                }
            )
    return {"valid": len(issues) == 0, "issues": issues}


def _roster_cache_key(from_date: str, to_date: str) -> Tuple[str, str, str]:
    return (_hospital_key.get() or "", from_date, to_date)


def _roster_cache_get(from_date: str, to_date: str) -> Optional[Dict[str, Any]]:
    key = _roster_cache_key(from_date, to_date)
    entry = _roster_cache.get(key)
    if not entry:
        return None
    ts, state = entry
    if time.monotonic() - ts > _ROSTER_CACHE_TTL_SEC:
        _roster_cache.pop(key, None)
        return None
    return state


def _roster_cache_put(from_date: str, to_date: str, state: Dict[str, Any]) -> None:
    _roster_cache[_roster_cache_key(from_date, to_date)] = (time.monotonic(), state)


def _roster_cache_clear() -> None:
    key_prefix = _hospital_key.get() or ""
    for key in [k for k in _roster_cache if k[0] == key_prefix]:
        _roster_cache.pop(key, None)


async def _prepare_roster_state(
    from_date: str,
    to_date: str,
    token: Optional[str],
) -> Dict[str, Any]:
    clean_from = _clean_date_string(from_date)
    clean_to = _clean_date_string(to_date)

    cached = _roster_cache_get(clean_from, clean_to)
    if cached is not None:
        return cached

    week_from, week_to = _week_bounds(clean_from, clean_to)

    # Kick off all read-only API fetches in parallel — saves ~4–5s per Suggest Week.
    staff_task = asyncio.create_task(tool_get_active_staff(token=token))
    shift_task = asyncio.create_task(tool_get_hospital_shifts(week_from, week_to, token=token))
    booth_task = asyncio.create_task(_load_active_booths(token))
    busy_task = asyncio.create_task(tool_get_staff_busy_blocks(week_from, week_to, token=token))
    appt_task = asyncio.create_task(_load_hospital_appointments(token))
    sched_task = asyncio.create_task(_load_hospital_schedules(token))

    staff_result = await staff_task
    if not staff_result.get("success"):
        for task in (shift_task, booth_task, busy_task, appt_task, sched_task):
            task.cancel()
        return staff_result

    shift_result = await shift_task
    if not shift_result.get("success") and (week_from != clean_from or week_to != clean_to):
        shift_result = await tool_get_hospital_shifts(clean_from, clean_to, token=token)
    if not shift_result.get("success"):
        for task in (booth_task, busy_task, appt_task, sched_task):
            task.cancel()
        return shift_result

    booths = await booth_task
    staff = staff_result.get("staff") or []
    shifts = shift_result.get("shifts") or []
    workload = {s["affiliationId"]: 0 for s in staff}
    for shift in shifts:
        affiliation_id = shift.get("affiliationId") or shift.get("AffiliationId")
        if affiliation_id in workload:
            workload[affiliation_id] += 1

    planned = []
    for shift in shifts:
        planned.append(
            {
                "affiliationId": shift.get("affiliationId") or shift.get("AffiliationId"),
                "date": _day_key(shift.get("shiftDate") or shift.get("ShiftDate")),
                "start": _minutes(shift.get("startTime") or shift.get("StartTime")),
                "end": _minutes(shift.get("endTime") or shift.get("EndTime")),
                "role": str(shift.get("staffRole") or shift.get("StaffRole") or "").upper(),
                "boothId": shift.get("boothId") or shift.get("BoothId"),
            }
        )

    # Include other-hospital shifts for the same people so we don't propose conflicts.
    busy_result = await busy_task
    external_busy = 0
    if busy_result.get("success"):
        seen = {
            (
                str(item.get("affiliationId")),
                item.get("date"),
                item.get("start"),
                item.get("end"),
            )
            for item in planned
        }
        for block in busy_result.get("blocks") or []:
            affiliation_id = block.get("localAffiliationId") or block.get("LocalAffiliationId")
            date = _day_key(block.get("shiftDate") or block.get("ShiftDate"))
            start = _minutes(block.get("startTime") or block.get("StartTime"))
            end = _minutes(block.get("endTime") or block.get("EndTime"))
            key = (str(affiliation_id), date, start, end)
            if not affiliation_id or key in seen:
                continue
            seen.add(key)
            is_external = bool(block.get("isExternal") if block.get("isExternal") is not None else block.get("IsExternal"))
            if is_external:
                external_busy += 1
            planned.append(
                {
                    "affiliationId": affiliation_id,
                    "date": date,
                    "start": start,
                    "end": end,
                    "role": "",
                    "boothId": None,
                }
            )

    for affiliation_id, day, start, end in _remembered_declines():
        planned.append(
            {
                "affiliationId": affiliation_id,
                "date": day,
                "start": _minutes(start),
                "end": _minutes(end),
                "role": "",
                "boothId": None,
            }
        )

    appointments = await appt_task
    schedules = await sched_task
    sessions = (
        _expand_schedule_sessions(schedules or [], clean_from, clean_to)
        if schedules is not None
        else []
    )
    state = {
        "success": True,
        "from": clean_from,
        "to": clean_to,
        "staff": staff,
        "doctors": [s for s in staff if str(s.get("staffRole") or "").upper() == "DOCTOR"],
        "nurses": [s for s in staff if str(s.get("staffRole") or "").upper() == "NURSE"],
        "booths": booths,
        "ordered_booths": _sorted_booths(booths),
        "appointments": appointments,
        "schedules": schedules,
        "sessions": sessions,
        "planned": planned,
        "externalBusyCount": external_busy,
        "workload": workload,
        "workloadBefore": _workload_summary(workload, staff),
        "today": _hospital_today(),
        "now_minutes": _hospital_now_minutes(),
        "slots": (("Morning", 8 * 60, 12 * 60), ("Afternoon", 13 * 60, 17 * 60)),
    }
    _roster_cache_put(clean_from, clean_to, state)
    return state


def _discover_staffing_gaps(state: Dict[str, Any]) -> Tuple[List[str], List[Dict[str, Any]], List[Dict[str, Any]]]:
    findings: List[str] = []
    openings: List[Dict[str, Any]] = []
    gaps: List[Dict[str, Any]] = []
    appointments = state.get("appointments")
    booths = state.get("booths")
    ordered_booths = state.get("ordered_booths") or []
    planned = state.get("planned") or []
    sessions = state.get("sessions") or []
    clean_from = state["from"]
    clean_to = state["to"]
    today = state["today"]
    now_minutes = state["now_minutes"]
    default_slots = state["slots"]

    if appointments is None and not sessions:
        findings.append("Appointments could not be loaded, so no booths need to be opened.")
        return findings, openings, gaps

    if appointments is None:
        findings.append("Appointments could not be loaded; staffing from posted vaccine schedules only.")
        appointments = []

    if state.get("schedules") is None:
        findings.append("Posted vaccine schedules could not be loaded; using morning/afternoon windows.")
    elif sessions:
        findings.append(f"Using {len(sessions)} posted vaccine schedule window(s) for staffing.")

    external_busy = int(state.get("externalBusyCount") or 0)
    if external_busy:
        findings.append(
            f"Respecting {external_busy} existing shift(s) at other hospitals so proposals won't clash on approve."
        )

    demand = _demand_groups(appointments, clean_from, clean_to, sessions=sessions)
    seeded = _seed_posted_schedule_demand(demand, sessions)
    if seeded:
        findings.append(
            f"Covering {seeded} hospital-posted vaccine routine(s) for their full declared clinic times."
        )
    cursor_day = datetime.fromisoformat(clean_from).date()
    end_day = datetime.fromisoformat(clean_to).date()
    while cursor_day <= end_day:
        date = cursor_day.isoformat()
        cursor_day += timedelta(days=1)
        if date < today:
            continue

        # Windows for this day: from demand keys + defaults if any fallback bookings exist.
        day_windows: Dict[str, Tuple[int, int]] = {}
        for (demand_date, slot_name), groups in demand.items():
            if demand_date != date:
                continue
            for group in groups:
                day_windows[slot_name] = (group.get("slotStart", 8 * 60), group.get("slotEnd", 12 * 60))
        # Always keep classic half-days available when demand used them.
        for slot_name, slot_start, slot_end in default_slots:
            day_windows.setdefault(slot_name, (slot_start, slot_end))

        for slot_name, (slot_start, slot_end) in day_windows.items():
            if date == today and slot_start <= now_minutes:
                continue
            groups = demand.get((date, slot_name), [])
            if not groups:
                continue
            open_booths: List[Dict[str, Any]] = []
            booth_room = {}
            booth_vaccines: Dict[str, List[str]] = {}
            for group in groups:
                placed, leftover = _place_vaccine_demand(
                    ordered_booths,
                    group,
                    open_booths,
                    booth_room,
                    preferred_booth_id=group.get("preferredBoothId"),
                )
                label = group["label"]
                for booth in placed:
                    key = str(_booth_id(booth) or id(booth))
                    names = booth_vaccines.setdefault(key, [])
                    if label not in names:
                        names.append(label)
                if not placed and leftover:
                    findings.append(
                        f"{date} {slot_name}: {leftover} {label} bookings, no booth gives that vaccine."
                    )
                    continue
                openings.append(
                    {
                        "date": date,
                        "slot": slot_name,
                        "count": group["count"],
                        "vaccine": label,
                        "booths": [_booth_label(booth) for booth in placed],
                        "source": "schedule" if group.get("fromSchedule") else "bookings",
                    }
                )
                if leftover:
                    findings.append(
                        f"{date} {slot_name}: {leftover} {label} patients do not fit booth capacity. "
                        "Add another booth for that vaccine."
                    )
            if not open_booths:
                continue
            for booth in open_booths:
                vaccine_label = ", ".join(booth_vaccines.get(str(_booth_id(booth) or id(booth)), []))
                booth_id = _booth_id(booth)
                for role in ("NURSE", "DOCTOR"):
                    if _booth_has_role(planned, booth, date, slot_start, slot_end, role):
                        continue
                    gaps.append(
                        {
                            "gapId": _gap_id(date, slot_name, booth_id, role),
                            "date": date,
                            "slot": slot_name,
                            "slotStart": slot_start,
                            "slotEnd": slot_end,
                            "role": role,
                            "boothId": booth_id,
                            "boothLabel": _booth_label(booth),
                            "booth": booth,
                            "vaccineName": vaccine_label,
                            "reason": "Doctor for this booth" if role == "DOCTOR" else "Nurse for this booth",
                        }
                    )

    if booths is None and appointments is not None:
        findings.append("Booth list could not be loaded, so proposals have no booth.")
    if (
        appointments is not None
        and ordered_booths
        and not gaps
        and not openings
        and not any("bookings for" in item for item in findings)
    ):
        if clean_from == clean_to:
            findings.append(f"There are no appointments on {clean_from}, so no booths need to be opened.")
        else:
            findings.append(
                f"There are no appointments from {clean_from} to {clean_to}, so no booths need to be opened."
            )
    if not findings and not openings:
        findings.append(
            f"There are no appointments from {clean_from} to {clean_to}, so no booths need to be opened."
        )
    return findings, openings, gaps


def _assign_gap_proposals(
    state: Dict[str, Any],
    gaps: List[Dict[str, Any]],
    exclude_affiliation_ids: Optional[List[str]] = None,
    gap_ids: Optional[List[str]] = None,
    preferred_assignments: Optional[List[Dict[str, Any]]] = None,
    soft_exclude: bool = False,
    pick_offset: int = 0,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, int]]:
    exclude = {str(item) for item in (exclude_affiliation_ids or []) if item}
    allowed = {str(item) for item in (gap_ids or [])} if gap_ids else None
    preferred_by_gap: Dict[str, str] = {}
    for item in preferred_assignments or []:
        gap_id = _resolve_gap_id(str(item.get("gap_id") or item.get("gapId") or item.get("g") or "").strip())
        affiliation_id = str(
            item.get("affiliation_id") or item.get("affiliationId") or item.get("id") or ""
        ).strip()
        if gap_id and affiliation_id:
            preferred_by_gap[gap_id] = affiliation_id

    planned = [dict(item) for item in state.get("planned") or []]
    workload = dict(state.get("workload") or {})
    doctors = state.get("doctors") or []
    nurses = state.get("nurses") or []
    staff_by_id = {str(s["affiliationId"]): s for s in (state.get("staff") or [])}
    proposals: List[Dict[str, Any]] = []
    offset = max(0, int(pick_offset or 0))

    for gap in gaps:
        if allowed is not None and gap["gapId"] not in allowed:
            continue
        pool = doctors if gap["role"] == "DOCTOR" else nurses
        slot_start = gap["slotStart"]
        slot_end = gap["slotEnd"]
        vaccine_label = gap.get("vaccineName") or ""
        preferred_id = preferred_by_gap.get(str(gap["gapId"]))
        chosen = None
        ai_picked = False
        if preferred_id and preferred_id not in exclude:
            preferred_person = staff_by_id.get(preferred_id)
            role_ok = preferred_person and any(
                str(person.get("affiliationId")) == preferred_id for person in pool
            )
            if preferred_person and role_ok:
                busy = any(
                    str(item["affiliationId"]) == preferred_id
                    and item["date"] == gap["date"]
                    and slot_start < item["end"]
                    and item["start"] < slot_end
                    for item in planned
                )
                if not busy:
                    # Override the LLM's pick if they already have a shift that day
                    # and another candidate is completely free that day.
                    preferred_day_count = _day_session_count(
                        planned, preferred_id, gap["date"]
                    )
                    if preferred_day_count > 0:
                        day_free = _pick_lightest_free(
                            pool,
                            planned,
                            workload,
                            gap["date"],
                            slot_start,
                            slot_end,
                            vaccine_label,
                            exclude_ids={preferred_id, *exclude},
                            pick_offset=offset,
                            soft_exclude=False,
                        )
                        if (
                            day_free
                            and _day_session_count(planned, day_free["affiliationId"], gap["date"]) == 0
                        ):
                            chosen = day_free
                            ai_picked = False
                    if chosen is None:
                        chosen = preferred_person
                        ai_picked = True
        if chosen is None:
            chosen = _pick_lightest_free(
                pool,
                planned,
                workload,
                gap["date"],
                slot_start,
                slot_end,
                vaccine_label,
                exclude_ids=exclude,
                pick_offset=offset,
                soft_exclude=soft_exclude,
            )
        if chosen and chosen["affiliationId"] in exclude:
            alts = _pick_alternatives(
                pool,
                planned,
                workload,
                gap["date"],
                slot_start,
                slot_end,
                exclude,
                limit=4,
                vaccine_label=vaccine_label,
            )
            if alts:
                chosen = alts[offset % len(alts)]
                ai_picked = False
            elif soft_exclude:
                pass
            else:
                chosen = None
                ai_picked = False
        if chosen is None:
            continue
        alts = _pick_alternatives(
            pool,
            planned,
            workload,
            gap["date"],
            slot_start,
            slot_end,
            {chosen["affiliationId"], *exclude},
            limit=3,
            vaccine_label=vaccine_label,
        )
        proposal = _make_gap_proposal(gap, chosen, alts, specialization_reason=ai_picked)
        proposals.append(proposal)
        workload[chosen["affiliationId"]] = workload.get(chosen["affiliationId"], 0) + 1
        planned.append(
            {
                "affiliationId": chosen["affiliationId"],
                "date": gap["date"],
                "start": slot_start,
                "end": slot_end,
                "role": gap["role"],
                "boothId": gap.get("boothId"),
            }
        )
    return proposals, planned, workload


def _minutes_to_time(minutes: int) -> str:
    minutes = max(0, min(24 * 60 - 1, int(minutes)))
    return f"{minutes // 60:02d}:{minutes % 60:02d}:00"


def _make_gap_proposal(
    gap: Dict[str, Any],
    chosen: Dict[str, Any],
    alternatives: List[Dict[str, Any]],
    specialization_reason: bool = False,
) -> Dict[str, Any]:
    slot_name = gap["slot"]
    booth = gap.get("booth")
    vaccine_label = gap.get("vaccineName") or ""
    reason = gap.get("reason") or "Suggested by Staff Scheduling Agent"
    if specialization_reason and chosen.get("specialization"):
        reason = (
            f"{reason} · specialization fit for {vaccine_label or 'clinic'} "
            f"({chosen.get('specialization')})"
        )
    elif specialization_reason:
        reason = f"{reason} · chosen for vaccine/clinic fit"
    return {
        "gapId": gap["gapId"],
        "affiliationId": chosen["affiliationId"],
        "staffName": chosen["staffName"],
        "staffRole": chosen["staffRole"],
        "specialization": chosen.get("specialization") or "",
        "shiftDate": gap["date"],
        "startTime": _minutes_to_time(gap["slotStart"]),
        "endTime": _minutes_to_time(gap["slotEnd"]),
        "boothId": gap.get("boothId"),
        "boothOrStation": _station_label(booth, slot_name),
        "vaccineName": vaccine_label,
        "notes": vaccine_label or "Clinic coverage",
        "reason": reason,
        "alternatives": [
            {
                "affiliationId": alt["affiliationId"],
                "staffName": alt["staffName"],
                "staffRole": alt["staffRole"],
                "specialization": alt.get("specialization") or "",
            }
            for alt in alternatives
        ],
    }


def _store_gap_catalog(
    state: Dict[str, Any],
    gaps: List[Dict[str, Any]],
    gap_id_aliases: Optional[Dict[str, str]] = None,
) -> None:
    key = _hospital_key.get()
    if not key:
        return
    existing = _gap_catalog.get(key) or {}
    aliases = (
        dict(gap_id_aliases)
        if gap_id_aliases is not None
        else dict(existing.get("gapIdAliases") or {})
    )
    _gap_catalog[key] = {
        "from": state["from"],
        "to": state["to"],
        "gaps": {gap["gapId"]: gap for gap in gaps},
        "gapIdAliases": aliases,
        "state": {
            "staff": state.get("staff") or [],
            "doctors": state.get("doctors") or [],
            "nurses": state.get("nurses") or [],
            "planned": state.get("planned") or [],
            "workload": state.get("workload") or {},
        },
    }


def _resolve_gap_id(gap_id: str) -> str:
    raw = str(gap_id or "").strip()
    if not raw:
        return raw
    catalog = _gap_catalog.get(_hospital_key.get(), {}) or {}
    aliases = catalog.get("gapIdAliases") or {}
    return str(aliases.get(raw) or raw)


async def tool_analyze_staffing_needs(
    from_date: str,
    to_date: str,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Read bookings, booths, and existing shifts. Returns gaps without assigning staff."""
    state = await _prepare_roster_state(from_date, to_date, token)
    if not state.get("success"):
        return state
    findings, openings, gaps = _discover_staffing_gaps(state)
    gap_rows = [
        {
            "gapId": gap["gapId"],
            "date": gap["date"],
            "slot": gap["slot"],
            "role": gap["role"],
            "boothLabel": gap["boothLabel"],
            "vaccineName": gap.get("vaccineName") or "",
            "candidates": _free_candidates_for_gap(state, gap),
        }
        for gap in gaps
    ]
    message = (
        f"Found {len(gaps)} staffing gap(s) across {state['from']} to {state['to']}. "
        "Use short gap ids gaps[].g with candidates[].id in preferred_assignments."
    )
    full = {
        "success": True,
        "from": state["from"],
        "to": state["to"],
        "findings": findings,
        "openings": openings,
        "gaps": gap_rows,
        "gapCount": len(gaps),
        "workloadBefore": state["workloadBefore"],
        "message": message,
    }
    llm_payload = _compact_analyze_for_llm(full)
    aliases = llm_payload.pop("_aliases", {}) or {}
    _store_gap_catalog(state, gaps, gap_id_aliases=aliases)
    full["llm"] = llm_payload
    return full


async def tool_build_staffing_plan(
    from_date: str,
    to_date: str,
    exclude_affiliation_ids: Optional[List[str]] = None,
    gap_ids: Optional[List[str]] = None,
    preferred_assignments: Optional[List[Dict[str, Any]]] = None,
    soft_exclude: bool = False,
    pick_offset: int = 0,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Assign staff to gaps (honoring LLM preferred_assignments when free) and validate."""
    state = await _prepare_roster_state(from_date, to_date, token)
    if not state.get("success"):
        return state
    findings, openings, gaps = _discover_staffing_gaps(state)
    _store_gap_catalog(state, gaps)
    proposals, planned, workload = _assign_gap_proposals(
        state,
        gaps,
        exclude_affiliation_ids=exclude_affiliation_ids,
        gap_ids=gap_ids,
        preferred_assignments=preferred_assignments,
        soft_exclude=soft_exclude,
        pick_offset=pick_offset,
    )
    validation = _validate_proposals(proposals, state.get("staff") or [], planned)
    workload_after = _workload_summary(workload, state.get("staff") or [])
    return {
        "success": True,
        "from": state["from"],
        "to": state["to"],
        "findings": findings,
        "openings": openings,
        "proposals": proposals,
        "proposalCount": len(proposals),
        "workloadBefore": state["workloadBefore"],
        "workloadAfter": workload_after,
        "validation": validation,
        "message": _review_message(state["from"], state["to"], findings, proposals),
    }


async def tool_propose_alternative_for_gap(
    gap_id: str,
    exclude_affiliation_ids: Optional[List[str]] = None,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Propose the next fairest person for one declined gap."""
    catalog = _gap_catalog.get(_hospital_key.get(), {})
    gap = (catalog.get("gaps") or {}).get(gap_id)
    if not gap:
        return {"success": False, "error": "Gap not found. Run analyze_staffing_needs first."}
    snapshot = catalog.get("state") or {}
    state = {
        "success": True,
        "from": catalog.get("from"),
        "to": catalog.get("to"),
        "staff": snapshot.get("staff") or [],
        "doctors": snapshot.get("doctors") or [],
        "nurses": snapshot.get("nurses") or [],
        "planned": [dict(item) for item in snapshot.get("planned") or []],
        "workload": dict(snapshot.get("workload") or {}),
    }
    proposals, planned, workload = _assign_gap_proposals(
        state,
        [gap],
        exclude_affiliation_ids=exclude_affiliation_ids,
        gap_ids=[gap_id],
    )
    if not proposals:
        return {
            "success": False,
            "error": "No alternative staff member is free for that booth and slot.",
        }
    validation = _validate_proposals(proposals, state.get("staff") or [], planned)
    return {
        "success": True,
        "proposal": proposals[0],
        "proposals": proposals,
        "workloadAfter": _workload_summary(workload, state.get("staff") or []),
        "validation": validation,
    }


def _append_gap_proposal(
    proposals, planned, workload, chosen, date, slot_name, slot_start, slot_end, booth, reason, vaccine_name=""
):
    booth_id = _booth_id(booth) if booth else None
    role = str(chosen.get("staffRole") or "").upper()
    pool = [chosen]  # legacy path
    alts = []
    proposal = {
        "gapId": _gap_id(date, slot_name, booth_id, role),
        "affiliationId": chosen["affiliationId"],
        "staffName": chosen["staffName"],
        "staffRole": chosen["staffRole"],
        "specialization": chosen.get("specialization") or "",
        "shiftDate": date,
        "startTime": _minutes_to_time(slot_start),
        "endTime": _minutes_to_time(slot_end),
        "boothId": booth_id,
        "boothOrStation": _station_label(booth, slot_name),
        "vaccineName": vaccine_name,
        "notes": vaccine_name or "Clinic coverage",
        "reason": reason,
        "alternatives": alts,
    }
    proposals.append(proposal)
    workload[chosen["affiliationId"]] = workload.get(chosen["affiliationId"], 0) + 1
    planned.append(
        {
            "affiliationId": chosen["affiliationId"],
            "date": date,
            "start": slot_start,
            "end": slot_end,
            "role": role,
            "boothId": booth_id,
        }
    )


def _review_message(from_date: str, to_date: str, findings: List[str], proposals: List[Dict[str, Any]]) -> str:
    lines = [f"Roster review {from_date} to {to_date}."]
    lines.extend(f"- {item}" for item in findings[:12])
    if proposals:
        lines.append(
            f"{len(proposals)} suggested shift(s). Press Approve or Decline on each one. Nothing is saved yet."
        )
    else:
        lines.append(
            "No new shifts to propose — every posted clinic window already has doctor/nurse coverage "
            "for this range. Approval is only needed when there are suggestion cards. "
            "Pick a week with open gaps, add more vaccine schedules/booths, or delete existing "
            "shifts if you want the agent to suggest replacements."
        )
    return "\n".join(lines)


STAFF_TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "get_active_staff",
            "description": "List active affiliated doctors and nurses by name and role.",
            "parameters": {
                "type": "object",
                "properties": {
                    "role": {
                        "type": "string",
                        "description": "Optional filter: DOCTOR or NURSE",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_coverage",
            "description": "Get coverage report (Low/Partial/Good) for a date range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_date": {"type": "string", "description": "Start date YYYY-MM-DD"},
                    "to_date": {"type": "string", "description": "End date YYYY-MM-DD"},
                },
                "required": ["from_date", "to_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_hospital_shifts",
            "description": "List existing hospital shifts between two dates.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_date": {"type": "string", "description": "Start date YYYY-MM-DD"},
                    "to_date": {"type": "string", "description": "End date YYYY-MM-DD"},
                },
                "required": ["from_date", "to_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_staffing_needs",
            "description": (
                "Step 1 for staffing. Reads bookings, posted schedules, booths, and shifts. "
                "Returns gaps with vaccineName and free candidates (including specialization text). "
                "Does not assign anyone."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "from_date": {"type": "string", "description": "Start date YYYY-MM-DD"},
                    "to_date": {"type": "string", "description": "End date YYYY-MM-DD"},
                },
                "required": ["from_date", "to_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "build_staffing_plan",
            "description": (
                "Step 2. Pass preferred_assignments using short gap_id from analyze gaps[].g "
                "and affiliation_id from gaps[].c[].id. Prefer day=0. Does not save."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "from_date": {"type": "string"},
                    "to_date": {"type": "string"},
                    "exclude_affiliation_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "preferred_assignments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "gap_id": {"type": "string"},
                                "affiliation_id": {"type": "string"},
                            },
                            "required": ["gap_id", "affiliation_id"],
                        },
                    },
                },
                "required": ["from_date", "to_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_alternative_for_gap",
            "description": (
                "After a hospital declines someone, propose the next fairest person for one gap."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "gap_id": {"type": "string"},
                    "exclude_affiliation_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["gap_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_shift_for_approval",
            "description": (
                "Propose ONE custom shift. Use only when the user asks for a single "
                "specific shift — not for whole-week suggestions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "affiliation_id": {"type": "string"},
                    "staff_name": {"type": "string"},
                    "shift_date": {"type": "string"},
                    "start_time": {"type": "string"},
                    "end_time": {"type": "string"},
                    "booth_or_station": {"type": "string"},
                    "booth_id": {"type": "string"},
                    "notes": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["affiliation_id", "staff_name", "shift_date", "start_time", "end_time"],
            },
        },
    },
]

# After analyze, only expose build — keeps 8k-context Suggest Week under the limit.
STAFF_WEEK_BUILD_TOOLS = [
    tool
    for tool in STAFF_TOOLS_SCHEMA
    if tool.get("function", {}).get("name") == "build_staffing_plan"
]
