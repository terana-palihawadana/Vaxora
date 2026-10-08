import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { appointmentService } from '../services/appointmentService';
import BookingAgentChat from './BookingAgentChat';
import { IconCalendar, IconClock, IconDoctor, IconHospital, IconRefresh, IconSearch, IconShield } from '../../../shared/icons/AppIcons';
import PatientSubpageHeader from './PatientSubpageHeader';
import {
  canPatientCancelByStatus,
  getPatientAppointmentStatusDisplay,
  normalizePatientAppointmentStatus,
} from '../utils/appointmentStatusDisplay';

const ACTIVE_APPOINTMENT_STATUSES = new Set([
  'confirmed',
  'accepted',
  'pending',
  'pendingpayment',
  'administering',
  'insession',
  'observation',
]);

function appointmentDateKey(apt) {
  return String(apt.appointmentDate || apt.date || '').slice(0, 10);
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeSlotTo24h(slotStart) {
  const raw = String(slotStart || '').trim();
  if (!raw) return '';
  // Already 24h HH:mm
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(':');
    return `${String(h).padStart(2, '0')}:${m}:00`;
  }
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return '';
  let hour = parseInt(match[1], 10);
  const minute = match[2];
  const mer = match[3].toUpperCase();
  if (mer === 'PM' && hour < 12) hour += 12;
  if (mer === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${minute}:00`;
}

const STEP_ICONS = {
  hospital: IconHospital,
  calendar: IconCalendar,
  clock: IconClock,
  shield: IconShield,
};

function registerPayHereCallbacks(payhere, callbacks) {
  payhere.onCompleted = callbacks.onCompleted;
  payhere.onDismissed = callbacks.onDismissed;
  payhere.onError = callbacks.onError;
}

export default function AppointmentsTab() {
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [vaccinesList, setVaccinesList] = useState([]);
  const [availableHospitals, setAvailableHospitals] = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const [availableSlots, setAvailableSlots] = useState([]);
  
  const [loadingVaccines, setLoadingVaccines] = useState(true);
  const [loadingDates, setLoadingDates] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [cancellationNow, setCancellationNow] = useState(null);

  useEffect(() => {
    const updateCancellationNow = () => setCancellationNow(Date.now());
    updateCancellationNow();
    const intervalId = window.setInterval(updateCancellationNow, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Popup calendar states
  const [showCalendarPopup, setShowCalendarPopup] = useState(false);
  const [calendarViewDate, setCalendarViewDate] = useState(() => new Date());
  const calendarRef = useRef(null);

  const [formData, setFormData] = useState({
    vaccine: '',
    vaccineId: null,
    hospital: '',
    hospitalUserId: null,
    date: '',
    time: '',
    scheduleId: null,
    notes: '',
  });

  const [appointments, setAppointments] = useState([]);
  const [notification, setNotification] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [listStatus, setListStatus] = useState('active'); // active | all | specific
  const [listDateScope, setListDateScope] = useState('upcoming'); // upcoming | past | all

  // Payment integration states
  const [selectedFee, setSelectedFee] = useState(0);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const showToast = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 5000);
  };

  // 1. Fetch logged-in patient's saved appointments from database
  const loadMyAppointments = useCallback(async () => {
    try {
      setLoadingAppointments(true);
      const data = await appointmentService.getPatientAppointments();
      if (Array.isArray(data)) {
        setAppointments(data);
      } else {
        setAppointments([]);
      }
    } catch (err) {
      console.error('Error loading patient appointments:', err);
    } finally {
      setLoadingAppointments(false);
    }
  }, []);

  const filteredAppointments = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    const today = todayKey();

    return appointments.filter((apt) => {
      const status = normalizePatientAppointmentStatus(apt.status);
      const date = appointmentDateKey(apt);

      if (listStatus === 'active') {
        if (!ACTIVE_APPOINTMENT_STATUSES.has(status)) return false;
      } else if (listStatus !== 'all' && status !== listStatus) {
        return false;
      }

      if (listDateScope === 'upcoming' && date && date < today) return false;
      if (listDateScope === 'past' && date && date >= today) return false;

      if (q) {
        const haystack = [
          apt.vaccineName,
          apt.vaccine,
          apt.hospitalName,
          apt.location,
          apt.doctorName,
          apt.timeSlot,
          apt.time,
          apt.boothLabel,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [appointments, listSearch, listStatus, listDateScope]);

  /** Wait for authoritative PayHere IPN (client cannot forge Paid). */
  const syncPayHereConfirmation = useCallback(async (appointmentId) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let confirmed = false;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const result = await appointmentService.confirmPayment(appointmentId);
        if (result?.confirmed) {
          confirmed = true;
          break;
        }
      } catch (err) {
        console.warn('PayHere sync attempt failed:', err?.message || err);
      }

      const list = await appointmentService.getPatientAppointments().catch(() => null);
      if (Array.isArray(list)) {
        setAppointments(list);
        const match = list.find((a) => String(a.id || a.Id) === String(appointmentId));
        const paid =
          String(match?.paymentStatus || '').toLowerCase() === 'paid' &&
          String(match?.status || '').toLowerCase() === 'confirmed';
        if (paid) {
          confirmed = true;
          break;
        }
      }

      await sleep(1500);
    }

    await loadMyAppointments();
    if (confirmed) {
      showToast('Payment confirmed. Your appointment is booked and receipts have been emailed.');
    } else {
      showToast(
        'PayHere checkout finished. Waiting for payment notification — refresh shortly, or ask the hospital desk to Mark paid if you paid at the counter.'
      );
    }
    setTimeout(() => {
      const section = document.querySelector('.appointments-list-section');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    }, 250);
  }, [loadMyAppointments]);

  useEffect(() => deferEffectCallback(() => {
    loadMyAppointments();
  }), [loadMyAppointments]);

  // Auto-refresh appointments whenever user focuses or switches back to tab
  useEffect(() => {
    const handleWindowFocus = () => {
      loadMyAppointments();
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [loadMyAppointments]);

  // 2. Listen for PayHere return URL query parameters (success or cancel)
  useEffect(() => deferEffectCallback(() => {
    const query = new URLSearchParams(window.location.search);
    const paymentParam = query.get('payment');
    const aptId = query.get('apt_id');

    if (paymentParam === 'success' && aptId) {
      const handleReturnSuccess = async () => {
        window.history.replaceState({}, document.title, window.location.pathname);
        await syncPayHereConfirmation(aptId);
      };
      handleReturnSuccess();
    } else if (paymentParam === 'cancelled') {
      showToast('PayHere payment was cancelled. You can complete payment anytime from your appointments list.');
      window.history.replaceState({}, document.title, window.location.pathname);
      loadMyAppointments();
    }
  }), [loadMyAppointments, syncPayHereConfirmation]);

  // 3. Fetch available vaccines and hospitals from database
  useEffect(() => {
    const fetchVaccines = async () => {
      try {
        setLoadingVaccines(true);
        const apiVaccines = await appointmentService.getVaccinesWithHospitals();
        if (Array.isArray(apiVaccines)) {
          const vaccineMap = new Map();
          apiVaccines.forEach((v) => {
            const vName = (v.name || '').trim();
            if (!vName) return;
            const key = vName.toLowerCase();
            const hospList = (v.hospitals || []).map((h) => ({
              id: h.id, // Hospital user or profile ID
              userId: h.userId || h.id,
              name: h.name,
              location: h.district || h.location || 'Sri Lanka',
              type: h.type || 'Approved Hospital',
            }));

            if (!vaccineMap.has(key)) {
              vaccineMap.set(key, {
                id: v.id,
                name: vName,
                category: v.category || 'Routine',
                manufacturer: v.manufacturer || '',
                hospitals: hospList,
              });
            } else {
              // Merge hospitals without duplicates
              const existing = vaccineMap.get(key);
              const existingHospIds = new Set(existing.hospitals.map((h) => h.id || h.userId));
              hospList.forEach((h) => {
                if (!existingHospIds.has(h.id || h.userId)) {
                  existing.hospitals.push(h);
                  existingHospIds.add(h.id || h.userId);
                }
              });
            }
          });

          setVaccinesList(Array.from(vaccineMap.values()));
        }
      } catch (err) {
        console.error('Error fetching vaccines with hospitals:', err);
      } finally {
        setLoadingVaccines(false);
      }
    };

    fetchVaccines();
  }, []);

  // 3. Handle Vaccine Selection Change
  const handleVaccineChange = (e) => {
    const selectedName = e.target.value;
    const selectedObj = vaccinesList.find((v) => v.name === selectedName);

    const hospitals = selectedObj?.hospitals || [];
    setAvailableHospitals(hospitals);
    setAvailableDates([]);
    setAvailableSlots([]);
    setSelectedFee(0);

    // Reset downstream fields
    setFormData({
      vaccine: selectedName,
      vaccineId: selectedObj?.id || null,
      hospital: '',
      hospitalUserId: null,
      date: '',
      time: '',
      scheduleId: null,
      notes: '',
    });
  };

  // 4. Handle Hospital Selection Change -> Loads available dates for vaccine
  const handleHospitalChange = async (e) => {
    const selectedHospitalUserId = e.target.value;
    const selectedHospitalObj = availableHospitals.find(
      (h) => String(h.userId || h.id) === String(selectedHospitalUserId)
    );

    const hospitalDisplayName = selectedHospitalObj
      ? `${selectedHospitalObj.name} (${selectedHospitalObj.location})`
      : '';

    setFormData((prev) => ({
      ...prev,
      hospital: hospitalDisplayName,
      hospitalUserId: selectedHospitalUserId,
      date: '',
      time: '',
      scheduleId: null,
    }));

    setAvailableDates([]);
    setAvailableSlots([]);
    setSelectedFee(0);

    if (selectedHospitalUserId && formData.vaccine) {
      try {
        setLoadingDates(true);
        const dates = await appointmentService.getAvailableDates(
          selectedHospitalUserId,
          formData.vaccine
        );
        const validDates = Array.isArray(dates) ? dates : [];
        setAvailableDates(validDates);

        // Pre-read fee from first available schedule slot and set calendar view to earliest session
        if (validDates.length > 0) {
          const firstDateStr = validDates[0].date || validDates[0].Date;
          if (firstDateStr) {
            const parts = firstDateStr.split('-').map(Number);
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              setCalendarViewDate(new Date(parts[0], parts[1] - 1, 1));
            }
          }
          const fee = Number(validDates[0].price ?? validDates[0].Price ?? 0);
          setSelectedFee(fee);
        }
      } catch (err) {
        console.error('Failed to load available dates:', err);
        setAvailableDates([]);
      } finally {
        setLoadingDates(false);
      }
    }
  };

  // Available dates map for quick O(1) lookup
  const availableDatesMap = useMemo(() => {
    const map = new Map();
    availableDates.forEach((d) => {
      const dateVal = d.date || d.Date;
      if (dateVal) {
        map.set(dateVal, d);
      }
    });
    return map;
  }, [availableDates]);

  // Information about currently selected date
  const selectedDateInfo = useMemo(() => {
    if (!formData.date) return null;
    return availableDatesMap.get(formData.date) || null;
  }, [formData.date, availableDatesMap]);

  // Close calendar popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target)) {
        setShowCalendarPopup(false);
      }
    };
    if (showCalendarPopup) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCalendarPopup]);

  // Calendar month navigation
  const handlePrevMonth = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCalendarViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCalendarViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // Generate days array for calendar grid
  const calendarDays = useMemo(() => {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sun
    const totalDays = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, dateStr });
    }
    return days;
  }, [calendarViewDate]);

  // 5. Handle Date Selection -> Loads available 20-minute time slots
  const handleSelectDate = async (selectedDate) => {
    const selectedDateObj = availableDatesMap.get(selectedDate);

    // Update fee specifically for this date/schedule
    if (selectedDateObj) {
      const fee = Number(selectedDateObj.price ?? selectedDateObj.Price ?? 0);
      setSelectedFee(fee);
    }

    setFormData((prev) => ({
      ...prev,
      date: selectedDate,
      time: '',
      scheduleId: selectedDateObj?.scheduleId || selectedDateObj?.ScheduleId || null,
    }));

    setAvailableSlots([]);
    setShowCalendarPopup(false);

    if (formData.hospitalUserId && formData.vaccine && selectedDate) {
      try {
        setLoadingSlots(true);
        const slots = await appointmentService.getAvailableSlots(
          formData.hospitalUserId,
          formData.vaccine,
          selectedDate
        );
        setAvailableSlots(Array.isArray(slots) ? slots : []);
      } catch (err) {
        console.error('Failed to load available slots:', err);
        setAvailableSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    }
  };

  // 6. Handle Time Slot Selection
  const handleTimeChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      time: e.target.value,
    }));
  };

  // 7. Handle Form Submission -> Persists Appointment to Database
  const handleBook = async (e) => {
    e.preventDefault();
    if (!formData.vaccine || !formData.hospitalUserId || !formData.date || !formData.time) {
      alert('Please complete all steps (Vaccine, Hospital, Date, and Time).');
      return;
    }

    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
    if (formData.date < todayLocal) {
      alert('That appointment date is in the past. Please pick another date.');
      return;
    }
    if (formData.date === todayLocal) {
      const slotStart = String(formData.time).split('-')[0]?.trim() || '';
      const nowHm = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Colombo',
      });
      // Compare via Date when slot is 12h ("09:00 AM") or 24h
      const parsed = Date.parse(`1970-01-01T${normalizeSlotTo24h(slotStart)}`);
      const nowParsed = Date.parse(`1970-01-01T${nowHm}:00`);
      if (!Number.isNaN(parsed) && !Number.isNaN(nowParsed) && parsed < nowParsed) {
        alert('That time slot has already started. Please choose a later slot.');
        return;
      }
    }

    const isFree = selectedFee <= 0;
    const chosenMethod = isFree ? 'Free' : 'PayHere';

    const payload = {
      hospitalUserId: formData.hospitalUserId,
      vaccineName: formData.vaccine,
      vaccineId: formData.vaccineId,
      vaccineScheduleId: formData.scheduleId,
      appointmentDate: formData.date,
      timeSlot: formData.time,
      notes: formData.notes || null,
      paymentMethod: chosenMethod,
    };

    try {
      setSubmitting(true);
      const res = await appointmentService.bookAppointment(payload);

      // Verify the returned appointment status and fee from the server
      const resFee = Number(res?.fee ?? res?.Fee ?? selectedFee);
      const resStatus = String(res?.status ?? res?.Status ?? '').toLowerCase();

      if (resFee <= 0 || resStatus === 'confirmed') {
        showToast('✓ Free appointment confirmed! Booking details sent to your email.');
        resetBookingForm();
        await loadMyAppointments();
        setTimeout(() => {
          const section = document.querySelector('.appointments-list-section');
          if (section) section.scrollIntoView({ behavior: 'smooth' });
        }, 200);
      } else {
        // Online Card Payment via PayHere Gateway
        // Appointment is created in PendingPayment status.
        const checkoutPayload = await appointmentService.initPayHere(res.id || res.Id);
        resetBookingForm();
        await loadMyAppointments();

        // Directly launch official PayHere popup without any intermediate built-in checkout
        launchPayHere(checkoutPayload, res.id || res.Id);
      }
    } catch (err) {
      alert(`Booking failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const resetBookingForm = () => {
    setFormData({
      vaccine: '',
      vaccineId: null,
      hospital: '',
      hospitalUserId: null,
      date: '',
      time: '',
      scheduleId: null,
      notes: '',
    });
    setSelectedFee(0);
    setAvailableHospitals([]);
    setAvailableDates([]);
    setAvailableSlots([]);
  };

  // Direct PayHere Official JavaScript SDK Popup Launcher
  const launchPayHere = (checkoutPayload, aptId) => {
    if (!window.payhere) {
      alert('PayHere payment library is still loading or blocked by your browser. Please refresh and try again.');
      return;
    }

    registerPayHereCallbacks(window.payhere, {
      onCompleted: async function onCompleted(orderId) {
        console.log('PayHere payment completed. OrderID:', orderId);
        try {
          await syncPayHereConfirmation(aptId);
        } catch (err) {
          console.error('Failed to sync PayHere payment:', err);
          showToast(err.message || 'Could not sync payment status. Please refresh.');
          await loadMyAppointments();
        }
      },
      onDismissed: function onDismissed() {
        showToast('PayHere checkout closed. You can complete payment anytime by clicking "Pay Now" on your appointment.');
        loadMyAppointments();
      },
      onError: function onError(error) {
        console.error('PayHere error:', error);
        alert(`PayHere error: ${error}`);
        loadMyAppointments();
      },
    });

    const payment = {
      sandbox: true,
      merchant_id: checkoutPayload.merchantId,
      return_url: checkoutPayload.returnUrl,
      cancel_url: checkoutPayload.cancelUrl,
      notify_url: checkoutPayload.notifyUrl,
      order_id: checkoutPayload.orderId,
      items: checkoutPayload.items,
      amount: checkoutPayload.formattedAmount,
      currency: checkoutPayload.currency,
      hash: checkoutPayload.hash,
      first_name: checkoutPayload.firstName,
      last_name: checkoutPayload.lastName,
      email: checkoutPayload.email,
      phone: checkoutPayload.phone,
      address: checkoutPayload.address,
      city: checkoutPayload.city,
      country: checkoutPayload.country,
    };

    window.payhere.startPayment(payment);
  };

  // Initiate PayHere Checkout for pending appointments
  const handlePayNow = async (apt) => {
    try {
      setIsProcessingPayment(true);
      const checkoutPayload = await appointmentService.initPayHere(apt.id || apt.Id);
      launchPayHere(checkoutPayload, apt.id || apt.Id);
    } catch (err) {
      alert(`Failed to launch PayHere: ${err.message}`);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Appointment dates and times are hospital-local (Sri Lanka, UTC+05:30).
  const isEligibleForCancellation = (appointment) => {
    const appointmentDate = appointment.appointmentDate || appointment.date;
    const timeSlot = appointment.startTime || appointment.StartTime ||
      appointment.timeSlot || appointment.TimeSlot;
    if (!appointmentDate || !timeSlot || cancellationNow === null) return false;

    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(appointmentDate).split('T')[0]);
    const timeValue = String(timeSlot).split('-')[0].trim();
    const timeMatch = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(timeValue);
    if (!dateMatch || !timeMatch) return false;

    const [, year, month, day] = dateMatch;
    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const meridiem = timeMatch[3]?.toUpperCase();
    if (minutes > 59 || (meridiem && (hours < 1 || hours > 12)) || (!meridiem && hours > 23)) {
      return false;
    }
    if (meridiem) {
      hours = hours % 12 + (meridiem === 'PM' ? 12 : 0);
    }

    const appointmentDateTime = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      hours,
      minutes,
    );
    if (
      new Date(appointmentDateTime).toISOString().slice(0, 10) !== `${year}-${month}-${day}`
    ) {
      return false;
    }

    const sriLankaOffsetMs = 5.5 * 60 * 60 * 1000;
    const appointmentStartUtc = appointmentDateTime - sriLankaOffsetMs;
    return appointmentStartUtc - cancellationNow >= 24 * 60 * 60 * 1000;
  };

  // 8. Handle Appointment Cancellation
  const handleCancel = async (apt) => {
    if (!isEligibleForCancellation(apt)) {
      alert('Appointments can only be cancelled at least 24 hours before the scheduled start time. For same-day adjustments, please contact the hospital directly.');
      return;
    }

    if (window.confirm('Are you sure you want to cancel this appointment slot? Your 20-minute slot will be made free for other citizens and a cancellation email will be sent to you.')) {
      try {
        await appointmentService.cancelAppointment(apt.id || apt.Id);
        showToast('Appointment cancelled successfully. A confirmation email has been dispatched and the slot is now free.');
        await loadMyAppointments();
      } catch (err) {
        alert(`Failed to cancel appointment: ${err.message}`);
      }
    }
  };

  // Dynamic step message
  const getStepGuide = () => {
    if (!formData.vaccine) {
      return {
        type: 'guide-prompt',
        iconKey: null,
        text: 'Step 1: Please select a vaccine from the list below to check which hospitals are offering it.',
      };
    }
    if (availableHospitals.length === 0) {
      return {
        type: 'guide-warning',
        iconKey: 'shield',
        text: `No hospitals are currently offering "${formData.vaccine}". Please select another vaccine.`,
      };
    }
    if (!formData.hospitalUserId) {
      return {
        type: 'guide-success',
        iconKey: 'hospital',
        text: `Step 2: ${availableHospitals.length} hospital(s) found offering ${formData.vaccine}. Choose your preferred hospital.`,
      };
    }
    if (!formData.date) {
      return {
        type: 'guide-prompt',
        iconKey: 'calendar',
        text: availableDates.length > 0
          ? `Step 3: Choose an available session date (${availableDates.length} date(s) found).`
          : 'Step 3: Checking available schedule dates from hospital...',
      };
    }
    if (!formData.time) {
      return {
        type: 'guide-prompt',
        iconKey: 'clock',
        text: 'Step 4: Select an available 20-minute time slot.',
      };
    }
    return {
      type: 'guide-success',
      iconKey: 'shield',
      text: 'Ready! Click "Book Appointment" to reserve your vaccination slot.',
    };
  };

  const stepInfo = getStepGuide();
  const isVaccineSelected = Boolean(formData.vaccine);
  const isHospitalSelected = Boolean(formData.hospitalUserId);
  const isDateSelected = Boolean(formData.date);
  const isFormComplete = Boolean(formData.vaccine && formData.hospitalUserId && formData.date && formData.time);

  return (
    <div className="patient-subpage-page">
      <PatientSubpageHeader
        title="Appointments"
        subtitle="Book vaccination visits and manage your upcoming appointments."
      />
      <div className="manage-appointments-wrapper">
      {/* Outer White Card Container */}
      <div className="manage-appointments-card">
        {/* Notification Alert */}
        {notification && (
          <div className="appointment-alert-pill" role="alert">
            ✓ {notification}
          </div>
        )}

        {/* Inner Light Blue Card: Book a New Appointment */}
        <div className="book-appointment-box" style={{ marginBottom: '32px' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <h2 className="book-appointment-heading" style={{ margin: 0 }}>
              Book a New Appointment
            </h2>
            <button
              type="button"
              onClick={() => setShowAgentModal(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 18px',
                background: 'linear-gradient(135deg, #0369a1 0%, #0369a1 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.35)',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <span style={{ fontSize: '18px' }}>🤖</span>
              <span>Open Booking Agent</span>
              <span style={{
                background: 'rgba(255, 255, 255, 0.25)',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 600
              }}>AI</span>
            </button>
          </div>

          {/* Dynamic Step Guidance Prompt */}
          <div className={`booking-step-guide ${stepInfo.type}`}>
            {stepInfo.iconKey && STEP_ICONS[stepInfo.iconKey] ? (
              <span style={{ display: 'inline-flex', marginRight: '6px', verticalAlign: 'middle' }}>
                {React.createElement(STEP_ICONS[stepInfo.iconKey], { size: 18 })}
              </span>
            ) : null}
            <span>{stepInfo.text}</span>
          </div>

          <form onSubmit={handleBook} className="book-appointment-form">
              <div className="book-form-grid">
              {/* 1. Select Vaccine (Always Enabled) */}
              <div className="book-form-group">
                <label className="book-form-label" htmlFor="select-vaccine">
                  Select Vaccine <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <div className="select-dropdown-wrap">
                  <select
                    id="select-vaccine"
                    name="vaccine"
                    value={formData.vaccine}
                    onChange={handleVaccineChange}
                    className="book-form-select"
                    disabled={loadingVaccines}
                    required
                  >
                    <option value="" disabled>
                      {loadingVaccines ? 'Loading vaccines from database...' : 'Select Vaccine'}
                    </option>
                    {vaccinesList.map((v) => (
                      <option key={v.id} value={v.name}>
                        {v.name} ({v.category})
                      </option>
                    ))}
                  </select>
                </div>
                {!isVaccineSelected ? (
                  <span className="field-helper-hint hint-warning">
                    * Required: Select a vaccine to unlock hospital list
                  </span>
                ) : (
                  <span className="field-helper-hint hint-success">
                    ✓ Vaccine selected: {formData.vaccine}
                  </span>
                )}
              </div>

              {/* 2. Select Hospital (Disabled until Vaccine is chosen) */}
              <div className="book-form-group">
                <label
                  className={`book-form-label ${!isVaccineSelected ? 'disabled' : ''}`}
                  htmlFor="select-hospital"
                >
                  Select Hospital <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <div className={`select-dropdown-wrap ${!isVaccineSelected ? 'disabled' : ''}`}>
                  <select
                    id="select-hospital"
                    name="hospitalUserId"
                    value={formData.hospitalUserId || ''}
                    onChange={handleHospitalChange}
                    className="book-form-select"
                    disabled={!isVaccineSelected || availableHospitals.length === 0}
                    required
                  >
                    <option value="" disabled>
                      {!isVaccineSelected
                        ? 'Select Vaccine first...'
                        : availableHospitals.length === 0
                        ? 'No hospitals offering this vaccine'
                        : 'Select Hospital'}
                    </option>
                    {availableHospitals.map((hosp) => (
                      <option key={hosp.userId || hosp.id} value={hosp.userId || hosp.id}>
                        {hosp.name} - {hosp.location}
                      </option>
                    ))}
                  </select>
                </div>
                {isVaccineSelected && availableHospitals.length > 0 && (
                  <span className="field-helper-hint hint-success">
                    ✓ {availableHospitals.length} hospital(s) offering this vaccine
                  </span>
                )}
                {isVaccineSelected && availableHospitals.length === 0 && (
                  <span className="field-helper-hint hint-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <IconShield size={14} /> No hospitals currently offer this vaccine
                  </span>
                )}
              </div>

              {/* 3. Available Date - Interactive Popup Calendar View */}
              <div className="book-form-group" ref={calendarRef} style={{ position: 'relative' }}>
                <label
                  className={`book-form-label ${!isHospitalSelected ? 'disabled' : ''}`}
                  htmlFor="select-date-trigger"
                >
                  Date <span style={{ color: '#dc2626' }}>*</span>
                </label>

                <div className={`select-dropdown-wrap ${!isHospitalSelected ? 'disabled' : ''}`}>
                  <button
                    id="select-date-trigger"
                    type="button"
                    className="cal-trigger-button"
                    onClick={() => {
                      if (isHospitalSelected && !loadingDates && availableDates.length > 0) {
                        setShowCalendarPopup((prev) => !prev);
                      }
                    }}
                    disabled={!isHospitalSelected || loadingDates || availableDates.length === 0}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <IconCalendar size={16} />
                      <span style={{ color: formData.date ? '#0f172a' : '#94a3b8', fontWeight: formData.date ? '600' : 'normal' }}>
                        {!isHospitalSelected
                          ? 'Select Hospital first...'
                          : loadingDates
                          ? 'Loading available schedule dates...'
                          : availableDates.length === 0
                          ? 'No upcoming sessions scheduled'
                          : formData.date
                          ? `${formData.date} (${selectedDateInfo?.dayOfWeek || ''})`
                          : 'Click to select available date from calendar'}
                      </span>
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {showCalendarPopup ? '▲' : '▼'}
                    </span>
                  </button>
                </div>

                {/* Calendar Popup Dropdown Card */}
                {showCalendarPopup && (
                  <div className="cal-popup-card">
                    {/* Month / Year navigation header */}
                    <div className="cal-popup-header">
                      <button
                        type="button"
                        className="cal-nav-btn"
                        onClick={handlePrevMonth}
                        title="Previous Month"
                      >
                        ◀
                      </button>
                      <span className="cal-month-title">
                        {calendarViewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                      </span>
                      <button
                        type="button"
                        className="cal-nav-btn"
                        onClick={handleNextMonth}
                        title="Next Month"
                      >
                        ▶
                      </button>
                    </div>

                    {/* Weekday labels */}
                    <div className="cal-weekdays-row">
                      <span>Su</span>
                      <span>Mo</span>
                      <span>Tu</span>
                      <span>We</span>
                      <span>Th</span>
                      <span>Fr</span>
                      <span>Sa</span>
                    </div>

                    {/* Days Grid */}
                    <div className="cal-days-grid">
                      {calendarDays.map((cell, idx) => {
                        if (!cell) {
                          return <div key={`empty-${idx}`} className="cal-cell empty" />;
                        }

                        const isAvailable = availableDatesMap.has(cell.dateStr);
                        const isSelected = formData.date === cell.dateStr;
                        const session = availableDatesMap.get(cell.dateStr);

                        if (isAvailable) {
                          return (
                            <button
                              key={cell.dateStr}
                              type="button"
                              className={`cal-cell available ${isSelected ? 'selected' : ''}`}
                              onClick={() => handleSelectDate(cell.dateStr)}
                              title={`${cell.dateStr} (${session?.dayOfWeek || ''}): ${session?.startTime || '09:00'} - ${session?.endTime || '11:00'}`}
                            >
                              <span>{cell.day}</span>
                              <span className="cal-available-dot" />
                            </button>
                          );
                        }

                        return (
                          <div key={cell.dateStr} className="cal-cell disabled">
                            <span>{cell.day}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Footer / Legend */}
                    <div className="cal-popup-footer">
                      <div className="cal-legend">
                        <span className="legend-item">
                          <span className="legend-dot available" /> Available
                        </span>
                        <span className="legend-item">
                          <span className="legend-dot selected" /> Selected
                        </span>
                      </div>
                      <span className="cal-available-count">
                        {availableDates.length} date{availableDates.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                )}

                {/* Selected Date Session Details Card */}
                {formData.date && selectedDateInfo && (
                  <div className="cal-selection-detail-card">
                    <div className="cal-detail-left">
                      <div className="cal-check-badge">✓</div>
                      <div className="cal-detail-text">
                        <div className="cal-detail-date">
                          <strong>{formData.date} ({selectedDateInfo.dayOfWeek})</strong>
                          <span className="cal-time-pill">
                            {selectedDateInfo.startTime} - {selectedDateInfo.endTime}
                          </span>
                        </div>
                        {selectedDateInfo.formattedPrice && (
                          <div className="cal-detail-sub">
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <IconDoctor size={14} /> Clinic staff are scheduled separately
                            </span>
                            {selectedDateInfo.formattedPrice && (
                              <span className="cal-fee-tag">• {selectedDateInfo.formattedPrice}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="cal-change-btn"
                      onClick={() => setShowCalendarPopup(true)}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <IconCalendar size={14} />
                        <span>Change Date</span>
                      </span>
                    </button>
                  </div>
                )}

                {!isHospitalSelected ? (
                  <span className="field-helper-hint">
                    Select a hospital to enable date selection
                  </span>
                ) : loadingDates ? (
                  <span className="field-helper-hint">
                    Fetching hospital immunization schedules...
                  </span>
                ) : availableDates.length === 0 ? (
                  <span className="field-helper-hint hint-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <IconShield size={14} /> Hospital has not yet posted active schedule slots for this vaccine.
                  </span>
                ) : (
                  <span className="field-helper-hint hint-success">
                    ✓ {availableDates.length} upcoming session date(s) marked in calendar
                  </span>
                )}
              </div>

              {/* 4. Compact scrollable slots — seat info only on light hover */}
              <div className="book-form-group">
                <label
                  className={`book-form-label ${!isDateSelected ? 'disabled' : ''}`}
                  id="select-time-label"
                >
                  Time Slot (20-Minute Sessions) <span style={{ color: '#dc2626' }}>*</span>
                </label>

                {!isDateSelected ? (
                  <span className="field-helper-hint">Select a date to load time bands</span>
                ) : loadingSlots ? (
                  <span className="field-helper-hint">Loading time bands…</span>
                ) : availableSlots.length === 0 ? (
                  <span className="field-helper-hint hint-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <IconShield size={14} /> No open time bands on this date. Pick another day.
                  </span>
                ) : availableSlots.every((s) => s.isBooked || s.IsBooked) ? (
                  <span className="field-helper-hint hint-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <IconShield size={14} /> Every band is full. Try another date.
                  </span>
                ) : (
                  <div
                    className="slot-list"
                    role="listbox"
                    aria-labelledby="select-time-label"
                  >
                    {availableSlots.map((slotObj) => {
                      const slotText = slotObj.slot || slotObj.Slot;
                      const capacity = Number(slotObj.capacity ?? slotObj.Capacity ?? 3);
                      const booked = Number(slotObj.bookedCount ?? slotObj.BookedCount ?? 0);
                      const seatsLeft = Number(
                        slotObj.seatsRemaining ?? slotObj.SeatsRemaining ?? Math.max(0, capacity - booked)
                      );
                      const isFull = Boolean(slotObj.isBooked || slotObj.IsBooked) || seatsLeft <= 0;
                      const isSelected = formData.time === slotText;
                      const tip = isFull
                        ? `All ${capacity} seats taken`
                        : seatsLeft === capacity
                          ? `All ${capacity} seats free`
                          : `${seatsLeft} of ${capacity} seats left`;

                      return (
                        <button
                          key={slotText}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={isFull}
                          aria-label={`${slotText}, ${tip}`}
                          disabled={isFull}
                          className={[
                            'slot-list-row',
                            isFull ? 'is-full' : 'is-open',
                            isSelected ? 'is-selected' : '',
                          ].filter(Boolean).join(' ')}
                          onClick={() => {
                            if (isFull) return;
                            setFormData((prev) => ({ ...prev, time: slotText }));
                          }}
                        >
                          <span
                            className={`slot-status-dot ${isFull ? 'is-red' : 'is-green'}`}
                            aria-hidden="true"
                          />
                          <span className="slot-list-time">{slotText}</span>
                          <span className="slot-hover-tip" role="tooltip">
                            <span className="slot-chip-seats" aria-hidden="true">
                              {Array.from({ length: capacity }, (_, i) => (
                                <span
                                  key={i}
                                  className={`slot-seat-dot ${i < booked ? 'is-taken' : 'is-free'}`}
                                />
                              ))}
                            </span>
                            <span>{tip}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <input type="hidden" name="time" value={formData.time} required={isDateSelected} />
              </div>
            </div>

            {/* Vaccine Fee & Payment Choice Banner */}
            {formData.vaccine && formData.hospitalUserId && (
              <div
                style={{
                  margin: '22px 0 10px 0',
                  padding: '20px',
                  borderRadius: '14px',
                  background: selectedFee > 0 ? '#f0f9ff' : '#f0fdf4',
                  border: `1.5px solid ${selectedFee > 0 ? '#38bdf8' : '#86efac'}`,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.6px', color: selectedFee > 0 ? '#0369a1' : '#15803d', fontWeight: 800 }}>
                      Vaccination Fee (Configured by Hospital)
                    </div>
                    <div style={{ fontSize: '1.45rem', fontWeight: 800, color: selectedFee > 0 ? '#0369a1' : '#16a34a', marginTop: '2px' }}>
                      {selectedFee > 0 ? `Rs. ${selectedFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'Free (0 Rs - Fully Subsidized)'}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: '6px 14px',
                      borderRadius: '20px',
                      background: selectedFee > 0 ? '#e0f2fe' : '#dcfce7',
                      color: selectedFee > 0 ? '#0369a1' : '#15803d',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                    }}
                  >
                    {selectedFee > 0 ? 'Payment Required' : '✓ No Gateway Required'}
                  </div>
                </div>

                {/* If fee > 0: Card payment required notice */}
                {selectedFee > 0 && (
                  <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #bae6fd' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        border: '1px solid #bae6fd',
                        background: '#ffffff',
                      }}
                    >
                      <span style={{ fontSize: '1.4rem' }}>💳</span>
                      <div>
                        <div style={{ fontWeight: 700, color: '#0369a1', fontSize: '0.92rem' }}>
                          Online Card Payment Required
                        </div>
                        <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px', lineHeight: 1.4 }}>
                          Payment of <strong>Rs. {selectedFee.toLocaleString()}</strong> is completed securely via online card payment to confirm your booking.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Book Appointment CTA Button */}
            <div className="book-btn-wrap">
              <button
                type="submit"
                className="btn-book-appointment"
                disabled={!isFormComplete || submitting}
                title={
                  !isFormComplete
                    ? 'Please complete all steps to book your appointment'
                    : 'Click to book appointment'
                }
              >
                {submitting
                  ? 'Processing Booking...'
                  : selectedFee <= 0
                  ? 'Confirm & Book Free Spot'
                  : `Pay Now (Rs. ${selectedFee.toLocaleString()})`}
              </button>
            </div>
          </form>
        </div>

        {/* Booking Agent Modal Popup */}
        {showAgentModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(5px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '20px'
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAgentModal(false);
            }}
          >
            <div style={{
              width: '100%',
              maxWidth: '760px',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)'
            }}>
              <BookingAgentChat
                onClose={() => setShowAgentModal(false)}
                onAppointmentCreated={loadMyAppointments}
                launchPayHere={launchPayHere}
              />
            </div>
          </div>
        )}

        {/* Appointments Lower Section */}
        <div className="appointments-list-section">
          <div className="appointments-list-header">
            <h2 className="appointments-section-heading" style={{ margin: 0 }}>
              Appointments
              {!loadingAppointments && (
                <span className="appointments-list-count">
                  {filteredAppointments.length}
                  {filteredAppointments.length !== appointments.length
                    ? ` of ${appointments.length}`
                    : ''}
                </span>
              )}
            </h2>
            <button
              type="button"
              className="appointments-refresh-btn"
              onClick={loadMyAppointments}
              disabled={loadingAppointments}
            >
              <IconRefresh size={14} /> Refresh
            </button>
          </div>

          <div className="appointments-filter-bar" role="search" aria-label="Filter appointments">
            <label className="appointments-filter-search">
              <IconSearch size={15} aria-hidden="true" />
              <input
                type="search"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Search vaccine, hospital, doctor…"
                aria-label="Search appointments"
              />
            </label>

            <label className="appointments-filter-field">
              <span>Status</span>
              <select
                value={listStatus}
                onChange={(e) => setListStatus(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="active">Active</option>
                <option value="all">All statuses</option>
                <option value="confirmed">Confirmed</option>
                <option value="pendingpayment">Awaiting payment</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>

            <div className="appointments-filter-pills" role="group" aria-label="Filter by date">
              {[
                { id: 'upcoming', label: 'Upcoming' },
                { id: 'past', label: 'Past' },
                { id: 'all', label: 'All dates' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`appointments-filter-pill ${listDateScope === opt.id ? 'active' : ''}`}
                  onClick={() => setListDateScope(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="appointments-table-container">
            <table className="custom-appointments-table">
              <thead>
                <tr>
                  <th className="th-vaccine">Vaccine</th>
                  <th className="th-date">Date</th>
                  <th className="th-time">Time Slot</th>
                  <th className="th-location">Hospital / Center</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center' }}>Fee &amp; Payment</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center' }}>Status</th>
                  <th className="th-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingAppointments ? (
                  <tr>
                    <td colSpan="7" className="empty-appointments-cell">
                      Loading your appointments from database...
                    </td>
                  </tr>
                ) : appointments.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="empty-appointments-cell">
                      No current appointments scheduled. Select a vaccine above to book your slot.
                    </td>
                  </tr>
                ) : filteredAppointments.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="empty-appointments-cell">
                      No appointments match these filters. Try All statuses or All dates.
                    </td>
                  </tr>
                ) : (
                  filteredAppointments.map((apt) => {
                    const feeNum = Number(apt.fee ?? apt.Fee ?? 0);
                    const payStatus = apt.paymentStatus || apt.PaymentStatus || 'Paid';
                    const statusDisplay = getPatientAppointmentStatusDisplay(apt.status);
                    const canCancelByStatus = canPatientCancelByStatus(apt.status);

                    return (
                      <tr key={apt.id || apt.Id}>
                        <td className="td-vaccine">
                          <div style={{ fontWeight: 600 }}>{apt.vaccineName || apt.vaccine}</div>
                          {apt.doctorName && (
                            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                              Dr. {apt.doctorName}
                            </div>
                          )}
                        </td>
                        <td className="td-date">{apt.appointmentDate || apt.date}</td>
                        <td className="td-time">
                          <span style={{ fontWeight: 600, color: '#1e40af' }}>
                            {apt.timeSlot || apt.time}
                          </span>
                        </td>
                        <td className="td-location">{apt.hospitalName || apt.location}</td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: feeNum > 0 ? '#0369a1' : '#16a34a' }}>
                            {feeNum > 0 ? `LKR ${feeNum.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'Free'}
                          </div>
                          <div style={{ marginTop: '3px' }}>
                            {feeNum <= 0 ? (
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '0.74rem', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' }}>
                                ✓ Subsidized
                              </span>
                            ) : payStatus === 'Paid' ? (
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '0.74rem', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' }}>
                                ✓ Paid Online
                              </span>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700, backgroundColor: '#fee2e2', color: '#b91c1c' }}>
                                  Payment Due
                                </span>
                                {(apt.status || '').toLowerCase() !== 'cancelled' && (
                                  <button
                                    type="button"
                                    onClick={() => handlePayNow(apt)}
                                    disabled={isProcessingPayment}
                                    style={{
                                      padding: '3px 8px',
                                      backgroundColor: '#0369a1',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: '4px',
                                      fontSize: '0.72rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    💳 Pay Now
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="td-status">
                          <span
                            className="apt-status-pill"
                            style={{
                              backgroundColor: statusDisplay.backgroundColor,
                              color: statusDisplay.color,
                              borderColor: statusDisplay.color,
                            }}
                          >
                            {statusDisplay.label}
                          </span>
                        </td>
                        <td className="td-action">
                          <div className="apt-action-cell">
                            {canCancelByStatus ? (
                              isEligibleForCancellation(apt) ? (
                                <button
                                  type="button"
                                  className="btn-cancel-appointment"
                                  onClick={() => handleCancel(apt)}
                                  title="Cancel appointment at least 24 hours before its scheduled start"
                                >
                                  Cancel
                                </button>
                              ) : (
                                <span
                                  className="apt-action-muted"
                                  title="Appointments cannot be cancelled online within 24 hours of the session. Please contact the hospital directly."
                                >
                                  Locked
                                </span>
                              )
                            ) : (apt.status || '').toLowerCase() === 'cancelled' ||
                              (apt.status || '').toLowerCase() === 'rejected' ? (
                              <span className="apt-action-muted is-cancelled">—</span>
                            ) : (apt.status || '').toLowerCase() === 'completed' ? (
                              <span className="apt-action-muted is-done">Done</span>
                            ) : (
                              <span className="apt-action-muted">—</span>
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
      </div>
      </div>
    </div>
  );
}
