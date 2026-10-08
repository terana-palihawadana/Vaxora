import httpx
import re
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta, date

try:
    from .config import settings
except ImportError:
    from config import settings

MONTH_NAMES = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

WEEKDAY_NAMES = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}

def _hospital_clock() -> datetime:
    """Official Vaxora clock (UTC+5:30 / Sri Lanka Time)."""
    return datetime.now(timezone(timedelta(hours=5, minutes=30)))

def _hospital_today() -> str:
    return _hospital_clock().date().isoformat()

def _get_current_date() -> date:
    return _hospital_clock().date()

def _get_temporal_context() -> Dict[str, Any]:
    now = _hospital_clock()
    today_date = now.date()
    today_iso = today_date.isoformat()
    day_name = now.strftime("%A")
    month_name = now.strftime("%B")
    month_short = now.strftime("%b")
    month_num = now.month
    year = now.year
    time_12 = now.strftime("%I:%M %p")
    time_24 = now.strftime("%H:%M")

    upcoming = {}
    for offset in range(14):
        target = today_date + timedelta(days=offset)
        label = "Today" if offset == 0 else ("Tomorrow" if offset == 1 else target.strftime("%A"))
        if offset >= 7 and label not in ("Today", "Tomorrow"):
            label = f"Next {target.strftime('%A')}"
        upcoming[label] = {
            "date": target.isoformat(),
            "dayOfWeek": target.strftime("%A"),
            "formatted": target.strftime("%A, %B %d, %Y"),
            "month": target.strftime("%B"),
            "monthNumber": target.month,
            "day": target.day,
            "year": target.year
        }

    return {
        "today": today_iso,
        "day_of_week": day_name,
        "month": month_name,
        "month_short": month_short,
        "month_number": month_num,
        "year": year,
        "time": time_12,
        "time_24": time_24,
        "timestamp_iso": now.isoformat(),
        "formatted_datetime": f"{day_name}, {month_name} {today_date.day}, {year} at {time_12}",
        "upcoming_calendar": upcoming
    }

def _parse_natural_date_to_iso(date_str: Any, base_date: Optional[date] = None) -> Optional[str]:
    """
    Parses natural language dates and months into ISO 'YYYY-MM-DD' format anchored to base_date (today).
    Handles:
    - '2026-10-16'
    - 'October 16', '16th October', '16 Oct', 'Oct 16', '16th of October'
    - 'today', 'tomorrow', 'day after tomorrow', 'next week'
    - 'Wednesday', 'next Friday', 'coming Monday'
    """
    if not date_str:
        return None
    s = str(date_str).strip()
    base = base_date or _get_current_date()

    # 1. Exact ISO
    m_iso = re.search(r'(\d{4}-\d{2}-\d{2})', s)
    if m_iso:
        return m_iso.group(1)

    s_lower = s.lower()

    # 2. Relative keywords
    if "today" in s_lower:
        return base.isoformat()
    if "tomorrow" in s_lower and "day after" not in s_lower:
        return (base + timedelta(days=1)).isoformat()
    if "day after tomorrow" in s_lower:
        return (base + timedelta(days=2)).isoformat()
    if "next week" in s_lower:
        return (base + timedelta(days=7)).isoformat()

    # 3. Month + Day combinations: e.g. "October 16", "Oct 16th", "16th of October", "16 October"
    # Pattern A: Month then Day -> "October 16", "Oct 16th"
    p_month_first = re.search(
        r'\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?',
        s_lower
    )
    if p_month_first:
        m_name = p_month_first.group(1)
        day_num = int(p_month_first.group(2))
        year_num = int(p_month_first.group(3)) if p_month_first.group(3) else None
        m_num = MONTH_NAMES.get(m_name)
        if m_num and 1 <= day_num <= 31:
            if not year_num:
                year_num = base.year if (m_num >= base.month or (m_num == base.month and day_num >= base.day)) else base.year + 1
            try:
                return date(year_num, m_num, day_num).isoformat()
            except ValueError:
                pass

    # Pattern B: Day then Month -> "16th of October", "16 October", "16th Oct"
    p_day_first = re.search(
        r'\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b(?:\s*,?\s*(\d{4}))?',
        s_lower
    )
    if p_day_first:
        day_num = int(p_day_first.group(1))
        m_name = p_day_first.group(2)
        year_num = int(p_day_first.group(3)) if p_day_first.group(3) else None
        m_num = MONTH_NAMES.get(m_name)
        if m_num and 1 <= day_num <= 31:
            if not year_num:
                year_num = base.year if (m_num >= base.month or (m_num == base.month and day_num >= base.day)) else base.year + 1
            try:
                return date(year_num, m_num, day_num).isoformat()
            except ValueError:
                pass

    # 4. Weekday names: e.g. "Wednesday", "next Friday"
    for w_name, w_idx in WEEKDAY_NAMES.items():
        if re.search(r'\b' + w_name + r'\b', s_lower):
            offset = (w_idx - base.weekday()) % 7
            if "next" in s_lower and offset == 0:
                offset = 7
            elif offset == 0 and "next" in s_lower:
                offset = 7
            elif offset == 0:
                offset = 0
            return (base + timedelta(days=offset)).isoformat()

    return None

