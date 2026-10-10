import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import staffAppointmentService from '../services/staffAppointmentService';
import { addHospitalDays, hospitalToday } from '../../hospital/utils/hospitalDate';
import { IconCalendar, IconChevronRight } from '../../../shared/icons/AppIcons';

/**
 * Home card: today's and tomorrow's booking counts, linking to the full
 * Appointments page. Today's rows come from the dashboard; tomorrow's count
 * is fetched once per hospital.
 */
export default function StaffAppointmentsSummaryCard({ hospitalUserId, todayAppointments, appointmentsPath }) {
  const [tomorrow, setTomorrow] = useState({ hospitalUserId: null, count: null });
  const requestedForRef = useRef(null);
  const tomorrowKey = addHospitalDays(hospitalToday(), 1);

  useEffect(() => {
    if (!hospitalUserId || requestedForRef.current === hospitalUserId) return undefined;
    return deferEffectCallback(() => {
      let cancelled = false;
      requestedForRef.current = hospitalUserId;
      staffAppointmentService
        .getHospitalAppointments(hospitalUserId, tomorrowKey)
        .then((rows) => {
          if (!cancelled) setTomorrow({ hospitalUserId, count: Array.isArray(rows) ? rows.length : 0 });
        })
        .catch(() => {
          if (!cancelled) setTomorrow({ hospitalUserId, count: null });
        });
      return () => {
        cancelled = true;
        if (requestedForRef.current === hospitalUserId) requestedForRef.current = null;
      };
    });
  }, [hospitalUserId, tomorrowKey]);

  const todayTotal = todayAppointments.length;
  const todayLeft = todayAppointments.filter((a) =>
    ['confirmed', 'pendingpayment', 'administering', 'observation'].includes(String(a.status || '').toLowerCase())
  ).length;
  const tomorrowLoaded = tomorrow.hospitalUserId === hospitalUserId;

  return (
    <div className="doctor-coldbox-card staff-appt-summary">
      <div className="staff-appt-summary-title">
        <span className="icon-shade icon-shade-blue">
          <IconCalendar size={22} />
        </span>
        <span>Appointments</span>
      </div>

      <ul className="staff-appt-summary-list">
        <li>
          <Link to={appointmentsPath} className="staff-appt-summary-row">
            <span className="staff-appt-summary-day">Today</span>
            <span className="staff-appt-summary-value">
              {todayTotal} booked · {todayLeft} left
            </span>
            <IconChevronRight size={16} />
          </Link>
        </li>
        <li>
          <Link to={`${appointmentsPath}?date=${tomorrowKey}`} className="staff-appt-summary-row">
            <span className="staff-appt-summary-day">Tomorrow</span>
            <span className="staff-appt-summary-value">
              {!tomorrowLoaded ? '…' : tomorrow.count == null ? '—' : `${tomorrow.count} booked`}
            </span>
            <IconChevronRight size={16} />
          </Link>
        </li>
      </ul>
    </div>
  );
}
