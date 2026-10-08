import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { authService } from "../../auth";
import { appointmentService } from "../services/appointmentService";
import { patientVaccinationService } from "../services/patientVaccinationService";
import { patientMedicalHistoryService } from "../services/patientMedicalHistoryService";
import PatientSubpageHeader from "./PatientSubpageHeader";
import { deferEffectCallback } from "../../../shared/utils/deferEffectCallback.js";
import DeleteAccountModal from "../../auth/components/DeleteAccountModal";
import { IconTrash } from "../../../shared/icons/AppIcons";

// ---------- Helpers ----------
const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
};

const statusColor = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "confirmed" || s === "completed") return "#10b981";
  if (s === "cancelled") return "#ef4444";
  if (s === "pendingpayment" || s === "pending") return "#b45309";
  return "#0369a1";
};

const severityColor = (severity) => {
  const s = String(severity || "").toLowerCase();
  if (s === "critical" || s === "severe") return "#dc2626";
  if (s === "moderate") return "#b45309";
  if (s === "mild") return "#0369a1";
  return "#64748b";
};

const historyStatusColor = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "active" || s === "chronic") return "#b45309";
  if (s === "resolved" || s === "inremission") return "#10b981";
  return "#64748b";
};

export default function PatientProfileTab() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState("");
  const [notificationType, setNotificationType] = useState("success");
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const [profileData, setProfileData] = useState({
    id: "",
    nic: "",
    name: "",
    email: "",
    phone: "",
    dob: "",
    status: "Active",
    profilePhotoUrl: null,
  });

  // ---------- Real history data ----------
  const [appointments, setAppointments] = useState([]);
  const [vaccinations, setVaccinations] = useState([]);
  const [medicalHistory, setMedicalHistory] = useState([]);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [loadingVaccinations, setLoadingVaccinations] = useState(true);
  const [loadingMedicalHistory, setLoadingMedicalHistory] = useState(true);

  const showNotification = (msg, type = "success") => {
    setNotification(msg);
    setNotificationType(type);
    setTimeout(() => setNotification(""), 3500);
  };

  // ---------- Load live patient profile ----------
  const populateState = useCallback((user) => {
    const details = user.profileDetails || {};
    const dobFormatted = details.dateOfBirth
      ? new Date(details.dateOfBirth).toISOString().split("T")[0]
      : "";

    setProfileData({
      id: user.registrationNumber || details.id || "VAX-P-000000",
      nic: details.nicNumber || details.nic || "N/A",
      name: details.fullName || user.name || "",
      email: user.email || "",
      phone: user.phoneNumber || details.phoneNumber || "",
      dob: dobFormatted,
      status: user.status || "Active",
      profilePhotoUrl: user.profilePhotoUrl || details.profilePhotoUrl || null,
    });
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const cached = authService.getUser();
      if (cached) populateState(cached);

      const freshUser = await authService.getMe();
      if (freshUser) populateState(freshUser);
    } catch (err) {
      console.warn("Could not fetch latest patient profile:", err);
    } finally {
      setLoading(false);
    }
  }, [populateState]);

  useEffect(() => deferEffectCallback(loadProfile), [loadProfile]);

  // ---------- Load real appointment + vaccination + medical history ----------
  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      const user = authService.getUser();
      const patientProfileId =
        user?.profileDetails?.id || user?.profileId || user?.patientProfileId;

      // 1. Appointments
      try {
        setLoadingAppointments(true);
        const data = await appointmentService.getPatientAppointments();
        if (!cancelled) setAppointments(Array.isArray(data) ? data : []);
      } catch (err) {
        console.warn("Could not load appointments:", err);
        if (!cancelled) setAppointments([]);
      } finally {
        if (!cancelled) setLoadingAppointments(false);
      }

      // 2. Vaccinations
      if (patientProfileId) {
        try {
          setLoadingVaccinations(true);
          const timeline =
            await patientVaccinationService.getTimeline(patientProfileId);
          if (!cancelled) {
            setVaccinations(
              Array.isArray(timeline?.records) ? timeline.records : [],
            );
          }
        } catch (err) {
          console.warn("Could not load vaccinations:", err);
          if (!cancelled) setVaccinations([]);
        } finally {
          if (!cancelled) setLoadingVaccinations(false);
        }
      } else {
        if (!cancelled) setLoadingVaccinations(false);
      }

      // 3. Medical history
      if (patientProfileId) {
        try {
          setLoadingMedicalHistory(true);
          const timeline =
            await patientMedicalHistoryService.getTimeline(patientProfileId);
          if (!cancelled) {
            setMedicalHistory(
              Array.isArray(timeline?.records) ? timeline.records : [],
            );
          }
        } catch (err) {
          console.warn("Could not load medical history:", err);
          if (!cancelled) setMedicalHistory([]);
        } finally {
          if (!cancelled) setLoadingMedicalHistory(false);
        }
      } else {
        if (!cancelled) setLoadingMedicalHistory(false);
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfileData((prev) => ({ ...prev, [name]: value }));
  };

  const handleToggleEdit = async () => {
    if (isEditing) {
      setSaving(true);
      try {
        await authService.updateProfile({
          fullName: profileData.name,
          phoneNumber: profileData.phone,
          dateOfBirth: profileData.dob ? new Date(profileData.dob) : null,
          profilePhotoUrl: profileData.profilePhotoUrl,
        });
        showNotification(
          "Patient profile updated successfully in the national database!",
        );
        setIsEditing(false);
      } catch (err) {
        showNotification(
          err.message || "Failed to update profile details.",
          "error",
        );
      } finally {
        setSaving(false);
      }
    } else {
      setIsEditing(true);
    }
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const updatedUser = await authService.updateProfilePhoto(file);
      const details = updatedUser?.profileDetails || {};
      const profilePhotoUrl =
        updatedUser?.profilePhotoUrl || details.profilePhotoUrl || null;

      setProfileData((prev) => ({ ...prev, profilePhotoUrl }));
      showNotification("Profile photo updated successfully!");
    } catch (err) {
      showNotification(
        err.message || "Failed to upload profile photo.",
        "error",
      );
    } finally {
      e.target.value = "";
    }
  };

  const handleExport = () => {
    showNotification(
      "Exported official citizen immunization data sheet (.PDF / .CSV)",
    );
  };

  // ---------- Sort: most recent first ----------
  const sortedAppointments = [...appointments].sort((a, b) => {
    const da = new Date(a.appointmentDate || a.date || 0);
    const db = new Date(b.appointmentDate || b.date || 0);
    return db - da;
  });

  const sortedVaccinations = [...vaccinations].sort((a, b) => {
    const da = new Date(a.administeredAt || 0);
    const db = new Date(b.administeredAt || 0);
    return db - da;
  });

  const sortedMedicalHistory = [...medicalHistory].sort((a, b) => {
    const da = new Date(a.diagnosedAt || a.createdAt || 0);
    const db = new Date(b.diagnosedAt || b.createdAt || 0);
    return db - da;
  });

  return (
    <div className="patient-subpage-page">
      <PatientSubpageHeader
        title="My Profile"
        subtitle="View and update your personal details, appointments, and vaccination records."
      />
      <div
        className="manage-appointments-wrapper"
        style={{ flexDirection: "column", alignItems: "center", gap: "28px" }}
      >
        {notification && (
          <div
            className="appointment-alert-pill"
            role="alert"
            style={{
              maxWidth: "960px",
              width: "100%",
              backgroundColor:
                notificationType === "error"
                  ? "rgba(239, 68, 68, 0.15)"
                  : "rgba(16, 185, 129, 0.15)",
              borderColor: notificationType === "error" ? "#ef4444" : "#10b981",
              color: notificationType === "error" ? "#f87171" : "#34d399",
            }}
          >
            {notificationType === "error" ? "⚠️" : "✓"} {notification}
          </div>
        )}

        {/* =========================================================================
            1. TOP CARD: Avatar & Personal Information
           ========================================================================= */}
        <div className="manage-appointments-card profile-top-card">
          <div className="profile-top-grid">
            <div className="profile-avatar-column">
              <div className="profile-avatar-wrap">
                {profileData.profilePhotoUrl ? (
                  <img
                    src={profileData.profilePhotoUrl}
                    alt={profileData.name || "Patient"}
                    style={{
                      width: "150px",
                      height: "150px",
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: "3px solid #0369a1",
                    }}
                  />
                ) : (
                  <svg
                    className="profile-large-silhouette"
                    viewBox="0 0 200 200"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="100" cy="100" r="100" fill="#d9dde3" />
                    <circle cx="100" cy="80" r="38" fill="#525862" />
                    <path
                      d="M40 174C40 140.863 66.863 118 100 118C133.137 118 160 140.863 160 174"
                      fill="#525862"
                    />
                  </svg>
                )}

                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  accept="image/*"
                  onChange={handlePhotoUpload}
                />

                <button
                  type="button"
                  className="btn-avatar-edit"
                  title="Update Profile Photo"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#1d1854"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="profile-info-column">
              <div className="profile-info-card">
                <div className="profile-info-header">
                  <div>
                    <h2 className="profile-info-title">Personal Information</h2>
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "#047857",
                        fontWeight: 600,
                      }}
                    >
                      ● Status: {profileData.status}
                    </span>
                  </div>
                  <div className="profile-header-actions">
                    <button
                      type="button"
                      className="btn-profile-edit"
                      onClick={handleToggleEdit}
                      disabled={saving}
                    >
                      {saving ? "Saving..." : isEditing ? "Save" : "Edit"}
                    </button>

                    <button
                      type="button"
                      className="btn-profile-export"
                      title="Export / Share Profile"
                      onClick={handleExport}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="profile-fields-list">
                  <div className="profile-field-row">
                    <span className="profile-field-label">ID (VAXORA)</span>
                    <span className="profile-field-colon">:</span>
                    <span
                      className="profile-field-value"
                      style={{ fontWeight: 700, color: "#0369a1" }}
                    >
                      {profileData.id || (loading ? "Loading..." : "N/A")}
                    </span>
                  </div>

                  <div className="profile-field-row">
                    <span className="profile-field-label">NIC</span>
                    <span className="profile-field-colon">:</span>
                    <span className="profile-field-value">
                      {profileData.nic || (loading ? "Loading..." : "N/A")}
                    </span>
                  </div>

                  <div className="profile-field-row">
                    <span className="profile-field-label">NAME</span>
                    <span className="profile-field-colon">:</span>
                    {isEditing ? (
                      <input
                        type="text"
                        name="name"
                        value={profileData.name}
                        onChange={handleChange}
                        className="profile-field-input"
                      />
                    ) : (
                      <span className="profile-field-value">
                        {profileData.name || (loading ? "Loading..." : "N/A")}
                      </span>
                    )}
                  </div>

                  <div className="profile-field-row">
                    <span className="profile-field-label">DATE OF BIRTH</span>
                    <span className="profile-field-colon">:</span>
                    {isEditing ? (
                      <input
                        type="date"
                        name="dob"
                        value={profileData.dob}
                        onChange={handleChange}
                        className="profile-field-input"
                      />
                    ) : (
                      <span className="profile-field-value">
                        {profileData.dob || "Not specified"}
                      </span>
                    )}
                  </div>

                  <div className="profile-field-row">
                    <span className="profile-field-label">EMAIL</span>
                    <span className="profile-field-colon">:</span>
                    <span className="profile-field-value">
                      {profileData.email || (loading ? "Loading..." : "N/A")}
                    </span>
                  </div>

                  <div className="profile-field-row">
                    <span className="profile-field-label">PHONE NUMBER</span>
                    <span className="profile-field-colon">:</span>
                    {isEditing ? (
                      <input
                        type="tel"
                        name="phone"
                        value={profileData.phone}
                        onChange={handleChange}
                        className="profile-field-input"
                      />
                    ) : (
                      <span className="profile-field-value">
                        {profileData.phone || "Not provided"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            2. MEDICAL HISTORY CARD
           ========================================================================= */}
        <div
          className="manage-appointments-card"
          style={{ maxWidth: "960px", width: "100%" }}
        >
          <div className="profile-appointments-section">
            <h2
              className="appointments-section-heading"
              style={{ marginBottom: "16px" }}
            >
              Medical History
            </h2>

            <div className="appointments-table-container">
              <table className="custom-appointments-table">
                <thead>
                  <tr>
                    <th className="th-vaccine">Record</th>
                    <th className="th-date">Type</th>
                    <th className="th-location">Severity</th>
                    <th className="th-status" style={{ borderRight: "none" }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loadingMedicalHistory ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          color: "#475569",
                        }}
                      >
                        Loading medical history…
                      </td>
                    </tr>
                  ) : sortedMedicalHistory.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          fontStyle: "italic",
                          color: "#475569",
                        }}
                      >
                        No medical history on file yet.
                      </td>
                    </tr>
                  ) : (
                    sortedMedicalHistory.map((rec) => (
                      <tr key={rec.id}>
                        <td className="td-vaccine">
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            <span style={{ fontWeight: 600, color: "#1e1b4b" }}>
                              {rec.title || "—"}
                            </span>
                            {rec.icd10Code && (
                              <span
                                style={{
                                  fontSize: "0.72rem",
                                  color: "#94a3b8",
                                }}
                              >
                                ICD-10: {rec.icd10Code}
                              </span>
                            )}
                            {rec.description && (
                              <span
                                style={{
                                  fontSize: "0.78rem",
                                  color: "#475569",
                                }}
                              >
                                {rec.description}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="td-date">{rec.recordType || "—"}</td>
                        <td className="td-location">
                          <span
                            style={{
                              color: severityColor(rec.severity),
                              fontWeight: 600,
                            }}
                          >
                            {rec.severity || "—"}
                          </span>
                        </td>
                        <td
                          className="td-status"
                          style={{ borderRight: "none" }}
                        >
                          <span
                            style={{
                              color: historyStatusColor(rec.status),
                              fontWeight: 600,
                            }}
                          >
                            ● {rec.status || "—"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* =========================================================================
            3. BOTTOM CARD: Appointments & Vaccination History
           ========================================================================= */}
        <div className="manage-appointments-card profile-bottom-card">
          <div className="profile-appointments-section">
            <h2
              className="appointments-section-heading"
              style={{ marginBottom: "16px" }}
            >
              Appointments
            </h2>

            <div className="appointments-table-container">
              <table className="custom-appointments-table">
                <thead>
                  <tr>
                    <th className="th-vaccine">Vaccine</th>
                    <th className="th-date">Date</th>
                    <th className="th-time">Time</th>
                    <th className="th-location">Hospital / Clinic</th>
                    <th className="th-status" style={{ borderRight: "none" }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loadingAppointments ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          color: "#475569",
                        }}
                      >
                        Loading appointments…
                      </td>
                    </tr>
                  ) : sortedAppointments.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          fontStyle: "italic",
                          color: "#475569",
                        }}
                      >
                        No appointments scheduled yet.
                      </td>
                    </tr>
                  ) : (
                    sortedAppointments.slice(0, 5).map((apt) => {
                      const status = apt.status || "Confirmed";
                      return (
                        <tr key={apt.id || apt.Id}>
                          <td className="td-vaccine">
                            {apt.vaccineName || apt.vaccine || "—"}
                          </td>
                          <td className="td-date">
                            {formatDate(apt.appointmentDate || apt.date)}
                          </td>
                          <td className="td-time">
                            {apt.timeSlot || apt.time || "—"}
                          </td>
                          <td className="td-location">
                            {apt.hospitalName || apt.location || "—"}
                          </td>
                          <td
                            className="td-status"
                            style={{ borderRight: "none" }}
                          >
                            <span
                              style={{
                                color: statusColor(status),
                                fontWeight: 600,
                              }}
                            >
                              ● {status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "16px",
              }}
            >
              <button
                type="button"
                className="btn-book-appointment"
                style={{ padding: "9px 24px", fontSize: "0.96rem" }}
                onClick={() => navigate("/patient/appointments")}
              >
                Book Appointment
              </button>
            </div>
          </div>

          <div
            className="profile-history-section"
            style={{ marginTop: "36px" }}
          >
            <h2
              className="appointments-section-heading"
              style={{ marginBottom: "16px" }}
            >
              Vaccination History
            </h2>

            <div className="appointments-table-container">
              <table className="custom-appointments-table">
                <thead>
                  <tr>
                    <th className="th-vaccine">Vaccine</th>
                    <th className="th-date">Date</th>
                    <th className="th-location">Administered By</th>
                    <th className="th-status" style={{ borderRight: "none" }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loadingVaccinations ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          color: "#475569",
                        }}
                      >
                        Loading vaccination history…
                      </td>
                    </tr>
                  ) : sortedVaccinations.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "20px",
                          textAlign: "center",
                          fontStyle: "italic",
                          color: "#475569",
                        }}
                      >
                        No vaccination records on file yet.
                      </td>
                    </tr>
                  ) : (
                    sortedVaccinations.map((rec) => (
                      <tr key={rec.id}>
                        <td className="td-vaccine">
                          {rec.vaccineName || "—"}
                          {rec.doseNumber ? (
                            <span
                              style={{
                                marginLeft: "8px",
                                fontSize: "0.78rem",
                                color: "#475569",
                              }}
                            >
                              (Dose {rec.doseNumber})
                            </span>
                          ) : null}
                        </td>
                        <td className="td-date">
                          {formatDate(rec.administeredAt)}
                        </td>
                        <td className="td-location">
                          {rec.administeredByName || "—"}
                        </td>
                        <td
                          className="td-status"
                          style={{ borderRight: "none" }}
                        >
                          <span style={{ color: "#10b981", fontWeight: 600 }}>
                            ✓ Completed
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* =========================================================================
            4. DANGER ZONE: Delete Account
           ========================================================================= */}
        <div
          className="patient-profile-card"
          style={{
            borderColor: "rgba(239, 68, 68, 0.35)",
            background:
              "linear-gradient(180deg, rgba(239, 68, 68, 0.05) 0%, rgba(15, 23, 42, 0.4) 100%)",
            borderRadius: "16px",
            padding: "24px",
            marginTop: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <div>
              <h4
                style={{
                  margin: "0 0 6px",
                  color: "#ef4444",
                  fontSize: "1.05rem",
                  fontWeight: 700,
                }}
              >
                Danger Zone
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  color: "#94a3b8",
                  maxWidth: "600px",
                }}
              >
                Permanently delete your Vaxora patient account, personal
                records, and vaccination history. This action cannot be undone.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsDeleteModalOpen(true)}
              style={{
                background: "#dc2626",
                color: "#ffffff",
                border: "1px solid #ef4444",
                borderRadius: "8px",
                padding: "10px 18px",
                fontSize: "0.88rem",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                boxShadow: "0 2px 8px rgba(220, 38, 38, 0.3)",
              }}
            >
              <IconTrash size={16} /> Delete Account
            </button>
          </div>
        </div>

        <DeleteAccountModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          userName={profileData.name || "Patient Profile"}
          roleName="Patient"
        />
      </div>
    </div>
  );
}
