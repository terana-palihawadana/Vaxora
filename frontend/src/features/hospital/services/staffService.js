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
    if (response.status === 401) {
      errorMessage = 'Session expired. Please log in again.';
    } else if (response.status === 403) {
      errorMessage = 'You do not have permission for this action.';
    } else if (typeof data === 'object' && data !== null) {
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

export const staffService = {
  inviteStaff(registrationNumber) {
    return apiRequest('/staff/invite', {
      method: 'POST',
      body: JSON.stringify({ registrationNumber }),
    });
  },

  searchCandidates(query, limit = 10) {
    return apiRequest(`/staff/candidates${buildQuery({ q: query, limit })}`);
  },

  getHospitalStaff({ role, dutyStatus, search, status } = {}) {
    return apiRequest(`/staff/hospital${buildQuery({ role, dutyStatus, search, status })}`);
  },

  removeAffiliation(affiliationId) {
    return apiRequest(`/staff/affiliations/${affiliationId}`, {
      method: 'DELETE',
    });
  },

  updateDutyStatus(affiliationId, dutyStatus) {
    return apiRequest(`/staff/affiliations/${affiliationId}/duty`, {
      method: 'PUT',
      body: JSON.stringify({ dutyStatus }),
    });
  },

  getMyInvitations() {
    return apiRequest('/staff/invitations');
  },

  respondToInvitation(affiliationId, decision) {
    return apiRequest(`/staff/invitations/${affiliationId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
  },

  getMyAffiliations() {
    return apiRequest('/staff/my-affiliations');
  },

  getHospitalShifts({ from, to } = {}) {
    return apiRequest(`/staff/shifts/hospital${buildQuery({ from, to })}`);
  },

  getHospitalBooths({ activeOnly } = {}) {
    return apiRequest(`/staff/booths${buildQuery({ activeOnly })}`);
  },

  createHospitalBooth(payload) {
    return apiRequest('/staff/booths', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateHospitalBooth(boothId, payload) {
    return apiRequest(`/staff/booths/${boothId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deactivateHospitalBooth(boothId) {
    return apiRequest(`/staff/booths/${boothId}`, {
      method: 'DELETE',
    });
  },

  getCoverage({ from, to }) {
    return apiRequest(`/staff/coverage${buildQuery({ from, to })}`);
  },

  createShift(payload) {
    return apiRequest('/staff/shifts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateShift(shiftId, payload) {
    return apiRequest(`/staff/shifts/${shiftId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteShift(shiftId) {
    return apiRequest(`/staff/shifts/${shiftId}`, {
      method: 'DELETE',
    });
  },

  suggestWeek({ from, to, defaultStart, defaultEnd }) {
    return apiRequest('/staff/shifts/suggest-week', {
      method: 'POST',
      body: JSON.stringify({ from, to, defaultStart, defaultEnd }),
    });
  },

  getMyShifts({ from, to } = {}) {
    return apiRequest(`/staff/shifts/mine${buildQuery({ from, to })}`);
  },

  getMyShiftSwaps(limit = 40) {
    return apiRequest(`/staff/shift-swaps/mine${buildQuery({ limit })}`);
  },

  getCoverQuota(shiftId) {
    return apiRequest(`/staff/shift-swaps/quota${buildQuery({ shiftId: shiftId || undefined })}`);
  },

  requestShiftCover({ shiftId, reason } = {}) {
    return apiRequest('/staff/shift-swaps', {
      method: 'POST',
      body: JSON.stringify({
        shiftId,
        ...(reason ? { reason } : {}),
      }),
    });
  },

  getHospitalShiftSwaps({ status, limit = 40 } = {}) {
    return apiRequest(`/staff/shift-swaps/hospital${buildQuery({ status, limit })}`);
  },

  rankShiftSwap(requestId) {
    return apiRequest(`/staff/shift-swaps/${requestId}/rank`, { method: 'POST' });
  },

  decideShiftSwap(requestId, { approved, note, replacementAffiliationId } = {}) {
    return apiRequest(`/staff/shift-swaps/${requestId}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        approved,
        note: note || null,
        replacementAffiliationId: replacementAffiliationId || null,
      }),
    });
  },
};

export default staffService;
