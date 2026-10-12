import { useEffect, useState } from 'react';
import staffService from '../services/staffService';
import { hhmm } from '../../staff/utils/availability';
import { addHospitalDays, hospitalToday } from '../utils/hospitalDate';

/** The API lists sessions for at most 31 days at a time. */
const LOOKAHEAD_DAYS = 30;

function dayLabel(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

const sessionKey = (session) => `${session.scheduleId}|${session.date}`;

/** A shift is for a doctor or a nurse; the form can add either, or both at once. */
const ROLE_FIELDS = [
  { role: 'DOCTOR', label: 'Doctor', sessionKey: 'doctors' },
  { role: 'NURSE', label: 'Nurse', sessionKey: 'nurses' },
];

/**
 * Add a shift by picking an upcoming session and a staff member who is available
 * for it. The shift takes its date, hours and booth from the session.
 */
export default function AddSessionShiftForm({ weekStart, onCreated, onClose }) {
  // Upcoming sessions from today (or the week on screen, if later) for the next month.
  const today = hospitalToday();
  const rangeFrom = weekStart > today ? weekStart : today;
  const rangeTo = addHospitalDays(rangeFrom, LOOKAHEAD_DAYS);
  const [sessions, setSessions] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [date, setDate] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [nurseId, setNurseId] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await staffService.getRosterSessions({ from: rangeFrom, to: rangeTo });
        if (cancelled) return;
        setSessions((Array.isArray(list) ? list : []).filter((s) => s.canAssign));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load sessions.');
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeFrom, rangeTo]);

  const session = sessions.find((s) => sessionKey(s) === selectedKey) || null;

  const visibleSessions = date ? sessions.filter((s) => s.date === date) : sessions;

  const handleDateChange = (value) => {
    setDate(value);
    const remaining = value ? sessions.filter((s) => s.date === value) : sessions;
    // One session that day: pick it. Otherwise drop a pick the date now hides.
    if (remaining.length === 1) {
      if (sessionKey(remaining[0]) !== selectedKey) handleSessionChange(sessionKey(remaining[0]));
    } else if (selectedKey && !remaining.some((s) => sessionKey(s) === selectedKey)) {
      handleSessionChange('');
    }
  };

  const handleSessionChange = async (key) => {
    setSelectedKey(key);
    setDoctorId('');
    setNurseId('');
    setCandidates([]);
    setError('');
    const picked = sessions.find((s) => sessionKey(s) === key);
    if (!picked) return;

    setLoadingStaff(true);
    try {
      const list = await staffService.getSessionCandidates(picked.scheduleId, picked.date);
      // Only people who can actually work it: free, in their offered hours, not on a day off.
      setCandidates((Array.isArray(list) ? list : []).filter((c) => c.available));
    } catch (err) {
      setError(err.message || 'Failed to load available staff.');
    } finally {
      setLoadingStaff(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const picks = [
      { id: doctorId, clear: setDoctorId },
      { id: nurseId, clear: setNurseId },
    ].filter((pick) => pick.id);
    if (!session || picks.length === 0) {
      setError('Pick a session, then a doctor, a nurse, or both.');
      return;
    }

    setSaving(true);
    setError('');
    // Each person is rostered on their own, so one failing does not block the other.
    let saved = 0;
    const failures = [];
    for (const pick of picks) {
      const name = candidates.find((c) => c.affiliationId === pick.id)?.staffName || 'Staff member';
      try {
        await staffService.assignSessionStaff({
          scheduleId: session.scheduleId,
          date: session.date,
          affiliationIds: [pick.id],
        });
        saved += 1;
        pick.clear('');
      } catch (err) {
        failures.push(`${name}: ${(err.message || 'could not be rostered').replace(/^Outside availability:\s*/, '')}`);
      }
    }
    setSaving(false);

    if (saved > 0) {
      // Stay open when something failed so the hospital can pick someone else.
      onCreated({ count: saved, close: failures.length === 0 });
      // Refresh who is still free. This clears the message, so set it afterwards.
      if (failures.length > 0) handleSessionChange(selectedKey);
    }
    if (failures.length > 0) setError(failures.join(' '));
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <div className="modal-form-group" style={{ margin: 0 }}>
          <label className="modal-label" htmlFor="shift-filter-date">Date</label>
          <input
            id="shift-filter-date"
            type="date"
            className="modal-input"
            value={date}
            min={rangeFrom}
            max={rangeTo}
            onChange={(e) => handleDateChange(e.target.value)}
            disabled={loadingSessions || saving}
          />
        </div>

        <div className="modal-form-group" style={{ margin: 0 }}>
          <label className="modal-label" htmlFor="shift-session">Session *</label>
          <select
            id="shift-session"
            className="modal-select"
            value={selectedKey}
            onChange={(e) => handleSessionChange(e.target.value)}
            disabled={loadingSessions || saving}
            required
          >
            <option value="">
              {loadingSessions
                ? 'Loading sessions...'
                : `Select a session (${visibleSessions.length})`}
            </option>
            {visibleSessions.map((s) => (
              <option key={sessionKey(s)} value={sessionKey(s)}>
                {[
                  date ? null : dayLabel(s.date),
                  `${hhmm(s.startTime)}-${hhmm(s.endTime)}`,
                  s.vaccineName,
                  s.boothLabel,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </option>
            ))}
          </select>
          {!loadingSessions && sessions.length > 0 && visibleSessions.length === 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              No sessions on this date.
            </span>
          )}
          {!loadingSessions && sessions.length === 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              No upcoming sessions in the next {LOOKAHEAD_DAYS} days. Post one under Sessions first.
            </span>
          )}
        </div>

        {ROLE_FIELDS.map((field) => {
          const people = candidates.filter((c) => c.staffRole === field.role);
          const already = session ? session[field.sessionKey] || [] : [];
          const value = field.role === 'DOCTOR' ? doctorId : nurseId;
          const setValue = field.role === 'DOCTOR' ? setDoctorId : setNurseId;
          const placeholder = !session
            ? 'Select a session first'
            : loadingStaff
              ? 'Checking who is free...'
              : people.length === 0
                ? `No ${field.label.toLowerCase()} is free`
                : `Select ${field.label.toLowerCase()}`;
          return (
            <div key={field.role} className="modal-form-group" style={{ margin: 0 }}>
              <label className="modal-label" htmlFor={`shift-session-${field.role}`}>
                {field.label}
              </label>
              <select
                id={`shift-session-${field.role}`}
                className="modal-select"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError('');
                }}
                disabled={!session || loadingStaff || saving || people.length === 0}
              >
                <option value="">{placeholder}</option>
                {people.map((c) => (
                  <option key={c.affiliationId} value={c.affiliationId}>
                    {c.staffName}
                    {c.specialization ? ` · ${c.specialization}` : ''}
                  </option>
                ))}
              </select>
              {already.length > 0 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Already assigned: {already.map((person) => person.staffName).join(', ')}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="submit" className="btn-hospital-primary" disabled={saving || !session || (!doctorId && !nurseId)}>
          {saving ? 'Saving...' : 'Create Shift'}
        </button>
        <button type="button" className="btn-hospital-secondary" onClick={onClose} disabled={saving}>
          Close
        </button>
      </div>
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--color-error)', fontSize: '0.875rem' }}>
          {error}
        </p>
      )}
    </form>
  );
}
