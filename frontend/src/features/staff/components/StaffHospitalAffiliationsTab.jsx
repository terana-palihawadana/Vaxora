import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import staffService from '../../hospital/services/staffService';
import { addHospitalDays, hospitalToday } from '../../hospital/utils/hospitalDate';
import { IconCalendar, IconHospital, IconRepeat } from '../../../shared/icons/AppIcons';
import PortalHero from '../../../components/PortalHero';

function toDateInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeek(dateInput) {
  const date = new Date(`${dateInput}T00:00:00`);
  const day = date.getDay(); // 0 Sun ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  date.setDate(date.getDate() + diff);
  return toDateInputValue(date);
}

function formatDayHeader(dateInput) {
  const date = new Date(`${dateInput}T00:00:00`);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    dateLabel: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  };
}

function formatShiftTime(shift) {
  return `${String(shift.startTime).slice(0, 5)} – ${String(shift.endTime).slice(0, 5)}`;
}

function formatWeekRangeLabel(weekStart, weekEnd) {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(`${weekEnd}T00:00:00`);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
}

function formatCoverWhen(request) {
  const date = request.shiftDate
    ? new Date(`${String(request.shiftDate).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : '—';
  return `${date}${request.shiftWindow ? ` · ${request.shiftWindow}` : ''}`;
}

function coverStatusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved' || s === 'covering') return 'is-approved';
  if (s === 'declined') return 'is-declined';
  if (s === 'cancelled') return 'is-cancelled';
  if (s === 'requested' || s === 'pending') return 'is-pending';
  return 'is-pending';
}

function coverActivityTone(status) {
  return coverStatusTone(status);
}

function formatShiftDate(dateInput) {
  const day = String(dateInput || '').slice(0, 10);
  if (!day) return '';
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * How a shift card looks and whether cover can be asked for.
 * Colours follow the app's meaning: blue = scheduled, green = live or resolved,
 * amber = waiting on the hospital, grey = past.
 */
function shiftCardState(shift, today) {
  const cover = String(shift.coverStatus || '').trim().toLowerCase();
  const finished = isShiftFinished(shift, today);
  const started = isShiftStarted(shift, today);
  const canRequest = !started && (!cover || cover === 'declined' || cover === 'requested');

  if (finished) return { tone: 'is-finished', chip: { tone: 'is-grey', label: 'Finished' }, canRequest: false };
  if (cover === 'covering') return { tone: 'is-upcoming', chip: { tone: 'is-blue', label: 'Covering' }, canRequest: false };
  if (cover === 'approved') return { tone: 'is-finished', chip: { tone: 'is-green', label: 'Covered' }, canRequest: false };
  if (started) return { tone: 'is-live', chip: { tone: 'is-green', label: 'On now' }, canRequest: false };
  if (cover === 'requested' || cover === 'pending') {
    return { tone: 'is-requested', chip: { tone: 'is-amber', label: 'Cover requested' }, canRequest, action: 'Edit request' };
  }
  if (cover === 'declined') {
    return { tone: 'is-upcoming', chip: { tone: 'is-red', label: 'Cover declined' }, canRequest, action: 'Ask again' };
  }
  return { tone: 'is-upcoming', chip: null, canRequest, action: 'Request cover' };
}

function shiftCardTitle(state) {
  if (state.canRequest) return `${state.action} for this shift`;
  if (state.chip?.label === 'Finished') return 'This shift has finished';
  if (state.chip?.label === 'On now') return 'Shift in progress. For cover, tell the hospital desk directly.';
  if (state.chip?.label === 'Covering') return 'You are covering this shift for a colleague';
  if (state.chip?.label === 'Covered') return 'A colleague is covering this shift';
  return undefined;
}

const COVER_STATUS_TONE = {
  'is-pending': 'is-amber',
  'is-approved': 'is-green',
  'is-declined': 'is-red',
  'is-cancelled': 'is-grey',
};

const COVER_RANGES = [
  { key: 'recent', label: '30 days', title: 'Past 30 days and upcoming' },
  { key: 'upcoming', label: 'Upcoming', title: 'From today on' },
  { key: 'all', label: 'All', title: 'Every cover request' },
];

const COVER_STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
  { key: 'cancelled', label: 'Cancelled' },
];

const COVER_LANE_LIMIT = 4;

function coverDay(request) {
  return String(request?.shiftDate || '').slice(0, 10);
}

function coverStatusKey(status, fallback = 'pending') {
  const s = String(status || fallback).toLowerCase();
  if (s === 'covering') return 'approved';
  if (s === 'requested') return 'pending';
  return s;
}

/** Upcoming covers soonest first, then past covers most recent first. */
function sortCovers(rows, today) {
  const upcoming = rows.filter((r) => coverDay(r) >= today).sort((a, b) => coverDay(a).localeCompare(coverDay(b)));
  const past = rows.filter((r) => coverDay(r) < today).sort((a, b) => coverDay(b).localeCompare(coverDay(a)));
  return [...upcoming, ...past];
}

function coverDateParts(request) {
  const day = coverDay(request);
  if (!day) return null;
  const date = new Date(`${day}T00:00:00`);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    day: date.getDate(),
    month: date.toLocaleDateString(undefined, { month: 'short' }),
  };
}

function isShiftFinished(shift, today) {
  const day = String(shift?.shiftDate || '').slice(0, 10);
  if (!day) return true;
  if (day < today) return true;
  if (day > today) return false;
  const end = String(shift?.endTime || '23:59').slice(0, 5);
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}` >= end;
}

/** Cover can only be requested before the shift starts (hospital-local time). */
function isShiftStarted(shift, today) {
  const day = String(shift?.shiftDate || '').slice(0, 10);
  if (!day) return true;
  if (day < today) return true;
  if (day > today) return false;
  const start = String(shift?.startTime || '00:00').slice(0, 5);
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}` >= start;
}

function localQuotaFallback(shift, today) {
  const day = String(shift?.shiftDate || '').slice(0, 10);
  const started = isShiftStarted(shift, today);
  if (started) {
    return {
      usedThisMonth: 0,
      monthlyLimit: 3,
      urgentUsedThisMonth: 0,
      urgentLimit: 1,
      minNoticeDays: 2,
      canRequest: false,
      reasonRequired: false,
      alreadyPending: false,
      isUrgent: false,
      blockReason: 'This shift has already started. Tell the hospital desk directly.',
      summary: 'This shift has already finished.',
    };
  }
  const shiftDate = new Date(`${day}T00:00:00`);
  const todayDate = new Date(`${today}T00:00:00`);
  const daysUntil = Math.round((shiftDate - todayDate) / 86400000);
  const isUrgent = daysUntil < 2;
  return {
    usedThisMonth: 0,
    monthlyLimit: 3,
    urgentUsedThisMonth: 0,
    urgentLimit: 1,
    minNoticeDays: 2,
    daysUntilShift: daysUntil,
    canRequest: true,
    reasonRequired: isUrgent,
    alreadyPending: false,
    isUrgent,
    summary: isUrgent
      ? `Short notice (${daysUntil} day${daysUntil === 1 ? '' : 's'} left). Add a reason.`
      : 'Cover limits could not be checked right now. You can still send the request.',
  };
}

function HospitalAvatar({ logoUrl }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className="staff-affil-hospital-avatar" />;
  }
  return (
    <div className="staff-affil-hospital-avatar staff-affil-hospital-avatar--fallback" aria-hidden>
      <IconHospital size={18} />
    </div>
  );
}

/**
 * Shared doctor/nurse data for hospital invitations, active affiliations,
 * week shifts, and cover requests (parity with mobile staff cover flow).
 * view="shifts": My shifts page (week calendar and cover activity).
 * view="hospitals": Hospitals page (active affiliations and invitations).
 */
export default function StaffHospitalAffiliationsTab({ roleLabel = 'Staff', view = 'shifts' }) {
  const isShiftsView = view === 'shifts';
  const today = useMemo(() => hospitalToday(), []);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(hospitalToday()));
  const [invitations, setInvitations] = useState([]);
  const [affiliations, setAffiliations] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [coverRequests, setCoverRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [actionId, setActionId] = useState(null);
  const [coverShift, setCoverShift] = useState(null);
  const [coverReason, setCoverReason] = useState('');
  const [coverQuota, setCoverQuota] = useState(null);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverSubmitting, setCoverSubmitting] = useState(false);
  const [coverError, setCoverError] = useState('');
  const [coverRange, setCoverRange] = useState('recent');
  const [coverStatusFilter, setCoverStatusFilter] = useState('all');
  const [coverHospital, setCoverHospital] = useState('all');
  const [expandedLanes, setExpandedLanes] = useState({});
  const toastTimerRef = useRef(null);

  const weekEnd = useMemo(() => addHospitalDays(weekStart, 6), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addHospitalDays(weekStart, i)),
    [weekStart]
  );

  const hospitalNameByAffiliation = useMemo(() => {
    const map = {};
    affiliations.forEach((a) => {
      map[a.affiliationId] = a.hospitalName || 'Hospital';
    });
    return map;
  }, [affiliations]);

  const shiftsByDay = useMemo(() => {
    const map = {};
    weekDays.forEach((day) => {
      map[day] = [];
    });
    shifts.forEach((shift) => {
      const day = String(shift.shiftDate || '').slice(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(shift);
    });
    Object.keys(map).forEach((day) => {
      map[day].sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
    });
    return map;
  }, [shifts, weekDays]);

  const outgoingCovers = useMemo(
    () => coverRequests.filter((r) => String(r.direction || '').toLowerCase() !== 'incoming'),
    [coverRequests]
  );
  const incomingCovers = useMemo(
    () => coverRequests.filter((r) => String(r.direction || '').toLowerCase() === 'incoming'),
    [coverRequests]
  );
  const pendingOutgoing = outgoingCovers.filter(
    (r) => String(r.status || '').toLowerCase() === 'pending'
  ).length;

  const coverHospitals = useMemo(
    () => [...new Set(coverRequests.map((r) => r.hospitalName).filter(Boolean))].sort(),
    [coverRequests]
  );

  // Range and hospital narrow the set; status counts are taken from what is left.
  const coverInScope = useCallback(
    (req) => {
      const day = coverDay(req);
      if (coverRange === 'upcoming' && !(day && day >= today)) return false;
      if (coverRange === 'recent' && day && day < addHospitalDays(today, -30)) return false;
      if (coverHospital !== 'all' && req.hospitalName !== coverHospital) return false;
      return true;
    },
    [coverRange, coverHospital, today]
  );

  const coverStatusCounts = useMemo(() => {
    const counts = { all: 0 };
    coverRequests.filter(coverInScope).forEach((req) => {
      const fallback = String(req.direction || '').toLowerCase() === 'incoming' ? 'approved' : 'pending';
      const key = coverStatusKey(req.status, fallback);
      counts.all += 1;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [coverRequests, coverInScope]);

  const filterCoverLane = (rows, fallback) =>
    sortCovers(
      rows.filter(
        (req) =>
          coverInScope(req) &&
          (coverStatusFilter === 'all' || coverStatusKey(req.status, fallback) === coverStatusFilter)
      ),
      today
    );

  const showToast = (message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pending, active, myShifts, myCovers] = await Promise.all([
        staffService.getMyInvitations(),
        staffService.getMyAffiliations(),
        staffService.getMyShifts({ from: weekStart, to: weekEnd }),
        staffService.getMyShiftSwaps(40).catch(() => []),
      ]);
      setInvitations(Array.isArray(pending) ? pending : []);
      setAffiliations(Array.isArray(active) ? active : []);
      setShifts(Array.isArray(myShifts) ? myShifts : []);
      setCoverRequests(Array.isArray(myCovers) ? myCovers : []);
    } catch (err) {
      setError(err.message || 'Failed to load hospital affiliations.');
      setInvitations([]);
      setAffiliations([]);
      setShifts([]);
      setCoverRequests([]);
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => deferEffectCallback(() => {
    loadData();
  }), [loadData]);

  const handleRespond = async (affiliationId, decision) => {
    setActionId(`${affiliationId}-${decision}`);
    try {
      await staffService.respondToInvitation(affiliationId, decision);
      showToast(decision === 'Accept' ? 'Invitation accepted.' : 'Invitation rejected.');
      await loadData();
    } catch (err) {
      setError(err.message || `Failed to ${decision.toLowerCase()} invitation.`);
    } finally {
      setActionId(null);
    }
  };

  const openCoverModal = async (shift) => {
    if (isShiftStarted(shift, today)) {
      showToast('This shift has already started. Tell the hospital desk directly.');
      return;
    }
    setCoverShift(shift);
    setCoverReason('');
    setCoverError('');
    setCoverQuota(null);
    setCoverLoading(true);
    try {
      const quota = await staffService.getCoverQuota(shift.shiftId);
      setCoverQuota(quota || localQuotaFallback(shift, today));
      setCoverError('');
    } catch {
      // Local estimate keeps the form usable; hide the raw API failure.
      setCoverQuota(localQuotaFallback(shift, today));
      setCoverError('');
    } finally {
      setCoverLoading(false);
    }
  };

  const closeCoverModal = () => {
    if (coverSubmitting) return;
    setCoverShift(null);
    setCoverReason('');
    setCoverQuota(null);
    setCoverError('');
  };

  const submitCoverRequest = async () => {
    if (!coverShift?.shiftId || coverSubmitting) return;
    if (coverQuota?.reasonRequired && !coverReason.trim()) {
      setCoverError('A reason is required for short-notice cover.');
      return;
    }
    if (coverQuota && !coverQuota.alreadyPending && coverQuota.canRequest === false) {
      setCoverError(coverQuota.blockReason || 'Cover cannot be requested for this shift.');
      return;
    }

    setCoverSubmitting(true);
    setCoverError('');
    try {
      await staffService.requestShiftCover({
        shiftId: coverShift.shiftId,
        reason: coverReason.trim() || undefined,
      });
      showToast(
        coverQuota?.alreadyPending
          ? 'Cover request updated.'
          : 'Cover request sent to the hospital.'
      );
      setCoverShift(null);
      setCoverReason('');
      setCoverQuota(null);
      await loadData();
    } catch (err) {
      setCoverError(err.message || 'Could not send cover request.');
    } finally {
      setCoverSubmitting(false);
    }
  };

  const canSubmitCover =
    !coverLoading &&
    !coverSubmitting &&
    (!coverQuota || coverQuota.alreadyPending || coverQuota.canRequest !== false) &&
    (!(coverQuota?.reasonRequired) || coverReason.trim().length > 0);

  return (
    <div className="doctor-dashboard-tab">
      {toast && (
        <div className="doctor-toast" role="status">
          {toast}
        </div>
      )}

      {error && (
        <div className="doctor-toast" role="alert" style={{ background: 'var(--color-error-bg)', color: 'var(--color-error)' }}>
          {error}
          <button
            type="button"
            onClick={() => setError('')}
            style={{ marginLeft: 12, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-error)' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {isShiftsView ? (
        <>
          <PortalHero
            eyebrow="Roster & cover"
            title="My shifts"
            subtitle="Your week on the roster. Ask for cover on an upcoming shift, and follow covers you sent or took on."
          />

          <div className="hospital-metrics-grid hospital-metrics-grid--3" aria-label="Shift summary" style={{ marginBottom: '24px' }}>
            <div className="hospital-stat-card">
              <div className="hospital-stat-icon stat-icon-blue">
                <IconCalendar size={22} />
              </div>
              <div className="hospital-stat-info">
                <span className="hospital-stat-label">Shifts this week</span>
                <span className="hospital-stat-value">{loading ? '—' : shifts.length}</span>
                <span className="hospital-stat-meta">On your roster</span>
              </div>
            </div>

            <div className="hospital-stat-card">
              <div className="hospital-stat-icon stat-icon-amber">
                <IconRepeat size={22} />
              </div>
              <div className="hospital-stat-info">
                <span className="hospital-stat-label">Cover pending</span>
                <span className="hospital-stat-value">{loading ? '—' : pendingOutgoing}</span>
                <span className="hospital-stat-meta">Requests you sent</span>
              </div>
            </div>

            <div className="hospital-stat-card">
              <div className="hospital-stat-icon stat-icon-green">
                <IconHospital size={22} />
              </div>
              <div className="hospital-stat-info">
                <span className="hospital-stat-label">Covering for others</span>
                <span className="hospital-stat-value">{loading ? '—' : incomingCovers.length}</span>
                <span className="hospital-stat-meta">Shifts handed to you</span>
              </div>
            </div>
          </div>

          <div className="doctor-card" style={{ padding: '24px', marginBottom: '24px' }}>
            <div className="staff-shift-week-header">
              <div>
                <h2 className="doctor-card-title" style={{ margin: 0 }}>
                  Week of {formatWeekRangeLabel(weekStart, weekEnd)}
                </h2>
                <p className="staff-cover-hint">
                  Tap an upcoming shift to ask for cover. Up to 3 covers a month, 1 at short notice (under 2 days).
                </p>
              </div>
              <div className="staff-shift-week-nav">
                <button
                  type="button"
                  className="staff-shift-week-nav-btn"
                  onClick={() => setWeekStart((prev) => addHospitalDays(prev, -7))}
                  aria-label="Previous week"
                >
                  ‹ Prev
                </button>
                <button
                  type="button"
                  className="staff-shift-week-nav-btn"
                  onClick={() => setWeekStart(startOfWeek(today))}
                  disabled={weekStart === startOfWeek(today)}
                >
                  This week
                </button>
                <button
                  type="button"
                  className="staff-shift-week-nav-btn"
                  onClick={() => setWeekStart((prev) => addHospitalDays(prev, 7))}
                  aria-label="Next week"
                >
                  Next ›
                </button>
              </div>
            </div>

            {loading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>Loading shifts...</p>
            ) : (
              <div className={`staff-shift-week-calendar is-${String(roleLabel).toLowerCase()}`}>
                <div className="staff-shift-week-calendar-scroll">
                  <div className="staff-shift-week-calendar-grid">
                    {weekDays.map((day) => {
                      const header = formatDayHeader(day);
                      const isToday = day === today;
                      return (
                        <div
                          key={`head-${day}`}
                          className={`staff-shift-week-day-head${isToday ? ' is-today' : ''}`}
                        >
                          <div className="staff-shift-week-day-top">
                            <span className="staff-shift-week-weekday">{header.weekday}</span>
                            {isToday ? <span className="staff-shift-week-today-pill">Today</span> : null}
                          </div>
                          <span className="staff-shift-week-date">{header.dateLabel}</span>
                        </div>
                      );
                    })}

                    {weekDays.map((day) => {
                      const dayShifts = shiftsByDay[day] || [];
                      const isToday = day === today;
                      return (
                        <div
                          key={`cell-${day}`}
                          className={`staff-shift-week-cell${isToday ? ' is-today' : ''}`}
                        >
                          {dayShifts.length === 0 ? (
                            <span className="shift-week-calendar-empty" aria-label="No shift" />
                          ) : (
                            dayShifts.map((shift) => {
                              const state = shiftCardState(shift, today);
                              const booth = shift.boothOrStation || 'Unassigned booth';
                              return (
                                <button
                                  type="button"
                                  key={shift.shiftId}
                                  className={`staff-shift-card ${state.tone}${state.canRequest ? ' is-actionable' : ''}`}
                                  onClick={() => state.canRequest && openCoverModal(shift)}
                                  disabled={!state.canRequest}
                                  title={shiftCardTitle(state)}
                                >
                                  <span className="staff-shift-card-time">{formatShiftTime(shift)}</span>
                                  <span className="staff-shift-card-booth" title={booth}>{booth}</span>
                                  {shift.notes ? (
                                    <span className="staff-shift-card-line" title={shift.notes}>{shift.notes}</span>
                                  ) : null}
                                  <span className="staff-shift-card-line">
                                    {hospitalNameByAffiliation[shift.affiliationId] || 'Hospital'}
                                  </span>
                                  {state.chip ? (
                                    <span className={`staff-shift-chip ${state.chip.tone}`}>{state.chip.label}</span>
                                  ) : null}
                                  {state.canRequest ? (
                                    <span className="staff-shift-card-action">
                                      <IconRepeat size={13} aria-hidden="true" /> {state.action}
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="doctor-card staff-cover-activity">
            <div className="staff-cover-activity-header">
              <h2 className="doctor-card-title" style={{ margin: 0 }}>
                Cover requests
              </h2>
              <p className="staff-cover-hint" style={{ margin: '4px 0 0' }}>
                Covers you asked for, and shifts you are covering for colleagues.
              </p>
            </div>

            <div className="staff-cover-toolbar" aria-label="Filter cover requests">
              <div className="staff-cover-seg" role="group" aria-label="Date range">
                {COVER_RANGES.map((opt) => (
                  <button
                    type="button"
                    key={opt.key}
                    title={opt.title}
                    className={`staff-cover-seg-btn${coverRange === opt.key ? ' is-active' : ''}`}
                    aria-pressed={coverRange === opt.key}
                    onClick={() => setCoverRange(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="staff-cover-seg" role="group" aria-label="Status">
                {COVER_STATUSES.map((opt) => (
                  <button
                    type="button"
                    key={opt.key}
                    className={`staff-cover-seg-btn${coverStatusFilter === opt.key ? ' is-active' : ''}`}
                    aria-pressed={coverStatusFilter === opt.key}
                    onClick={() => setCoverStatusFilter(opt.key)}
                  >
                    {opt.label}
                    <span className="staff-cover-seg-count">{coverStatusCounts[opt.key] || 0}</span>
                  </button>
                ))}
              </div>

              {coverHospitals.length > 1 ? (
                <select
                  className="staff-cover-select"
                  aria-label="Hospital"
                  value={coverHospital}
                  onChange={(e) => setCoverHospital(e.target.value)}
                >
                  <option value="all">All hospitals</option>
                  {coverHospitals.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : null}
            </div>

            {loading ? (
              <p className="staff-cover-quiet">Loading cover requests...</p>
            ) : (
              <div className="staff-cover-board">
                {[
                  {
                    key: 'out',
                    title: 'You asked for cover',
                    icon: <IconRepeat size={16} aria-hidden="true" />,
                    rows: outgoingCovers,
                    empty: 'You have not asked for cover yet.',
                    fallbackStatus: 'Pending',
                    note: (req) =>
                      req.replacementName
                        ? `Covered by ${req.replacementName}`
                        : String(req.status || '').toLowerCase() === 'cancelled' && req.decisionNote
                          ? req.decisionNote
                          : req.reason || '',
                  },
                  {
                    key: 'in',
                    title: "You're covering",
                    icon: <IconHospital size={16} aria-hidden="true" />,
                    rows: incomingCovers,
                    empty: 'No shifts handed to you.',
                    fallbackStatus: 'Approved',
                    note: (req) => `For ${req.requesterName || 'a colleague'}`,
                  },
                ].map((lane) => {
                  const rows = filterCoverLane(lane.rows, lane.fallbackStatus);
                  const expanded = Boolean(expandedLanes[lane.key]);
                  const visible = expanded ? rows : rows.slice(0, COVER_LANE_LIMIT);
                  const hidden = rows.length - visible.length;
                  return (
                    <section key={lane.key} className={`staff-cover-lane is-${lane.key}`}>
                      <header className="staff-cover-lane-head">
                        <h3 className="staff-cover-lane-title">
                          <span className="staff-cover-lane-icon">{lane.icon}</span>
                          {lane.title}
                        </h3>
                        <span className="staff-cover-lane-count" title={`${rows.length} of ${lane.rows.length} shown by filters`}>
                          {rows.length}
                        </span>
                      </header>

                      {rows.length === 0 ? (
                        <p className="staff-cover-quiet">
                          {lane.rows.length === 0 ? lane.empty : 'Nothing matches these filters.'}
                        </p>
                      ) : (
                        <ul className="staff-cover-list">
                          {visible.map((req, index) => {
                            const status = req.status || lane.fallbackStatus;
                            const note = lane.note(req);
                            const parts = coverDateParts(req);
                            const isPast = coverDay(req) < today;
                            const startsPast = isPast && index > 0 && coverDay(visible[index - 1]) >= today;
                            return (
                              <li key={req.id} className="staff-cover-row" aria-label={`${formatCoverWhen(req)}, ${status}`}>
                                {startsPast ? <span className="staff-cover-divider">Earlier</span> : null}
                                <div className={`staff-cover-item${isPast ? ' is-past' : ''}`}>
                                  <div className="staff-cover-date" aria-hidden="true">
                                    {parts ? (
                                      <>
                                        <span className="staff-cover-date-wd">{parts.weekday}</span>
                                        <span className="staff-cover-date-day">{parts.day}</span>
                                        <span className="staff-cover-date-mon">{parts.month}</span>
                                      </>
                                    ) : (
                                      <span className="staff-cover-date-day">-</span>
                                    )}
                                  </div>
                                  <div className="staff-cover-item-main">
                                    <span className="staff-cover-item-when">
                                      {req.shiftWindow || 'Time not set'}
                                    </span>
                                    <span className="staff-cover-item-where">
                                      {[req.hospitalName || 'Hospital', req.boothOrStation].filter(Boolean).join(' · ')}
                                    </span>
                                    {note ? <span className="staff-cover-item-note">{note}</span> : null}
                                  </div>
                                  <span className={`staff-shift-chip ${COVER_STATUS_TONE[coverActivityTone(status)] || 'is-amber'}`}>
                                    {status}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {rows.length > COVER_LANE_LIMIT ? (
                        <button
                          type="button"
                          className="staff-cover-more"
                          onClick={() => setExpandedLanes((prev) => ({ ...prev, [lane.key]: !expanded }))}
                        >
                          {expanded ? 'Show less' : `Show ${hidden} more`}
                        </button>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <PortalHero
            eyebrow="Affiliations"
            title="Hospitals"
            subtitle={`Hospitals you work at, and invitations to join a roster as a ${roleLabel.toLowerCase()}.`}
          />

          <div className="doctor-card" style={{ padding: '24px', marginBottom: '24px' }}>
            <h2 className="doctor-card-title" style={{ marginTop: 0, marginBottom: 18 }}>
              Pending Invitations ({invitations.length})
            </h2>

            {loading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>Loading invitations...</p>
            ) : invitations.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>No pending hospital invitations.</p>
            ) : (
              <div style={{ display: 'grid', gap: '14px' }}>
                {invitations.map((item) => (
                  <div key={item.affiliationId} className="staff-affil-item-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                      <HospitalAvatar logoUrl={item.hospitalLogoUrl} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--color-text-title)', lineHeight: 1.4 }}>
                          {item.hospitalName || 'Hospital invitation'}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 8 }}>
                          Invited: {item.invitedAt ? new Date(item.invitedAt).toLocaleString() : '—'}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="staff-affil-reject-btn"
                        disabled={actionId != null && String(actionId).startsWith(item.affiliationId)}
                        onClick={() => handleRespond(item.affiliationId, 'Reject')}
                      >
                        {actionId === `${item.affiliationId}-Reject` ? 'Rejecting...' : 'Reject'}
                      </button>
                      <button
                        type="button"
                        className="staff-affil-accept-btn"
                        disabled={actionId != null && String(actionId).startsWith(item.affiliationId)}
                        onClick={() => handleRespond(item.affiliationId, 'Accept')}
                      >
                        {actionId === `${item.affiliationId}-Accept` ? 'Accepting...' : 'Accept'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="doctor-card" style={{ padding: '24px', marginBottom: '24px' }}>
            <h2 className="doctor-card-title" style={{ marginTop: 0, marginBottom: 18 }}>
              Active Affiliations ({affiliations.length})
            </h2>

            {loading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>Loading affiliations...</p>
            ) : affiliations.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)' }}>
                You are not affiliated with any hospital yet. Accept an invitation to join a roster.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '14px' }}>
                {affiliations.map((item) => (
                  <div key={item.affiliationId} className="staff-affil-item-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                      <HospitalAvatar logoUrl={item.hospitalLogoUrl} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--color-text-title)', lineHeight: 1.4 }}>
                          {item.hospitalName || 'Hospital'}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 8 }}>
                          Joined: {item.respondedAt ? new Date(item.respondedAt).toLocaleDateString() : '—'}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`staff-affil-presence${item.isOnDutyNow ? ' is-live' : ''}`}
                      title={
                        item.isOnDutyNow
                          ? 'You can do clinical work at this hospital now'
                          : 'Clock in from your dashboard, or wait for your rostered shift'
                      }
                    >
                      {item.isOnDutyNow ? 'On duty now' : 'Not on duty'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {coverShift && (
        <div className="doctor-modal-overlay" onClick={closeCoverModal}>
          <div className="doctor-modal-card staff-cover-modal" onClick={(e) => e.stopPropagation()}>
            <div className="doctor-modal-header">
              <div>
                <h3 className="doctor-modal-title">Request cover</h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)' }}>
                  The hospital assigns a replacement for you.
                </p>
              </div>
              <button
                type="button"
                className="doctor-modal-close-btn"
                onClick={closeCoverModal}
                disabled={coverSubmitting}
              >
                &times;
              </button>
            </div>

            <div className="doctor-modal-body">
              <div className="staff-cover-modal-shift">
                <strong>
                  {hospitalNameByAffiliation[coverShift.affiliationId] || 'Hospital'}
                </strong>
                <div>
                  {formatShiftDate(coverShift.shiftDate)} · {formatShiftTime(coverShift)}
                </div>
                <div>{coverShift.boothOrStation || 'Unassigned booth'}</div>
              </div>

              {coverLoading ? (
                <p className="staff-cover-loading">Checking cover limits…</p>
              ) : coverQuota?.canRequest === false ? (
                <p className="staff-cover-blocked" role="alert">
                  {coverQuota.blockReason || coverQuota.summary || 'Cover cannot be requested for this shift.'}
                </p>
              ) : coverQuota ? (
                <p className="staff-cover-quota">
                  {Number.isFinite(coverQuota.usedThisMonth) && Number.isFinite(coverQuota.monthlyLimit)
                    ? `${coverQuota.usedThisMonth} of ${coverQuota.monthlyLimit} covers used this month.`
                    : null}
                  {coverQuota.isUrgent ? ' Short notice, so a reason is required.' : ''}
                </p>
              ) : null}

              <div className="doctor-form-group">
                <label className="doctor-form-label" htmlFor="staff-cover-reason">
                  Reason {coverQuota?.reasonRequired ? '(required)' : '(optional)'}
                </label>
                <textarea
                  id="staff-cover-reason"
                  className="doctor-form-textarea"
                  rows={3}
                  value={coverReason}
                  onChange={(e) => setCoverReason(e.target.value)}
                  placeholder={
                    coverQuota?.reasonRequired
                      ? 'Short notice: explain why you need cover'
                      : 'Why do you need cover for this shift?'
                  }
                  disabled={coverSubmitting || coverQuota?.canRequest === false}
                />
                {coverQuota?.alreadyPending && coverQuota?.canRequest !== false ? (
                  <p className="staff-cover-hint-inline">
                    You already have a pending request. Sending again updates the reason.
                  </p>
                ) : null}
              </div>

              {coverError ? (
                <p role="alert" style={{ color: 'var(--color-error)', fontWeight: 600, margin: '0 0 8px' }}>
                  {coverError}
                </p>
              ) : null}
            </div>

            <div className="doctor-modal-footer">
              <button
                type="button"
                className="doctor-btn-cancel"
                onClick={closeCoverModal}
                disabled={coverSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="doctor-btn-submit"
                onClick={submitCoverRequest}
                disabled={!canSubmitCover}
              >
                {coverSubmitting
                  ? 'Sending…'
                  : coverQuota?.alreadyPending
                    ? 'Update request'
                    : 'Send cover request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
