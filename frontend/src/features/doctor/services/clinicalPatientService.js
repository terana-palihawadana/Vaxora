import { getToken } from "../../auth/services/authService";

const getApiBase = () => {
  const envUrl =
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.trim()) {
    const trimmed = envUrl.trim().replace(/\/+$/, "");
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  }
  return "/api";
};

const API_BASE = getApiBase();

async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type");
  const isJson = contentType && contentType.includes("application/json");
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    let errorMessage = "Request failed";
    if (typeof data === "object" && data !== null) {
      if (data.message) errorMessage = data.message;
      else if (data.title) errorMessage = data.title;
    } else if (typeof data === "string" && data) {
      errorMessage = data;
    }
    throw new Error(errorMessage);
  }

  return data;
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, value);
    }
  });
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

export const clinicalPatientService = {
  searchPatients(q, limit = 10) {
    return apiRequest(`/clinical/patients/search${buildQuery({ q, limit })}`);
  },

  getPatientByVaxoraId(vaxoraId) {
    return apiRequest(`/clinical/patients/${encodeURIComponent(vaxoraId)}`);
  },

  getRecentUpdates(limit = 10) {
    return apiRequest(`/clinical/patients/recent${buildQuery({ limit })}`);
  },

  getMedicalTimeline(patientProfileId) {
    return apiRequest(`/patient-medical-history/patients/${encodeURIComponent(patientProfileId)}/timeline`);
  },

  getVaccinationTimeline(patientProfileId) {
    return apiRequest(`/patient-vaccinations/patients/${encodeURIComponent(patientProfileId)}/timeline`);
  },

  updateDosage(appointmentId, dosage) {
    return apiRequest(`/clinical/appointments/${appointmentId}/dosage`, {
      method: "PUT",
      body: JSON.stringify({ dosage }),
    });
  },

  // ============================================================
  // Clinical data entry — medical history & visits
  // ============================================================

  createMedicalHistory(patientProfileId, data) {
    return apiRequest(
      `/patient-medical-history/patients/${encodeURIComponent(patientProfileId)}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  },

  createVisit(patientProfileId, data) {
    return apiRequest(
      `/patient-visits/patients/${encodeURIComponent(patientProfileId)}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  },

  // ============================================================
  // Read-only: patient's medical history timeline
  // ============================================================

  getMedicalHistory(patientProfileId) {
    return apiRequest(
      `/patient-medical-history/patients/${encodeURIComponent(patientProfileId)}/timeline`,
    );
  },
};

export default clinicalPatientService;
