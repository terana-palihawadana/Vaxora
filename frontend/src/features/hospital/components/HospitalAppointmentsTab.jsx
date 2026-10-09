import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { inventoryService } from '../services/inventoryService';
import { scheduleService } from '../services/scheduleService';
import { staffService } from '../services/staffService';
import { appointmentService } from '../../patient/services/appointmentService';
import HospitalSubpageHero from './HospitalSubpageHero';
import { getAppointmentActionDisplay } from '../utils/appointmentStatus';
import { IconCalendar, IconRefresh } from '../../../shared/icons/AppIcons';

const DAYS_OF_WEEK = [
  { key: 'Monday', label: 'Mon' },
  { key: 'Tuesday', label: 'Tue' },
  { key: 'Wednesday', label: 'Wed' },
  { key: 'Thursday', label: 'Thu' },
  { key: 'Friday', label: 'Fri' },
  { key: 'Saturday', label: 'Sat' },
  { key: 'Sunday', label: 'Sun' },
];

/** Hospital wall-clock date in Asia/Colombo (yyyy-MM-dd). */
function hospitalTodayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
}

function hospitalNowHm() {
  return new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Colombo',
  });
}

/** Round up to next :00 or :20 or :40, then return HH:mm. */
function nextClinicStartHm(fromHm = hospitalNowHm()) {
  const [h, m] = fromHm.split(':').map(Number);
  let minutes = h * 60 + m + 1; // strictly after now
  const rem = minutes % 20;
  if (rem !== 0) minutes += 20 - rem;
  if (minutes >= 24 * 60) minutes = 23 * 60; // clamp late night
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function addHoursHm(hm, hours) {
  const [h, m] = hm.split(':').map(Number);
  let total = h * 60 + m + hours * 60;
  if (total >= 24 * 60) total = 23 * 60 + 59;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function defaultWindowForDate(dateStr) {
  const today = hospitalTodayStr();
  if (dateStr === today) {
    const start = nextClinicStartHm();
    return { startTime: start, endTime: addHoursHm(start, 2) };
  }
  return { startTime: '09:00', endTime: '11:00' };
}

function monthsAheadStr(months) {
  const parts = hospitalTodayStr().split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setMonth(d.getMonth() + months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function HospitalAppointmentsTab() {
  const [vaccines, setVaccines] = useState([]);
  const [booths, setBooths] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const todayStr = hospitalTodayStr();
  const defaultEndDateStr = monthsAheadStr(3);
  const initialWindow = defaultWindowForDate(todayStr);

  // 1. Create a new schedule form state
  const [scheduleForm, setScheduleForm] = useState({
    scheduleType: 'OneTime', // 'OneTime' | 'Weekly'
    vaccineType: '',
    boothId: '',
    specificDate: todayStr,
    daysOfWeek: ['Monday', 'Wednesday', 'Friday'],
    startDate: todayStr,
    endDate: defaultEndDateStr,
    startTime: initialWindow.startTime,
    endTime: initialWindow.endTime,
    price: '0.00',
  });

  // 2. Appointments list state (mock/live)
  const [appointments, setAppointments] = useState([]);

  // 3. Filter Date state
  const [filterDate, setFilterDate] = useState(todayStr);
  const [notification, setNotification] = useState('');
  const [notificationTone, setNotificationTone] = useState('success'); // success | error | warning | info
  const [stockHorizon, setStockHorizon] = useState(null);
  const [loadingHorizon, setLoadingHorizon] = useState(false);

  const showToast = (msg, tone = 'success') => {
    setNotification(msg);
    setNotificationTone(tone);
    setTimeout(() => setNotification(''), 3500);
  };

  const toastStyles = {
    success: { background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1.5px solid var(--color-success-border)' },
    error: { background: 'var(--color-error-bg)', color: 'var(--color-error)', border: '1.5px solid var(--color-error-border)' },
    warning: { background: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1.5px solid var(--color-warning-border)' },
    info: { background: 'var(--color-info-bg)', color: 'var(--color-primary)', border: '1.5px solid var(--color-info-border)' },
  };

  // Fetch formulary vaccines and active booths
  const loadOptions = useCallback(async () => {
    try {
      setLoadingOptions(true);
      const [formularyData, globalVaccinesData, boothData] = await Promise.allSettled([
        inventoryService.getFormulary(),
        inventoryService.getGlobalVaccines(),
        staffService.getHospitalBooths({ activeOnly: true }),
      ]);

      const vaccineMap = new Map();
      if (formularyData.status === 'fulfilled' && Array.isArray(formularyData.value) && formularyData.value.length > 0) {
        formularyData.value.forEach((f) => {
          const vName = (f.vaccineName || f.name || '').trim();
          // Prefer catalog VaccineId — never the formulary row Id (that breaks booth matching).
          const vId = f.vaccineId || f.VaccineId || null;
          if (vName && !vaccineMap.has(vName.toLowerCase())) {
            vaccineMap.set(vName.toLowerCase(), {
              id: vId,
              name: vName,
              manufacturer: f.manufacturer || '',
              price: Number(f.price ?? f.Price ?? 0),
              isFree: Number(f.price ?? f.Price ?? 0) <= 0,
              formularyId: f.id,
            });
          }
        });
      } else if (globalVaccinesData.status === 'fulfilled' && Array.isArray(globalVaccinesData.value) && globalVaccinesData.value.length > 0) {
        globalVaccinesData.value.forEach((v) => {
          const vName = (v.name || '').trim();
          if (vName && !vaccineMap.has(vName.toLowerCase())) {
            vaccineMap.set(vName.toLowerCase(), {
              id: v.id,
              name: vName,
              manufacturer: v.manufacturer || '',
            });
          }
        });
      }

      setVaccines(Array.from(vaccineMap.values()));
      setBooths(
        boothData.status === 'fulfilled' && Array.isArray(boothData.value)
          ? boothData.value.filter((b) => b.isActive !== false)
          : []
      );
    } catch (err) {
      console.error('Failed to load appointment schedule options:', err);
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  // Fetch saved schedules from database
  const loadSchedules = useCallback(async () => {
    try {
      setLoadingSchedules(true);
      const data = await scheduleService.getHospitalSchedules();
      if (Array.isArray(data)) {
        setSchedules(data);
      } else {
        setSchedules([]);
      }
    } catch (err) {
      console.error('Failed to load hospital schedules:', err);
    } finally {
      setLoadingSchedules(false);
    }
  }, []);

  // Fetch appointments for this hospital from database
  const loadHospitalAppointments = useCallback(async () => {
    try {
      const data = await appointmentService.getHospitalAppointments();
      if (Array.isArray(data)) {
        setAppointments(data);
      } else {
        setAppointments([]);
      }
    } catch (err) {
      console.error('Failed to load hospital appointments:', err);
    }
  }, []);

  useEffect(() => deferEffectCallback(() => {
    loadOptions();
    loadSchedules();
    loadHospitalAppointments();
  }), [loadOptions, loadSchedules, loadHospitalAppointments]);

  const selectedVaccine = useMemo(
    () => vaccines.find((v) => v.name === scheduleForm.vaccineType) || null,
    [vaccines, scheduleForm.vaccineType]
  );

  const matchingBooths = useMemo(() => {
    if (!selectedVaccine) return [];
    const vaccineId = selectedVaccine.id ? String(selectedVaccine.id) : '';
    const vaccineName = (selectedVaccine.name || '').toLowerCase();

    return booths.filter((b) => {
      const ids = Array.isArray(b.vaccineIds) ? b.vaccineIds.map(String) : [];
      const names = Array.isArray(b.vaccineNames)
        ? b.vaccineNames.map((n) => String(n).toLowerCase())
        : [];
      // Only booths that explicitly offer this vaccine (no "show all" fallback —
      // that let users pick B02 and then get blocked by the API).
      if (vaccineId && ids.includes(vaccineId)) return true;
      return names.includes(vaccineName);
    });
  }, [booths, selectedVaccine]);

  useEffect(() => deferEffectCallback(() => {
    if (!scheduleForm.vaccineType) {
      if (scheduleForm.boothId) {
        setScheduleForm((prev) => ({ ...prev, boothId: '' }));
      }
      return;
    }

    const stillValid = matchingBooths.some(
      (b) => String(b.boothId || b.id) === String(scheduleForm.boothId)
    );
    if (stillValid) return;

    const autoId =
      matchingBooths.length === 1
        ? String(matchingBooths[0].boothId || matchingBooths[0].id)
        : '';
    setScheduleForm((prev) => ({ ...prev, boothId: autoId }));
  }), [scheduleForm.vaccineType, scheduleForm.boothId, matchingBooths]);

  // Soft stock horizon preview (does not deduct vials)
  useEffect(() => deferEffectCallback(() => {
    if (!scheduleForm.vaccineType || !scheduleForm.startTime || !scheduleForm.endTime) {
      setStockHorizon(null);
      return undefined;
    }

    const isWeekly = scheduleForm.scheduleType === 'Weekly';
    if (isWeekly && (!scheduleForm.startDate || scheduleForm.daysOfWeek.length === 0)) {
      setStockHorizon(null);
      return undefined;
    }
    if (!isWeekly && !scheduleForm.specificDate) {
      setStockHorizon(null);
      return undefined;
    }

    const selectedVac = vaccines.find((v) => v.name === scheduleForm.vaccineType);
    const timer = setTimeout(async () => {
      try {
        setLoadingHorizon(true);
        const data = await scheduleService.getStockHorizon({
          vaccineId: selectedVac?.id || null,
          vaccineName: scheduleForm.vaccineType,
          scheduleType: scheduleForm.scheduleType,
          specificDate: isWeekly ? null : scheduleForm.specificDate,
          daysOfWeek: isWeekly ? scheduleForm.daysOfWeek : [],
          startDate: isWeekly ? scheduleForm.startDate : null,
          endDate: isWeekly ? scheduleForm.endDate : null,
          startTime: scheduleForm.startTime,
          endTime: scheduleForm.endTime,
        });
        setStockHorizon(data);

        const maxEnd = data?.maxEndDate || data?.MaxEndDate;
        if (
          isWeekly &&
          maxEnd &&
          scheduleForm.endDate &&
          String(scheduleForm.endDate) > String(maxEnd)
        ) {
          setScheduleForm((prev) => ({ ...prev, endDate: String(maxEnd).slice(0, 10) }));
        }
      } catch (err) {
        setStockHorizon({
          canCreate: false,
          message: err.message || 'Could not estimate stock coverage.',
        });
      } finally {
        setLoadingHorizon(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }), [
    scheduleForm.vaccineType,
    scheduleForm.scheduleType,
    scheduleForm.specificDate,
    scheduleForm.daysOfWeek,
    scheduleForm.startDate,
    scheduleForm.endDate,
    scheduleForm.startTime,
    scheduleForm.endTime,
    vaccines,
  ]);

  const handleScheduleChange = (e) => {
    const { name, value } = e.target;
    setScheduleForm((prev) => {
      const next = {
        ...prev,
        [name]: value,
        ...(name === 'vaccineType' ? { boothId: '' } : {}),
      };
      if (name === 'vaccineType') {
        const vac = vaccines.find((v) => v.name === value);
        next.price = vac ? Number(vac.price || 0).toFixed(2) : '0.00';
      }

      // When landing on today (or changing times), never keep a past start.
      const sessionDate =
        next.scheduleType === 'Weekly' ? next.startDate : next.specificDate;
      if (name === 'specificDate' || name === 'startDate') {
        if (sessionDate === todayStr) {
          const win = defaultWindowForDate(todayStr);
          if (next.startTime < win.startTime) {
            next.startTime = win.startTime;
            next.endTime = win.endTime;
          }
        }
      }
      if ((name === 'startTime' || name === 'endTime') && sessionDate === todayStr) {
        const minStart = nextClinicStartHm();
        if (next.startTime < minStart) next.startTime = minStart;
        if (next.endTime <= next.startTime) next.endTime = addHoursHm(next.startTime, 2);
      }
      return next;
    });
  };

  const handleToggleDay = (dayKey) => {
    setScheduleForm((prev) => {
      const exists = prev.daysOfWeek.includes(dayKey);
      const nextDays = exists
        ? prev.daysOfWeek.filter((d) => d !== dayKey)
        : [...prev.daysOfWeek, dayKey];
      return { ...prev, daysOfWeek: nextDays };
    });
  };

  const handleSelectAllDays = () => {
    setScheduleForm((prev) => ({
      ...prev,
      daysOfWeek: DAYS_OF_WEEK.map((d) => d.key),
    }));
  };

  const handleSelectWeekdays = () => {
    setScheduleForm((prev) => ({
      ...prev,
      daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    }));
  };

  // Submit and save new schedule slot to database
  const handleAddSchedule = async (e) => {
    e.preventDefault();

    if (!scheduleForm.vaccineType) {
      alert('Please select a Vaccine Type.');
      return;
    }
    if (!scheduleForm.boothId) {
      alert('Please select a Booth for this schedule.');
      return;
    }
    if (!scheduleForm.startTime || !scheduleForm.endTime) {
      alert('Please select both Start Time and End Time.');
      return;
    }

    const isWeekly = scheduleForm.scheduleType === 'Weekly';
    if (isWeekly) {
      if (scheduleForm.daysOfWeek.length === 0) {
        alert('Please select at least one day of the week (e.g. Mon, Wed).');
        return;
      }
      if (!scheduleForm.startDate || !scheduleForm.endDate) {
        alert('Please specify the Start Date and End Date range for recurring weekly slots.');
        return;
      }
      if (scheduleForm.endDate < scheduleForm.startDate) {
        alert('End Date cannot be earlier than Start Date.');
        return;
      }
    } else {
      if (!scheduleForm.specificDate) {
        alert('Please select a Date for the one-time schedule.');
        return;
      }
      if (scheduleForm.specificDate < todayStr) {
        alert('One-time schedule date cannot be in the past.');
        return;
      }
    }

    if (scheduleForm.endTime <= scheduleForm.startTime) {
      alert('End time must be after start time.');
      return;
    }

    const sessionDate = isWeekly ? scheduleForm.startDate : scheduleForm.specificDate;
    if (sessionDate === todayStr) {
      const nowHm = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Colombo',
      });
      if (scheduleForm.startTime < nowHm) {
        alert('Schedule start time cannot be in the past for today.');
        return;
      }
    }

    if (isWeekly && scheduleForm.startDate && scheduleForm.startDate < todayStr) {
      alert('Weekly schedule start date cannot be in the past.');
      return;
    }
    if (isWeekly && scheduleForm.endDate && scheduleForm.endDate < todayStr) {
      alert('Weekly schedule end date cannot be in the past.');
      return;
    }

    // Validate price
    const parsedPrice = parseFloat(scheduleForm.price || 0);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      alert('Please specify a valid vaccine price (enter 0 for free / subsidized vaccinations).');
      return;
    }

    if (stockHorizon && stockHorizon.canCreate === false) {
      showToast(stockHorizon.message || 'Not enough stock to post this schedule window.', 'warning');
      return;
    }

    const selectedVac = vaccines.find((v) => v.name === scheduleForm.vaccineType);

    const payload = {
      boothId: scheduleForm.boothId,
      vaccineId: selectedVac?.id || null,
      vaccineName: scheduleForm.vaccineType,
      scheduleType: scheduleForm.scheduleType,
      specificDate: isWeekly ? null : scheduleForm.specificDate,
      daysOfWeek: isWeekly ? scheduleForm.daysOfWeek : [],
      startDate: isWeekly ? scheduleForm.startDate : null,
      endDate: isWeekly ? scheduleForm.endDate : null,
      startTime: scheduleForm.startTime,
      endTime: scheduleForm.endTime,
      price: parsedPrice,
    };

    try {
      setSubmitting(true);
      await scheduleService.createSchedule(payload);
      showToast('Immunization schedule slot created and saved to database successfully!', 'success');

      // Reset form — default window avoids past times for today
      const resetWindow = defaultWindowForDate(todayStr);
      setScheduleForm({
        scheduleType: 'OneTime',
        vaccineType: '',
        boothId: '',
        specificDate: todayStr,
        daysOfWeek: ['Monday', 'Wednesday', 'Friday'],
        startDate: todayStr,
        endDate: defaultEndDateStr,
        startTime: resetWindow.startTime,
        endTime: resetWindow.endTime,
        price: '0.00',
      });

      await loadSchedules();
    } catch (err) {
      showToast(`Failed to save schedule: ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Cancel schedule in database
  const handleCancelSchedule = async (id) => {
    if (!window.confirm(
      'Cancel this immunization schedule? This is blocked if patients still have upcoming appointments on it.'
    )) {
      return;
    }

    try {
      await scheduleService.cancelSchedule(id);
      showToast('Schedule slot cancelled.', 'success');
      await loadSchedules();
    } catch (err) {
      showToast(err.message || 'Failed to cancel schedule.', 'error');
    }
  };

  const handleAcceptAppointment = async (id) => {
    try {
      await appointmentService.updateAppointmentStatus(id, { status: 'Confirmed' });
      showToast('Appointment confirmed (payment recorded if it was awaiting payment).', 'success');
      await loadHospitalAppointments();
    } catch (err) {
      showToast(`Failed to confirm appointment: ${err.message}`, 'error');
    }
  };

  const handleRejectAppointment = async (id) => {
    if (!window.confirm('Decline this appointment? The patient will see it as rejected.')) return;
    try {
      await appointmentService.updateAppointmentStatus(id, { status: 'Rejected' });
      showToast('Appointment declined.', 'warning');
      await loadHospitalAppointments();
    } catch (err) {
      showToast(`Failed to decline appointment: ${err.message}`, 'error');
    }
  };

  const handleCancelAppointment = async (id) => {
    if (!window.confirm('Cancel this confirmed appointment?')) return;
    try {
      await appointmentService.cancelAppointment(id);
      showToast('Appointment cancelled.', 'warning');
      await loadHospitalAppointments();
    } catch (err) {
      showToast(`Failed to cancel appointment: ${err.message}`, 'error');
    }
  };

  // Filter appointments according to filterDate
  const filteredAppointments = filterDate
    ? appointments.filter((app) => (app.appointmentDate || app.date) === filterDate)
    : appointments;

  return (
    <div className="hospital-manage-appointments-wrapper">
      <HospitalSubpageHero
        eyebrow="Appointment operations"
        title="Schedules & appointments"
        subtitle="Publish vaccination sessions, manage recurring availability, and monitor today’s hospital appointments."
      />
      {notification && (
        <div
          className="appointment-alert-pill"
          role="status"
          style={{
            maxWidth: '1060px',
            width: '100%',
            marginBottom: '20px',
            ...(toastStyles[notificationTone] || toastStyles.success),
          }}
        >
          {notification}
        </div>
      )}

      {/* Main Outer Card Container */}
      <div className="hospital-manage-appointments-card">
        <h1 className="hospital-manage-title">
          Manage Your Appointments
        </h1>

        {/* 1. Create a new schedule Card */}
        <div className="schedule-create-box">
          <h2 className="schedule-create-title">
            Create a new schedule
          </h2>

          <form onSubmit={handleAddSchedule}>
            {/* Recurrence Selector Bar */}
            <div className="schedule-recurrence-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text-title)' }}>
                  Recurrence Frequency:
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-body)' }}>
                  (Choose single day or weekly repeating days)
                </span>
              </div>

              <div className="schedule-recurrence-options">
                <button
                  type="button"
                  className={`schedule-type-btn ${scheduleForm.scheduleType === 'OneTime' ? 'active' : ''}`}
                  onClick={() => setScheduleForm((prev) => ({ ...prev, scheduleType: 'OneTime' }))}
                >
                  Single Date Only
                </button>
                <button
                  type="button"
                  className={`schedule-type-btn ${scheduleForm.scheduleType === 'Weekly' ? 'active' : ''}`}
                  onClick={() => setScheduleForm((prev) => ({ ...prev, scheduleType: 'Weekly' }))}
                >
                  Recurring Weekly
                </button>
              </div>
            </div>

            {/* Recurring Weekly: Days of Week Multi-Selector */}
            {scheduleForm.scheduleType === 'Weekly' && (
              <div className="schedule-days-container">
                <div className="schedule-days-label-row">
                  <label className="schedule-input-label" style={{ margin: 0 }}>
                    Select Days of the Week (1 or more days):
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="schedule-quick-btn"
                      onClick={handleSelectWeekdays}
                    >
                      Weekdays (Mon-Fri)
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      className="schedule-quick-btn"
                      onClick={handleSelectAllDays}
                    >
                      All 7 Days
                    </button>
                  </div>
                </div>

                <div className="schedule-days-pills-row">
                  {DAYS_OF_WEEK.map((day) => {
                    const isSelected = scheduleForm.daysOfWeek.includes(day.key);
                    return (
                      <button
                        key={day.key}
                        type="button"
                        className={`schedule-day-pill ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleToggleDay(day.key)}
                      >
                        {day.key} ({day.label})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="schedule-inputs-row">
              {/* Vaccine Type Dropdown */}
              <div className="schedule-input-group">
                <label htmlFor="schedule-vaccineType" className="schedule-input-label">Vaccine Type</label>
                <select
                  name="vaccineType"
                  id="schedule-vaccineType"
                  value={scheduleForm.vaccineType}
                  onChange={handleScheduleChange}
                  className="schedule-input-field schedule-select-field"
                  required
                >
                  <option value="">
                    {loadingOptions
                      ? 'Loading vaccines...'
                      : vaccines.length === 0
                      ? '-- No formulary vaccines found --'
                      : '-- Select Vaccine --'}
                  </option>
                  {vaccines.map((v) => (
                    <option key={v.id} value={v.name}>
                      {v.name} {v.manufacturer ? `(${v.manufacturer})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Booth Dropdown — filtered to booths that offer the selected vaccine */}
              <div className="schedule-input-group">
                <label htmlFor="schedule-boothId" className="schedule-input-label">Booth</label>
                <select
                  name="boothId"
                  id="schedule-boothId"
                  value={scheduleForm.boothId}
                  onChange={handleScheduleChange}
                  className="schedule-input-field schedule-select-field"
                  required
                  disabled={!scheduleForm.vaccineType}
                >
                  <option value="">
                    {!scheduleForm.vaccineType
                      ? '-- Select vaccine first --'
                      : loadingOptions
                      ? 'Loading booths...'
                      : matchingBooths.length === 0
                      ? '-- No booth offers this vaccine --'
                      : '-- Select Booth --'}
                  </option>
                  {matchingBooths.map((b) => {
                    const id = b.boothId || b.id;
                    return (
                      <option key={id} value={id}>
                        {b.displayLabel || `${b.code} · ${b.name}`}
                      </option>
                    );
                  })}
                </select>
                {scheduleForm.vaccineType && !loadingOptions && matchingBooths.length === 0 ? (
                  <p className="schedule-field-hint" style={{ margin: '6px 0 0', color: 'var(--color-warning)', fontSize: '0.82rem' }}>
                    Add this vaccine to a booth under Staff → Booths, then come back to post the schedule.
                  </p>
                ) : null}
              </div>

              {/* Times first — seats/session depend on the window before date range is capped */}
              <div className="schedule-input-group">
                <label htmlFor="schedule-startTime" className="schedule-input-label">Start Time</label>
                <input
                  type="time"
                  name="startTime"
                  id="schedule-startTime"
                  value={scheduleForm.startTime}
                  min={
                    (scheduleForm.scheduleType === 'Weekly'
                      ? scheduleForm.startDate
                      : scheduleForm.specificDate) === todayStr
                      ? hospitalNowHm()
                      : undefined
                  }
                  onChange={handleScheduleChange}
                  className="schedule-input-field"
                  required
                />
              </div>

              <div className="schedule-input-group">
                <label htmlFor="schedule-endTime" className="schedule-input-label">End Time</label>
                <input
                  type="time"
                  name="endTime"
                  id="schedule-endTime"
                  value={scheduleForm.endTime}
                  min={scheduleForm.startTime || undefined}
                  onChange={handleScheduleChange}
                  className="schedule-input-field"
                  required
                />
              </div>

              {/* Date Inputs based on Recurrence */}
              {scheduleForm.scheduleType === 'OneTime' ? (
                <div className="schedule-input-group">
                  <label htmlFor="schedule-specificDate" className="schedule-input-label">Specific Date</label>
                  <input
                    type="date"
                    name="specificDate"
                    id="schedule-specificDate"
                    value={scheduleForm.specificDate}
                    min={todayStr}
                    onChange={handleScheduleChange}
                    className="schedule-input-field"
                    required
                  />
                </div>
              ) : (
                <>
                  <div className="schedule-input-group">
                    <label className="schedule-input-label">Active From (Start Date)</label>
                    <input
                      type="date"
                      name="startDate"
                      value={scheduleForm.startDate}
                      min={todayStr}
                      onChange={handleScheduleChange}
                      className="schedule-input-field"
                      required
                    />
                  </div>

                  <div className="schedule-input-group">
                    <label className="schedule-input-label">Active Until (End Date)</label>
                    <input
                      type="date"
                      name="endDate"
                      value={scheduleForm.endDate}
                      min={scheduleForm.startDate || todayStr}
                      max={
                        (stockHorizon?.maxEndDate || stockHorizon?.MaxEndDate)
                          ? String(stockHorizon.maxEndDate || stockHorizon.MaxEndDate).slice(0, 10)
                          : undefined
                      }
                      onChange={handleScheduleChange}
                      className="schedule-input-field"
                      required
                    />
                  </div>
                </>
              )}

              {/* Fee inherited from formulary Free/Paid tag — same field chrome as other inputs */}
              <div className="schedule-input-group">
                <label className="schedule-input-label">
                  Fee / person
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-text-body)', fontWeight: 'normal', marginLeft: '6px' }}>
                    (from formulary)
                  </span>
                </label>
                <input
                  type="text"
                  className="schedule-input-field"
                  value={
                    selectedVaccine
                      ? Number(selectedVaccine.price || 0) <= 0
                        ? 'Free'
                        : `LKR ${Number(selectedVaccine.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                      : 'Select a vaccine first'
                  }
                  disabled
                  readOnly
                  title="Change this under Inventory → Formulary"
                />
              </div>
            </div>

            {(loadingHorizon || stockHorizon) && (() => {
              const h = stockHorizon || {};
              const blocked = h.canCreate === false;
              const free = h.freeDoses ?? h.FreeDoses;
              const seats = h.seatsPerSession ?? h.SeatsPerSession;
              const reserved = h.committedDoses ?? h.CommittedDoses;
              const buffer = h.emergencyBufferDoses ?? h.EmergencyBufferDoses ?? 2;
              const physical = h.physicalDoses ?? h.PhysicalDoses;
              const maxEnd = h.maxEndDate || h.MaxEndDate;
              const tone = loadingHorizon
                ? toastStyles.info
                : blocked
                ? toastStyles.warning
                : toastStyles.success;
              const headline = loadingHorizon
                ? 'Checking stock coverage for this clinic window…'
                : blocked
                ? 'Not enough free stock for this window'
                : maxEnd && scheduleForm.scheduleType === 'Weekly'
                ? `Stock can cover this window until ${String(maxEnd).slice(0, 10)}`
                : 'Enough free stock for this clinic window';

              const chip = (label, value, hint) => (
                <div
                  key={label}
                  style={{
                    flex: '1 1 120px',
                    minWidth: '110px',
                    background: 'rgba(255,255,255,0.72)',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    border: '1px solid rgba(var(--rgb-primary-dark), 0.06)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-body)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                    {label}
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 750, color: 'var(--color-text-title)', marginTop: '2px' }}>
                    {value}
                  </div>
                  {hint ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-body)', marginTop: '2px', fontWeight: 500 }}>
                      {hint}
                    </div>
                  ) : null}
                </div>
              );

              return (
                <div
                  role="status"
                  style={{
                    margin: '14px 0 0',
                    padding: '14px 16px',
                    borderRadius: '14px',
                    ...tone,
                  }}
                >
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: loadingHorizon ? 0 : '10px' }}>
                    {headline}
                  </div>
                  {!loadingHorizon && typeof free === 'number' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {chip('On shelf', physical ?? '—', 'all lots of this vaccine')}
                      {chip('Already planned', reserved ?? 0, 'other active schedules')}
                      {chip('Emergency hold', buffer, 'kept aside')}
                      {chip('Free to schedule', free, seats != null ? `this window needs ${seats}` : undefined)}
                    </div>
                  )}
                  {!loadingHorizon && blocked && h.message ? (
                    <p style={{ margin: '10px 0 0', fontSize: '0.82rem', fontWeight: 600, opacity: 0.9 }}>
                      Tip: shorten the hours/date range, cancel overlapping schedules, or restock.
                    </p>
                  ) : null}
                </div>
              );
            })()}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
              <button
                type="submit"
                className="btn-add-schedule"
                disabled={
                  submitting ||
                  loadingHorizon ||
                  vaccines.length === 0 ||
                  booths.length === 0 ||
                  (Boolean(scheduleForm.vaccineType) && matchingBooths.length === 0) ||
                  stockHorizon?.canCreate === false
                }
                title={
                  stockHorizon?.canCreate === false
                    ? stockHorizon.message || 'Not enough stock for this timeline'
                    : vaccines.length === 0
                    ? 'Please ensure vaccines are registered in your hospital formulary'
                    : booths.length === 0
                    ? 'Please configure at least one active booth under Booths'
                    : scheduleForm.vaccineType && matchingBooths.length === 0
                    ? 'No booth offers this vaccine yet — assign it on a booth first'
                    : 'Save schedule slot to database'
                }
              >
                {submitting ? 'Saving...' : 'Add Schedule'}
              </button>
            </div>
          </form>
        </div>

        {/* 2. Schedules Table Section */}
        <div style={{ marginBottom: '38px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 className="schedule-section-heading" style={{ margin: 0 }}>
              Active Schedules
            </h2>
            <button
              type="button"
              className="hospital-filter-btn"
              onClick={loadSchedules}
              disabled={loadingSchedules}
              title="Refresh schedules from database"
            >
              <IconRefresh size={14} /> Refresh
            </button>
          </div>

          <div className="hospital-appointments-table-wrapper">
            <table className="hospital-appointments-mockup-table">
              <thead>
                <tr>
                  <th style={{ width: '20%' }}>Vaccine</th>
                  <th style={{ width: '18%' }}>Booth</th>
                  <th style={{ width: '28%' }}>Schedule / Recurrence</th>
                  <th style={{ width: '14%' }}>Time Slot</th>
                  <th style={{ width: '12%' }}>Fee (Per Person)</th>
                  <th style={{ width: '8%', borderRight: 'none' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingSchedules ? (
                  <tr>
                    <td colSpan={6} className="empty-table-cell">
                      Loading saved schedules from database...
                    </td>
                  </tr>
                ) : schedules.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-table-cell">
                      No active schedules created yet. Use the form above to add one-time or weekly recurring slots.
                    </td>
                  </tr>
                ) : (
                  schedules.map((item) => (
                    <tr key={item.id}>
                      <td>{item.vaccineName}</td>
                      <td>{item.boothLabel || '—'}</td>
                      <td style={{ fontSize: '0.92rem' }}>
                        {item.scheduleType === 'Weekly' ? (
                          <div>
                            <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>Weekly: </span>
                            <span>{item.daysOfWeek?.join(', ') || 'Weekly'}</span>
                            {item.startDate && item.endDate && (
                              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-body)', marginTop: '2px' }}>
                                ({item.startDate} to {item.endDate})
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>One-Time: </span>
                            <span>{item.specificDate || item.date}</span>
                          </div>
                        )}
                      </td>
                      <td>{item.formattedTime || `${item.startTime} - ${item.endTime}`}</td>
                      <td>
                        {item.price && Number(item.price) > 0 ? (
                          <span style={{ fontWeight: 700, color: 'var(--color-info)' }}>
                            LKR {Number(item.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>
                            Free (0 LKR)
                          </span>
                        )}
                      </td>
                      <td style={{ borderRight: 'none' }}>
                        <button
                          type="button"
                          className="btn-cancel-schedule"
                          onClick={() => handleCancelSchedule(item.id)}
                          title="Cancel and remove schedule slot"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Appointments Table Section with Date Filter */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <h2 className="schedule-section-heading" style={{ margin: 0 }}>
              Appointments
            </h2>

            {/* Filter Date Bar */}
            <div className="hospital-filter-group">
                <label htmlFor="hospital-filter-date" className="hospital-filter-label">
                  <IconCalendar size={14} aria-hidden="true" /> Filter Date:
                </label>
              <input
                id="hospital-filter-date"
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="hospital-filter-date-input"
                aria-label="Filter appointments by date"
              />
              <button
                type="button"
                className={`hospital-filter-btn ${!filterDate ? 'active' : ''}`}
                onClick={() => setFilterDate('')}
              >
                All Dates ({appointments.length})
              </button>
              {filterDate && (
                <button
                  type="button"
                  className="hospital-filter-btn active"
                  onClick={() => setFilterDate(filterDate)}
                >
                  {filterDate}
                </button>
              )}
            </div>
          </div>

          <div className="hospital-appointments-table-wrapper">
            <table className="hospital-appointments-mockup-table">
              <thead>
                <tr>
                  <th style={{ width: '22%' }}>P-Name</th>
                  <th style={{ width: '18%' }}>Date</th>
                  <th style={{ width: '18%' }}>Time</th>
                  <th style={{ width: '22%' }}>Vaccine</th>
                  <th style={{ width: '20%', borderRight: 'none', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredAppointments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-table-cell">
                      No patient appointments found for date {filterDate || 'all dates'}.{' '}
                      {filterDate && (
                        <button
                          type="button"
                          onClick={() => setFilterDate('')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-primary)',
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
                  filteredAppointments.map((item) => (
                    <tr key={item.id || item.Id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-title)' }}>{item.patientName || item.pName || 'Patient'}</div>
                        {item.patientPhone && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-body)', marginTop: '2px' }}>
                            Tel: {item.patientPhone}
                          </div>
                        )}
                      </td>
                      <td>{item.appointmentDate || item.date}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                          {item.timeSlot || item.time}
                        </span>
                      </td>
                      <td>{item.vaccineName || item.vaccine}</td>
                      <td style={{ borderRight: 'none', textAlign: 'center' }}>
                        {(() => {
                          const display = getAppointmentActionDisplay(item.status);
                          if (display.kind === 'actions-pending') {
                            return (
                              <div className="hospital-action-buttons-wrapper">
                                <button
                                  type="button"
                                  className="btn-hospital-confirm-action"
                                  title="Accept and Confirm Appointment"
                                  onClick={() => handleAcceptAppointment(item.id || item.Id)}
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  className="btn-hospital-cancel-action"
                                  title="Decline Appointment"
                                  onClick={() => handleRejectAppointment(item.id || item.Id)}
                                >
                                  ✕ Decline
                                </button>
                              </div>
                            );
                          }
                          if (display.kind === 'actions-payment') {
                            return (
                              <div className="hospital-action-buttons-wrapper">
                                <span className={`mockup-status-badge ${display.tone}`}>
                                  {display.label}
                                </span>
                                <button
                                  type="button"
                                  className="btn-hospital-confirm-action"
                                  title="Record desk/cash payment and confirm the appointment"
                                  onClick={() => handleAcceptAppointment(item.id || item.Id)}
                                >
                                  Mark paid
                                </button>
                                <button
                                  type="button"
                                  className="btn-hospital-cancel-action"
                                  title="Decline unpaid appointment"
                                  onClick={() => handleRejectAppointment(item.id || item.Id)}
                                >
                                  ✕ Decline
                                </button>
                              </div>
                            );
                          }
                          if (display.kind === 'badge-cancel') {
                            return (
                              <div className="hospital-action-buttons-wrapper">
                                <span className={`mockup-status-badge ${display.tone}`}>
                                  {display.label}
                                </span>
                                <button
                                  type="button"
                                  className="btn-hospital-cancel-action"
                                  onClick={() => handleCancelAppointment(item.id || item.Id)}
                                  title="Cancel appointment"
                                >
                                  Cancel
                                </button>
                              </div>
                            );
                          }
                          return (
                            <div className="hospital-action-buttons-wrapper">
                              <span className={`mockup-status-badge ${display.tone}`}>
                                {display.label}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
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
