/** Same zone as StaffDutyHelper (Asia/Colombo). */
const HOSPITAL_TIME_ZONE = 'Asia/Colombo';

/** Hospital-local calendar date (yyyy-MM-dd), matching patient booking. */
export function hospitalToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: HOSPITAL_TIME_ZONE });
}

export function hospitalMinutesNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HOSPITAL_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

/** Normalize API/date values to yyyy-MM-dd for reliable queue filtering. */
export function toHospitalDateKey(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-CA', { timeZone: HOSPITAL_TIME_ZONE });
}

export function addHospitalDays(dateInput, days) {
  const [year, month, day] = String(dateInput).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}
