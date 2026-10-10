import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import WalkInRegistrationModal from './WalkInRegistrationModal';
import scheduleService from '../services/scheduleService';
import RestockVaccineModal from './RestockVaccineModal';
import staffService from '../services/staffService';
import { inventoryService } from '../services/inventoryService';
import { appointmentService } from '../../patient/services/appointmentService';
import { authService } from '../../auth';
import { hospitalMinutesNow, hospitalToday, toHospitalDateKey } from '../utils/hospitalDate';
import {
  mapDbStatusToQueueStatus,
  queueStatusLabel,
} from '../utils/appointmentStatus';
import hospitalHeroImage from '../../../assets/images/portal/hero-hospital.jpg';
import PortalHero from '../../../components/PortalHero';
import {
  IconClipboard,
  IconClock,
  IconClose,
  IconDoor,
  IconPackage,
  IconRefresh,
  IconShield,
  IconSnowflake,
  IconSyringe,
  IconThermometer,
  RoleAvatarIcon,
} from './HospitalIcons';

function timeToMinutes(value) {
  const raw = String(value || '').slice(0, 5);
  const [h, m] = raw.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function formatShiftWindow(shift) {
  const start = String(shift.startTime || '').slice(0, 5);
  const end = String(shift.endTime || '').slice(0, 5);
  return `${start}–${end}`;
}

function roleLabel(role) {
  if (role === 'DOCTOR') return 'Doctor';
  if (role === 'NURSE') return 'Nurse';
  return role || 'Staff';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** True when an active vaccine session runs on `day` (yyyy-MM-dd). */
function sessionRunsOn(schedule, day) {
  if (String(schedule?.status || 'Active').toLowerCase() !== 'active') return false;
  const type = String(schedule.scheduleType || 'OneTime').toLowerCase();
  if (type !== 'weekly') return String(schedule.specificDate || '').slice(0, 10) === day;
  const start = String(schedule.startDate || '').slice(0, 10);
  const end = String(schedule.endDate || '').slice(0, 10);
  if (start && day < start) return false;
  if (end && day > end) return false;
  const weekday = WEEKDAYS[new Date(`${day}T00:00:00`).getDay()];
  return (schedule.daysOfWeek || []).some((d) => {
    const value = String(d || '').trim().toLowerCase();
    return value === weekday.toLowerCase() || value === weekday.slice(0, 3).toLowerCase();
  });
}

function boothStatusClass(status) {
  if (status === 'Unstaffed' || status === 'No session today') return 'is-unstaffed';
  if (status === 'Needs staff') return 'is-needs-staff';
  if (status === 'On duty') return 'is-on-duty';
  if (status === 'In session') return 'is-in-session';
  return 'is-scheduled';
}

function queueTimeSortKey(time) {
  const match = String(time || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatVaultTemp(temp) {
  const raw = String(temp || '').trim();
  if (!raw) return null;
  return /°\s*c/i.test(raw) ? raw.replace(/\s+/g, '') : `${raw}°C`;
}

function normalizePersonName(value) {
  return String(value || '')
    .replace(/^(dr\.|doctor|nurse)\s+/i, '')
    .trim()
    .toLowerCase();
}

function parseBoothLabel(label) {
  const raw = String(label || '').trim();
  if (!raw) return { code: null, name: 'Unassigned' };
  if (/^unassigned$/i.test(raw)) return { code: null, name: 'Unassigned' };
  const parts = raw.split(/\s*·\s*/);
  if (parts.length >= 2) {
    return { code: parts[0].trim(), name: parts.slice(1).join(' · ').trim() };
  }
  return { code: null, name: raw };
}

function resolveQueueBooth(appointment, boothCards) {
  if (appointment.boothLabel) return parseBoothLabel(appointment.boothLabel);

  const practitioner = normalizePersonName(appointment.doctorName || appointment.nurseName);
  if (practitioner && boothCards.length > 0) {
    const match = boothCards.find((booth) =>
      (booth.staffMembers || []).some((member) => {
        const staff = normalizePersonName(member.name);
        return staff && (practitioner.includes(staff) || staff.includes(practitioner));
      })
    );
    if (match) {
      return {
        code: match.code || null,
        name: match.name || parseBoothLabel(match.boothName).name,
      };
    }
  }

  return { code: null, name: 'Unassigned' };
}

const HOME_QUEUE_PREVIEW_ROWS = 6;

/**
 * Hospital home and the front-desk queue share one data layer.
 * view="home": overview with a read-only queue preview, stock and booths.
 * view="queue": the full live queue with desk actions (check-in, payment, walk-in, no-show).
 */
export default function HospitalDashboardOverview({ view = 'home' }) {
  const isQueueView = view === 'queue';
  const [isWalkInOpen, setIsWalkInOpen] = useState(false);
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [toastMessage, setToastMessage] = useState('');

  // 1. Logged in Hospital Profile Context
  const [hospitalUser, setHospitalUser] = useState(() => authService.getUser());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fresh = await authService.getMe();
        if (!cancelled && fresh) setHospitalUser(fresh);
      } catch {
        /* keep cached user */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hospitalDetails = hospitalUser?.profileDetails || {};
  const hospitalCenterName =
    hospitalDetails.hospitalName || hospitalUser?.name || 'Immunization Center Operations';
  const hospitalCenterCode = hospitalUser?.registrationNumber
    ? `Center ID: ${hospitalUser.registrationNumber}`
    : null;
  const hospitalSessionHours = hospitalDetails.operatingHours || null;
  const hospitalType = hospitalDetails.hospitalType || null;

  // 2. Booths & On-Duty Staff State
  const [boothCards, setBoothCards] = useState([]);
  const [boothsLoading, setBoothsLoading] = useState(true);
  const [boothsError, setBoothsError] = useState('');
  const [onDutyCount, setOnDutyCount] = useState(0);

  // 3. Database Inventory State
  const [inventory, setInventory] = useState([]);
  const [formularyVaccines, setFormularyVaccines] = useState([]);
  const [coldVaults, setColdVaults] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState('');

  // 4. Live Queue Appointments State (from Database)
  const [queuePatients, setQueuePatients] = useState([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');

  const toastTimerRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 3500);
  };

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const handleDeskMarkPaid = async (appointmentId) => {
    try {
      await appointmentService.updateAppointmentStatus(appointmentId, { status: 'Confirmed' });
      showToast('Counter payment recorded — patient is ready for clinical queue.');
      await loadAppointmentsQueue();
    } catch (err) {
      showToast(err.message || 'Failed to record payment.');
    }
  };

  const handleDeskCheckIn = async (appointmentId) => {
    try {
      await appointmentService.checkIn(appointmentId);
      showToast('Patient checked in — now in the clinical queue.');
      await loadAppointmentsQueue();
    } catch (err) {
      showToast(err.message || 'Failed to check in patient.');
    }
  };

  const handleDeskNoShow = async (appointmentId) => {
    if (!window.confirm('Mark this patient as a no-show?')) return;
    try {
      await appointmentService.updateAppointmentStatus(appointmentId, {
        status: 'Cancelled',
        remarks: 'No-show — patient did not arrive',
      });
      showToast('Marked as no-show.');
      await loadAppointmentsQueue();
    } catch (err) {
      showToast(err.message || 'Failed to mark no-show.');
    }
  };

  const handleDeskDeclineUnpaid = async (appointmentId) => {
    if (!window.confirm('Decline this unpaid appointment?')) return;
    try {
      await appointmentService.updateAppointmentStatus(appointmentId, { status: 'Rejected' });
      showToast('Unpaid appointment declined.');
      await loadAppointmentsQueue();
    } catch (err) {
      showToast(err.message || 'Failed to decline appointment.');
    }
  };

  // ==================== FETCH INVENTORY (BATCHES & FORMULARY) ====================
  const loadInventory = useCallback(async () => {
    setInventoryLoading(true);
    setInventoryError('');
    try {
      const [batchesRes, formularyRes, vaultsRes] = await Promise.allSettled([
        inventoryService.getInventory(),
        inventoryService.getFormulary(),
        inventoryService.getColdVaults(),
      ]);

      const batches = batchesRes.status === 'fulfilled' && Array.isArray(batchesRes.value) ? batchesRes.value : [];
      const formulary = formularyRes.status === 'fulfilled' && Array.isArray(formularyRes.value) ? formularyRes.value : [];
      const vaults = vaultsRes.status === 'fulfilled' && Array.isArray(vaultsRes.value) ? vaultsRes.value : [];

      setFormularyVaccines(formulary);
      setColdVaults(vaults);

      // Map DB batches to inventory cards
      const mappedBatches = batches.map((b) => {
        const available = Number(b.available ?? b.quantity ?? 0);
        const capacity = Number(b.capacity ?? Math.max(available * 1.5, 400));
        const minThreshold = Number(b.minThreshold ?? 50);
        const isLow = available <= minThreshold;

        return {
          id: b.id,
          name: b.name || b.vaccineName || 'Vaccine Formulation',
          lotNumber: b.lotNumber || 'LT-' + (b.id ? b.id.substring(0, 6).toUpperCase() : '001'),
          available,
          capacity,
          expiry: b.expiry || b.expiryDate || 'N/A',
          temp: b.temp || (b.storageUnit ? b.storageUnit : '2°C to 8°C Chiller'),
          statusColor: isLow ? 'bar-amber' : 'bar-green',
          warning: isLow ? `Low Stock Alert (${available} vials remaining)` : undefined,
        };
      });

      // Also include any formulary vaccines that have 0 batches registered yet
      const existingNames = new Set(mappedBatches.map((m) => m.name.toLowerCase()));
      formulary.forEach((f) => {
        const fName = f.vaccineName || f.name;
        if (fName && !existingNames.has(fName.toLowerCase())) {
          mappedBatches.push({
            id: 'formulary-' + (f.id || fName),
            name: fName,
            lotNumber: 'Not Stocked',
            available: 0,
            capacity: 500,
            expiry: 'Restock Required',
            temp: 'Requires Storage Allocation',
            statusColor: 'bar-amber',
            warning: 'Out of Stock - Restock Recommended',
          });
        }
      });

      setInventory(mappedBatches);
    } catch (err) {
      console.error('Failed to load inventory:', err);
      setInventoryError(err.message || 'Failed to load vaccine inventory.');
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  // ==================== FETCH APPOINTMENTS QUEUE (FROM DATABASE) ====================
  const loadAppointmentsQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError('');
    try {
      const todayStr = hospitalToday();
      // Load full hospital list; metric cards + "Today" scope filter to hospital-local today.
      const data = await appointmentService.getHospitalAppointments();
      const rawList = Array.isArray(data) ? data : [];

      // Filter out rejected/cancelled if looking at active session
      const mapped = rawList
        .filter((a) => String(a.status || '').toLowerCase() !== 'rejected')
        .map((a, idx) => {
          const rawId = String(a.id || a.Id || idx);
          const shortRef = a.referenceNumber || (rawId.length > 6 ? `T-${rawId.substring(0, 4).toUpperCase()}` : `T-10${idx + 1}`);
          const rawStatus = a.status || a.Status || 'Pending';
          const queueStatus = mapDbStatusToQueueStatus(rawStatus);

          const appointmentDate =
            toHospitalDateKey(a.appointmentDate || a.AppointmentDate || a.date) || todayStr;

          return {
            id: rawId,
            token: shortRef,
            name: a.patientName || a.PatientName || a.pName || a.patientEmail || a.PatientEmail || 'Patient',
            phone: a.patientPhone || a.PatientPhone || '',
            nic: a.patientNic || a.PatientNic || '',
            date: appointmentDate,
            vaccine: a.vaccineName || a.VaccineName || 'Vaccine',
            dose: a.prescribedDosage || a.PrescribedDosage || 'Primary / Booster Dose',
            booth: resolveQueueBooth(a, boothCards),
            practitioner: a.doctorName ? `Dr. ${a.doctorName.replace(/^Dr\.\s*/i, '')}` : (a.nurseName ? `Nurse ${a.nurseName}` : 'Staff Duty Officer'),
            time: a.timeSlot || a.TimeSlot || '09:00 AM - 09:20 AM',
            status: queueStatus,
            dbStatus: rawStatus,
            paymentStatus: a.paymentStatus || a.PaymentStatus || '—',
            checkedIn: Boolean(a.checkedInAt || a.CheckedInAt),
          };
        });

      setQueuePatients(mapped);
    } catch (err) {
      console.error('Failed to load appointments queue:', err);
      setQueueError(err.message || 'Failed to load live appointments queue.');
    } finally {
      setQueueLoading(false);
    }
  }, [boothCards]);

  // ==================== FETCH BOOTH STAFFING ====================
  const loadBoothStaffing = useCallback(async () => {
    setBoothsLoading(true);
    setBoothsError('');
    const today = hospitalToday();
    const nowMinutes = hospitalMinutesNow();

    try {
      const [boothList, shiftList, staffList, scheduleList] = await Promise.all([
        staffService.getHospitalBooths({ activeOnly: true }),
        staffService.getHospitalShifts({ from: today, to: today }),
        staffService.getHospitalStaff({ status: 'Active' }),
        scheduleService.getHospitalSchedules().catch(() => null),
      ]);
      // Booths that run a vaccine session today (null when sessions could not be loaded).
      const sessionBoothIds = Array.isArray(scheduleList)
        ? new Set(
            scheduleList
              .filter((sch) => sch.boothId && sessionRunsOn(sch, today))
              .map((sch) => sch.boothId)
          )
        : null;

      const booths = Array.isArray(boothList) ? boothList : [];
      const shifts = Array.isArray(shiftList) ? shiftList : [];
      const staff = Array.isArray(staffList) ? staffList : [];

      // The server decides who is on duty (live shift or clock-in, not on break),
      // so the count and booth badges match what clinical staff can actually do.
      const onDutyAffiliationIds = new Set(
        staff.filter((s) => s.isOnDutyNow).map((s) => s.affiliationId)
      );
      setOnDutyCount(onDutyAffiliationIds.size);

      const photoByAffiliation = new Map(
        staff.map((s) => [s.affiliationId, s.staffProfilePhotoUrl || null])
      );

      const cards = booths.map((booth, index) => {
        const boothShifts = shifts
          .filter((s) => s.boothId && s.boothId === booth.boothId)
          .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

        const liveShift = boothShifts.find((s) => {
          const start = timeToMinutes(s.startTime);
          const end = timeToMinutes(s.endTime);
          return (
            start != null &&
            end != null &&
            start <= nowMinutes &&
            nowMinutes < end &&
            onDutyAffiliationIds.has(s.affiliationId)
          );
        });

        const primary = liveShift || boothShifts[0] || null;
        const isLive = Boolean(liveShift);

        const staffMembers = boothShifts.map((s) => ({
          key: `${s.affiliationId || s.staffName}-${s.startTime}-${s.endTime}`,
          name: s.staffName || 'Unassigned',
          roleLabel: roleLabel(s.staffRole),
          roleKey: s.staffRole === 'NURSE' ? 'Nurse' : 'Doctor',
          window: formatShiftWindow(s),
          photoUrl: photoByAffiliation.get(s.affiliationId) || null,
          isLive: liveShift != null && s === liveShift,
        }));

        return {
          id: booth.boothId,
          code: booth.code || String(index + 1).padStart(2, '0'),
          name: booth.name || booth.displayLabel || 'Booth',
          boothName: booth.displayLabel || `${booth.code} · ${booth.name}`,
          staffMembers,
          vaccineNames: booth.vaccineNames || [],
          status: primary
            ? isLive
              ? 'On duty'
              : 'Scheduled'
            : !sessionBoothIds
              ? 'Unstaffed'
              : sessionBoothIds.has(booth.boothId)
                ? 'Needs staff'
                : 'No session today',
          shiftCount: boothShifts.length,
        };
      });

      setBoothCards(cards);
    } catch (err) {
      setBoothCards([]);
      setOnDutyCount(0);
      setBoothsError(err.message || 'Failed to load booth staffing.');
    } finally {
      setBoothsLoading(false);
    }
  }, []);

  useEffect(() => deferEffectCallback(() => {
    loadBoothStaffing();
    loadInventory();
  }), [loadBoothStaffing, loadInventory]);

  useEffect(() => {
    loadAppointmentsQueue();
  }, [loadAppointmentsQueue]);

  // ==================== ACTIONS ====================

  // 1. Walk-in Registration (persisted appointment for registered patient NIC)
  const handleAddWalkIn = async (payload) => {
    const created = await appointmentService.createWalkIn({
      patientNic: payload.patientNic,
      patientName: payload.patientName,
      patientEmail: payload.patientEmail,
      patientPhone: payload.patientPhone,
      vaccineName: payload.vaccineName,
      dose: payload.dose,
      boothLabel: payload.boothLabel,
      age: payload.age,
      gender: payload.gender,
    });
    await loadAppointmentsQueue();
    const unpaid = String(created?.paymentStatus || '').toLowerCase() !== 'paid';
    showToast(
      created?.matchedExistingBooking
        ? `${payload.patientName} already booked ${created.vaccineName || 'this vaccine'} today${created.timeSlot ? ` (${created.timeSlot})` : ''} — checked in their booking.`
        : unpaid
        ? `Guest ${payload.patientName} registered — collect the fee and click Mark paid. Guest password is their NIC.`
        : `Guest ${payload.patientName} queued — awaiting a doctor's prescription. Login email is theirs; guest password is their NIC.`
    );
  };

  // 2. Real Database Restock Batch
  const handleAddStock = async ({ vaccineName, lotNumber, quantity, storageUnit, expiryDate, supplier }) => {
    try {
      await inventoryService.restockBatch({
        vaccineName,
        lotNumber,
        quantity: Number(quantity),
        storageUnit,
        expiryDate,
        supplier,
      });
      await loadInventory();
      showToast(`Logged restock shipment for ${vaccineName} (${quantity} vials).`);
    } catch (err) {
      console.error('Failed to restock batch:', err);
      alert('Failed to log restock shipment: ' + err.message);
      throw err;
    }
  };

  // ==================== FILTERING & COMPUTED STATS ====================
  const todayStr = hospitalToday();

  const todayQueuePatients = useMemo(
    () => queuePatients.filter((p) => toHospitalDateKey(p.date) === todayStr),
    [queuePatients, todayStr]
  );

  const filteredQueue = useMemo(() => {
    // Today only: other dates live under Appointments → Bookings.
    const list = todayQueuePatients.filter((p) => {
      // Status filter
      if (statusFilter !== 'all' && p.status !== statusFilter) {
        return false;
      }

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.phone && p.phone.includes(q)) ||
        p.token.toLowerCase().includes(q) ||
        p.vaccine.toLowerCase().includes(q)
      );
    });

    return list.sort((a, b) => {
      const byTime = queueTimeSortKey(a.time) - queueTimeSortKey(b.time);
      if (byTime !== 0) return byTime;
      return String(a.token || '').localeCompare(String(b.token || ''));
    });
  }, [todayQueuePatients, statusFilter, searchQuery]);

  const totalStock = useMemo(() => {
    return inventory.reduce((acc, curr) => acc + (curr.available || 0), 0);
  }, [inventory]);

  const todayPatients = todayQueuePatients;

  const completedTodayCount = useMemo(() => {
    return todayPatients.filter((p) => p.status === 'completed').length;
  }, [todayPatients]);

  const activeQueueCount = useMemo(() => {
    return todayPatients.filter(
      (p) => p.status !== 'completed' && p.status !== 'cancelled'
    ).length;
  }, [todayPatients]);

  const observationCount = useMemo(
    () => todayPatients.filter((p) => p.status === 'observation').length,
    [todayPatients]
  );

  const awaitingPaymentCount = useMemo(
    () => todayPatients.filter((p) => p.status === 'awaiting_payment').length,
    [todayPatients]
  );

  const notArrivedCount = useMemo(
    () => todayPatients.filter((p) => p.status === 'waiting' && !p.checkedIn).length,
    [todayPatients]
  );

  const checkedInCount = useMemo(
    () => todayPatients.filter((p) => p.status === 'waiting' && p.checkedIn).length,
    [todayPatients]
  );

  const queueRows = isQueueView ? filteredQueue : filteredQueue.slice(0, HOME_QUEUE_PREVIEW_ROWS);

  const liveBoothCount = useMemo(
    () => boothCards.filter((b) => b.status === 'On duty').length,
    [boothCards]
  );

  const staffedBoothCount = useMemo(
    () => boothCards.filter((b) => b.shiftCount > 0).length,
    [boothCards]
  );

  const coldChainSummary = useMemo(() => {
    if (!coldVaults.length) return null;

    const isOk = (v) =>
      !v.status || /optimal|ok|normal|safe|active/i.test(String(v.status));

    const okCount = coldVaults.filter(isOk).length;
    const total = coldVaults.length;
    const allOk = okCount === total;

    return {
      total,
      okCount,
      allOk,
      value: `${okCount}/${total}`,
      meta: allOk
        ? `${total} vault${total === 1 ? '' : 's'} optimal`
        : `${okCount} optimal · ${total - okCount} need attention`,
      vaults: coldVaults,
    };
  }, [coldVaults]);

  const queueCard = (
    <div className="hospital-section-card" id={isQueueView ? 'queue-board' : 'queue'}>
      <div className="section-card-header queue-section-header">
        <div className="section-title-group">
          <h2>
            <span className="section-title-icon icon-shade-blue"><IconClipboard size={22} /></span>{' '}
            {isQueueView ? 'Live Vaccination Queue' : "Today's queue"}
          </h2>
          <p className="section-title-desc">
            {isQueueView
              ? 'Call Next, administer and discharge are handled by on-duty clinical staff'
              : 'Next patients for today. Check-in and payments are under Appointments.'}
          </p>
        </div>
        {!isQueueView && (
          <Link to="/hospital/appointments" className="btn-hospital-secondary queue-open-link">
            Open queue
          </Link>
        )}
      </div>

      {isQueueView && (
        <div className="queue-controls-bar">
          <div className="queue-controls-left">
            <input
              type="text"
              placeholder="Search patient, phone, token..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="queue-search-input"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="queue-filter-select"
              aria-label="Filter queue by status"
            >
              <option value="all">All Statuses</option>
              <option value="awaiting_payment">Awaiting payment</option>
              <option value="waiting">Waiting</option>
              <option value="administering">Administering</option>
              <option value="observation">In Observation</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <button
              type="button"
              className="btn-inventory-refresh"
              onClick={() => {
                setStatusFilter('all');
                loadAppointmentsQueue();
              }}
              disabled={queueLoading}
              title="Refresh live queue from database"
            >
              {queueLoading ? '...' : <IconRefresh size={16} />}
            </button>
          </div>

          <button
            type="button"
            className="btn-queue-walkin"
            onClick={() => setIsWalkInOpen(true)}
          >
            + Walk-In
          </button>
        </div>
      )}

      <div className="table-responsive">
        <table className="hospital-queue-table">
          <colgroup>
            <col className="col-token" />
            <col className="col-patient" />
            <col className="col-vaccine" />
            <col className="col-booth" />
            <col className="col-status" />
          </colgroup>
          <thead>
            <tr>
              <th>Token</th>
              <th>Patient Details</th>
              <th>Vaccine &amp; Dose</th>
              <th>Booth Station</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {queueLoading ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-muted)' }}>
                  Loading live queue from database...
                </td>
              </tr>
            ) : queueError ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '32px', color: 'var(--color-error)' }}>
                  {queueError}
                </td>
              </tr>
            ) : filteredQueue.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-table-cell">
                  No patients in today's queue.
                </td>
              </tr>
            ) : (
              queueRows.map((patient) => (
                <tr key={patient.id}>
                  <td>
                    <span className="queue-token-pill">{String(patient.token || '').replace(/-/g, '\u2011')}</span>
                  </td>
                  <td>
                    <div className="queue-patient-name">{patient.name}</div>
                    <div className="queue-patient-meta">
                      {patient.phone ? patient.phone : patient.date}
                    </div>
                    {patient.time ? (
                      <div className="queue-patient-meta queue-patient-time">{patient.time}</div>
                    ) : null}
                  </td>
                  <td>
                    <div className="queue-vaccine-badge">{patient.vaccine}</div>
                    <div className="queue-dose-meta" title={patient.dose}>{patient.dose}</div>
                  </td>
                  <td>
                    <span
                      className={`queue-booth-tag${
                        !patient.booth?.code ? ' is-unassigned' : ''
                      }`}
                    >
                      {patient.booth?.code || 'Unassigned'}
                    </span>
                  </td>
                  <td>
                    {!isQueueView ? (
                      <span className={`queue-status-badge status-${patient.status}`}>
                        {patient.status === 'awaiting_payment'
                          ? 'Awaiting payment'
                          : patient.status === 'waiting'
                            ? (patient.checkedIn ? 'Checked in' : 'Not arrived')
                            : queueStatusLabel(patient.status)}
                      </span>
                    ) : patient.status === 'awaiting_payment' ? (
                      <div className="hospital-action-buttons-wrapper">
                        <span className="mockup-status-badge pending">Awaiting payment</span>
                        {!patient.checkedIn && patient.date === todayStr ? (
                          <button
                            type="button"
                            className="btn-hospital-confirm-action"
                            title="Patient has arrived at the hospital"
                            onClick={() => handleDeskCheckIn(patient.id)}
                          >
                            Check in
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-hospital-confirm-action"
                          title="Record desk/cash payment at the hospital counter"
                          onClick={() => handleDeskMarkPaid(patient.id)}
                        >
                          Mark paid
                        </button>
                        <button
                          type="button"
                          className="btn-hospital-cancel-action"
                          title="Decline unpaid appointment"
                          onClick={() => handleDeskDeclineUnpaid(patient.id)}
                        >
                          ✕ Decline
                        </button>
                      </div>
                    ) : patient.status === 'waiting' && !patient.checkedIn && patient.date === todayStr ? (
                      <div className="hospital-action-buttons-wrapper">
                        <span className="mockup-status-badge pending">Not arrived</span>
                        <button
                          type="button"
                          className="btn-hospital-confirm-action"
                          title="Patient has arrived at the hospital"
                          onClick={() => handleDeskCheckIn(patient.id)}
                        >
                          Check in
                        </button>
                        <button
                          type="button"
                          className="btn-hospital-cancel-action"
                          title="Patient did not come"
                          onClick={() => handleDeskNoShow(patient.id)}
                        >
                          No-show
                        </button>
                      </div>
                    ) : (
                      <span className={`queue-status-badge status-${patient.status}`}>
                        {patient.status === 'waiting' && patient.checkedIn
                          ? 'Checked in'
                          : queueStatusLabel(patient.status)}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="hospital-dashboard-tab">
      {/* 1. Hero Banner */}
      {!isQueueView && (
        <PortalHero
          eyebrow="Hospital operations"
          title={hospitalCenterName}
          subtitle="Real-time management for daily vaccinations, cold-chain monitoring, and live patient queueing."
          image={hospitalHeroImage}
        >
          <div className="hospital-hero-tags">
            {hospitalCenterCode && (
              <span className="hospital-tag-item">{hospitalCenterCode}</span>
            )}
            {hospitalSessionHours && (
              <span className="hospital-tag-item">Hours: {hospitalSessionHours}</span>
            )}
            {hospitalType && (
              <span className="hospital-tag-item">{hospitalType}</span>
            )}
          </div>
        </PortalHero>
      )}

      {/* Toast Notice */}
      {toastMessage && (
        <div
          style={{
            background: 'var(--color-success-bg)',
            border: '1px solid var(--color-success-border)',
            color: 'var(--color-success)',
            padding: '12px 18px',
            borderRadius: '10px',
            marginBottom: '20px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 12px rgba(6, 95, 70, 0.1)',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage('')}
            style={{ background: 'none', border: 'none', color: 'var(--color-success)', cursor: 'pointer', fontWeight: 800 }}
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* 2. Metrics: front-desk counts on the queue page, operations overview on home */}
      {isQueueView ? (
        <div className="hospital-metrics-grid hospital-metrics-grid--4">
          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-amber">
              <IconClock size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Not arrived</span>
              <span className="hospital-stat-value">{notArrivedCount}</span>
              <span className="hospital-stat-meta">Booked for today</span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-amber">
              <IconPackage size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Awaiting payment</span>
              <span className="hospital-stat-value">{awaitingPaymentCount}</span>
              <span className="hospital-stat-meta">Pay at the desk</span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-blue">
              <IconClipboard size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Checked in</span>
              <span className="hospital-stat-value">{checkedInCount}</span>
              <span className="hospital-stat-meta">{observationCount} in observation</span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-green">
              <IconSyringe size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Completed today</span>
              <span className="hospital-stat-value">{completedTodayCount}</span>
              <span className="hospital-stat-meta">Doses given</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="hospital-metrics-grid">
          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-green">
              <IconSyringe size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Administered Vaccinations</span>
              <span className="hospital-stat-value">{completedTodayCount}</span>
              <span className="hospital-stat-meta">Completed today</span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-blue">
              <IconClock size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Active Patient Queue</span>
              <span className="hospital-stat-value">{activeQueueCount}</span>
              <span className="hospital-stat-meta">
                {observationCount} in observation
              </span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div
              className={`hospital-stat-icon ${
                coldChainSummary
                  ? (coldChainSummary.allOk ? 'stat-icon-green' : 'stat-icon-amber')
                  : 'stat-icon-slate'
              }`}
            >
              <IconSnowflake size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Cold-Chain Storage</span>
              <span className="hospital-stat-value">
                {inventoryLoading ? '...' : (coldChainSummary?.value || '—')}
              </span>
              <span className="hospital-stat-meta">
                {coldChainSummary ? (
                  <span className={coldChainSummary.allOk ? 'meta-positive' : 'meta-warning'}>
                    {coldChainSummary.meta}
                  </span>
                ) : (
                  'No vault telemetry'
                )}
              </span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-slate">
              <IconPackage size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Total Vaccine Stock</span>
              <span className="hospital-stat-value">
                {inventoryLoading ? '...' : totalStock.toLocaleString()}
              </span>
              <span className="hospital-stat-meta">
                {inventory.length} formulation{inventory.length === 1 ? '' : 's'} · vials on hand
              </span>
            </div>
          </div>

          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-blue">
              <IconShield size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">On-Duty Medical Staff</span>
              <span className="hospital-stat-value">{onDutyCount}</span>
              <span className="hospital-stat-meta">
                {liveBoothCount > 0
                  ? `${liveBoothCount} booth${liveBoothCount === 1 ? '' : 's'} live now`
                  : staffedBoothCount > 0
                    ? `${staffedBoothCount} booth${staffedBoothCount === 1 ? '' : 's'} scheduled today`
                    : 'No booths scheduled'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 3. Queue: full board on the queue page; preview beside stock on home */}
      {isQueueView ? (
        queueCard
      ) : (
        <div className="hospital-dashboard-columns">
          {queueCard}

          {/* Right Column: Vaccine Inventory Tracker */}
          <div className="hospital-section-card" id="inventory">
            <div className="section-card-header inventory-section-header">
              <div className="inventory-section-title-row">
                <h2>
                  <span className="section-title-icon section-title-icon--teal"><IconSnowflake size={22} /></span> Vaccine Stock &amp; Cold Vaults
                </h2>
                <div className="inventory-section-actions">
                  <button
                    type="button"
                    className="btn-inventory-refresh"
                    onClick={loadInventory}
                    disabled={inventoryLoading}
                    title="Refresh inventory from database"
                  >
                    {inventoryLoading ? '...' : <IconRefresh size={16} />}
                  </button>
                  <button
                    type="button"
                    className="btn-inventory-restock"
                    onClick={() => setIsRestockOpen(true)}
                  >
                    + Restock
                  </button>
                </div>
              </div>
              <p className="section-title-desc inventory-section-desc">
                Live batch numbers, expiration tracking, and cold-chain storage from database
              </p>
            </div>

            {/* Cold Chain IoT Health — all vaults */}
            <div className="cold-chain-monitor-bar cold-chain-monitor-bar--multi">
              {!coldChainSummary ? (
                <div className="cold-chain-info">
                  <span className="cold-chain-icon"><IconThermometer size={22} /></span>
                  <div>
                    <div className="cold-chain-temp">—</div>
                    <div className="cold-chain-label">No cold vault registered</div>
                  </div>
                </div>
              ) : (
                <div
                  className="cold-chain-vault-strip"
                  role="list"
                  aria-label="Cold vault temperatures"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(coldChainSummary.vaults.length, 3)}, minmax(0, 1fr))`,
                  }}
                >
                  {coldChainSummary.vaults.map((vault) => {
                    const temp = formatVaultTemp(vault.temp) || '—';
                    const ok =
                      !vault.status || /optimal|ok|normal|safe|active/i.test(String(vault.status));
                    return (
                      <div key={vault.id} className="cold-chain-vault-chip" role="listitem">
                        <span className="cold-chain-vault-chip-temp">{temp}</span>
                        <span className="cold-chain-vault-chip-name">{vault.name}</span>
                        <span
                          className={`cold-chain-vault-chip-status${ok ? ' is-ok' : ' is-warn'}`}
                        >
                          {vault.status || 'Monitored'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="inventory-items-list" tabIndex={0} role="region" aria-label="Vaccine stock batches">
              {inventoryLoading ? (
                <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '24px' }}>
                  Loading live inventory batches...
                </p>
              ) : inventoryError ? (
                <p style={{ color: 'var(--color-error)', textAlign: 'center', padding: '24px' }}>
                  {inventoryError}
                </p>
              ) : inventory.length === 0 ? (
                <p className="empty-state-text">
                  No vaccine batches logged in database. Click "+ Restock" to register a batch.
                </p>
              ) : (
                inventory.map((item) => {
                  const percent = Math.round(((item.available || 0) / (item.capacity || 1)) * 100);
                return (
                  <div key={item.id} className="inventory-item-card">
                    <div className="inventory-item-header">
                      <span className="inventory-name">{item.name}</span>
                      <span className="inventory-count">{item.available} vials</span>
                    </div>

                    <div className="inventory-meta">
                      <span>Lot: <strong>{item.lotNumber}</strong> • Exp: {item.expiry}</span>
                      <span>{item.temp}</span>
                    </div>

                    <div className="inventory-progress-track">
                      <div
                        className={`inventory-progress-bar ${item.statusColor}`}
                          style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
                      />
                    </div>

                    {item.warning && (
                      <div style={{ color: 'var(--color-warning)', fontSize: '0.72rem', fontWeight: 700, marginTop: '6px' }}>
                        {item.warning}
                      </div>
                    )}
                  </div>
                );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. Booth Station & Medical Staff On-Duty Allocation (home only) */}
      {!isQueueView && (
        <div className="hospital-section-card" id="booths">
          <div className="section-card-header booths-section-header">
            <div className="section-title-group">
              <h2>
                <span className="section-title-icon section-title-icon--teal"><IconDoor size={22} /></span> Vaccination Booths &amp; On-Duty Medical Staff
              </h2>
              <p className="section-title-desc">
                Live from Booths and today’s shift roster
              </p>
            </div>
            <div className="booths-header-actions">
              <span
                className={`booth-stat-pill ${staffedBoothCount > 0 ? 'is-ok' : 'is-warn'}`}
                title={staffedBoothCount > 0 ? 'Booths with shifts today' : 'No booths have shifts today'}
              >
                {boothCards.length} booth{boothCards.length === 1 ? '' : 's'} · {staffedBoothCount} staffed
              </span>
              <span
                className={`booth-stat-pill ${onDutyCount > 0 ? 'is-live' : 'is-idle'}`}
                title={onDutyCount > 0 ? 'Staff with a live shift right now' : 'No staff currently in a live shift'}
              >
                {onDutyCount} on duty now
              </span>
              <button
                type="button"
                className="btn-hospital-secondary"
                onClick={loadBoothStaffing}
                disabled={boothsLoading}
                style={{ padding: '6px 12px', fontSize: '0.82rem' }}
              >
                {boothsLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {boothsError && (
            <div
              className="appointment-alert-pill"
              role="alert"
              style={{ marginBottom: '12px', background: 'var(--color-error-bg)', color: 'var(--color-error)', borderColor: 'var(--color-error-border)' }}
            >
              {boothsError}
            </div>
          )}

          {boothsLoading ? (
            <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>Loading booth staffing...</p>
          ) : boothCards.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
              No active booths yet. Add stations under Sessions → Booths, then assign shifts to them.
            </p>
          ) : (
          <div className="booths-grid">
              {boothCards.map((booth) => (
              <div key={booth.id} className="booth-card">
                <div className="booth-card-header">
                  <div className="booth-title-box">
                      <span className="booth-number-tag">{booth.code}</span>
                    <span className="booth-title">{booth.boothName}</span>
                  </div>
                  <div className={`booth-status-indicator ${boothStatusClass(booth.status)}`}>
                    <span className="booth-status-dot" aria-hidden="true" />
                    <span>{booth.status}</span>
                  </div>
                </div>

                <div className="booth-staff-list">
                  {booth.staffMembers.length === 0 ? (
                    <div className="booth-staff-info">
                      <div className="staff-avatar-mini">
                        <RoleAvatarIcon role="Doctor" size={18} />
                      </div>
                      <div className="staff-text-group">
                        <span className="staff-name">Unassigned</span>
                        <span className="staff-role-desc">No shift scheduled today</span>
                      </div>
                    </div>
                  ) : (
                    booth.staffMembers.map((member) => (
                      <div
                        key={member.key}
                        className={`booth-staff-info${member.isLive ? ' is-live' : ''}`}
                      >
                        <div className="staff-avatar-mini">
                          {member.photoUrl ? (
                            <img src={member.photoUrl} alt="" />
                          ) : (
                            <RoleAvatarIcon role={member.roleKey} size={18} />
                          )}
                        </div>
                        <div className="staff-text-group">
                          <span className="staff-name">{member.name}</span>
                          <span className="staff-role-desc">
                            {member.roleLabel} · {member.window}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="booth-stats-row">
                  <span>
                    Today:{' '}
                    <strong className="booth-stat-bold">
                      {booth.shiftCount} shift{booth.shiftCount === 1 ? '' : 's'}
                    </strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {/* Modals */}
      <WalkInRegistrationModal
        isOpen={isWalkInOpen}
        onClose={() => setIsWalkInOpen(false)}
        onAddPatient={handleAddWalkIn}
        vaccines={formularyVaccines.map((f) => f.vaccineName || f.name).filter(Boolean)}
        vaccinePrices={Object.fromEntries(
          formularyVaccines
            .filter((f) => (f.vaccineName || f.name) && f.formattedPrice)
            .map((f) => [f.vaccineName || f.name, f.formattedPrice])
        )}
        booths={boothCards.map((b) => ({ id: b.id, label: b.boothName, vaccineNames: b.vaccineNames }))}
      />

      {isRestockOpen && (
        <RestockVaccineModal
          isOpen={isRestockOpen}
          onClose={() => setIsRestockOpen(false)}
          onAddStock={handleAddStock}
          registeredVaccines={formularyVaccines.map((f) => f.vaccineName || f.name)}
        />
      )}
    </div>
  );
}
