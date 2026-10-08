import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import staffAppointmentService from '../services/staffAppointmentService';
import { addHospitalDays, hospitalToday } from '../../hospital/utils/hospitalDate';
import { IconCalendar } from '../../../shared/icons/AppIcons';
import StaffSubpageHeader from './StaffSubpageHeader';

/**
 * Shared doctor/nurse appointments roster.
 * Hospital switch shows whenever the staff member has multiple affiliations.
 * Prefer the hospital where they are on duty now as the default selection.
 * Date browsing is limited to hospital-local today ± 1 day (clinical session).
 * No Action column (view-only roster).
 */
export default function StaffAppointmentsPanel({
  allowHospitalSwitch = true,
  facilitySuffix = '',
}) {
  const today = useMemo(() => hospitalToday(), []);
  const minDate = useMemo(() => addHospitalDays(today, -1), [today]);
  const maxDate = useMemo(() => addHospitalDays(today, 1), [today]);
  const [hospitals, setHospitals] = useState([]);
  const [selectedHospitalUserId, setSelectedHospitalUserId] = useState('');
  const [filterDate, setFilterDate] = useState(today);
  const [appointments, setAppointments] = useState([]);
  const [loadingHospitals, setLoadingHospitals] = useState(true);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [error, setError] = useState('');

  const selectedHospital = hospitals.find((h) => h.hospitalUserId === selectedHospitalUserId);

  const loadHospitals = useCallback(async () => {
    setLoadingHospitals(true);
    setError('');
    try {
      const list = await staffAppointmentService.getMyAffiliations();
      const active = (Array.isArray(list) ? list : []).filter(
        (a) => String(a.status).toLowerCase() === 'active'
      );
      setHospitals(active);
      if (active.length > 0) {
        setSelectedHospitalUserId((prev) => {
          if (prev && active.some((h) => h.hospitalUserId === prev)) return prev;
          const onDuty = active.find((h) => h.isOnDutyNow);
          return (onDuty || active[0]).hospitalUserId;
        });
      } else {
        setSelectedHospitalUserId('');
      }
    } catch (err) {
      setError(err.message || 'Failed to load hospital affiliations.');
      setHospitals([]);
      setSelectedHospitalUserId('');
    } finally {
      setLoadingHospitals(false);
    }
  }, []);

  const loadAppointments = useCallback(async () => {
    if (!selectedHospitalUserId) {
      setAppointments([]);
      return;
    }

    setLoadingAppointments(true);
    setError('');
    try {
      const list = await staffAppointmentService.getHospitalAppointments(
        selectedHospitalUserId,
        filterDate || today
      );
      setAppointments(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || 'Failed to load appointments.');
      setAppointments([]);
    } finally {
      setLoadingAppointments(false);
    }
  }, [selectedHospitalUserId, filterDate, today]);

  useEffect(() => deferEffectCallback(() => {
    loadHospitals();
  }), [loadHospitals]);

  useEffect(() => deferEffectCallback(() => {
    loadAppointments();
  }), [loadAppointments]);

  const facilityTitle = selectedHospital
    ? `${selectedHospital.hospitalName || 'Hospital'}${facilitySuffix}`
    : loadingHospitals
      ? 'Loading hospital...'
      : 'No affiliated hospital';

  const onFilterDateChange = (value) => {
    if (!value) {
      setFilterDate(today);
      return;
    }
    if (value < minDate || value > maxDate) {
      setError(`Clinical roster is limited to ${minDate} … ${maxDate} (hospital today ± 1 day).`);
      setFilterDate(today);
      return;
    }
    setError('');
    setFilterDate(value);
  };

  return (
    <div className="staff-workspace-page staff-appointments-page">
      <StaffSubpageHeader
        eyebrow="Clinical workflow"
        title="Appointments"
        subtitle="Today’s vaccination visits at your affiliated hospital (session window ± 1 day)."
      />
      {error && (
        <div
          className="appointment-alert-pill"
          role="alert"
          style={{
            maxWidth: '1060px',
            width: '100%',
            marginBottom: '20px',
            background: '#fef2f2',
            color: '#b91c1c',
            borderColor: '#fecaca',
          }}
        >
          {error}
        </div>
      )}

      <div className="doctor-manage-appointments-card">
        <div className="doctor-appointment-inner-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <h2 className="doctor-inner-facility-name" style={{ margin: 0 }}>
              {facilityTitle}
            </h2>

            {(allowHospitalSwitch || hospitals.length > 1) && hospitals.length > 1 && (
              <select
                className="doctor-filter-date-input"
                value={selectedHospitalUserId}
                onChange={(e) => setSelectedHospitalUserId(e.target.value)}
                aria-label="Select hospital"
                style={{ minWidth: 220 }}
              >
                {hospitals.map((h) => (
                  <option key={h.affiliationId || h.hospitalUserId} value={h.hospitalUserId}>
                    {h.hospitalName || h.hospitalUserId}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="doctor-appointments-filter-bar">
            <div className="doctor-filter-group">
              <label htmlFor="staff-filter-date" className="doctor-filter-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <IconCalendar size={16} /> Session date:
              </label>
              <input
                id="staff-filter-date"
                type="date"
                value={filterDate}
                min={minDate}
                max={maxDate}
                onChange={(e) => onFilterDateChange(e.target.value)}
                className="doctor-filter-date-input"
                aria-label="Filter appointments by session date"
                disabled={!selectedHospitalUserId}
              />
              <button
                type="button"
                className={`doctor-filter-btn ${filterDate === today ? 'active' : ''}`}
                onClick={() => onFilterDateChange(today)}
                disabled={!selectedHospitalUserId}
              >
                Today
              </button>
              <button
                type="button"
                className="doctor-filter-btn"
                onClick={loadAppointments}
                disabled={!selectedHospitalUserId || loadingAppointments}
              >
                Refresh
              </button>
            </div>

            <div style={{ fontSize: '0.88rem', color: '#64748b', fontWeight: 600 }}>
              {loadingAppointments
                ? 'Loading...'
                : `Showing ${appointments.length} appointment${appointments.length === 1 ? '' : 's'}`}
            </div>
          </div>

          <div className="doctor-appointments-table-wrapper">
            <table className="doctor-appointments-mockup-table">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>P-Name</th>
                  <th style={{ width: '22%' }}>Date</th>
                  <th style={{ width: '22%' }}>Time</th>
                  <th style={{ width: '28%' }}>Vaccine</th>
                </tr>
              </thead>
              <tbody>
                {!selectedHospitalUserId ? (
                  <tr>
                    <td colSpan={4} className="empty-table-cell">
                      {loadingHospitals
                        ? 'Loading affiliations...'
                        : 'No active hospital affiliation. Accept a hospital invitation first.'}
                    </td>
                  </tr>
                ) : loadingAppointments ? (
                  <tr>
                    <td colSpan={4} className="empty-table-cell">
                      Loading appointments...
                    </td>
                  </tr>
                ) : appointments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-table-cell">
                      No appointments found{filterDate ? ` for date ${filterDate}` : ''}.{' '}
                      {filterDate && (
                        <button
                          type="button"
                          onClick={() => setFilterDate('')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#19469d',
                            fontWeight: 700,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            marginLeft: '6px',
                          }}
                        >
                          Show All Dates
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  appointments.map((item) => (
                    <tr key={item.id}>
                      <td>{item.patientName}</td>
                      <td>{item.appointmentDate}</td>
                      <td>{item.timeSlot || item.startTime || '—'}</td>
                      <td>{item.vaccineName}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
