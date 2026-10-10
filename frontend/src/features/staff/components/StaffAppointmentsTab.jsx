import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import PortalHero from '../../../components/PortalHero';
import staffService from '../../hospital/services/staffService';
import staffAppointmentService from '../services/staffAppointmentService';
import { addHospitalDays, hospitalToday } from '../../hospital/utils/hospitalDate';
import { IconCalendar, IconCheck, IconClock } from '../../../shared/icons/AppIcons';

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

/** Filter bucket, display label and colour tone for an appointment status. */
function describeStatus(appointment) {
  const s = String(appointment.status || '').toLowerCase();
  if (s === 'completed') return { bucket: 'completed', label: 'Completed', tone: 'green' };
  if (s === 'cancelled' || s === 'rejected') return { bucket: 'cancelled', label: 'Cancelled', tone: 'red' };
  if (s === 'observation') return { bucket: 'upcoming', label: 'Under watch', tone: 'amber' };
  if (s === 'administering') return { bucket: 'upcoming', label: 'In session', tone: 'blue' };
  if (s === 'pendingpayment') return { bucket: 'upcoming', label: 'Awaiting payment', tone: 'amber' };
  return { bucket: 'upcoming', label: appointment.checkedInAt ? 'Checked in' : 'Booked', tone: 'blue' };
}

