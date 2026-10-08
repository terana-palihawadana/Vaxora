import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import staffService from '../../hospital/services/staffService';
import { addHospitalDays, hospitalToday } from '../../hospital/utils/hospitalDate';
import { IconHospital, IconRepeat } from '../../../shared/icons/AppIcons';
import affilHeroImage from '../../../assets/images/staff-affiliations-hero.png';

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
      blockReason: 'This shift has already started — tell the hospital desk directly.',
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
      : 'Cover limits could not be verified from the server — you can still try to send.',
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
 * Shared doctor/nurse view for hospital invitations, active affiliations,
 * week shifts, and cover requests (parity with mobile staff cover flow).
 */
export default function StaffHospitalAffiliationsTab({ roleLabel = 'Staff' }) {
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
      showToast('This shift has already started — tell the hospital desk directly.');
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
        <div className="doctor-toast" role="alert" style={{ background: '#fef2f2', color: '#b91c1c' }}>
          {error}
          <button
            type="button"
            onClick={() => setError('')}
            style={{ marginLeft: 12, border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c' }}
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="hospital-hero-banner staff-affil-hero">
        <div className="hospital-hero-content staff-affil-hero-content">
          <p className="hospital-hero-eyebrow">Roster &amp; cover</p>
          <h1>Hospital Affiliations</h1>
          <p className="hospital-hero-sub">
            Invitations, roster membership, shifts, and cover requests for your {roleLabel.toLowerCase()} account.
          </p>
          <div className="staff-affil-hero-pills" aria-label="Affiliation summary">
            <span className="staff-affil-hero-pill">
              <strong>{loading ? '—' : invitations.length}</strong> Pending invites
            </span>
            <span className="staff-affil-hero-pill">
              <strong>{loading ? '—' : affiliations.length}</strong> Active
            </span>
            <span className="staff-affil-hero-pill">
              <strong>{loading ? '—' : shifts.length}</strong> Shifts (week)
            </span>
            <span className="staff-affil-hero-pill">
              <strong>{loading ? '—' : pendingOutgoing}</strong> Cover pending
            </span>
          </div>
        </div>
        <div className="hospital-hero-media" aria-hidden="true">
          <img src={affilHeroImage} alt="" className="hospital-hero-image staff-affil-hero-image" />
        </div>
      </section>

      <div className="doctor-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <h2 className="doctor-card-title" style={{ marginTop: 0, marginBottom: 18 }}>
          Active Affiliations ({affiliations.length})
        </h2>

        {loading ? (
          <p style={{ color: '#64748b' }}>Loading affiliations...</p>
        ) : affiliations.length === 0 ? (
          <p style={{ color: '#64748b' }}>
            You are not affiliated with any hospital yet. Accept an invitation to join a roster.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '14px' }}>
            {affiliations.map((item) => (
              <div key={item.affiliationId} className="staff-affil-item-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
                  <HospitalAvatar logoUrl={item.hospitalLogoUrl} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', lineHeight: 1.4 }}>
                      {item.hospitalName || 'Hospital'}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 8 }}>
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

      <div className="doctor-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <div className="staff-shift-week-header">
          <h2 className="doctor-card-title" style={{ margin: 0 }}>
            My Shifts — week calendar
          </h2>
          <div className="staff-shift-week-nav">
            <button
              type="button"
              className="staff-shift-week-nav-btn"
              onClick={() => setWeekStart((prev) => addHospitalDays(prev, -7))}
            >
              Prev
            </button>
            <button
              type="button"
              className="staff-shift-week-nav-btn"
              onClick={() => setWeekStart(startOfWeek(today))}
            >
              This week
            </button>
            <button
              type="button"
              className="staff-shift-week-nav-btn"
              onClick={() => setWeekStart((prev) => addHospitalDays(prev, 7))}
            >
              Next
            </button>
          </div>
        </div>
        <p className="staff-shift-week-range">{formatWeekRangeLabel(weekStart, weekEnd)}</p>
        <p className="staff-cover-hint">
          Click a shift to request hospital cover. Limits: 3 covers / month, 1 short-notice (&lt; 2 days).
        </p>

        {loading ? (
          <p style={{ color: '#64748b' }}>Loading shifts...</p>
        ) : (
          <div className="staff-shift-week-calendar">
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
                        <span className="staff-shift-week-empty">—</span>
                      ) : (
                        dayShifts.map((shift) => {
                          const cover = String(shift.coverStatus || '').trim();
                          const finished = isShiftFinished(shift, today);
                          const started = isShiftStarted(shift, today);
                          const canRequest =
                            !started &&
                            (!cover ||
                              cover.toLowerCase() === 'declined' ||
                              cover.toLowerCase() === 'requested');
                          return (
                            <button
                              type="button"
                              key={shift.shiftId}
                              className={`staff-shift-week-card staff-shift-week-card--action${
                                cover ? ` is-cover-${cover.toLowerCase()}` : ''
                              }${finished ? ' is-finished' : ''}`}
                              onClick={() => canRequest && openCoverModal(shift)}
                              disabled={!canRequest}
                              title={
                                finished
                                  ? 'This shift has already finished'
                                  : started && !cover
                                    ? 'Shift already started — tell the hospital desk directly'
                                    : cover.toLowerCase() === 'covering'
                                    ? 'You are covering this shift for a colleague'
                                    : canRequest
                                      ? 'Request cover for this shift'
                                      : undefined
                              }
                            >
                              <div className="staff-shift-week-card-time">{formatShiftTime(shift)}</div>
                              <div className="staff-shift-week-card-booth">
                                {shift.boothOrStation || 'Unassigned booth'}
                              </div>
                              {shift.notes ? (
                                <div className="staff-shift-week-card-notes">{shift.notes}</div>
                              ) : null}
                              <div className="staff-shift-week-card-hospital">
                                {hospitalNameByAffiliation[shift.affiliationId] || 'Hospital'}
                              </div>
                              {finished ? (
                                <span className="staff-cover-chip is-declined">Finished</span>
                              ) : cover ? (
                                <span className={`staff-cover-chip ${coverStatusTone(cover)}`}>
                                  {cover}
                                </span>
                              ) : started ? (
                                <span className="staff-cover-chip is-pending">In progress</span>
                              ) : (
                                <span className="staff-cover-chip is-request">Request cover</span>
                              )}
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
          <div className="staff-cover-activity-title-row">
            <span className="staff-cover-activity-icon" aria-hidden="true">
              <IconRepeat size={18} />
            </span>
            <div>
              <h2 className="doctor-card-title" style={{ margin: 0 }}>
                Cover activity
              </h2>
              <p className="staff-cover-hint" style={{ margin: '4px 0 0' }}>
                Your cover swaps at a glance — requests you sent, and shifts handed to you.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="staff-cover-activity-empty">Loading cover activity...</p>
        ) : coverRequests.length === 0 ? (
          <p className="staff-cover-activity-empty">No cover requests yet.</p>
        ) : (
          <div className="staff-cover-board">
            <section className="staff-cover-lane is-outgoing">
              <header className="staff-cover-lane-head">
                <div>
                  <p className="staff-cover-lane-kicker">You asked out</p>
                  <h3 className="staff-cover-lane-title">Outgoing</h3>
                </div>
                <span className="staff-cover-lane-count">{outgoingCovers.length}</span>
              </header>

              {outgoingCovers.length === 0 ? (
                <p className="staff-cover-lane-empty">No outgoing requests.</p>
              ) : (
                <ul className="staff-cover-timeline">
                  {outgoingCovers.map((req) => {
                    const tone = coverActivityTone(req.status);
                    return (
                      <li key={req.id} className={`staff-cover-row ${tone}`}>
                        <span className="staff-cover-rail" aria-hidden="true" />
                        <div className="staff-cover-row-body">
                          <div className="staff-cover-row-top">
                            <strong>{req.hospitalName || 'Hospital'}</strong>
                            <span className={`staff-cover-badge ${tone}`}>
                              {req.status || 'Pending'}
                            </span>
                          </div>
                          <div className="staff-cover-row-when">{formatCoverWhen(req)}</div>
                          <div className="staff-cover-row-meta">
                            {req.boothOrStation ? (
                              <span className="staff-cover-booth-pill">{req.boothOrStation}</span>
                            ) : null}
                            {req.reason ? (
                              <span className="staff-cover-note">{req.reason}</span>
                            ) : null}
                            {req.replacementName ? (
                              <span className="staff-cover-note is-emphasis">
                                Covered by {req.replacementName}
                              </span>
                            ) : null}
                            {String(req.status || '').toLowerCase() === 'cancelled' &&
                            req.decisionNote ? (
                              <span className="staff-cover-note">{req.decisionNote}</span>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="staff-cover-lane is-incoming">
              <header className="staff-cover-lane-head">
                <div>
                  <p className="staff-cover-lane-kicker">Assigned to you</p>
                  <h3 className="staff-cover-lane-title">Incoming</h3>
                </div>
                <span className="staff-cover-lane-count">{incomingCovers.length}</span>
              </header>

              {incomingCovers.length === 0 ? (
                <p className="staff-cover-lane-empty">No assigned cover shifts.</p>
              ) : (
                <ul className="staff-cover-timeline">
                  {incomingCovers.map((req) => {
                    const tone = coverActivityTone(req.status);
                    return (
                      <li key={req.id} className={`staff-cover-row ${tone}`}>
                        <span className="staff-cover-rail" aria-hidden="true" />
                        <div className="staff-cover-row-body">
                          <div className="staff-cover-row-top">
                            <strong>{req.hospitalName || 'Hospital'}</strong>
                            <span className={`staff-cover-badge ${tone}`}>
                              {req.status || 'Approved'}
                            </span>
                          </div>
                          <div className="staff-cover-row-when">{formatCoverWhen(req)}</div>
                          <div className="staff-cover-row-meta">
                            {req.boothOrStation ? (
                              <span className="staff-cover-booth-pill">{req.boothOrStation}</span>
                            ) : null}
                            <span className="staff-cover-note is-emphasis">
                              Covering for {req.requesterName || 'colleague'}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>

      <div className="doctor-card" style={{ padding: '24px' }}>
        <h2 className="doctor-card-title" style={{ marginTop: 0, marginBottom: 18 }}>
          Pending Invitations ({invitations.length})
        </h2>

        {loading ? (
          <p style={{ color: '#64748b' }}>Loading invitations...</p>
        ) : invitations.length === 0 ? (
          <p style={{ color: '#64748b' }}>No pending hospital invitations.</p>
        ) : (
          <div style={{ display: 'grid', gap: '14px' }}>
            {invitations.map((item) => (
              <div key={item.affiliationId} className="staff-affil-item-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                  <HospitalAvatar logoUrl={item.hospitalLogoUrl} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', lineHeight: 1.4 }}>
                      {item.hospitalName || 'Hospital invitation'}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 8 }}>
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

      {coverShift && (
        <div className="doctor-modal-overlay" onClick={closeCoverModal}>
          <div className="doctor-modal-card staff-cover-modal" onClick={(e) => e.stopPropagation()}>
            <div className="doctor-modal-header">
              <div>
                <h3 className="doctor-modal-title">Request cover</h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)' }}>
                  Hospital will assign a replacement — not a peer swap
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
                  {String(coverShift.shiftDate || '').slice(0, 10)} · {formatShiftTime(coverShift)}
                </div>
                <div>{coverShift.boothOrStation || 'Unassigned booth'}</div>
              </div>

              {coverLoading ? (
                <p className="staff-cover-loading">Checking cover limits…</p>
              ) : coverQuota?.canRequest === false ? (
                <p className="staff-cover-blocked" role="alert">
                  {coverQuota.blockReason || coverQuota.summary || 'Cover cannot be requested for this shift.'}
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
                      ? 'Short notice — explain why you need cover'
                      : 'Why do you need cover for this shift?'
                  }
                  disabled={coverSubmitting || coverQuota?.canRequest === false}
                />
                {coverQuota?.alreadyPending && coverQuota?.canRequest !== false ? (
                  <p className="staff-cover-hint-inline">
                    You already have a pending request — submitting updates the reason.
                  </p>
                ) : null}
              </div>

              {coverError ? (
                <p role="alert" style={{ color: '#b91c1c', fontWeight: 600, margin: '0 0 8px' }}>
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