def _resolve_preferred_date(
    preferred_date_input: Optional[str],
    available_dates: List[Dict[str, Any]],
    base_date: Optional[date] = None
) -> Optional[str]:
    """
    Intelligently resolves a patient's preferred date or month against the list of available clinic dates.
    FIRST checks today's date to avoid proposing past sessions.
    Supports:
    - Specific ISO dates ('2026-10-16')
    - Natural month+day ('October 16th', '16 Oct')
    - Month-only queries ('in October', 'October') -> selects first session in October
    - Relative days ('today', 'tomorrow', 'next week')
    - Day of week ('Wednesday', 'Friday')
    """
    if not available_dates:
        return None

    base = base_date or _get_current_date()
    today_str = base.isoformat()

    # Filter out past dates so the agent never proposes past appointments
    future_dates = [d for d in available_dates if (d.get("date") or "") >= today_str]
    pool = future_dates if future_dates else available_dates

    if not preferred_date_input or str(preferred_date_input).strip().lower() in ["earliest", "any", "first", "next available", "asap"]:
        return pool[0].get("date")

    s_raw = str(preferred_date_input).strip()
    s_lower = s_raw.lower()

    # 1. Direct ISO match
    clean_iso = _clean_date_string(s_raw)
    if clean_iso and re.match(r'^\d{4}-\d{2}-\d{2}$', clean_iso):
        for d in pool:
            if d.get("date") == clean_iso:
                return clean_iso

    # 2. Natural language parsing to ISO
    parsed_iso = _parse_natural_date_to_iso(s_raw, base)
    if parsed_iso:
        # Exact match in available dates
        for d in pool:
            if d.get("date") == parsed_iso:
                return parsed_iso
        # If exact date not open, find closest available session on or after requested date
        on_or_after = [d for d in pool if (d.get("date") or "") >= parsed_iso]
        if on_or_after:
            return on_or_after[0].get("date")

    # 3. Month-only matching (e.g. "October", "in October", "Nov")
    for m_name, m_num in MONTH_NAMES.items():
        if re.search(r'\b' + m_name + r'\b', s_lower):
            month_matches = [
                d for d in pool
                if len(d.get("date", "")) >= 7 and int(d.get("date", "")[5:7]) == m_num
            ]
            if month_matches:
                return month_matches[0].get("date")

    # 4. Day of week matching (e.g. "Wednesday", "Friday")
    for d in pool:
        dow = str(d.get("dayOfWeek") or "").lower()
        if dow and dow in s_lower:
            return d.get("date")

    # 5. Day number matching (e.g. "16th", "on the 20th")
    m_day = re.search(r'\b(\d{1,2})(?:st|nd|rd|th)\b', s_lower)
    if m_day:
        target_day = int(m_day.group(1))
        for d in pool:
            dt_val = str(d.get("date") or "")
            if len(dt_val) >= 10 and int(dt_val[8:10]) == target_day:
                return dt_val

    # Default fallback
    return pool[0].get("date")

