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
      else if (data.errors) errorMessage = Object.values(data.errors).flat().join(' ');
      else if (data.title) errorMessage = data.title;
    } else if (typeof data === 'string' && data) {
      errorMessage = data;
    } else if (response.status === 401) {
      errorMessage = 'Session expired. Please log in again.';
    } else if (response.status === 403) {
      errorMessage = 'You do not have permission for this action.';
    }
    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
  }

  return data;
}

export const deskService = {
  // ---------- Hospital manager: front-desk accounts ----------
  getDeskAccounts() {
    return apiRequest('/desk/accounts');
  },

  createDeskAccount({ fullName, phoneNumber, email, password }) {
    return apiRequest('/desk/accounts', {
      method: 'POST',
      body: JSON.stringify({ fullName, phoneNumber: phoneNumber || null, email, password }),
    });
  },

  removeDeskAccount(affiliationId) {
    return apiRequest(`/desk/accounts/${affiliationId}`, { method: 'DELETE' });
  },

  // ---------- Front desk: own hospital ----------
  getMyHospital() {
    return apiRequest('/desk/me');
  },

  getFormulary() {
    return apiRequest('/desk/formulary');
  },
};

export default deskService;
