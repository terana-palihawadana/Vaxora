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

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query.set(key, value);
    }
  });
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export const staffAppointmentService = {
  getMyAffiliations() {
    return apiRequest('/staff/my-affiliations');
  },

  getPatientContact(appointmentId) {
    return apiRequest(`/appointments/${appointmentId}/staff-contact`);
  },

  getHospitalAppointments(hospitalUserId, date) {
    return apiRequest(
      `/appointments/staff${buildQuery({
        hospitalUserId,
        date: date || undefined,
      })}`
    );
  },

  checkIn(id) {
    return apiRequest(`/appointments/${id}/check-in`, { method: 'POST' });
  },

  updateAppointmentStatus(id, status, remarks, administration) {
    return apiRequest(`/appointments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        ...(remarks ? { remarks } : {}),
        ...(administration?.batchId ? { batchId: administration.batchId } : {}),
        ...(administration?.lotNumber ? { lotNumber: administration.lotNumber } : {}),
        ...(administration?.injectionSite ? { injectionSite: administration.injectionSite } : {}),
        ...(administration?.route ? { route: administration.route } : {}),
        ...(administration?.administrationNotes
          ? { administrationNotes: administration.administrationNotes }
          : {}),
        ...(administration?.doseConfirmed != null
          ? { doseConfirmed: administration.doseConfirmed }
          : {}),
        ...(administration?.consentConfirmed != null
          ? { consentConfirmed: administration.consentConfirmed }
          : {}),
        ...(administration?.vitalsConfirmed != null
          ? { vitalsConfirmed: administration.vitalsConfirmed }
          : {}),
      }),
    });
  },

  reportAefi(appointmentId, payload) {
    const followUpDate = payload.followUpAt
      ? new Date(`${payload.followUpAt}T09:00:00.000Z`).toISOString()
      : undefined;
    return apiRequest(`/appointments/${appointmentId}/aefi`, {
      method: 'POST',
      body: JSON.stringify({
        severity: payload.severity || 'Mild',
        description: payload.reactionType || payload.description || '',
        treatmentGiven: payload.treatmentGiven || '',
        followUpAt: followUpDate,
        followUpPlan: payload.followUpPlan || '',
        notifyDoctor: payload.notifyDoctor !== false,
        notifyMOH: false,
      }),
    });
  },
};

export default staffAppointmentService;
