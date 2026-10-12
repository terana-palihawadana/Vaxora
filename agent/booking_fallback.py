"""
Deterministic handling for the booking agent's everyday requests.

Free-tier models often answer in prose, return their own reasoning, or get rate
limited instead of calling a tool. For the requests patients actually make (book a
vaccine, approve a proposal, list appointments, list vaccines) the agent can work the
request out itself and call the same tools, so the patient still gets a real,
tool-backed answer. The approval gate and validation stay in BookingAgent.
"""
import re
from datetime import date
from typing import Any, Dict, List, Optional

GENERIC_WORDS = {
    "vaccine", "vaccines", "vaccination", "recombinant", "quadrivalent", "bivalent",
    "mrna", "and", "the", "for", "adult", "booster", "dose", "hospital", "hospitals",
    "clinic", "center", "centre", "medical",
}

BOOKING_INTENT_PATTERN = r"\b(book|booking|schedule|reserve|appointment|slot|vaccinated|vaccination)\b"
MY_APPOINTMENTS_PATTERN = r"\bmy\b.*\b(appointments?|bookings?)\b|\b(appointments?|bookings?)\b.*\b(do\s+i\s+have|i\s+have)\b"
LIST_VACCINES_PATTERN = (
    r"\b(what|which)\b.*\bvaccines?\b.*\b(available|have|offer|stock)\b|"
    r"\bavailable\s+vaccines?\b|\b(which|what)\s+hospitals?\b"
)

# "I approve and confirm booking for <vaccine> at <hospital> on <date> at <slot>."
APPROVAL_DETAILS_PATTERN = (
    r"booking\s+for\s+(?P<vaccine>.+?)\s+at\s+(?P<hospital>.+?)\s+on\s+(?P<date>\d{4}-\d{2}-\d{2})"
    r"\s+at\s+(?P<slot>\d{1,2}:\d{2}\s*[AP]M\s*-\s*\d{1,2}:\d{2}\s*[AP]M)"
)

DATE_PHRASE_PATTERN = (
    r"\d{4}-\d{2}-\d{2}|day\s+after\s+tomorrow|tomorrow|tmrw|tmr|today|next\s+week|this\s+week|"
    r"(?:next\s+|this\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
    r"(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?)?"
    r"(?:january|february|march|april|may|june|july|august|september|october|november|december)"
    r"(?:\s+\d{1,2}(?:st|nd|rd|th)?)?"
)

THINKING_PATTERN = r"<think>.*?</think>|^\s*(here'?s\s+a\s+thinking\s+process|thinking\s+process\s*:|let\s+me\s+think)"


def looks_like_reasoning(text: str) -> bool:
    """True when the reply is the model's own reasoning instead of an answer for the patient."""
    return bool(text) and re.search(THINKING_PATTERN, text, re.IGNORECASE | re.DOTALL) is not None


def is_booking_intent(text: str) -> bool:
    return bool(text) and re.search(BOOKING_INTENT_PATTERN, text, re.IGNORECASE) is not None


def is_my_appointments_question(text: str) -> bool:
    return bool(text) and re.search(MY_APPOINTMENTS_PATTERN, text, re.IGNORECASE) is not None


def is_vaccine_list_question(text: str) -> bool:
    return bool(text) and re.search(LIST_VACCINES_PATTERN, text, re.IGNORECASE) is not None


def parse_booking_approval(text: str) -> Optional[Dict[str, str]]:
    """Booking details carried by the approval message the Approve buttons send."""
    match = re.search(APPROVAL_DETAILS_PATTERN, text or "", re.IGNORECASE)
    if not match:
        return None
    return {
        "vaccine_name": match.group("vaccine").strip(),
        "hospital_name": match.group("hospital").strip(),
        "appointment_date": match.group("date"),
        "time_slot": re.sub(r"\s+", " ", match.group("slot")).strip().upper(),
    }


def _words(name: str) -> List[str]:
    return [w for w in re.split(r"[^a-z0-9]+", (name or "").lower()) if len(w) >= 3 and w not in GENERIC_WORDS]


def _best_name(text: str, names: List[str], need_all_words: bool) -> Optional[str]:
    """The catalogue name the text refers to, by whole-word overlap. Longest match wins."""
    text_lower = (text or "").lower()
    text_words = set(re.split(r"[^a-z0-9]+", text_lower))
    best, best_score = None, 0
    for name in names:
        words = _words(name)
        if not words:
            continue
        if name.lower() in text_lower:
            score = 100 + len(words)
        else:
            shared = [w for w in words if w in text_words]
            if not shared or (need_all_words and len(shared) < len(words)):
                continue
            score = len(shared)
        if score > best_score:
            best, best_score = name, score
    return best


