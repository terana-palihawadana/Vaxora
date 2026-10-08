import { getToken } from '../../auth/services/authService';

const getApiBase = () => {
  const envUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    const trimmed = envUrl.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  return '/api';
};

const API_BASE = getApiBase();

async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    let errorMessage = 'Request failed';
    if (typeof data === 'object' && data !== null) {
      if (data.message) errorMessage = data.message;
      else if (data.title) errorMessage = data.title;
    } else if (typeof data === 'string' && data) {
      errorMessage = data;
    }
    throw new Error(errorMessage);
  }

  return data;
}

export const appointmentService = {
  getVaccinesWithHospitals() {
    return apiRequest('/inventory/vaccines-with-hospitals', {
      method: 'GET',
    });
  },

  // 1. Get available dates for a hospital & vaccine based on hospital schedules
  getAvailableDates(hospitalUserId, vaccineName) {
    const query = new URLSearchParams({
      hospitalUserId,
      vaccineName,
    });
    return apiRequest(`/appointments/available-dates?${query.toString()}`, {
      method: 'GET',
    });
  },

  // 2. Get available 20-min slots for a hospital, vaccine & date
  getAvailableSlots(hospitalUserId, vaccineName, date) {
    const query = new URLSearchParams({
      hospitalUserId,
      vaccineName,
      date,
    });
    return apiRequest(`/appointments/available-slots?${query.toString()}`, {
      method: 'GET',
    });
  },

  // 3. Book a new appointment slot
  bookAppointment(payload) {
    return apiRequest('/appointments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // 4. Get appointments booked by current patient (with cache busting)
  getPatientAppointments() {
    return apiRequest(`/appointments/patient?_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
  },

  // 5. Get appointments for hospital (cache-bust so refresh shows latest statuses)
  getHospitalAppointments(params = {}) {
    const query = new URLSearchParams();
    if (params.date) query.set('date', params.date);
    if (params.status) query.set('status', params.status);
    query.set('_t', String(Date.now()));
    const qs = query.toString();
    return apiRequest(`/appointments/hospital?${qs}`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
  },

  // 5b. Hospital walk-in registration (links by NIC or auto-creates patient account)
  createWalkIn(payload) {
    return apiRequest('/appointments/hospital/walk-in', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // 5c. Mark a patient as arrived (hospital desk or affiliated staff), today only
  checkIn(id) {
    return apiRequest(`/appointments/${id}/check-in`, { method: 'POST' });
  },

  // 6. Update appointment status (Hospital action)
  updateAppointmentStatus(id, statusPayload) {
    return apiRequest(`/appointments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(statusPayload),
    });
  },

  // 7. Cancel appointment
  cancelAppointment(id) {
    return apiRequest(`/appointments/${id}/cancel`, {
      method: 'DELETE',
    });
  },

  // 8. Initialize PayHere payment parameters
  initPayHere(appointmentId) {
    return apiRequest('/payment/payhere-init', {
      method: 'POST',
      body: JSON.stringify({ appointmentId }),
    });
  },

  // 9. Sync PayHere payment status (IPN is authoritative; client cannot forge Paid)
  confirmPayment(appointmentId, paymentProof = {}) {
    return apiRequest('/payment/confirm', {
      method: 'POST',
      body: JSON.stringify({
        appointmentId,
        ...(paymentProof && typeof paymentProof === 'object' ? paymentProof : {}),
      }),
    });
  },
};

export default appointmentService;