def _is_valid_uuid(val: Any) -> bool:
    if not val:
        return False
    s = str(val).strip()
    return bool(re.match(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$', s))

def _clean_date_string(date_str: Any) -> str:
    """Extracts YYYY-MM-DD from any text (e.g. '2026-09-18 (Friday) - 09:00 AM - 11:00 AM')."""
    if not date_str:
        return ""
    m = re.search(r'(\d{4}-\d{2}-\d{2})', str(date_str))
    if m:
        return m.group(1)
    return str(date_str).strip()

def _clean_slot_string(slot_str: Any) -> str:
    """Extracts clean time slot range (e.g. '09:00 AM - 09:20 AM' or '09:00 - 09:20')."""
    if not slot_str:
        return ""
    s = str(slot_str).strip()
    m = re.search(r'(\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?\s*-\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?)', s)
    if m:
        return m.group(1)
    return s

# Appointments in these states can no longer be cancelled by the patient.
NON_CANCELLABLE_STATUSES = {"cancelled", "completed", "rejected", "administering", "observation"}

def _cancellable_appointments(appointments: Any) -> List[Dict[str, Any]]:
    """Active, upcoming appointments (soonest first) that a patient may still cancel."""
    today_str = _hospital_today()
    result = []
    for a in (appointments if isinstance(appointments, list) else []):
        if not isinstance(a, dict):
            continue
        if str(a.get("status", "")).strip().lower() in NON_CANCELLABLE_STATUSES:
            continue
        apt_date = _clean_date_string(a.get("appointmentDate"))
        if re.match(r'^\d{4}-\d{2}-\d{2}$', apt_date) and apt_date < today_str:
            continue
        result.append(a)
    return sorted(result, key=lambda a: _clean_date_string(a.get("appointmentDate")) or "9999-12-31")

def _appointment_matches(appointment: Dict[str, Any], term: str) -> bool:
    term = term.lower().strip()
    if not term:
        return False
    a_id = str(appointment.get("id", "")).lower()
    return (
        term == a_id
        or (len(term) >= 4 and a_id.startswith(term))
        or term in str(appointment.get("referenceNumber", "")).lower()
        or term in str(appointment.get("vaccineName", "")).lower()
        or term in str(appointment.get("appointmentDate", "")).lower()
        or term in str(appointment.get("hospitalName", "")).lower()
    )

async def api_get(endpoint: str, token: Optional[str] = None, params: Optional[Dict[str, Any]] = None) -> Any:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(f"{settings.vaxora_api_base_url}{endpoint}", headers=headers, params=params)
        if response.is_error:
            try:
                err_data = response.json()
                msg = err_data.get("message") or err_data.get("title") or err_data.get("errors") or str(err_data)
                raise Exception(f"API Error ({response.status_code}): {msg}")
            except Exception as pe:
                if "API Error" in str(pe):
                    raise pe
                raise Exception(f"API Error ({response.status_code}): {response.text}")
        return response.json()

async def api_post(endpoint: str, data: Dict[str, Any], token: Optional[str] = None) -> Any:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(f"{settings.vaxora_api_base_url}{endpoint}", headers=headers, json=data)
        if response.is_error:
            try:
                err_data = response.json()
                msg = err_data.get("message") or err_data.get("title") or err_data.get("errors") or str(err_data)
                raise Exception(f"API Error ({response.status_code}): {msg}")
            except Exception as pe:
                if "API Error" in str(pe):
                    raise pe
                raise Exception(f"API Error ({response.status_code}): {response.text}")
        return response.json()

async def api_delete(endpoint: str, token: Optional[str] = None) -> Any:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.delete(f"{settings.vaxora_api_base_url}{endpoint}", headers=headers)
        if response.is_error:
            try:
                err_data = response.json()
                msg = err_data.get("message") or err_data.get("title") or err_data.get("errors") or str(err_data)
                raise Exception(f"API Error ({response.status_code}): {msg}")
            except Exception as pe:
                if "API Error" in str(pe):
                    raise pe
                raise Exception(f"API Error ({response.status_code}): {response.text}")
        return response.json()

# Tool Implementations
async def _resolve_hospital_and_vaccine(hospital_id_or_name: Optional[str], vaccine_name: Optional[str], token: Optional[str] = None):
    resolved_hospital_id = str(hospital_id_or_name).strip() if hospital_id_or_name else ""
    resolved_vaccine_name = str(vaccine_name).strip() if vaccine_name else ""

    try:
        # Load inventory vaccines and active schedules
        data = await api_get("/inventory/vaccines-with-hospitals", token=token)
        schedules = []
        try:
            schedules = await api_get("/schedule/available", token=token)
        except Exception:
            pass

        # Collect all hospital references: [{userId, id, name}]
        known_hospitals = []
        for v in (data if isinstance(data, list) else []):
            for h in v.get("hospitals", []):
                uid = h.get("userId") or h.get("id")
                name = h.get("name", "")
                if uid and uid not in [kh["userId"] for kh in known_hospitals]:
                    known_hospitals.append({"userId": uid, "name": name, "profileId": h.get("hospitalProfileId")})

        for s in (schedules if isinstance(schedules, list) else []):
            uid = s.get("hospitalUserId")
            name = s.get("hospitalName", "")
            if uid and uid not in [kh["userId"] for kh in known_hospitals]:
                known_hospitals.append({"userId": uid, "name": name, "profileId": None})

        # Match vaccine name from known inventory / schedules
        v_input = (vaccine_name or "").lower().strip()
        matched_vname = None

        if v_input:
            # 1. Exact or bidirectional containment with inventory
            for v in (data if isinstance(data, list) else []):
                db_vname = v.get("name", "")
                if db_vname.lower() == v_input or db_vname.lower() in v_input or v_input in db_vname.lower():
                    matched_vname = db_vname
                    break

            # 2. Check schedules if still not matched
            if not matched_vname:
                for s in (schedules if isinstance(schedules, list) else []):
                    sched_vname = s.get("vaccineName", "")
                    if sched_vname.lower() == v_input or sched_vname.lower() in v_input or v_input in sched_vname.lower():
                        matched_vname = sched_vname
                        break

            # 3. Word token matching (e.g. "astrazeneca" in "AstraZeneca COVID-19 Vaccine")
            if not matched_vname:
                v_words = [w for w in re.split(r'[\s\-_]+', v_input) if len(w) >= 4]
                for v in (data if isinstance(data, list) else []):
                    db_vname = v.get("name", "")
                    if any(w in db_vname.lower() for w in v_words):
                        matched_vname = db_vname
                        break

        if matched_vname:
            resolved_vaccine_name = matched_vname

        # If hospital_id_or_name is ALREADY a valid UUID, keep it
        if _is_valid_uuid(resolved_hospital_id):
            return resolved_hospital_id, resolved_vaccine_name

        h_input = (hospital_id_or_name or "").lower().strip()
        # Clean sluggy terms like "hospital-royal" -> ["royal"]
        h_tokens = [t for t in re.split(r'[\s\-_]+', h_input) if t and t not in ("hospital", "hospitals", "clinic", "center")]

        matched_hid = None
        for kh in known_hospitals:
            kh_name = kh["name"].lower()
            if h_input and (h_input in kh_name or kh_name in h_input):
                matched_hid = kh["userId"]
                break
            if h_tokens and any(t in kh_name for t in h_tokens):
                matched_hid = kh["userId"]
                break

        # If still not matched, check if a hospital offers the matched vaccine
        if not matched_hid and resolved_vaccine_name:
            for v in (data if isinstance(data, list) else []):
                if v.get("name", "").lower() == resolved_vaccine_name.lower():
                    if v.get("hospitals"):
                        matched_hid = v["hospitals"][0].get("userId") or v["hospitals"][0].get("id")
                        break

        # Fallback to the first available hospital in system if still not a valid UUID
        if not matched_hid and known_hospitals:
            matched_hid = known_hospitals[0]["userId"]

        if matched_hid and _is_valid_uuid(matched_hid):
            resolved_hospital_id = matched_hid

    except Exception:
        pass

    return resolved_hospital_id, resolved_vaccine_name

async def tool_get_available_vaccines_and_hospitals(token: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve all available vaccines, current hospital stock, and pricing information."""
    try:
        data = await api_get("/inventory/vaccines-with-hospitals", token=token)
        schedules = []
        try:
            schedules = await api_get("/schedule/available", token=token)
        except Exception:
            pass

        # Enrich inventory with price and schedule information
        enriched_vaccines = []
        for v in (data if isinstance(data, list) else []):
            v_copy = dict(v)
            v_name = v_copy.get("name", "").strip().lower()
            hospitals = v_copy.get("hospitals", [])
            enriched_hospitals = []
            matched_prices = []

            for h in hospitals:
                h_copy = dict(h)
                h_uid = str(h_copy.get("userId") or h_copy.get("id") or "").lower()

                # Find matching schedule for this hospital and vaccine
                matched_sched = None
                for s in schedules:
                    s_huid = str(s.get("hospitalUserId") or "").lower()
                    s_vname = str(s.get("vaccineName") or "").strip().lower()
                    if (s_huid == h_uid or not h_uid) and (s_vname == v_name or s_vname in v_name or v_name in s_vname):
                        matched_sched = s
                        break

                if matched_sched:
                    price = float(matched_sched.get("price") or 0.0)
                    h_copy["price"] = price
                    h_copy["formattedPrice"] = matched_sched.get("formattedPrice") or (f"LKR {price:,.2f}" if price > 0 else "Free (0 LKR)")
                    h_copy["is_free"] = price <= 0
                    h_copy["vaccineScheduleId"] = matched_sched.get("id")
                    matched_prices.append(price)
                else:
                    h_copy["price"] = 0.0
                    h_copy["formattedPrice"] = "Free (0 LKR)"
                    h_copy["is_free"] = True

                enriched_hospitals.append(h_copy)

            v_copy["hospitals"] = enriched_hospitals
            if matched_prices:
                primary_price = matched_prices[0]
                v_copy["price"] = primary_price
                v_copy["formattedPrice"] = f"LKR {primary_price:,.2f}" if primary_price > 0 else "Free (0 LKR)"
                v_copy["is_free"] = primary_price <= 0
            else:
                v_copy["price"] = 0.0
                v_copy["formattedPrice"] = "Free (0 LKR)"
                v_copy["is_free"] = True

            enriched_vaccines.append(v_copy)

        return {"success": True, "vaccines": enriched_vaccines}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def tool_get_current_date_time(token: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve today's date, current day of week, month, year, time, and 14-day upcoming calendar in Vaxora."""
    return {
        "success": True,
        **_get_temporal_context()
    }

async def tool_get_available_dates(
    hospital_user_id: str,
    vaccine_name: str,
    month: Optional[str] = None,
    token: Optional[str] = None
) -> Dict[str, Any]:
    """Retrieve available clinic dates and schedules for a specific hospital and vaccine with temporal enrichment and optional month filtering."""
    try:
        hid, vname = await _resolve_hospital_and_vaccine(hospital_user_id, vaccine_name, token=token)
        params = {"hospitalUserId": hid, "vaccineName": vname}
        data = await api_get("/appointments/available-dates", token=token, params=params)

        today_obj = _get_current_date()
        today_str = today_obj.isoformat()
        current_month_name = today_obj.strftime("%B")
        current_year = today_obj.year

        enriched_dates = []
        for d in (data if isinstance(data, list) else []):
            d_copy = dict(d)
            dt_str = str(d_copy.get("date") or "").strip()
            if dt_str and len(dt_str) >= 10:
                try:
                    d_obj = datetime.strptime(dt_str[:10], "%Y-%m-%d").date()
                    d_copy["month"] = d_obj.strftime("%B")
                    d_copy["monthNumber"] = d_obj.month
                    d_copy["year"] = d_obj.year
                    d_copy["day"] = d_obj.day
                    d_copy["isToday"] = (d_obj == today_obj)
                    d_copy["isPast"] = (d_obj < today_obj)
                    d_copy["formatted"] = d_obj.strftime("%A, %B %d, %Y")
                except Exception:
                    pass
            enriched_dates.append(d_copy)

        month_filtered_dates = None
        if month:
            m_target = None
            m_clean = str(month).strip().lower()
            if m_clean in MONTH_NAMES:
                m_target = MONTH_NAMES[m_clean]
            elif m_clean.isdigit():
                m_target = int(m_clean)
            if m_target:
                month_filtered_dates = [d for d in enriched_dates if d.get("monthNumber") == m_target]

        return {
            "success": True,
            "today": today_str,
            "current_month": f"{current_month_name} {current_year}",
            "dates": enriched_dates,
            "month_filter": month,
            "matching_dates_for_month": month_filtered_dates,
            "hospital_user_id": hid,
            "vaccine_name": vname
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

async def tool_get_available_slots(hospital_user_id: str, vaccine_name: str, date: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve available 20-minute time slots for a given date, hospital, and vaccine."""
    try:
        clean_date = _clean_date_string(date)
        hid, vname = await _resolve_hospital_and_vaccine(hospital_user_id, vaccine_name, token=token)
        params = {"hospitalUserId": hid, "vaccineName": vname, "date": clean_date}
        data = await api_get("/appointments/available-slots", token=token, params=params)
        return {"success": True, "slots": data, "hospital_user_id": hid, "vaccine_name": vname, "date": clean_date}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def tool_autonomous_find_and_propose(
    vaccine_name: str,
    hospital_name_or_id: Optional[str] = None,
    preferred_date: Optional[str] = None,
    preferred_slot: Optional[str] = None,
    time_of_day: Optional[str] = None,
    token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Autonomous Delegated Booking Tool (One-Prompt Execution):
    In a single shot, discovers the hospital, fetches upcoming clinic dates, locates open time slots,
    applies schedule pricing, and prepares the official proposal card for human-in-the-loop patient approval.
    """
    try:
        # 1. Resolve hospital and vaccine name
        hid, vname = await _resolve_hospital_and_vaccine(hospital_name_or_id, vaccine_name, token=token)

        # 2. Get schedule details for hospital name and price.
        hospital_name = "Hospital Center"
        schedule_id = None
        vaccine_id = None
        price = 0.0
        formatted_price = "Free (0 LKR)"
        is_free = True

        try:
            schedules = await api_get("/schedule/available", token=token)
            for s in schedules:
                s_huid = str(s.get("hospitalUserId") or "").lower()
                s_vname = str(s.get("vaccineName") or "").strip().lower()
                if (s_huid == str(hid).lower() or not hid) and (s_vname == vname.lower() or s_vname in vname.lower() or vname.lower() in s_vname):
                    hospital_name = s.get("hospitalName") or hospital_name
                    schedule_id = s.get("id")
                    vaccine_id = s.get("vaccineId")
                    price = float(s.get("price") or 0.0)
                    formatted_price = s.get("formattedPrice") or (f"LKR {price:,.2f}" if price > 0 else "Free (0 LKR)")
                    is_free = price <= 0
                    break
        except Exception:
            pass

        if hospital_name == "Hospital Center":
            try:
                inv = await api_get("/inventory/vaccines-with-hospitals", token=token)
                for iv in inv:
                    for ih in iv.get("hospitals", []):
                        if ih.get("userId") == hid or ih.get("id") == hid:
                            hospital_name = ih.get("name") or hospital_name
                            break
            except Exception:
                pass

        # 3. Retrieve available clinic dates
        dates_res = await api_get("/appointments/available-dates", token=token, params={"hospitalUserId": hid, "vaccineName": vname})
        if not dates_res or not isinstance(dates_res, list) or len(dates_res) == 0:
            return {
                "success": False,
                "error": f"No clinic sessions found for {vname} at {hospital_name}. Please choose another vaccine or hospital."
            }

        # Select date matching preference using intelligent calendar and month resolver
        selected_date = _resolve_preferred_date(preferred_date, dates_res)
        if not selected_date:
            # Default to the earliest available date
            selected_date = dates_res[0].get("date")

        # 4. Fetch available slots for this date
        slots_res = await api_get("/appointments/available-slots", token=token, params={"hospitalUserId": hid, "vaccineName": vname, "date": selected_date})
        open_slots = [s for s in (slots_res if isinstance(slots_res, list) else []) if not s.get("isBooked")]

        # If no open slots on chosen date, try next available dates
        if not open_slots:
            for next_d in dates_res:
                if next_d.get("date") != selected_date:
                    next_slots = await api_get("/appointments/available-slots", token=token, params={"hospitalUserId": hid, "vaccineName": vname, "date": next_d.get("date")})
                    open_slots = [s for s in (next_slots if isinstance(next_slots, list) else []) if not s.get("isBooked")]
                    if open_slots:
                        selected_date = next_d.get("date")
                        break

        if not open_slots:
            return {
                "success": False,
                "error": f"All slots are currently booked for {vname} at {hospital_name} across upcoming dates."
            }

        # Pick slot matching user time preference
        selected_slot = None
        pref_time_lower = (time_of_day or preferred_slot or "").lower()

        if preferred_slot:
            clean_pref_slot = _clean_slot_string(preferred_slot)
            for s in open_slots:
                if clean_pref_slot in s.get("slot", ""):
                    selected_slot = s.get("slot")
                    break

        if not selected_slot and ("morning" in pref_time_lower or "am" in pref_time_lower):
            for s in open_slots:
                st = s.get("startTime", "")
                if st and st < "12:00":
                    selected_slot = s.get("slot")
                    break

        if not selected_slot and ("afternoon" in pref_time_lower or "evening" in pref_time_lower or "pm" in pref_time_lower):
            for s in open_slots:
                st = s.get("startTime", "")
                if st and st >= "12:00":
                    selected_slot = s.get("slot")
                    break

        if not selected_slot:
            # Default to first open slot
            selected_slot = open_slots[0].get("slot")

        proposal = {
            "hospital_user_id": hid,
            "hospital_name": hospital_name,
            "vaccine_name": vname,
            "vaccine_id": vaccine_id,
            "vaccine_schedule_id": schedule_id,
            "appointment_date": selected_date,
            "time_slot": selected_slot,
            "price": price,
            "is_free": is_free
        }

        return {
            "success": True,
            "status": "proposal_pending_user_approval",
            "proposal": proposal,
            "summary": f"Optimal appointment found: {vname} at {hospital_name} on {selected_date} at {selected_slot}. Fee: {formatted_price}."
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

async def tool_book_appointment(
    hospital_user_id: str,
    vaccine_name: str,
    appointment_date: str,
    time_slot: str,
    notes: Optional[str] = None,
    payment_method: str = "Free",
    vaccine_id: Optional[str] = None,
    vaccine_schedule_id: Optional[str] = None,
    token: Optional[str] = None
) -> Dict[str, Any]:
    """Execute the final booking for an appointment. Must only be invoked after explicit user approval."""
    try:
        clean_date = _clean_date_string(appointment_date)
        clean_slot = _clean_slot_string(time_slot)
        hid, vname = await _resolve_hospital_and_vaccine(hospital_user_id, vaccine_name, token=token)

        # Lookup schedule if vaccine_schedule_id not supplied
        resolved_schedule_id = vaccine_schedule_id
        resolved_vaccine_id = vaccine_id
        schedule_price = 0.0

        try:
            schedules = await api_get("/schedule/available", token=token)
            for s in schedules:
                s_huid = str(s.get("hospitalUserId") or "").lower()
                s_vname = str(s.get("vaccineName") or "").strip().lower()
                if (s_huid == str(hid).lower() or not hid) and (s_vname == vname.lower() or s_vname in vname.lower() or vname.lower() in s_vname):
                    if not resolved_schedule_id:
                        resolved_schedule_id = s.get("id")
                    if not resolved_vaccine_id:
                        resolved_vaccine_id = s.get("vaccineId")
                    schedule_price = float(s.get("price") or 0.0)
                    break
        except Exception:
            pass

        # Determine payment method based on schedule pricing
        if schedule_price > 0 or payment_method.lower() in ("payhere", "paid", "online"):
            resolved_payment_method = "PayHere"
        else:
            resolved_payment_method = "Free"

        payload = {
            "hospitalUserId": hid,
            "vaccineName": vname,
            "appointmentDate": clean_date,
            "timeSlot": clean_slot,
            "notes": notes or "Booked via Vaxora AI Agent",
            "paymentMethod": resolved_payment_method
        }
        if resolved_vaccine_id and _is_valid_uuid(resolved_vaccine_id):
            payload["vaccineId"] = resolved_vaccine_id
        if resolved_schedule_id and _is_valid_uuid(resolved_schedule_id):
            payload["vaccineScheduleId"] = resolved_schedule_id

        res = await api_post("/appointments", data=payload, token=token)
        appointment_id = res.get("id") or res.get("Id")

        # If it's a paid booking, initialize PayHere checkout payload automatically
        payhere_payload = None
        fee = float(res.get("fee") or schedule_price or 0.0)
        is_free = fee <= 0 and res.get("status") != "PendingPayment"

        if not is_free or res.get("status") == "PendingPayment" or fee > 0:
            try:
                payhere_payload = await api_post("/payment/payhere-init", data={"appointmentId": appointment_id}, token=token)
            except Exception as pe:
                payhere_payload = {"error": f"Payment init failed: {str(pe)}"}

        return {
            "success": True,
            "appointment": res,
            "payhere_payload": payhere_payload,
            "is_free": is_free,
            "fee": fee
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

async def tool_get_my_appointments(token: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve the logged-in patient's appointment history and upcoming bookings."""
    try:
        data = await api_get("/appointments/patient", token=token)
        return {"success": True, "appointments": data}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def tool_cancel_appointment(appointment_id: Optional[str] = None, token: Optional[str] = None) -> Dict[str, Any]:
    """Cancel an upcoming appointment. Accepts GUID, ReferenceNumber, Vaccine Name, Date, 'all', or 'latest'."""
    try:
        # 1. Fetch user's current appointments from database
        patient_appts = []
        try:
            patient_appts = await api_get("/appointments/patient", token=token)
        except Exception as ex_fetch:
            # Without the patient's list we can only act on an exact appointment GUID;
            # the API still enforces ownership and cancellation rules.
            if _is_valid_uuid(appointment_id):
                data = await api_delete(f"/appointments/{appointment_id.strip()}/cancel", token=token)
                return {"success": True, "result": data, "message": f"Appointment {appointment_id} cancelled."}
            raise ex_fetch

        if not patient_appts or not isinstance(patient_appts, list):
            return {"success": False, "error": "You currently have no booked appointments on record."}

        target_input = (appointment_id or "").strip()
        lower_input = target_input.lower()

        active_appts = _cancellable_appointments(patient_appts)

        if not active_appts:
            return {"success": False, "error": "No active upcoming appointments found to cancel."}

        if not target_input or lower_input in ("latest", "upcoming", "my appointment", "appointment"):
            to_cancel = [active_appts[0]]
        elif lower_input in ("all", "everything", "all appointments", "all bookings"):
            to_cancel = active_appts
        else:
            to_cancel = [a for a in active_appts if _appointment_matches(a, lower_input)]

        if not to_cancel:
            return {"success": False, "error": f"Could not find an active upcoming appointment matching '{target_input}'."}

        cancelled_items = []
        for apt in to_cancel:
            apt_id = apt.get("id")
            await api_delete(f"/appointments/{apt_id}/cancel", token=token)
            cancelled_items.append({
                "id": apt_id,
                "referenceNumber": apt.get("referenceNumber"),
                "vaccineName": apt.get("vaccineName"),
                "hospitalName": apt.get("hospitalName"),
                "appointmentDate": apt.get("appointmentDate"),
                "timeSlot": apt.get("timeSlot")
            })

        count = len(cancelled_items)
        details = ", ".join([f"{item['vaccineName']} on {item['appointmentDate']} at {item['timeSlot']}" for item in cancelled_items])
        return {
            "success": True,
            "count": count,
            "message": f"Successfully cancelled {count} appointment(s): {details}.",
            "cancelled": cancelled_items
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

async def tool_propose_cancellation_for_approval(
    appointment_id: Optional[str] = None,
    vaccine_name: Optional[str] = None,
    hospital_name: Optional[str] = None,
    appointment_date: Optional[str] = None,
    time_slot: Optional[str] = None,
    token: Optional[str] = None
) -> Dict[str, Any]:
    """Prepares an appointment cancellation card for explicit patient approval BEFORE executing cancellation."""
    target_apt = None
    active_appts = []
    search_terms = []
    try:
        if token:
            patient_appts = await api_get("/appointments/patient", token=token)
            active_appts = _cancellable_appointments(patient_appts)

            if appointment_id and appointment_id.lower().strip() not in ("latest", "upcoming", "all", "none"):
                search_terms.append(appointment_id)
            if vaccine_name:
                search_terms.append(vaccine_name)
            if appointment_date:
                search_terms.append(_clean_date_string(appointment_date))

            if search_terms:
                # Pick the appointment matching the most criteria; never fall back
                # to an unrelated appointment when nothing matches.
                best_score = 0
                for a in active_appts:
                    score = sum(1 for st in search_terms if _appointment_matches(a, st))
                    if score > best_score:
                        best_score, target_apt = score, a
            elif active_appts:
                target_apt = active_appts[0]
    except Exception:
        pass

    if token and not active_appts:
        return {
            "success": False,
            "error": "No active upcoming appointments found to cancel."
        }

    if token and not target_apt:
        return {
            "success": False,
            "error": "No active upcoming appointment matches that request. Ask the patient which appointment to cancel.",
            "active_appointments": [
                {
                    "id": a.get("id"),
                    "vaccineName": a.get("vaccineName"),
                    "hospitalName": a.get("hospitalName"),
                    "appointmentDate": a.get("appointmentDate"),
                    "timeSlot": a.get("timeSlot"),
                }
                for a in active_appts
            ],
        }

    resolved_id = target_apt.get("id") if target_apt else (appointment_id or "")
    resolved_vaccine = target_apt.get("vaccineName") if target_apt else (vaccine_name or "Vaccination Appointment")
    resolved_hospital = target_apt.get("hospitalName") if target_apt else (hospital_name or "Assigned Hospital")
    resolved_date = target_apt.get("appointmentDate") if target_apt else (appointment_date or "")
    resolved_slot = target_apt.get("timeSlot") if target_apt else (time_slot or "")

    return {
        "success": True,
        "status": "cancellation_pending_user_approval",
        "proposal": {
            "type": "cancellation",
            "appointment_id": str(resolved_id),
            "vaccine_name": resolved_vaccine,
            "hospital_name": resolved_hospital,
            "appointment_date": resolved_date,
            "time_slot": resolved_slot,
            "fee": 0.0,
            "requires_payment": False
        }
    }


# Function definitions for Qwen / OpenAI tool calling
TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "get_current_date_time",
            "description": "Get current real-time clock and calendar details in Vaxora: today's date, day of week, current month, year, time, and 14-day upcoming calendar reference. Use this to check today's date before performing date calculations or schedule queries.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_available_vaccines_and_hospitals",
            "description": "Get all vaccines, hospital locations, stock levels, and pricing details in Vaxora.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "autonomous_find_and_propose",
            "description": "AUTONOMOUS GOAL-BASED DELEGATED BOOKING: In ONE shot, autonomously searches hospital schedules, finds the best date and open slot matching the patient's request (e.g. earliest, morning, afternoon, specific date/day), and prepares the official proposal card for patient approval. Use this whenever the user wants to book, schedule, or find an appointment directly.",
            "parameters": {
                "type": "object",
                "properties": {
                    "vaccine_name": {
                        "type": "string",
                        "description": "Name of the vaccine requested (e.g. 'AstraZeneca', 'Test Vaccine', etc.)"
                    },
                    "hospital_name_or_id": {
                        "type": "string",
                        "description": "Optional hospital name or GUID if specified by user (e.g. 'Royal Hospitals'). If omitted, optimal hospital is chosen automatically."
                    },
                    "preferred_date": {
                        "type": "string",
                        "description": "Optional preferred date (e.g. 'YYYY-MM-DD', 'October 16', '16th October', 'Friday', 'next week', 'tomorrow', 'in October', or 'earliest'). The agent resolves this relative to today's date."
                    },
                    "preferred_slot": {
                        "type": "string",
                        "description": "Optional specific slot if requested (e.g. '09:00 AM - 09:20 AM')."
                    },
                    "time_of_day": {
                        "type": "string",
                        "enum": ["morning", "afternoon", "earliest", "any"],
                        "description": "Time preference: 'morning' (<12:00 PM), 'afternoon' (>=12:00 PM), 'earliest' (first available), or 'any'."
                    }
                },
                "required": ["vaccine_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_available_dates",
            "description": "Get available scheduled clinic dates for a specific hospital and vaccine name, with optional month filtering.",
            "parameters": {
                "type": "object",
                "properties": {
                    "hospital_user_id": {
                        "type": "string",
                        "description": "The unique GUID of the hospital user"
                    },
                    "vaccine_name": {
                        "type": "string",
                        "description": "The name of the vaccine (e.g. 'COVID-19 (Pfizer-BioNTech)', 'Influenza')"
                    },
                    "month": {
                        "type": "string",
                        "description": "Optional month name or number (e.g. 'October', '10', 'November') to filter clinic dates."
                    }
                },
                "required": ["hospital_user_id", "vaccine_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_available_slots",
            "description": "Get available 20-minute time slots for a specific date, hospital, and vaccine.",
            "parameters": {
                "type": "object",
                "properties": {
                    "hospital_user_id": {
                        "type": "string",
                        "description": "The unique GUID of the hospital user"
                    },
                    "vaccine_name": {
                        "type": "string",
                        "description": "The name of the vaccine"
                    },
                    "date": {
                        "type": "string",
                        "description": "The appointment date in 'YYYY-MM-DD' format"
                    }
                },
                "required": ["hospital_user_id", "vaccine_name", "date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "propose_booking_for_approval",
            "description": "Propose an appointment booking to the user for explicit approval BEFORE booking. Use this tool when you have chosen hospital, vaccine, date, and slot, so the user sees a review card with a Confirm button.",
            "parameters": {
                "type": "object",
                "properties": {
                    "hospital_user_id": {"type": "string", "description": "Hospital GUID"},
                    "hospital_name": {"type": "string", "description": "Hospital Name"},
                    "vaccine_name": {"type": "string", "description": "Vaccine Name"},
                    "vaccine_id": {"type": "string", "description": "Vaccine GUID if known"},
                    "vaccine_schedule_id": {"type": "string", "description": "Schedule GUID if known"},
                    "appointment_date": {"type": "string", "description": "Date in 'YYYY-MM-DD' format"},
                    "time_slot": {"type": "string", "description": "Time slot like '09:00 AM - 09:20 AM'"},
                    "price": {"type": "number", "description": "Vaccine fee in LKR (0 for free)"},
                    "is_free": {"type": "boolean", "description": "True if free, False if paid"}
                },
                "required": ["hospital_user_id", "hospital_name", "vaccine_name", "appointment_date", "time_slot", "is_free"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "book_appointment",
            "description": "Execute the final booking. Call this ONLY after the user has approved the proposal.",
            "parameters": {
                "type": "object",
                "properties": {
                    "hospital_user_id": {"type": "string", "description": "Hospital GUID"},
                    "vaccine_name": {"type": "string", "description": "Vaccine Name"},
                    "appointment_date": {"type": "string", "description": "Date in 'YYYY-MM-DD' format"},
                    "time_slot": {"type": "string", "description": "Time slot string"},
                    "notes": {"type": "string", "description": "Any special notes"},
                    "payment_method": {"type": "string", "description": "'Free' or 'PayHere'"},
                    "vaccine_id": {"type": "string", "description": "Vaccine GUID"},
                    "vaccine_schedule_id": {"type": "string", "description": "Schedule GUID"}
                },
                "required": ["hospital_user_id", "vaccine_name", "appointment_date", "time_slot"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_appointments",
            "description": "Retrieve the current patient's booked appointments and vaccination history.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "propose_cancellation_for_approval",
            "description": "Prepares an appointment cancellation card for explicit patient approval BEFORE executing cancellation. Call this whenever a patient asks to cancel an appointment.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id": {
                        "type": "string",
                        "description": "The appointment GUID, reference number, vaccine name, date, 'latest', or 'all' to cancel."
                    },
                    "vaccine_name": {
                        "type": "string",
                        "description": "Optional name of the vaccine (e.g. 'AstraZeneca', 'Pfizer')."
                    },
                    "appointment_date": {
                        "type": "string",
                        "description": "Optional appointment date ('YYYY-MM-DD')."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_appointment",
            "description": "Execute the cancellation of an appointment in the database. Call this ONLY after the user has explicitly confirmed/approved the cancellation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id": {
                        "type": "string",
                        "description": "The appointment GUID, reference number, vaccine name, date, 'latest', or 'all' to cancel."
                    }
                },
                "required": []
            }
        }
    }
]