def find_vaccine(user_messages: List[str], vaccine_names: List[str]) -> Optional[str]:
    """The vaccine the patient means: their latest message first, then earlier ones."""
    for text in reversed(user_messages):
        found = _best_name(text, vaccine_names, need_all_words=False)
        if found:
            return found
    return None


def find_hospital(text: str, hospital_names: List[str]) -> Optional[str]:
    """A hospital the patient named. Every distinctive word of its name must be present."""
    return _best_name(text, hospital_names, need_all_words=True)


def find_date_phrase(text: str) -> str:
    match = re.search(DATE_PHRASE_PATTERN, text or "", re.IGNORECASE)
    if not match:
        return "earliest"
    phrase = match.group(0).lower()
    return "tomorrow" if phrase in ("tmr", "tmrw") else phrase


def find_time_of_day(text: str) -> str:
    lower = (text or "").lower()
    if "morning" in lower:
        return "morning"
    if "afternoon" in lower or "evening" in lower:
        return "afternoon"
    return "earliest"


def _friendly_date(iso: str) -> str:
    try:
        return date.fromisoformat(str(iso)[:10]).strftime("%A, %B %d, %Y").replace(" 0", " ")
    except ValueError:
        return str(iso)


def _fee(amount: float) -> str:
    return f"LKR {amount:,.2f}" if amount > 0 else "Free"


def proposal_message(proposal: Dict[str, Any]) -> str:
    price = float(proposal.get("price") or 0.0)
    payment = "" if price <= 0 else " You can pay online now, or choose to pay at the hospital on the day."
    return (
        f"I found an open slot: **{proposal.get('vaccine_name')}** at **{proposal.get('hospital_name')}** "
        f"on **{_friendly_date(proposal.get('appointment_date'))}** at **{proposal.get('time_slot')}** "
        f"(Fee: **{_fee(price)}**).\n\n"
        f"Please review the card below and approve it to book.{payment}"
    )


def booking_message(result: Dict[str, Any], details: Dict[str, str]) -> str:
    where = (
        f"**{details.get('vaccine_name')}** at **{details.get('hospital_name')}** "
        f"on **{_friendly_date(details.get('appointment_date'))}** at **{details.get('time_slot')}**"
    )
    fee = float(result.get("fee") or 0.0)
    if result.get("is_free"):
        return f"Your appointment is confirmed: {where}. The booking details were sent to your email."
    if result.get("pay_at_desk"):
        return f"Your slot is reserved: {where}. Please pay **{_fee(fee)}** at the hospital desk on the day."
    return f"Your slot is reserved: {where}. Complete the payment of **{_fee(fee)}** in the PayHere window to confirm it."


def appointments_message(appointments: List[Dict[str, Any]]) -> str:
    active = [
        a for a in appointments
        if str(a.get("status") or "").lower() not in ("cancelled", "rejected", "completed")
    ]
    if not active:
        return "You have no upcoming appointments. Tell me which vaccine you need and I will find a slot."
    lines = ["Here are your upcoming appointments:", ""]
    for a in sorted(active, key=lambda x: (str(x.get("appointmentDate")), str(x.get("startTime") or ""))):
        status = "Awaiting payment" if str(a.get("status")) == "PendingPayment" else a.get("status")
        lines.append(
            f"- **{a.get('vaccineName')}** at {a.get('hospitalName')} on "
            f"{_friendly_date(a.get('appointmentDate'))}, {a.get('timeSlot')} ({status})"
        )
    return "\n".join(lines)


def vaccines_message(vaccines: List[Dict[str, Any]], sessions: List[Dict[str, Any]], asked_for: Optional[str]) -> str:
    """Vaccines with a clinic session to book, and the hospitals running them."""
    by_vaccine: Dict[str, Dict[str, float]] = {}
    for s in sessions:
        name, hospital = s.get("vaccineName"), s.get("hospitalName")
        if name and hospital:
            by_vaccine.setdefault(name, {})[hospital] = float(s.get("price") or 0.0)
    if asked_for:
        by_vaccine = {k: v for k, v in by_vaccine.items() if k == asked_for}
        if not by_vaccine:
            in_stock = any(v.get("name") == asked_for and v.get("hospitals") for v in vaccines)
            note = " It is in stock, but no clinic session is open for booking yet." if in_stock else ""
            return f"No hospital has a clinic session for **{asked_for}** right now.{note}"
    if not by_vaccine:
        return "No clinic sessions are open for booking right now."
    lines = ["These vaccines have clinic sessions you can book:", ""]
    for name in sorted(by_vaccine):
        places = ", ".join(f"{h} ({_fee(p)})" for h, p in sorted(by_vaccine[name].items()))
        lines.append(f"- **{name}**: {places}")
    lines += ["", "Tell me which one you want and I will find the next open slot."]
    return "\n".join(lines)