const RELATIVE_DAYS = ['Today', 'Tomorrow', 'Yesterday'];

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function formatDayLabel(dateKey, today) {
  if (dateKey === today) return 'Today';
  if (dateKey === addHospitalDays(today, 1)) return 'Tomorrow';
  if (dateKey === addHospitalDays(today, -1)) return 'Yesterday';
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatFullDate(dateKey) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function pickHospitalId(affiliations) {
  const live = affiliations.find((a) => a.isOnDutyNow);
  return (live || affiliations[0])?.hospitalUserId || '';
}

/**
 * Read-only booking list for doctors and nurses: any day at an affiliated hospital.
 * Treating patients stays on Home; this page is for checking and planning the day.
 * ?date=yyyy-MM-dd opens a specific day (Home links here with tomorrow's date).
 */
export default function StaffAppointmentsTab() {
  const today = hospitalToday();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedDate = searchParams.get('date');
  const date = isDateKey(requestedDate) ? requestedDate : today;

  const [affiliations, setAffiliations] = useState([]);
  const [hospitalUserId, setHospitalUserId] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const setDate = (next) => {
    setSearchParams(next === today ? {} : { date: next }, { replace: true });
  };

  useEffect(() => {
    return deferEffectCallback(() => {
      let cancelled = false;
      staffService
        .getMyAffiliations()
        .then((list) => {
          if (cancelled) return;
          const active = Array.isArray(list) ? list : [];
          setAffiliations(active);
          setHospitalUserId(pickHospitalId(active));
          if (active.length === 0) setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setError('Could not load your hospitals.');
          setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    });
  }, []);

  useEffect(() => {
    if (!hospitalUserId) return undefined;
    return deferEffectCallback(() => {
      let cancelled = false;
      setLoading(true);
      setError('');
      staffAppointmentService
        .getHospitalAppointments(hospitalUserId, date)
        .then((rows) => {
          if (!cancelled) setAppointments(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {
          if (!cancelled) {
            setAppointments([]);
            setError('Could not load appointments for this day.');
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    });
  }, [hospitalUserId, date]);

  const rows = useMemo(
    () =>
      appointments
        .map((a) => ({ ...a, statusInfo: describeStatus(a) }))
        .sort((a, b) => String(a.startTime || a.timeSlot).localeCompare(String(b.startTime || b.timeSlot))),
    [appointments]
  );

  const counts = useMemo(() => {
    const result = { all: rows.length, upcoming: 0, completed: 0, cancelled: 0 };
    rows.forEach((r) => {
      result[r.statusInfo.bucket] += 1;
    });
    return result;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.statusInfo.bucket !== statusFilter) return false;
      if (!q) return true;
      return [r.patientName, r.vaccineName, r.boothLabel]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [rows, statusFilter, search]);

  const hospitalName =
    affiliations.find((a) => a.hospitalUserId === hospitalUserId)?.hospitalName || 'your hospital';
  const dayLabel = formatDayLabel(date, today);

  return (
    <div className="doctor-dashboard-tab">
      <PortalHero
        eyebrow="Schedule"
        title="Appointments"
        subtitle={`Every booked slot at ${hospitalName}. Check any day and plan ahead.`}
      />

      <div className="hospital-metrics-grid hospital-metrics-grid--3" aria-label="Day summary" style={{ marginBottom: '24px' }}>
        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-blue">
            <IconCalendar size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Booked</span>
            <span className="hospital-stat-value">{loading ? '—' : counts.all}</span>
            <span className="hospital-stat-meta">{dayLabel}</span>
          </div>
        </div>
        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-amber">
            <IconClock size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Upcoming</span>
            <span className="hospital-stat-value">{loading ? '—' : counts.upcoming}</span>
            <span className="hospital-stat-meta">Still to be seen</span>
          </div>
        </div>
        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-green">
            <IconCheck size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Completed</span>
            <span className="hospital-stat-value">{loading ? '—' : counts.completed}</span>
            <span className="hospital-stat-meta">Doses given</span>
          </div>
        </div>
      </div>

      <div className="doctor-card staff-page-section staff-appt-card">
        <div className="staff-shift-week-header">
          <div>
            <h2 className="doctor-card-title" style={{ margin: 0 }}>
              {RELATIVE_DAYS.includes(dayLabel)
                ? `${dayLabel} · ${formatFullDate(date)}`
                : formatFullDate(date)}
            </h2>
          </div>
          <div className="staff-shift-week-nav">
            <button
              type="button"
              className="staff-shift-week-nav-btn"
              onClick={() => setDate(addHospitalDays(date, -1))}
              aria-label="Previous day"
            >
              ‹ Prev
            </button>
            <button
              type="button"
              className="staff-shift-week-nav-btn"
              onClick={() => setDate(today)}
              disabled={date === today}
            >
              Today
            </button>
            <button
              type="button"
              className="staff-shift-week-nav-btn"
              onClick={() => setDate(addHospitalDays(date, 1))}
              aria-label="Next day"
            >
              Next ›
            </button>
          </div>
        </div>

        <div className="queue-controls-bar">
          <div className="queue-controls-left">
            <div className="queue-scope-switch" role="group" aria-label="Status">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`queue-scope-btn${statusFilter === f.key ? ' active' : ''}`}
                  aria-pressed={statusFilter === f.key}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label} ({counts[f.key]})
                </button>
              ))}
            </div>
            <input
              type="search"
              className="queue-search-input"
              placeholder="Search patient, vaccine, booth..."
              aria-label="Search appointments"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {affiliations.length > 1 ? (
              <select
                className="staff-cover-select"
                aria-label="Hospital"
                value={hospitalUserId}
                onChange={(e) => setHospitalUserId(e.target.value)}
              >
                {affiliations.map((a) => (
                  <option key={a.hospitalUserId} value={a.hospitalUserId}>
                    {a.hospitalName}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="staff-appt-empty">Loading appointments...</p>
        ) : error ? (
          <p className="staff-appt-empty" role="alert">{error}</p>
        ) : affiliations.length === 0 ? (
          <p className="staff-appt-empty">Join a hospital to see its appointments.</p>
        ) : visibleRows.length === 0 ? (
          <p className="staff-appt-empty">
            {rows.length === 0
              ? `No appointments booked for ${RELATIVE_DAYS.includes(dayLabel) ? dayLabel.toLowerCase() : formatFullDate(date)}.`
              : 'No appointments match this filter.'}
          </p>
        ) : (
          <ul className="staff-appt-list" aria-label="Appointments">
            <li className="staff-appt-row staff-appt-row--head" aria-hidden="true">
              <span>Time</span>
              <span>Patient</span>
              <span>Booth</span>
              <span>Status</span>
            </li>
            {visibleRows.map((a) => (
              <li key={a.id} className={`staff-appt-row tone-${a.statusInfo.tone}`}>
                <span className="staff-appt-time">{a.timeSlot || a.startTime || '—'}</span>
                <span className="staff-appt-patient">
                  <span className="staff-appt-name">{a.patientName || 'Patient'}</span>
                  <span className="staff-appt-vaccine">{a.vaccineName || '—'}</span>
                </span>
                <span className="staff-appt-booth">{a.boothLabel || 'No booth'}</span>
                <span className="staff-appt-status">{a.statusInfo.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
