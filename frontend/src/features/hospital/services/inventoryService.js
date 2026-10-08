// Vaxora Hospital Inventory Service

const getApiBase = () => {
  const envUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    const trimmed = envUrl.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  return '/api';
};

const API_BASE = getApiBase();

const getToken = () => localStorage.getItem('vaxora_token');

async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

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
    }
    throw new Error(errorMessage);
  }

  return data;
}

export const inventoryService = {
  // ---------- VACCINES (GLOBAL MASTER) ----------
  async getGlobalVaccines() {
    return await apiRequest('/inventory/vaccines', { method: 'GET' });
  },

  // ---------- FORMULARY (HOSPITAL'S REGISTERED LIST) ----------
  async getFormulary() {
    return await apiRequest('/inventory/formulary', { method: 'GET' });
  },

  async registerFormulary(vaccineName, manufacturer = '', price = 0, category = 'routine') {
    return await apiRequest('/inventory/formulary', {
      method: 'POST',
      body: JSON.stringify({
        vaccineName,
        manufacturer,
        price: Number(price) || 0,
        category: category || 'routine',
      }),
    });
  },

  async updateFormularyPrice(formularyId, price, category) {
    const body = { price: Number(price) || 0 };
    if (category) body.category = category;
    return await apiRequest(`/inventory/formulary/${formularyId}/price`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async removeFormulary(formularyId) {
    return await apiRequest(`/inventory/formulary/${formularyId}`, {
      method: 'DELETE',
    });
  },

  // ---------- BATCHES (INVENTORY STOCK) ----------
  async getInventory(hospitalUserId) {
    const qs = hospitalUserId
      ? `?hospitalUserId=${encodeURIComponent(hospitalUserId)}`
      : '';
    return await apiRequest(`/inventory/batches${qs}`, { method: 'GET' });
  },

  async restockBatch({ vaccineName, lotNumber, quantity, storageUnit, expiryDate, supplier, category }) {
    return await apiRequest('/inventory/batches', {
      method: 'POST',
      body: JSON.stringify({
        vaccineName,
        lotNumber,
        quantity: Number(quantity),
        storageUnit,
        expiryDate,
        supplier,
        ...(category ? { category } : {}),
      }),
    });
  },

  async logWastage(batchId, { quantity, reason, reportedBy, notes, incidentDate }) {
    return await apiRequest(`/inventory/batches/${batchId}/wastage`, {
      method: 'POST',
      body: JSON.stringify({
        quantity: Number(quantity),
        reason,
        reportedBy,
        notes,
        incidentDate,
      }),
    });
  },

  async adjustStock(batchId, delta, reason = '') {
    return await apiRequest(`/inventory/batches/${batchId}/adjust`, {
      method: 'PUT',
      body: JSON.stringify({ delta: Number(delta), reason }),
    });
  },

  async issueStock(batchId, quantity, sessionReference) {
    return await apiRequest(`/inventory/batches/${batchId}/issue`, {
      method: 'POST',
      body: JSON.stringify({ quantity: Number(quantity), sessionReference }),
    });
  },

  async getBatchAudit(batchId) {
    return await apiRequest(`/inventory/batches/${batchId}/audit`, { method: 'GET' });
  },

  // ---------- COLD VAULTS ----------
  async getColdVaults() {
    return await apiRequest('/inventory/vaults', { method: 'GET' });
  },

  // ---------- SUMMARY ----------
  async getSummary() {
    return await apiRequest('/inventory/summary', { method: 'GET' });
  },
};

export default inventoryService;