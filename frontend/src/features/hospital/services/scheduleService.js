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

export const scheduleService = {
  createSchedule(payload) {
    return apiRequest('/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getHospitalSchedules() {
    return apiRequest('/schedule/hospital', {
      method: 'GET',
    });
  },

  cancelSchedule(scheduleId) {
    return apiRequest(`/schedule/${scheduleId}`, {
      method: 'DELETE',
    });
  },

  getAvailableSchedules(params = {}) {
    const query = new URLSearchParams();
    if (params.hospitalUserId) query.set('hospitalUserId', params.hospitalUserId);
    if (params.vaccineName) query.set('vaccineName', params.vaccineName);
    const qs = query.toString();
    return apiRequest(`/schedule/available${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  },

  getStockHorizon(payload) {
    return apiRequest('/schedule/stock-horizon', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export default scheduleService;
