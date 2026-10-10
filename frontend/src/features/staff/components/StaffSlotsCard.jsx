import { useEffect, useRef, useState } from 'react';
import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import staffAppointmentService from '../services/staffAppointmentService';
import { addHospitalDays, hospitalToday } from '../../hospital/utils/hospitalDate';
import { IconClock } from '../../../shared/icons/AppIcons';

const MAX_ROWS = 6;

/**
 * Read-only list of booked slots at the working hospital, for today or
 * tomorrow. Today's rows come from the dashboard; tomorrow loads on demand.
 */
export default function StaffSlotsCard({ hospitalUserId, todayAppointments }) {
  const [day, setDay] = useState('today'); // 'today' | 'tomorrow'
  const [tomorrow, setTomorrow] = useState({ hospitalUserId: null, rows: [], loading: false, error: '' });

  // Hospital whose tomorrow list is loaded or loading, so each hospital is fetched once.
  const requestedForRef = useRef(null);

  useEffect(() => {
    if (day !== 'tomorrow' || !hospitalUserId || requestedForRef.current === hospitalUserId) return undefined;
    return deferEffectCallback(() => {
      let cancelled = false;
      requestedForRef.current = hospitalUserId;
      setTomorrow({ hospitalUserId, rows: [], loading: true, error: '' });
      staffAppointmentService
        .getHospitalAppointments(hospitalUserId, addHospitalDays(hospitalToday(), 1))
        .then((rows) => {
          if (!cancelled) setTomorrow({ hospitalUserId, rows: Array.isArray(rows) ? rows : [], loading: false, error: '' });
        })
        .catch(() => {
          if (!cancelled) setTomorrow({ hospitalUserId, rows: [], loading: false, error: "Could not load tomorrow's slots." });
        });
      return () => {
        cancelled = true;
        // Unmounted or switched hospital mid-request: allow a fresh fetch next time.
        if (requestedForRef.current === hospitalUserId) requestedForRef.current = null;
      };
    });
  }, [day, hospitalUserId]);

  const isToday = day === 'today';
  const rows = isToday ? todayAppointments : tomorrow.rows;
  const loading = !isToday && tomorrow.loading;

  return (
    <div className="doctor-coldbox-card staff-today-slots">
      <div className="staff-today-slots-header">
        <div className="staff-today-slots-title">
          <span className="icon-shade icon-shade-blue">
            <IconClock size={22} />
          </span>
          <span>Slots</span>
        </div>
        <span className="staff-today-slots-count">
          {loading ? '…' : `${rows.length} ${rows.length === 1 ? 'slot' : 'slots'}`}
        </span>
      </div>

      <div className="queue-scope-switch staff-slots-day-switch" role="group" aria-label="Slots day">
        <button
          type="button"
          className={`queue-scope-btn${isToday ? ' active' : ''}`}
          aria-pressed={isToday}
          onClick={() => setDay('today')}
        >
          Today
        </button>
        <button
          type="button"
          className={`queue-scope-btn${!isToday ? ' active' : ''}`}
          aria-pressed={!isToday}
          onClick={() => setDay('tomorrow')}
          disabled={!hospitalUserId}
        >
          Tomorrow
        </button>
      </div>

      {loading ? (
        <p className="staff-today-slots-empty">Loading tomorrow&apos;s slots…</p>
      ) : !isToday && tomorrow.error ? (
        <p className="staff-today-slots-empty">{tomorrow.error}</p>
      ) : rows.length === 0 ? (
        <p className="staff-today-slots-empty">
          {isToday ? 'No slots booked for today.' : 'No slots booked for tomorrow.'}
        </p>
      ) : (
        <ul className="staff-today-slots-list">
          {rows.slice(0, MAX_ROWS).map((a) => {
            const done = a.status === 'Completed';
            return (
              <li key={a.id} className={`staff-today-slot-item${done ? ' is-done' : ''}`}>
                <div className="staff-today-slot-time">{a.timeSlot || a.startTime || '—'}</div>
                <div className="staff-today-slot-meta">
                  <span className="staff-today-slot-name">{a.patientName || 'Patient'}</span>
                  <span className={`staff-today-slot-status${done ? ' is-done' : ''}`}>
                    {a.status || 'Scheduled'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
