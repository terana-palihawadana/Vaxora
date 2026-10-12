/** Monday first, matching the roster week. Values are .NET DayOfWeek numbers. */
export const WEEK_DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

export const hhmm = (time) => String(time || '').slice(0, 5);

/** One line describing what a doctor offers a hospital, for cards and roster hints. */
export function describeAvailability(affiliation) {
  if (affiliation?.isPrimary) return 'Primary hospital: any time';
  const windows = affiliation?.availabilityWindows || [];
  if (windows.length === 0) return 'No hours set: any time';
  return WEEK_DAYS.filter((day) => windows.some((w) => w.dayOfWeek === day.value))
    .map((day) => {
      const blocks = windows
        .filter((w) => w.dayOfWeek === day.value)
        .map((w) => `${hhmm(w.startTime)}-${hhmm(w.endTime)}`)
        .join(', ');
      return `${day.label} ${blocks}`;
    })
    .join(' · ');
}

/** Collapses sorted yyyy-MM-dd dates into consecutive { from, to } runs. */
export function groupDateRanges(dates) {
  const ranges = [];
  for (const date of dates) {
    const last = ranges[ranges.length - 1];
    if (last && nextDay(last.to) === date) last.to = date;
    else ranges.push({ from: date, to: date });
  }
  return ranges;
}

function nextDay(date) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * True when the hospital may roster this person for the slot: not on a day off, and
 * inside the weekly hours they offer (the primary hospital and anyone with no hours
 * set are not limited). Mirrors the API rule so unavailable staff are not offered.
 */
export function isOfferedFor(affiliation, date, startTime, endTime) {
  if (!date) return true;
  if ((affiliation?.unavailableDates || []).includes(date)) return false;

  const windows = affiliation?.availabilityWindows || [];
  if (affiliation?.isPrimary || windows.length === 0) return true;
  if (!startTime || !endTime) return true;

  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return windows.some(
    (w) => w.dayOfWeek === weekday && hhmm(w.startTime) <= hhmm(startTime) && hhmm(w.endTime) >= hhmm(endTime),
  );
}
