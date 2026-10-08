// Vaxora Authentication & Verification Service

const getApiBase = () => {
  const envUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    const trimmed = envUrl.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  return '/api';
};

const API_BASE = getApiBase();

/**
 * Helper to retrieve stored auth token
 */
export const getToken = () => localStorage.getItem('vaxora_token');

/**
 * Helper to retrieve stored refresh token
 */
export const getRefreshToken = () => localStorage.getItem('vaxora_refresh_token');

/**
 * Helper to retrieve stored user object
 */
export const getUser = () => {
  try {
    const raw = localStorage.getItem('vaxora_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * Save auth session
 */
export const setSession = (token, refreshToken, user) => {
  if (token) localStorage.setItem('vaxora_token', token);
  if (refreshToken) localStorage.setItem('vaxora_refresh_token', refreshToken);
  if (user) {
    localStorage.setItem('vaxora_user', JSON.stringify(user));
    emitAuthUserUpdated();
  }
};

function mergeAndSaveUser(updatedUser) {
  const next = { ...(getUser() || {}), ...updatedUser };
  localStorage.setItem('vaxora_user', JSON.stringify(next));
  emitAuthUserUpdated();
  return next;
}

function emitAuthUserUpdated() {
  window.dispatchEvent(new Event('vaxora-user-updated'));
}

/** Re-render listeners when localStorage user is updated (photo / getMe). */
export function subscribeAuthUser(onChange) {
  window.addEventListener('vaxora-user-updated', onChange);
  return () => window.removeEventListener('vaxora-user-updated', onChange);
}

/**
 * Clear auth session
 */
export const clearAuth = () => {
  localStorage.removeItem('vaxora_token');
  localStorage.removeItem('vaxora_refresh_token');
  localStorage.removeItem('vaxora_user');
  emitAuthUserUpdated();
};

/** Single in-flight refresh so concurrent 401s share one rotation. */
let refreshInFlight = null;

function parseErrorMessage(data) {
  let errorMessage = 'Request failed';
  if (typeof data === 'object' && data !== null) {
    if (data.message) {
      errorMessage = data.message;
    } else if (data.errors && typeof data.errors === 'object') {
      const fieldErrors = Object.values(data.errors).flat();
      if (fieldErrors.length > 0) {
        errorMessage = fieldErrors.join(' ');
      } else if (data.title) {
        errorMessage = data.title;
      }
    } else if (data.title) {
      errorMessage = data.title;
    }
  } else if (typeof data === 'string' && data) {
    try {
      const parsed = JSON.parse(data);
      if (parsed.message) errorMessage = parsed.message;
      else if (parsed.errors) errorMessage = Object.values(parsed.errors).flat().join(' ');
      else if (parsed.title) errorMessage = parsed.title;
      else errorMessage = data;
    } catch {
      errorMessage = data;
    }
  }
  return errorMessage;
}

async function fetchJson(endpoint, options = {}) {
  const {
    skipAuth = false,
    skipAuthRefresh = false,
    headers: optionHeaders,
    ...fetchOptions
  } = options;

  const headers = {
    ...(optionHeaders || {}),
  };

  if (!(fetchOptions.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (!skipAuth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.text();

  return { response, data };
}

async function refreshSessionOnce() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token available');

    const { response, data } = await fetchJson('/auth/refresh-token', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      skipAuth: true,
      skipAuthRefresh: true,
    });

    if (!response.ok) {
      clearAuth();
      throw new Error(parseErrorMessage(data));
    }

    if (data.token) {
      setSession(data.token, data.refreshToken, data.user);
    }
    return data;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/**
 * Generic API request wrapper with auth header, 401 refresh retry, and error handling.
 */
async function apiRequest(endpoint, options = {}) {
  const { skipAuthRefresh = false, ...requestOptions } = options;
  let { response, data } = await fetchJson(endpoint, requestOptions);

  if (
    response.status === 401 &&
    !skipAuthRefresh &&
    !endpoint.includes('/auth/login') &&
    !endpoint.includes('/auth/refresh-token') &&
    getRefreshToken()
  ) {
    try {
      await refreshSessionOnce();
      ({ response, data } = await fetchJson(endpoint, requestOptions));
    } catch {
      clearAuth();
      throw new Error(parseErrorMessage(data) || 'Session expired. Please sign in again.');
    }
  }

  if (!response.ok) {
    throw new Error(parseErrorMessage(data));
  }

  return data;
}

// Cross-tab logout: when another tab clears the session, leave protected pages here too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (
      (event.key === 'vaxora_token' || event.key === 'vaxora_refresh_token') &&
      event.newValue === null &&
      event.oldValue
    ) {
      emitAuthUserUpdated();
      const path = window.location.pathname || '';
      if (!path.startsWith('/login') && !path.startsWith('/signup')) {
        window.location.assign('/login');
      }
    }
  });
}

export const authService = {
  // 1. Login
  async login(email, password) {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (data.token) {
      setSession(data.token, data.refreshToken, data.user);
    }
    return data;
  },

  // 2. Patient Signup
  async signupPatient(payload) {
    const isFormData = payload instanceof FormData;
    const data = await apiRequest('/auth/signup/patient', {
      method: 'POST',
      body: isFormData ? payload : JSON.stringify(payload),
    });
    if (data.token) {
      setSession(data.token, data.refreshToken, data.user);
    }
    return data;
  },

  // 3. Doctor Signup (Multipart form-data)
  async signupDoctor(formData) {
    const data = await apiRequest('/auth/signup/doctor', {
      method: 'POST',
      body: formData,
    });
    if (data.token) {
      setSession(data.token, data.refreshToken, data.user);
    }
    return data;
  },

  // 4. Nurse Signup (Multipart form-data)
  async signupNurse(formData) {
    const data = await apiRequest('/auth/signup/nurse', {
      method: 'POST',
      body: formData,
    });
    if (data.token) {
      setSession(data.token, data.refreshToken, data.user);
    }
    return data;
  },

  // 5. Hospital Signup (Multipart form-data)
  async signupHospital(formData) {
    const data = await apiRequest('/auth/signup/hospital', {
      method: 'POST',
      body: formData,
    });
    if (data.token) {
      setSession(data.token, data.refreshToken, data.user);
    }
    return data;
  },

  // 6. Get Current User Profile
  async getMe() {
    const user = await apiRequest('/auth/me', {
      method: 'GET',
    });
    if (user) mergeAndSaveUser(user);
    return user;
  },

  // 6.1 Update Current User Profile
  async updateProfile(payload) {
    const updatedUser = await apiRequest('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (updatedUser) mergeAndSaveUser(updatedUser);
    return updatedUser;
  },

  // 6.2 Upload profile photo / hospital logo (multipart → R2)
  async updateProfilePhoto(file) {
    const formData = new FormData();
    formData.append('photo', file);
    const updatedUser = await apiRequest('/auth/profile/photo', {
      method: 'POST',
      body: formData,
    });
    if (updatedUser) mergeAndSaveUser(updatedUser);
    return updatedUser;
  },

  // 7. Refresh Token
  async refreshToken() {
    return refreshSessionOnce();
  },

  // 8. Logout — always clear local session; revoke server refresh even if access JWT expired
  async logout() {
    const refreshToken = getRefreshToken();
    try {
      await apiRequest('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        skipAuthRefresh: true,
      });
    } catch (err) {
      console.warn('Logout API error:', err);
    } finally {
      clearAuth();
    }
  },

  // 9. Forgot Password
  async forgotPassword(email) {
    return await apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  // 10. Reset Password
  async resetPassword(email, resetToken, newPassword, confirmPassword) {
    return await apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, resetToken, newPassword, confirmPassword }),
    });
  },

  // 11. Change Password
  async changePassword(currentPassword, newPassword) {
    return await apiRequest('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  // 12. Delete Account
  async deleteAccount() {
    const data = await apiRequest('/auth/account', {
      method: 'DELETE',
    });
    clearAuth();
    return data;
  },

  // ================= ADMIN VERIFICATION & DASHBOARD APIS =================
  async getAdminDashboardStats() {
    return await apiRequest('/admin/verification/dashboard-stats', {
      method: 'GET',
    });
  },

  async getPendingVerifications() {
    return await apiRequest('/admin/verification/pending', {
      method: 'GET',
    });
  },

  async decideVerification(userId, decision, reason = '') {
    return await apiRequest(`/admin/verification/decide/${userId}`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    });
  },

  async updateUserStatus(userId, status) {
    return await apiRequest(`/admin/verification/status/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  },

  async getAuditLogs(limit = 100) {
    return await apiRequest(`/admin/verification/audit-logs?limit=${limit}`, {
      method: 'GET',
    });
  },

  async getAllUsers(params = {}) {
    const query = new URLSearchParams(params).toString();
    return await apiRequest(`/admin/verification/users${query ? `?${query}` : ''}`, {
      method: 'GET',
    });
  },

  getUser() {
    return getUser();
  },

  getToken() {
    return getToken();
  },

  getRefreshToken() {
    return getRefreshToken();
  },

  setSession(token, refreshToken, user) {
    setSession(token, refreshToken, user);
  },

  clearAuth() {
    clearAuth();
  }
};

export default authService;
