import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUser } from '../../auth/services/authService';
import inventoryService from '../../hospital/services/inventoryService';
import staffService from '../../hospital/services/staffService';
import ClinicalPrescribeModal from '../../doctor/components/ClinicalPrescribeModal';
import staffAppointmentService from '../services/staffAppointmentService';
import { hospitalMinutesNow, hospitalToday } from '../../hospital/utils/hospitalDate';
import {
  IconCalendar,
  IconCheck,
  IconClipboard,
  IconClock,
  IconHospital,
  IconPencil,
  IconRefresh,
  IconShield,
  IconStethoscope,
  IconSyringe,
  IconUser,
} from '../../../shared/icons/AppIcons';

const OBSERVATION_WINDOW_MINUTES = 15;

/** Minutes still remaining in the observation window, or null when the start time is unknown. */
function observationMinutesLeft(administeredAt, now) {
  if (!administeredAt) return null;
  const startedAt = new Date(administeredAt).getTime();
  if (Number.isNaN(startedAt)) return null;
  const elapsedMinutes = (now - startedAt) / 60000;
  return Math.max(0, Math.ceil(OBSERVATION_WINDOW_MINUTES - elapsedMinutes));
}

function greetingForNow(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function mapDbStatusToUi(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'completed';
  if (s === 'observation') return 'observation';
  if (s === 'administering') return 'consulting';
  if (s === 'cancelled' || s === 'rejected') return 'cancelled';
  // PendingPayment and Confirmed both show in the waiting queue;
  // paymentStatus decides "In Queue" vs "Awaiting payment".
  return 'waiting';
}

function pickDefaultHospitalId(active, preferredId) {
  const live = active.find((a) => a.isOnDutyNow);
  if (live) return live.hospitalUserId;
  if (preferredId && active.some((a) => a.hospitalUserId === preferredId)) {
    return preferredId;
  }
  return active[0]?.hospitalUserId || '';
}

const DUTY_REQUIRED_HINT = 'Clock in to start clinical work';

function presenceLabel(affiliation) {
  if (!affiliation) return null;
  if (String(affiliation.dutyStatus || '').toLowerCase() === 'onbreak') return 'On break';
  if (affiliation.isOnDutyNow) return affiliation.isClockedIn ? 'Clocked in' : 'On shift';
  return 'Not on duty';
}

function clockToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeBooth(value) {
  return String(value || '').trim().toLowerCase();
}

function isPaymentSettled(patientOrStatus) {
  const value =
    typeof patientOrStatus === 'string'
      ? patientOrStatus
      : patientOrStatus?.paymentStatus;
  return String(value || '').toLowerCase() === 'paid';
}

/**
 * Shared doctor/nurse home: today's queue, observation watch, and status transitions.
 * Role-specific chrome (hero image, title, modals, labels) is passed in by the wrappers.
 */
export default function StaffClinicalDashboard({
  formatTitle,
  heroImage,
  heroClassName = '',
  spotlightBadge,
  allowHospitalSwitch = false,
  AdministerModal,
  AefiModal,
}) {
  const [isAdministerModalOpen, setIsAdministerModalOpen] = useState(false);
  const [isAefiModalOpen, setIsAefiModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [toastMessage, setToastMessage] = useState(null);
  const [user] = useState(() => getUser());
  const isDoctor = String(user?.role || '').toUpperCase() === 'DOCTOR';
  const [prescribeTargetId, setPrescribeTargetId] = useState(null);
  const [affiliations, setAffiliations] = useState([]);
  const [selectedHospitalUserId, setSelectedHospitalUserId] = useState('');
  const [todayAppointments, setTodayAppointments] = useState([]);
  const [inventoryLots, setInventoryLots] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [dutyUpdating, setDutyUpdating] = useState(false);
  const [todayShifts, setTodayShifts] = useState([]);
  // 'mine' = patients at the booth of my live shift (plus unassigned), 'all' = whole hospital.
  const [boothScope, setBoothScope] = useState('mine');
  const [activePatientId, setActivePatientId] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [hospitalMenuOpen, setHospitalMenuOpen] = useState(false);
  const [contactCache, setContactCache] = useState({});
  const [contactLoadingId, setContactLoadingId] = useState(null);
  const toastTimerRef = useRef(null);
  const hospitalMenuRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    if (!hospitalMenuOpen) return undefined;
    const onPointerDown = (event) => {
      if (hospitalMenuRef.current && !hospitalMenuRef.current.contains(event.target)) {
        setHospitalMenuOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setHospitalMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [hospitalMenuOpen]);

  const loadDashboardData = useCallback(async (hospitalOverride) => {
    setStatsLoading(true);
    setLoadError('');
    try {
      const list = await staffService.getMyAffiliations();
      const active = Array.isArray(list) ? list : [];
      setAffiliations(active);

      // Always prefer the hospital where staff are on duty now — even when the
      // switcher UI is hidden (nurses with one affiliation, or multi without switch).
      const hospitalId = pickDefaultHospitalId(
        active,
        hospitalOverride !== undefined ? hospitalOverride : selectedHospitalUserId
      );

      setSelectedHospitalUserId(hospitalId || '');

      if (!hospitalId) {
        setTodayAppointments([]);
        setInventoryLots([]);
        setActivePatientId(null);
        return;
      }

      const [appts, lots, shifts] = await Promise.all([
        staffAppointmentService.getHospitalAppointments(hospitalId, hospitalToday()),
        inventoryService.getInventory(hospitalId).catch(() => []),
        staffService.getMyShifts({ from: hospitalToday(), to: hospitalToday() }).catch(() => []),
      ]);
      setTodayShifts(Array.isArray(shifts) ? shifts : []);
      const rows = Array.isArray(appts) ? appts : [];
      setTodayAppointments(rows);
      setInventoryLots(Array.isArray(lots) ? lots : []);

      const administering = rows.find((a) => mapDbStatusToUi(a.status) === 'consulting');
      setActivePatientId((prev) => {
        if (prev && rows.some((a) => a.id === prev && mapDbStatusToUi(a.status) === 'consulting')) {
          return prev;
        }
        return administering?.id || null;
      });
    } catch (err) {
      setLoadError(err?.message || 'Could not load your clinical session. Check your connection and retry.');
      setAffiliations([]);
      setTodayAppointments([]);
      setInventoryLots([]);
      setSelectedHospitalUserId('');
      setActivePatientId(null);
    } finally {
      setStatsLoading(false);
    }
  }, [selectedHospitalUserId]);

  useEffect(() => {
    let cancelled = false;
    // Defer so setState inside loadDashboardData is not synchronous in this effect body.
    const timer = setTimeout(() => {
      if (!cancelled) loadDashboardData();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Initial load only — hospital switches call loadDashboardData explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heroDateLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    []
  );

  const primaryAffiliation =
    affiliations.find((a) => a.hospitalUserId === selectedHospitalUserId) || affiliations[0];
  const displayTitle = formatTitle(user);
  const greeting = greetingForNow();
  const dutyText = presenceLabel(primaryAffiliation);
  // Clinical actions need a live shift or a clock-in (the backend enforces the same rule).
  const notOnDuty = Boolean(primaryAffiliation) && !primaryAffiliation.isOnDutyNow;
  const onBreak = String(primaryAffiliation?.dutyStatus || '').toLowerCase() === 'onbreak';

  const handleDutyChange = async (nextStatus) => {
    if (!primaryAffiliation?.affiliationId) return;
    setDutyUpdating(true);
    try {
      await staffService.updateDutyStatus(primaryAffiliation.affiliationId, nextStatus);
      showToast(
        nextStatus === 'OnDuty'
          ? 'You are on duty. Clinical actions are unlocked.'
          : nextStatus === 'OnBreak'
            ? 'Break started. Clinical actions are paused.'
            : 'Clocked out.'
      );
      await loadDashboardData(selectedHospitalUserId);
    } catch (err) {
      showToast(err?.message || 'Could not update your duty status.');
    } finally {
      setDutyUpdating(false);
    }
  };

  const revealPatientContact = useCallback(
    async (appointmentId) => {
      if (contactCache[appointmentId]) return contactCache[appointmentId];

      setContactLoadingId(appointmentId);
      try {
        const data = await staffAppointmentService.getPatientContact(appointmentId);
        setContactCache((prev) => ({ ...prev, [appointmentId]: data }));
        return data;
      } catch (err) {
        showToast(err.message || 'Could not load contact details.');
        return null;
      } finally {
        setContactLoadingId(null);
      }
    },
    [contactCache, showToast]
  );

  const todayTotal = todayAppointments.length;
  const todayCompleted = todayAppointments.filter((a) => a.status === 'Completed').length;
  const todayUpcoming = todayAppointments.filter((a) => {
    const s = String(a.status || '').toLowerCase();
    return s === 'confirmed' || s === 'pendingpayment';
  }).length;
  const todayNeedsDosage = todayAppointments.filter(
    (a) => a.status === 'Confirmed' && !a.prescribedDosage
  ).length;

  const patients = useMemo(() => {
    return todayAppointments.map((a) => {
      const id = a.id;
      const status = mapDbStatusToUi(a.status);
      const short = String(id).replace(/-/g, '').slice(0, 4).toUpperCase();
      return {
        id,
        token: `T-${short}`,
        patientProfileId: a.patientProfileId || null,
        name: a.patientName || 'Patient',
        vaccine: a.vaccineName || '—',
        dose: a.prescribedDosage || 'Dosage not set',
        hasDosage: Boolean(a.prescribedDosage),
        prescribedBy: a.prescribedByDoctorName || null,
        paymentStatus: a.paymentStatus || '—',
        checkedIn: Boolean(a.checkedInAt),
        booth: a.boothLabel || null,
        boothId: a.boothId || null,
        time: a.timeSlot || [a.startTime, a.endTime].filter(Boolean).join(' – ') || '—',
        status,
        appointmentStatus: a.status,
        notes: a.notes || '',
        updatedAt: a.updatedAt || a.dosageUpdatedAt || null,
      };
    });
  }, [todayAppointments]);

  // Booth of my live shift at this hospital, if any. Clock-ins without a shift have none.
  const myBooth = useMemo(() => {
    const nowMinutes = hospitalMinutesNow();
    const live = todayShifts.find((s) => {
      if (primaryAffiliation && s.affiliationId !== primaryAffiliation.affiliationId) return false;
      const start = clockToMinutes(s.startTime);
      const end = clockToMinutes(s.endTime);
      return start != null && end != null && start <= nowMinutes && nowMinutes < end;
    });
    if (!live || (!live.boothId && !live.boothOrStation)) return null;
    return { id: live.boothId || null, label: live.boothOrStation || 'My booth' };
    // `now` ticks every 30s so the booth follows shift changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayShifts, primaryAffiliation, now]);

  const boothFiltered = Boolean(myBooth) && boothScope === 'mine';
  // Patients without a booth (e.g. walk-ins at a hospital with no booths) stay visible to everyone.
  const scopedPatients = useMemo(() => {
    if (!boothFiltered) return patients;
    return patients.filter((p) => {
      if (!p.booth && !p.boothId) return true;
      if (myBooth.id && p.boothId) return p.boothId === myBooth.id;
      return normalizeBooth(p.booth) === normalizeBooth(myBooth.label);
    });
  }, [patients, boothFiltered, myBooth]);

  const observationPatients = useMemo(
    () =>
      scopedPatients
        .filter((p) => p.status === 'observation')
        .map((p) => ({
          id: p.id,
          token: p.token,
          name: p.name,
          vaccine: p.vaccine,
          administeredTime: p.updatedAt
            ? new Date(p.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '—',
          minsLeft: observationMinutesLeft(p.updatedAt, now),
        })),
    [scopedPatients, now]
  );

  const activePatient = useMemo(
    () => patients.find((p) => p.id === activePatientId) || null,
    [patients, activePatientId]
  );

  const activePatientContact = activePatient ? contactCache[activePatient.id] : null;

  const activePaymentSettled = activePatient ? isPaymentSettled(activePatient) : true;

  useEffect(() => {
    if (!activePatient?.id) return undefined;
    if (activePatient.status !== 'consulting' && activePatient.status !== 'observation') {
      return undefined;
    }
    if (contactCache[activePatient.id]) return undefined;
    const patientId = activePatient.id;
    return deferEffectCallback(() => revealPatientContact(patientId));
  }, [activePatient?.id, activePatient?.status, contactCache, revealPatientContact]);

  const persistStatus = async (appointmentId, dbStatus) => {
    setStatusUpdating(true);
    try {
      await staffAppointmentService.updateAppointmentStatus(appointmentId, dbStatus);
      await loadDashboardData(selectedHospitalUserId);
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleCallNext = async () => {
    // Only call patients at my booth (or unassigned) so nobody is sent to the wrong booth.
    const nextWaiting = scopedPatients.find(
      (p) => p.status === 'waiting' && p.checkedIn && isPaymentSettled(p) && p.hasDosage
    );
    if (!nextWaiting) {
      const notArrived = scopedPatients.some((p) => p.status === 'waiting' && !p.checkedIn);
      const unpaidWaiting = scopedPatients.some(
        (p) => p.status === 'waiting' && !isPaymentSettled(p)
      );
      const undosedWaiting = scopedPatients.some(
        (p) => p.status === 'waiting' && isPaymentSettled(p) && !p.hasDosage
      );
      showToast(
        notArrived && !scopedPatients.some((p) => p.status === 'waiting' && p.checkedIn)
          ? 'No checked-in patients yet. Patients join the queue when they check in at the desk.'
          : undosedWaiting
          ? 'Paid patients are waiting for a doctor to prescribe their dose.'
          : unpaidWaiting
            ? 'No paid patients waiting. Unpaid appointments cannot be administered yet.'
            : boothFiltered
              ? `No more waiting patients at ${myBooth.label}. Switch to All booths to help elsewhere.`
              : "No more waiting patients in today's queue."
      );
      return;
    }

    const current = activePatientId
      ? patients.find((p) => p.id === activePatientId)
      : patients.find((p) => p.status === 'consulting');

    // Do not silently move consulting → Observation (that consumes inventory).
    if (current?.status === 'consulting') {
      showToast(
        `Finish ${current.name} (certify to observation) before calling the next patient.`
      );
      return;
    }

    try {
      await staffAppointmentService.updateAppointmentStatus(nextWaiting.id, 'Administering');
      setActivePatientId(nextWaiting.id);
      showToast(`Calling ${nextWaiting.name} (${nextWaiting.token})`);
      await loadDashboardData(selectedHospitalUserId);
    } catch (err) {
      showToast(err.message || 'Failed to call next patient.');
    }
  };

  const handleCheckIn = async (patient) => {
    setStatusUpdating(true);
    try {
      await staffAppointmentService.checkIn(patient.id);
      await loadDashboardData(selectedHospitalUserId);
      showToast(`${patient.name} checked in.`);
    } catch (err) {
      showToast(err.message || 'Failed to check in patient.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleSelectPatient = async (patient) => {
    if (patient.status === 'waiting') {
      if (!patient.checkedIn) {
        showToast('This patient has not checked in yet.');
        return;
      }
      if (!isPaymentSettled(patient)) {
        showToast('Payment must be settled before starting consultation.');
        return;
      }
      if (!patient.hasDosage) {
        showToast('A doctor must prescribe the dose before administration.');
        return;
      }
      try {
        setActivePatientId(patient.id);
        await persistStatus(patient.id, 'Administering');
      } catch (err) {
        setActivePatientId(null);
        showToast(err.message || 'Failed to start consultation.');
      }
      return;
    }

    // Spotlight only drives clinical actions for the active consulting patient.
    // Observation / completed rows can still be focused for read-only context.
    setActivePatientId(patient.id);
  };

  const handleCertifyAdministration = async (certifiedData) => {
    if (!isPaymentSettled(certifiedData)) {
      showToast('Payment must be settled before recording administration.');
      throw new Error('Payment not settled');
    }
    const current = patients.find((p) => p.id === certifiedData.id);
    if (current && current.status !== 'consulting') {
      showToast('Only a patient in active consultation can be certified to observation.');
      throw new Error('Invalid status for certify');
    }
    const details = certifiedData.administrationDetails || {};
    try {
      setStatusUpdating(true);
      await staffAppointmentService.updateAppointmentStatus(
        certifiedData.id,
        'Observation',
        undefined,
        {
          batchId: details.batchId || undefined,
          lotNumber: details.lotNumber || undefined,
          injectionSite: details.injectionSite || undefined,
          route: details.route || undefined,
          administrationNotes: details.notes || undefined,
          doseConfirmed: details.doseConfirmed,
          consentConfirmed: details.consentConfirmed,
          vitalsConfirmed: details.vitalsConfirmed,
        }
      );
      showToast(`Recorded administration for ${certifiedData.name}`);
      await loadDashboardData(selectedHospitalUserId);
    } catch (err) {
      showToast(err.message || 'Failed to move patient to observation.');
      throw err;
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleReturnToQueue = async (patient) => {
    if (patient.status !== 'consulting') {
      showToast('Only the active consulting patient can be returned to the waiting queue.');
      return;
    }
    if (!isPaymentSettled(patient)) {
      showToast('Unpaid appointments cannot be returned as Confirmed — settle payment at the desk first.');
      return;
    }
    try {
      await persistStatus(patient.id, 'Confirmed');
      if (activePatientId === patient.id) setActivePatientId(null);
      showToast(`${patient.name} returned to the waiting queue.`);
    } catch (err) {
      showToast(err.message || 'Failed to return the patient to the queue.');
    }
  };

  const handleDischargeObservation = async (id, name) => {
    const patient = patients.find((p) => p.id === id);
    if (patient && !isPaymentSettled(patient)) {
      showToast('Payment must be settled before discharging the patient.');
      return;
    }
    try {
      await persistStatus(id, 'Completed');
      if (activePatientId === id) setActivePatientId(null);
      showToast(`${name} discharged from observation.`);
    } catch (err) {
      showToast(err.message || 'Failed to discharge patient.');
    }
  };

  const handleHospitalChange = (hospitalUserId) => {
    setHospitalMenuOpen(false);
    setSelectedHospitalUserId(hospitalUserId);
    setActivePatientId(null);
    setFilterStatus('all');
    setSearchQuery('');
    setContactCache({});
    loadDashboardData(hospitalUserId);
  };

  const handleAefiSubmit = async (data) => {
    if (!activePatient?.id) {
      showToast('Select an active patient before reporting AEFI.');
      throw new Error('No active patient');
    }
    const severity = data.severity || 'Mild';

    try {
      setStatusUpdating(true);
      const result = await staffAppointmentService.reportAefi(activePatient.id, {
        ...data,
        severity,
        notifyDoctor: data.notifyDoctor !== false,
      });
      await loadDashboardData(selectedHospitalUserId);
      const bits = [];
      if (result?.documentedOnDose) bits.push('documented on dose');
      if (result?.followUpScheduled) bits.push('follow-up scheduled');
      if (result?.notifiedDoctor) bits.push('physician alerted');
      showToast(
        result?.message ||
          `AEFI (${severity}) saved for ${data.patientName || activePatient.name}${
            bits.length ? ` — ${bits.join(', ')}` : ''
          }.`
      );
    } catch (err) {
      showToast(err.message || 'Failed to submit AEFI report.');
      throw err;
    } finally {
      setStatusUpdating(false);
    }
  };

  const filteredPatients = scopedPatients.filter((p) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.token.toLowerCase().includes(q) ||
      p.vaccine.toLowerCase().includes(q);

    if (!matchesSearch) return false;
    if (filterStatus === 'all') return true;
    if (filterStatus === 'waiting') {
      return p.status === 'waiting' && isPaymentSettled(p);
    }
    if (filterStatus === 'awaiting_payment') {
      return p.status === 'waiting' && !isPaymentSettled(p);
    }
    return p.status === filterStatus;
  });

  const waitingCount = scopedPatients.filter(
    (p) => p.status === 'waiting' && isPaymentSettled(p)
  ).length;
  const awaitingPaymentCount = scopedPatients.filter(
    (p) =>
      p.status === 'waiting' &&
      !isPaymentSettled(p)
  ).length;
  const completedCount = scopedPatients.filter((p) => p.status === 'completed').length;
  const observationCount = scopedPatients.filter((p) => p.status === 'observation').length;
  // Show the switcher whenever staff have multiple affiliations (doctors + multi-hospital nurses).
  const showHospitalSwitch = (allowHospitalSwitch || affiliations.length > 1) && affiliations.length > 1;
  const canCertifyActive = activePatient?.status === 'consulting' && activePaymentSettled;
  const canReturnActive = activePatient?.status === 'consulting';

  return (
    <div>
      {toastMessage && (
        <div className="doctor-toast" role="status">
          <span>{toastMessage}</span>
        </div>
      )}

      {loadError && (
        <div className="staff-inline-error" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            className="staff-inline-error-action"
            onClick={() => loadDashboardData(selectedHospitalUserId)}
          >
            Retry
          </button>
        </div>
      )}

      <section className={`hospital-hero-banner doctor-home-hero ${heroClassName}`.trim()}>
        <div className="hospital-hero-content doctor-home-hero-content">
          <p className="hospital-hero-eyebrow">Clinical session</p>
          <h1>
            {greeting}, {displayTitle}
          </h1>
          <p className="hospital-hero-sub">
            {heroDateLabel}
            {primaryAffiliation?.hospitalName
              ? ` · ${primaryAffiliation.hospitalName}`
              : ' · No active hospital affiliation yet'}
          </p>
          {showHospitalSwitch ? (
            <div
              className={`doctor-hero-session-switch${hospitalMenuOpen ? ' is-open' : ''}`}
              ref={hospitalMenuRef}
            >
              <button
                type="button"
                className="doctor-hero-session-pill doctor-hero-session-pill--switch"
                aria-label="Working hospital"
                aria-haspopup="listbox"
                aria-expanded={hospitalMenuOpen}
                disabled={statsLoading || statusUpdating}
                onClick={() => setHospitalMenuOpen((open) => !open)}
              >
                <span className="doctor-hero-session-pill-main">
                  <IconHospital size={14} aria-hidden="true" />
                  <span>{primaryAffiliation?.hospitalName || 'Affiliated hospital'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{dutyText}</span>
                </span>
                <span className="doctor-hero-session-pill-chevron" aria-hidden="true">
                  ▾
                </span>
              </button>
              {hospitalMenuOpen && (
                <ul className="doctor-hero-session-menu" role="listbox" aria-label="Working hospital">
                  {affiliations.map((h) => {
                    const selected = h.hospitalUserId === selectedHospitalUserId;
                    const label = presenceLabel(h);
                    return (
                      <li key={h.affiliationId || h.hospitalUserId} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`doctor-hero-session-menu-item${selected ? ' is-selected' : ''}`}
                          onClick={() => handleHospitalChange(h.hospitalUserId)}
                        >
                          <span className="doctor-hero-session-menu-name">
                            {h.hospitalName || h.hospitalUserId}
                          </span>
                          <span className="doctor-hero-session-menu-duty">{label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="doctor-hero-session-pill">
              {primaryAffiliation ? (
                <>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <IconHospital size={14} />{' '}
                    {primaryAffiliation.hospitalName || 'Affiliated hospital'}
                  </span>
                  <span>·</span>
                  <span>{dutyText}</span>
                </>
              ) : (
                <span>Accept a hospital invitation on Affiliations to join a roster</span>
              )}
            </div>
          )}
          <div className="doctor-hero-actions">
            <button
              type="button"
              className="doctor-btn-call-next"
              onClick={handleCallNext}
              disabled={statusUpdating || statsLoading || !selectedHospitalUserId || notOnDuty}
              title={notOnDuty ? DUTY_REQUIRED_HINT : undefined}
            >
              Call Next Patient
            </button>
            <button
              type="button"
              className="doctor-btn-report-aefi"
              onClick={() => setIsAefiModalOpen(true)}
              disabled={!activePatient || statusUpdating}
              title={!activePatient ? 'Call or select a patient first' : undefined}
            >
              Report AEFI
            </button>
            {primaryAffiliation ? (
              <div className="doctor-duty-controls" role="group" aria-label="Duty status">
                {onBreak || notOnDuty ? (
                  <button
                    type="button"
                    className="doctor-btn-duty doctor-btn-duty--start"
                    onClick={() => handleDutyChange('OnDuty')}
                    disabled={dutyUpdating}
                    title={onBreak ? undefined : 'For walk-ins or cover outside your rostered shift'}
                  >
                    {onBreak ? 'End break' : 'Clock in'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="doctor-btn-duty"
                    onClick={() => handleDutyChange('OnBreak')}
                    disabled={dutyUpdating}
                  >
                    Take break
                  </button>
                )}
                {primaryAffiliation.isClockedIn && !onBreak ? (
                  <button
                    type="button"
                    className="doctor-btn-duty"
                    onClick={() => handleDutyChange('Off')}
                    disabled={dutyUpdating}
                  >
                    Clock out
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="hospital-hero-media" aria-hidden="true">
          <img src={heroImage} alt="" className="hospital-hero-image doctor-home-hero-image" />
        </div>
      </section>

      <section className="hospital-metrics-grid hospital-metrics-grid--4 doctor-stats-grid">
        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-slate">
            <IconCalendar size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Today&apos;s Appointments</span>
            <span className="hospital-stat-value">{statsLoading ? '—' : todayTotal}</span>
            <span className="hospital-stat-meta">
              <span className="meta-positive">
                {statsLoading ? '—' : todayCompleted} Completed
              </span>
              {' · '}
              {statsLoading ? '—' : todayUpcoming} Upcoming
            </span>
          </div>
        </div>

        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-blue">
            <IconClock size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Upcoming Today</span>
            <span className="hospital-stat-value">{statsLoading ? '—' : todayUpcoming}</span>
            <span className="hospital-stat-meta">Confirmed or awaiting payment</span>
          </div>
        </div>

        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-green">
            <IconSyringe size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Completed Today</span>
            <span className="hospital-stat-value">{statsLoading ? '—' : todayCompleted}</span>
            <span className="hospital-stat-meta">Marked completed at this hospital</span>
          </div>
        </div>

        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-amber">
            <IconShield size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Needs Dosage</span>
            <span className="hospital-stat-value">{statsLoading ? '—' : todayNeedsDosage}</span>
            <span className="hospital-stat-meta">Confirmed visits without prescribed dosage</span>
          </div>
        </div>
      </section>

      {activePatient && (
        <section className="doctor-spotlight-card">
          <div className="doctor-spotlight-header">
            <div>
              <div className="doctor-spotlight-badge">
                <span className="doctor-spotlight-pulse"></span>
                {spotlightBadge}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="doctor-token-pill" style={{ fontSize: '1.05rem', padding: '4px 12px' }}>
                  {activePatient.token}
                </span>
                <span className="doctor-spotlight-token">{activePatient.name}</span>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>Scheduled Slot</span>
              <div style={{ fontWeight: 700, color: 'var(--color-text-title)', fontSize: '1rem' }}>
                {activePatient.time}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {activePatient.appointmentStatus || '—'}
              </div>
            </div>
          </div>

          <div className="doctor-spotlight-details-grid">
            <div className="doctor-patient-bio">
              <div className="doctor-patient-avatar">
                <IconUser size={28} />
              </div>
              <div>
                <div className="doctor-patient-name">{activePatient.name}</div>
                {activePatientContact ? (
                  <>
                    <div className="doctor-patient-meta-text">
                      NIC: <strong>{activePatientContact.patientNic || '—'}</strong>
                    </div>
                    <div className="doctor-patient-meta-text">
                      Phone: {activePatientContact.patientPhone || '—'}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="queue-contact-reveal-btn"
                    onClick={() => revealPatientContact(activePatient.id)}
                    disabled={contactLoadingId === activePatient.id || statusUpdating}
                  >
                    {contactLoadingId === activePatient.id ? 'Loading contact…' : 'Show contact details'}
                  </button>
                )}
              </div>
            </div>

            <div className="doctor-vitals-box">
              <div className="doctor-vital-item">
                <span className="doctor-vital-label">Scheduled Slot</span>
                <span className="doctor-vital-value">{activePatient.time}</span>
              </div>
              <div className="doctor-vital-item">
                <span className="doctor-vital-label">Booth</span>
                <span className="doctor-vital-value">{activePatient.booth || 'Not assigned'}</span>
              </div>
              <div className="doctor-vital-item">
                <span className="doctor-vital-label">Payment</span>
                <span className="doctor-vital-value">{activePatient.paymentStatus}</span>
              </div>
              <div className="doctor-vital-item">
                <span className="doctor-vital-label">Prescribed By</span>
                <span className="doctor-vital-value">{activePatient.prescribedBy || 'Not prescribed'}</span>
              </div>
            </div>

            <div className="doctor-vaccine-assign-box">
              <span className="doctor-vaccine-assign-title">Vaccine Prescription</span>
              <span className="doctor-vaccine-name">{activePatient.vaccine}</span>
              <span className="doctor-vaccine-lot">{activePatient.dose}</span>
            </div>
          </div>

          <div className="doctor-checklist-bar">
            <span className="doctor-checklist-heading">Pre-administration readiness</span>
            <div className="doctor-checklist-items">
              <span className={`doctor-check-pill${activePatient.hasDosage ? ' is-ok' : ' is-pending'}`}>
                {activePatient.hasDosage ? 'Dosage prescribed' : 'Dosage not set'}
              </span>
              <span
                className={`doctor-check-pill${
                  activePatientContact?.patientNic ? ' is-ok' : ' is-pending'
                }`}
              >
                {activePatientContact?.patientNic
                  ? 'Patient NIC on record'
                  : activePatientContact
                    ? 'NIC missing'
                    : 'Contact not loaded'}
              </span>
              <span className={`doctor-check-pill${isPaymentSettled(activePatient) ? ' is-ok' : ' is-pending'}`}>
                {isPaymentSettled(activePatient) ? 'Payment settled' : `Payment: ${activePatient.paymentStatus}`}
              </span>
              <span className={`doctor-check-pill${activePatient.booth ? ' is-ok' : ' is-pending'}`}>
                {activePatient.booth ? `Booth ${activePatient.booth}` : 'Booth not assigned'}
              </span>
            </div>
          </div>

          <div className="doctor-spotlight-actions">
            {isDoctor && activePatient.status === 'waiting' && (
              <button
                type="button"
                className="doctor-btn-defer"
                onClick={() => setPrescribeTargetId(activePatient.id)}
                disabled={statusUpdating || notOnDuty}
                title={notOnDuty ? DUTY_REQUIRED_HINT : undefined}
              >
                {activePatient.hasDosage ? 'Edit prescribed dose' : 'Prescribe dose'}
              </button>
            )}
            <button
              type="button"
              className="doctor-btn-defer"
              onClick={() => handleReturnToQueue(activePatient)}
              disabled={statusUpdating || !canReturnActive || notOnDuty}
              title={
                notOnDuty
                  ? DUTY_REQUIRED_HINT
                  : activePatient.status !== 'consulting'
                  ? 'Only the active consulting patient can be returned to the queue'
                  : 'Send this patient back to the waiting queue'
              }
            >
              Return to Queue
            </button>
            <button
              type="button"
              className="doctor-btn-certify"
              onClick={() => setIsAdministerModalOpen(true)}
              disabled={statusUpdating || !canCertifyActive || notOnDuty}
              title={
                notOnDuty
                  ? DUTY_REQUIRED_HINT
                  : activePatient.status !== 'consulting'
                  ? 'Select a consulting patient to certify administration'
                  : !activePaymentSettled
                    ? 'Payment must be settled first'
                    : 'Record administration details, then transfer to observation'
              }
            >
              Certify &amp; Transfer to Observation
            </button>
          </div>
          {activePatient.status !== 'consulting' ? (
            <p className="doctor-off-duty-hint" style={{ marginTop: '10px', color: 'var(--color-text-muted)', fontSize: '0.85rem', fontWeight: 600 }}>
              Spotlight actions apply only while this patient is in active consultation.
            </p>
          ) : !activePaymentSettled ? (
            <p className="doctor-off-duty-hint" style={{ marginTop: '10px', color: 'var(--color-warning)', fontSize: '0.85rem', fontWeight: 600 }}>
              Payment not settled — hospital desk must Mark paid at the counter before administration.
            </p>
          ) : null}
        </section>
      )}

      <div className="doctor-main-grid">
        <div className="doctor-card doctor-queue-card">
          <div className="section-card-header queue-section-header">
            <div className="section-title-group">
              <h2>
                <span className="section-title-icon icon-shade-blue">
                  <IconClipboard size={22} />
                </span>
                Today&apos;s Consultation Queue
              </h2>
              <p className="section-title-desc">
                {boothFiltered
                  ? `Patients at ${myBooth.label} today, plus unassigned walk-ins`
                  : 'All patients booked at this hospital today'}
              </p>
            </div>
          </div>

          <div className="queue-controls-bar">
            <div className="queue-controls-left">
              {myBooth ? (
                <div className="queue-scope-switch" role="group" aria-label="Booth scope">
                  <button
                    type="button"
                    className={`queue-scope-btn${boothScope === 'mine' ? ' active' : ''}`}
                    onClick={() => setBoothScope('mine')}
                  >
                    My booth · {String(myBooth.label).split(' · ')[0]}
                  </button>
                  <button
                    type="button"
                    className={`queue-scope-btn${boothScope === 'all' ? ' active' : ''}`}
                    onClick={() => setBoothScope('all')}
                  >
                    All booths
                  </button>
                </div>
              ) : null}
              <div className="queue-scope-switch">
                <button
                  type="button"
                  className={`queue-scope-btn${filterStatus === 'all' ? ' active' : ''}`}
                  onClick={() => setFilterStatus('all')}
                >
                  All ({scopedPatients.length})
                </button>
                <button
                  type="button"
                  className={`queue-scope-btn${filterStatus === 'waiting' ? ' active' : ''}`}
                  onClick={() => setFilterStatus('waiting')}
                >
                  Waiting ({waitingCount})
                </button>
                {awaitingPaymentCount > 0 ? (
                  <button
                    type="button"
                    className={`queue-scope-btn${filterStatus === 'awaiting_payment' ? ' active' : ''}`}
                    onClick={() => setFilterStatus('awaiting_payment')}
                  >
                    Awaiting payment ({awaitingPaymentCount})
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`queue-scope-btn${filterStatus === 'observation' ? ' active' : ''}`}
                  onClick={() => setFilterStatus('observation')}
                >
                  Observation ({observationCount})
                </button>
                <button
                  type="button"
                  className={`queue-scope-btn${filterStatus === 'completed' ? ' active' : ''}`}
                  onClick={() => setFilterStatus('completed')}
                >
                  Completed ({completedCount})
                </button>
              </div>

              <input
                type="text"
                className="queue-search-input"
                placeholder="Search patient, token, vaccine..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <button
                type="button"
                className="btn-inventory-refresh"
                onClick={() => {
                  setFilterStatus('all');
                  setSearchQuery('');
                  loadDashboardData(selectedHospitalUserId);
                }}
                disabled={statsLoading || statusUpdating}
                title="Refresh consultation queue"
              >
                {statsLoading ? '...' : <IconRefresh size={16} />}
              </button>
            </div>
          </div>

          <div className="table-responsive">
            <table className="hospital-queue-table">
              <colgroup>
                <col className="col-token" />
                <col className="col-patient" />
                <col className="col-vaccine" />
                <col className="col-booth" />
                <col className="col-status" />
                <col className="col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Patient Details</th>
                  <th>Vaccine &amp; Dose</th>
                  <th>Slot</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-table-cell">
                      {statsLoading
                        ? "Loading today's appointments..."
                        : patients.length === 0
                          ? 'No appointments for today at your affiliated hospital.'
                          : 'No patients matching your search criteria.'}
                    </td>
                  </tr>
                ) : (
                  filteredPatients.map((p) => {
                    const isCurrent = activePatient?.id === p.id;
                    return (
                      <tr
                        key={p.id}
                        className={isCurrent ? 'is-current-patient' : undefined}
                      >
                        <td>
                          <span className="queue-token-pill">
                            {String(p.token || '').replace(/-/g, '\u2011')}
                          </span>
                        </td>
                        <td>
                          <div
                            className="queue-patient-name"
                            role="button"
                            tabIndex={0}
                            onClick={() => handleSelectPatient(p)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSelectPatient(p);
                              }
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            {p.name}
                          </div>
                          {contactCache[p.id] ? (
                            <>
                              <div className="queue-patient-meta">
                                NIC: {contactCache[p.id].patientNic || '—'}
                              </div>
                              {contactCache[p.id].patientPhone ? (
                                <div className="queue-patient-meta">{contactCache[p.id].patientPhone}</div>
                              ) : null}
                            </>
                          ) : (
                            <button
                              type="button"
                              className="queue-contact-reveal-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                revealPatientContact(p.id);
                              }}
                              disabled={contactLoadingId === p.id || statusUpdating}
                            >
                              {contactLoadingId === p.id ? 'Loading…' : 'Show contact'}
                            </button>
                          )}
                        </td>
                        <td>
                          <div className="queue-vaccine-badge">{p.vaccine}</div>
                          <div className="queue-dose-meta" title={p.dose}>
                            {p.dose}
                          </div>
                        </td>
                        <td>
                          <span className="queue-booth-tag">{p.time || '—'}</span>
                        </td>
                        <td>
                          <span className={`queue-status-badge status-${p.status === 'waiting' && !isPaymentSettled(p) ? 'awaiting-payment' : p.status}`}>
                            {p.status === 'consulting'
                              ? 'Consulting'
                              : p.status === 'waiting'
                                ? !p.checkedIn
                                  ? 'Not arrived'
                                  : isPaymentSettled(p)
                                    ? 'In Queue'
                                    : 'Awaiting payment'
                                : p.status === 'observation'
                                  ? 'Observation'
                                  : p.status === 'cancelled'
                                    ? 'Cancelled'
                                    : 'Completed'}
                          </span>
                        </td>
                        <td>
                          <div className="queue-action-btns">
                            {isDoctor && p.status === 'waiting' && !p.hasDosage && (
                              <button
                                type="button"
                                className="btn-queue-action btn-queue-action--icon"
                                onClick={() => setPrescribeTargetId(p.id)}
                                disabled={statusUpdating || notOnDuty}
                                title={notOnDuty ? DUTY_REQUIRED_HINT : 'Prescribe'}
                                aria-label="Prescribe"
                              >
                                <IconPencil size={15} />
                              </button>
                            )}
                            {p.status === 'waiting' && !p.checkedIn && (
                              <button
                                type="button"
                                className="btn-queue-action btn-queue-action--icon"
                                onClick={() => handleCheckIn(p)}
                                disabled={statusUpdating}
                                title="Check in — patient has arrived"
                                aria-label="Check in"
                              >
                                <IconUser size={15} />
                              </button>
                            )}
                            {p.status === 'waiting' && p.checkedIn && (
                              <button
                                type="button"
                                className="btn-queue-action btn-queue-action--icon"
                                onClick={() => handleSelectPatient(p)}
                                disabled={!isPaymentSettled(p) || !p.hasDosage || statusUpdating || notOnDuty}
                                title={
                                  notOnDuty
                                    ? DUTY_REQUIRED_HINT
                                    : !isPaymentSettled(p)
                                    ? 'Payment must be settled first'
                                    : !p.hasDosage
                                      ? 'Waiting for the doctor to prescribe a dose'
                                      : 'Examine'
                                }
                                aria-label="Examine"
                              >
                                <IconStethoscope size={15} />
                              </button>
                            )}
                            {p.status === 'consulting' && (
                              <button
                                type="button"
                                className="btn-queue-action btn-queue-action--icon btn-queue-action--session"
                                onClick={() => {
                                  setActivePatientId(p.id);
                                  setIsAdministerModalOpen(true);
                                }}
                                disabled={!isPaymentSettled(p) || statusUpdating || notOnDuty}
                                title={
                                  notOnDuty
                                    ? DUTY_REQUIRED_HINT
                                    : !isPaymentSettled(p)
                                    ? 'Payment must be settled first'
                                    : 'Administer'
                                }
                                aria-label="Administer"
                              >
                                <IconSyringe size={15} />
                              </button>
                            )}
                            {p.status === 'observation' && (
                              <button
                                type="button"
                                className="btn-queue-action btn-queue-action--icon btn-queue-action--release"
                                onClick={() => handleDischargeObservation(p.id, p.name)}
                                disabled={
                                  !isPaymentSettled(p) ||
                                  statusUpdating ||
                                  notOnDuty ||
                                  (observationMinutesLeft(p.updatedAt, now) ?? 0) > 0
                                }
                                title={
                                  notOnDuty
                                    ? DUTY_REQUIRED_HINT
                                    : (observationMinutesLeft(p.updatedAt, now) ?? 0) > 0
                                    ? `Observation: ${observationMinutesLeft(p.updatedAt, now)} min left`
                                    : !isPaymentSettled(p)
                                    ? 'Payment must be settled first'
                                    : 'Discharge'
                                }
                                aria-label="Discharge"
                              >
                                <IconCheck size={15} />
                              </button>
                            )}
                            {p.status === 'completed' && (
                              <span className="queue-pass-note">Certified</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="doctor-side-column">
          <div className="doctor-obs-card">
            <div className="doctor-obs-header">
              <div
                className="doctor-obs-title"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                <span className="icon-shade icon-shade-amber">
                  <IconClock size={22} />
                </span>
                15-Min Observation Watch
              </div>
              <span className="doctor-obs-count-badge">
                {observationPatients.length} Under Watch
              </span>
            </div>

            {observationPatients.length === 0 ? (
              <div className="doctor-obs-empty">
                Observation recovery room is currently clear.
              </div>
            ) : (
              <div className="doctor-obs-list">
                {observationPatients.map((obs) => (
                  <div key={obs.id} className="doctor-obs-item">
                    <div className="doctor-obs-item-info">
                      <span className="doctor-obs-item-name">{obs.name}</span>
                      <span className="doctor-obs-item-meta">
                        {obs.vaccine} • {obs.administeredTime}
                      </span>
                      <span
                        className={
                          obs.minsLeft === 0
                            ? 'doctor-obs-item-state is-clear'
                            : 'doctor-obs-item-state'
                        }
                      >
                        {obs.minsLeft === 0
                          ? 'Observation window complete'
                          : 'Under observation'}
                      </span>
                    </div>
                    <div className="doctor-obs-countdown">
                      <span
                        className="doctor-obs-timer-pill"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <IconClock size={14} />
                        {obs.minsLeft === null
                          ? 'Time unknown'
                          : obs.minsLeft === 0
                            ? 'Ready to discharge'
                            : `${obs.minsLeft} min left`}
                      </span>
                      <button
                        type="button"
                        className="doctor-obs-btn-discharge"
                        onClick={() => handleDischargeObservation(obs.id, obs.name)}
                        disabled={statusUpdating || notOnDuty || (obs.minsLeft ?? 0) > 0}
                        title={notOnDuty ? DUTY_REQUIRED_HINT : undefined}
                      >
                        {(obs.minsLeft ?? 0) > 0 ? `Discharge in ${obs.minsLeft} min` : 'Discharge Patient'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="doctor-coldbox-card staff-today-slots">
            <div className="staff-today-slots-header">
              <div className="staff-today-slots-title">
                <span className="icon-shade icon-shade-blue">
                  <IconClock size={22} />
                </span>
                <span>Today&apos;s Slots</span>
              </div>
              <span className="staff-today-slots-count">
                {todayAppointments.length}{' '}
                {todayAppointments.length === 1 ? 'slot' : 'slots'}
              </span>
            </div>

            {todayAppointments.length === 0 ? (
              <p className="staff-today-slots-empty">No slots booked for today.</p>
            ) : (
              <ul className="staff-today-slots-list">
                {todayAppointments.slice(0, 6).map((a) => {
                  const done = a.status === 'Completed';
                  return (
                    <li
                      key={a.id}
                      className={`staff-today-slot-item${done ? ' is-done' : ''}`}
                    >
                      <div className="staff-today-slot-time">
                        {a.timeSlot || a.startTime || '—'}
                      </div>
                      <div className="staff-today-slot-meta">
                        <span className="staff-today-slot-name">
                          {a.patientName || 'Patient'}
                        </span>
                        <span
                          className={`staff-today-slot-status${done ? ' is-done' : ''}`}
                        >
                          {a.status || 'Scheduled'}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <ClinicalPrescribeModal
        isOpen={Boolean(prescribeTargetId)}
        onClose={() => setPrescribeTargetId(null)}
        patient={patients.find((p) => p.id === prescribeTargetId) || null}
        onSaved={async (p, dose) => {
          showToast(`Prescribed ${dose} for ${p.name}`);
          await loadDashboardData(selectedHospitalUserId);
        }}
      />

      <AdministerModal
        isOpen={isAdministerModalOpen}
        onClose={() => setIsAdministerModalOpen(false)}
        patient={activePatient}
        onCertify={handleCertifyAdministration}
        lotOptions={inventoryLots}
        isDoctor={isDoctor}
      />

      <AefiModal
        isOpen={isAefiModalOpen}
        onClose={() => setIsAefiModalOpen(false)}
        onSubmitReport={handleAefiSubmit}
        patient={activePatient}
      />
    </div>
  );
}
