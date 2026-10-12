import { useState } from 'react';
import staffService from '../../hospital/services/staffService';
import { addHospitalDays, hospitalToday } from '../../hospital/utils/hospitalDate';
import { WEEK_DAYS, groupDateRanges, hhmm } from '../utils/availability';

/** Matches the API cap: a doctor can block out up to a full year. */
const MAX_DAYS_OFF = 366;

function initialRows(affiliation) {
  const windows = affiliation.availabilityWindows || [];
  return WEEK_DAYS.map((day) => {
    const saved = windows.find((w) => w.dayOfWeek === day.value);
    return {
      ...day,
      on: Boolean(saved),
      start: saved ? hhmm(saved.startTime) : '17:00',
      end: saved ? hhmm(saved.endTime) : '21:00',
    };
  });
}

export default function StaffAvailabilityModal({ affiliation, onClose, onSaved }) {
  const today = hospitalToday();
  const [isPrimary, setIsPrimary] = useState(Boolean(affiliation.isPrimary));
  const [rows, setRows] = useState(() => initialRows(affiliation));
  const [daysOff, setDaysOff] = useState(() =>
    (affiliation.unavailableDates || []).filter((date) => date >= today),
  );
  const [newDayOff, setNewDayOff] = useState('');
  const [newDayOffEnd, setNewDayOffEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateRow = (value, patch) => {
    setRows((current) => current.map((row) => (row.value === value ? { ...row, ...patch } : row)));
    setError('');
  };

  const addDayOff = () => {
    if (!newDayOff) return;
    const last = newDayOffEnd && newDayOffEnd > newDayOff ? newDayOffEnd : newDayOff;
    const added = [];
    for (let date = newDayOff; date <= last; date = addHospitalDays(date, 1)) added.push(date);
    const next = [...new Set([...daysOff, ...added])].sort();
    if (next.length > MAX_DAYS_OFF) {
      setError(`You can list at most ${MAX_DAYS_OFF} days off.`);
      return;
    }
    setDaysOff(next);
    setNewDayOff('');
    setNewDayOffEnd('');
    setError('');
  };

  const removeRange = (range) =>
    setDaysOff((current) => current.filter((date) => date < range.from || date > range.to));

  const handleSave = async () => {
    const activeRows = isPrimary ? [] : rows.filter((row) => row.on);
    const invalid = activeRows.find((row) => !row.start || !row.end || row.end <= row.start);
    if (invalid) {
      setError(`${invalid.label}: end time must be after start time.`);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const saved = await staffService.updateMyAvailability(affiliation.affiliationId, {
        isPrimary,
        windows: activeRows.map((row) => ({
          dayOfWeek: row.value,
          startTime: `${row.start}:00`,
          endTime: `${row.end}:00`,
        })),
        unavailableDates: daysOff,
      });
      onSaved(saved);
    } catch (err) {
      setError(err.message || 'Failed to save availability.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="doctor-modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="doctor-modal-card staff-avail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="doctor-modal-header">
          <div>
            <h3 className="doctor-modal-title">Availability</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'rgba(255,255,255,0.85)' }}>
              {affiliation.hospitalName || 'Hospital'}
            </p>
          </div>
          <button type="button" className="doctor-modal-close-btn" onClick={onClose} disabled={saving}>
            &times;
          </button>
        </div>

        <div className="doctor-modal-body">
          <label className="staff-avail-primary">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => {
                setIsPrimary(e.target.checked);
                setError('');
              }}
              disabled={saving}
            />
            <span>
              <strong>Primary hospital</strong>
              <small>Your main employer. It can roster you any time.</small>
            </span>
          </label>

          {!isPrimary && (
            <div className="doctor-form-group">
              <span className="doctor-form-label">Hours you offer this hospital</span>
              <div className="staff-avail-grid">
                {rows.map((row) => (
                  <div key={row.value} className={`staff-avail-row${row.on ? ' is-on' : ''}`}>
                    <label className="staff-avail-day">
                      <input
                        type="checkbox"
                        checked={row.on}
                        onChange={(e) => updateRow(row.value, { on: e.target.checked })}
                        disabled={saving}
                      />
                      {row.label}
                    </label>
                    {row.on ? (
                      <div className="staff-avail-times">
                        <input
                          type="time"
                          className="doctor-form-input"
                          aria-label={`${row.label} from`}
                          value={row.start}
                          onChange={(e) => updateRow(row.value, { start: e.target.value })}
                          disabled={saving}
                        />
                        <span aria-hidden>to</span>
                        <input
                          type="time"
                          className="doctor-form-input"
                          aria-label={`${row.label} to`}
                          value={row.end}
                          onChange={(e) => updateRow(row.value, { end: e.target.value })}
                          disabled={saving}
                        />
                      </div>
                    ) : (
                      <span className="staff-avail-off">Not available</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="staff-cover-hint-inline">Leave every day off to stay available any time.</p>
            </div>
          )}

          <div className="doctor-form-group">
            <label className="doctor-form-label" htmlFor="staff-avail-day-off">
              Days off
            </label>
            <div className="staff-avail-dayoff-add">
              <input
                id="staff-avail-day-off"
                type="date"
                className="doctor-form-input"
                aria-label="Day off, or first day"
                min={today}
                value={newDayOff}
                onChange={(e) => setNewDayOff(e.target.value)}
                disabled={saving}
              />
              <span aria-hidden>to</span>
              <input
                type="date"
                className="doctor-form-input"
                aria-label="Last day (optional)"
                min={newDayOff || today}
                value={newDayOffEnd}
                onChange={(e) => setNewDayOffEnd(e.target.value)}
                disabled={saving || !newDayOff}
              />
              <button
                type="button"
                className="staff-affil-accept-btn"
                onClick={addDayOff}
                disabled={saving || !newDayOff}
              >
                Add
              </button>
            </div>
            <p className="staff-cover-hint-inline">One day, or a first and last day for a longer break.</p>
            {daysOff.length > 0 && (
              <div className="staff-avail-chips">
                {groupDateRanges(daysOff).map((range) => {
                  const label = range.from === range.to ? range.from : `${range.from} to ${range.to}`;
                  return (
                    <span key={range.from} className="staff-avail-chip">
                      {label}
                      <button
                        type="button"
                        aria-label={`Remove ${label}`}
                        onClick={() => removeRange(range)}
                        disabled={saving}
                      >
                        &times;
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {error ? (
            <p role="alert" style={{ color: 'var(--color-error)', fontWeight: 600, margin: 0 }}>
              {error}
            </p>
          ) : null}
        </div>

        <div className="doctor-modal-footer">
          <button type="button" className="doctor-btn-cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="doctor-btn-submit" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
