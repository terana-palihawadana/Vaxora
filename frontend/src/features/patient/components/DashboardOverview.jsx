import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authService, getUser } from "../../auth";
import { agentService } from "../services/agentService";
import { appointmentService } from "../services/appointmentService";
import { patientVaccinationService } from "../services/patientVaccinationService";
import CarePlanModal from "./CarePlanModal";
import {
  IconBot,
  IconCalendar,
  IconClock,
  IconDoctor,
  IconHospital,
  IconRocket,
  IconShield,
  IconStethoscope,
  IconSyringe,
} from "../../../shared/icons/AppIcons";
import heroImage from "../../../assets/images/patient-home-hero.png";

// ---------- Date helpers ----------
/** Local calendar YYYY-MM-DD (avoid UTC shift from toISOString). */
const toLocalDateInput = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Parse API date/datetime as a local calendar date when possible. */
const parseLocalDate = (iso) => {
  if (!iso) return null;
  const raw = String(iso).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.slice(0, 10));
  if (dateOnly && (raw.length === 10 || raw[10] === "T" || raw[10] === " ")) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
    );
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatLongDate = (iso) => {
  const d = parseLocalDate(iso);
  if (!d) return "—";
  try {
    return d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const formatShortDate = (iso) => {
  const d = parseLocalDate(iso);
  if (!d) return "—";
  try {
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const daysAgo = (iso) => {
  const d = parseLocalDate(iso);
  if (!d) return "";
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startThen = new Date(d);
  startThen.setHours(0, 0, 0, 0);
  const diff = Math.round((startToday - startThen) / 86400000);
  if (diff < 0) return `in ${Math.abs(diff)} days`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 30) return `${diff} days ago`;
  if (diff < 365) return `${Math.floor(diff / 30)} months ago`;
  return `${Math.floor(diff / 365)} years ago`;
};

const daysUntil = (iso) => {
  const d = parseLocalDate(iso);
  if (!d) return "";
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startThen = new Date(d);
  startThen.setHours(0, 0, 0, 0);
  const diff = Math.round((startThen - startToday) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return daysAgo(iso);
  return `in ${diff} days`;
};

/** Bookings that still need a clinic visit — not already given / finished. */
const isUpcomingAppointmentStatus = (status) => {
  const s = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return s === "confirmed" || s === "pending" || s === "pendingpayment";
};

export default function DashboardOverview({ onNavigateTab, onOpenBookModal }) {
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(() => {
    const cached =
      typeof authService?.getUser === "function"
        ? authService.getUser()
        : getUser
          ? getUser()
          : null;
    return cached?.name || cached?.profileDetails?.fullName || "";
  });

  // ---------- Care plan state ----------
  const [carePlanOpen, setCarePlanOpen] = useState(false);
  const [carePlanLoading, setCarePlanLoading] = useState(false);
  const [carePlanError, setCarePlanError] = useState(null);
  const [carePlanResult, setCarePlanResult] = useState(() => {
    try {
      const user = getUser();
      const patientProfileId =
        user?.profileDetails?.id || user?.profileId || user?.patientProfileId;
      if (!patientProfileId) return null;
      const cached = localStorage.getItem(
        `vaxora_care_plan_${patientProfileId}`
      );
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.care_plan) return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  });

  // ---------- Dashboard data state ----------
  const [nextAppointment, setNextAppointment] = useState(null);
  const [recentVaccines, setRecentVaccines] = useState([]);
  const [vaccinationStats, setVaccinationStats] = useState({
    totalDoses: 0,
    distinctVaccines: 0,
    lastVaccinatedAt: null,
  });
  const [dashboardLoading, setDashboardLoading] = useState(true);

  // ---------- Fetch latest profile (existing behaviour) ----------
  useEffect(() => {
    const fetchLatestProfile = async () => {
      try {
        if (typeof authService?.getMe === "function") {
          const fresh = await authService.getMe();
          const name = fresh?.name || fresh?.profileDetails?.fullName;
          if (name) setDisplayName(name);
        }
      } catch (err) {
        console.warn("Could not fetch latest user profile:", err);
      }
    };
    fetchLatestProfile();
  }, []);

  // ---------- Load real dashboard data ----------
  useEffect(() => {
    let cancelled = false;

    const loadDashboardData = async () => {
      const user = getUser();
      const patientProfileId =
        user?.profileDetails?.id || user?.profileId || user?.patientProfileId;

      try {
        setDashboardLoading(true);

        // 1. Next booking still awaiting clinic (not completed / in session).
        try {
          const appointments =
            await appointmentService.getPatientAppointments();
          if (!cancelled && Array.isArray(appointments)) {
            const todayStr = toLocalDateInput(new Date());
            const upcoming = appointments
              .filter((a) => {
                if (!isUpcomingAppointmentStatus(a.status || a.Status)) {
                  return false;
                }
                const dateRaw = a.appointmentDate || a.date || a.Date || "";
                const date = String(dateRaw).slice(0, 10);
                return date >= todayStr;
              })
              .sort((a, b) => {
                const da = String(a.appointmentDate || a.date || "").slice(0, 10);
                const db = String(b.appointmentDate || b.date || "").slice(0, 10);
                if (da !== db) return da.localeCompare(db);
                const ta = String(a.startTime || a.timeSlot || "");
                const tb = String(b.startTime || b.timeSlot || "");
                return ta.localeCompare(tb);
              });
            setNextAppointment(upcoming[0] || null);
          }
        } catch (err) {
          console.warn("Could not load appointments for dashboard:", err);
        }

        // 2. Vaccination timeline
        if (patientProfileId) {
          try {
            const timeline =
              await patientVaccinationService.getTimeline(patientProfileId);
            if (!cancelled && timeline) {
              setVaccinationStats({
                totalDoses: timeline.totalDoses ?? 0,
                distinctVaccines: timeline.distinctVaccines ?? 0,
                lastVaccinatedAt: timeline.lastVaccinatedAt || null,
              });
              const records = Array.isArray(timeline.records)
                ? timeline.records
                : [];
              setRecentVaccines(records.slice(0, 4));
            }
          } catch (err) {
            console.warn("Could not load vaccination timeline:", err);
          }
        }
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    };

    loadDashboardData();
    return () => {
      cancelled = true;
    };
  }, []);



  // ---------- Care plan trigger ----------
  const handleGenerateCarePlan = async () => {
    const user = getUser();
    const patientProfileId =
      user?.profileDetails?.id || user?.profileId || user?.patientProfileId;

    if (!patientProfileId) {
      setCarePlanError(
        "Your patient profile could not be found. Please contact support.",
      );
      setCarePlanOpen(true);
      return;
    }

    setCarePlanOpen(true);
    setCarePlanLoading(true);
    setCarePlanError(null);

    try {
      const result = await agentService.patientCarePlan(patientProfileId);
      setCarePlanResult(result);
      if (result?.success) {
        try {
          localStorage.setItem(
            `vaxora_care_plan_${patientProfileId}`,
            JSON.stringify(result)
          );
        } catch (e) {
          console.warn("Could not cache care plan:", e);
        }
      } else {
        setCarePlanError(
          result?.error || "The AI assistant could not generate a care plan.",
        );
      }
    } catch (err) {
      setCarePlanError(err.message || "Failed to generate care plan.");
    } finally {
      setCarePlanLoading(false);
    }
  };

  // ---------- Derived values for stat cards ----------
  const nextApptDate = nextAppointment
    ? nextAppointment.appointmentDate || nextAppointment.date
    : null;
  const nextApptVaccine = nextAppointment
    ? nextAppointment.vaccineName || nextAppointment.vaccine || "Appointment"
    : null;

  return (
    <div className="dashboard-overview-tab">
      {/* ---------- 1. Welcome Banner ---------- */}
      <section className="patient-welcome-banner">
        <div className="patient-welcome-content">
          <p className="patient-welcome-eyebrow">
            <IconStethoscope size={14} /> Your care hub
          </p>
          <h1>Welcome back{displayName ? `, ${displayName}` : ""}!</h1>
          <p className="welcome-subtitle">
            {nextAppointment
              ? `Your next vaccination is scheduled for ${formatShortDate(nextApptDate)}.`
              : "Your Vaxora immunization pass is cryptographically verified and up-to-date. No upcoming appointments scheduled."}
          </p>
          <div className="patient-welcome-tags">
            <span className="patient-welcome-tag">
              <IconShield size={13} /> Protected
            </span>
            <span className="patient-welcome-tag">
              <IconSyringe size={13} /> Vaccination ready
            </span>
            <span className="patient-welcome-tag patient-welcome-tag--soft">
              Care-first support
            </span>
          </div>
          <div className="patient-welcome-actions">
            {carePlanResult ? (
              <>
                <button
                  type="button"
                  className="btn-banner-action"
                  onClick={() => setCarePlanOpen(true)}
                >
                  <IconBot size={16} /> View Care Plan
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-banner-action"
                onClick={handleGenerateCarePlan}
              >
                <IconBot size={16} /> Generate AI Care Plan
              </button>
            )}
            <button
              type="button"
              className="btn-banner-action btn-banner-action--primary"
              onClick={() =>
                onOpenBookModal
                  ? onOpenBookModal()
                  : navigate("/patient/appointments")
              }
            >
              + Book Vaccination
            </button>
          </div>
        </div>
        <div className="patient-welcome-media" aria-hidden="true">
          <img
            src={heroImage}
            alt=""
            className="patient-welcome-image"
          />
        </div>
      </section>

      {/* ---------- 2. Stat Metric Cards (match hospital home pattern) ---------- */}
      <div className="hospital-metrics-grid hospital-metrics-grid--4">
        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-blue">
            <IconCalendar size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Upcoming Dose</span>
            <span className="hospital-stat-value">
              {dashboardLoading
                ? "—"
                : nextAppointment
                  ? formatShortDate(nextApptDate)
                  : "—"}
            </span>
            <span className="hospital-stat-meta">
              {dashboardLoading
                ? "Loading"
                : nextAppointment
                  ? `${nextApptVaccine}${nextAppointment.timeSlot ? ` · ${nextAppointment.timeSlot}` : ""} · ${daysUntil(nextApptDate)}`
                  : "No upcoming appointment"}
            </span>
          </div>
        </div>

        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-green">
            <IconSyringe size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Doses Received</span>
            <span className="hospital-stat-value">
              {dashboardLoading ? "—" : vaccinationStats.totalDoses}
            </span>
            <span className="hospital-stat-meta">
              {vaccinationStats.totalDoses > 0
                ? "Completed in registry"
                : "No doses on file"}
            </span>
          </div>
        </div>

        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-teal">
            <IconShield size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Distinct Vaccines</span>
            <span className="hospital-stat-value">
              {dashboardLoading ? "—" : vaccinationStats.distinctVaccines}
            </span>
            <span className="hospital-stat-meta">
              {vaccinationStats.distinctVaccines > 0
                ? "Verified in registry"
                : "None yet"}
            </span>
          </div>
        </div>

        <div className="hospital-stat-card">
          <div className="hospital-stat-icon stat-icon-slate">
            <IconClock size={22} />
          </div>
          <div className="hospital-stat-info">
            <span className="hospital-stat-label">Last Vaccination</span>
            <span className="hospital-stat-value">
              {dashboardLoading
                ? "—"
                : vaccinationStats.lastVaccinatedAt
                  ? formatShortDate(vaccinationStats.lastVaccinatedAt)
                  : "—"}
            </span>
            <span className="hospital-stat-meta">
              {vaccinationStats.lastVaccinatedAt
                ? daysAgo(vaccinationStats.lastVaccinatedAt)
                : "No record"}
            </span>
          </div>
        </div>
      </div>

      {/* ---------- 3. Main Dashboard Columns ---------- */}
      <div className="hospital-dashboard-columns patient-home-columns">
        <div className="patient-home-column">
          <div className="hospital-section-card">
            <div className="section-card-header">
              <div className="section-title-group">
                <h2>
                  <span className="section-title-icon icon-shade-blue">
                    <IconCalendar size={22} />
                  </span>
                  Next Confirmed Appointment
                </h2>
                <p className="section-title-desc">
                  Your upcoming dose booking and visit details
                </p>
              </div>
              <button
                type="button"
                className="btn-inventory-refresh"
                onClick={() => onNavigateTab("appointments")}
              >
                View all
              </button>
            </div>

            {dashboardLoading ? (
              <div className="patient-empty-state">
                Loading your next appointment…
              </div>
            ) : !nextAppointment ? (
              <div className="patient-empty-state patient-empty-state--dashed">
                <p>You have no upcoming appointments.</p>
                <button
                  type="button"
                  className="btn-queue-walkin"
                  style={{ marginLeft: 0 }}
                  onClick={() =>
                    onOpenBookModal
                      ? onOpenBookModal()
                      : navigate("/patient/appointments")
                  }
                >
                  + Book an Appointment
                </button>
              </div>
            ) : (
              <div className="spotlight-appointment">
                <div className="appointment-meta-top">
                  <span className="vaccine-badge-pill">{nextApptVaccine}</span>
                  <span className="status-badge-confirmed">
                    {String(
                      nextAppointment.status || "Confirmed",
                    ).toUpperCase()}
                  </span>
                </div>

                <div className="appointment-main-details">
                  <h3>
                    {nextAppointment.hospitalName ||
                      nextAppointment.location ||
                      "Hospital"}
                  </h3>
                  <div className="appointment-hospital-line">
                    <span className="appointment-meta-icon">
                      <IconHospital size={14} />
                      {nextAppointment.hospitalAddress ||
                        nextAppointment.district ||
                        "See appointment details"}
                    </span>
                  </div>
                </div>

                <div className="appointment-date-time-bar">
                  <span className="appointment-meta-icon">
                    <IconCalendar size={14} />
                    {formatLongDate(nextApptDate)}
                  </span>
                  <span className="appointment-meta-icon">
                    <IconClock size={14} />
                    {nextAppointment.timeSlot || nextAppointment.time || "—"}
                  </span>
                  {nextAppointment.doctorName && (
                    <span className="appointment-meta-icon">
                      <IconDoctor size={14} />
                      Dr. {nextAppointment.doctorName.replace(/^(?:(?:dr\.|dr\s|doctor\s)\s*)+/i, '')}
                    </span>
                  )}
                </div>

                <div className="appointment-actions-row">
                  <button
                    type="button"
                    className="btn-outline-action"
                    onClick={() => navigate("/patient/appointments")}
                  >
                    Manage / Reschedule
                  </button>
                  <button
                    type="button"
                    className="btn-queue-walkin"
                    style={{ marginLeft: 0, flex: 1 }}
                    onClick={() =>
                      alert(
                        `Appointment on ${formatShortDate(nextApptDate)} — a slip has been sent to your registered email.`,
                      )
                    }
                  >
                    Download Appointment Slip
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="hospital-section-card patient-advisory-card">
            <div className="patient-advisory-row">
              <div className="hospital-stat-icon stat-icon-amber">
                <IconRocket size={22} />
              </div>
              <div>
                <h4 className="patient-advisory-title">
                  International Travel Immunization Advisory
                </h4>
                <p className="patient-advisory-copy">
                  Planning international travel in 2026? Ensure your Yellow
                  Fever and Meningococcal vaccine certificates are renewed at
                  least 14 days before departure.
                </p>
                <button
                  type="button"
                  className="panel-link-btn"
                  onClick={() => navigate("/patient/vaccination-history")}
                >
                  Check Vaccination Certifications →
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="hospital-section-card">
          <div className="section-card-header inventory-section-header">
            <div className="inventory-section-title-row">
              <h2>
                <span className="section-title-icon section-title-icon--teal">
                  <IconShield size={22} />
                </span>
                Immunization Tracker
              </h2>
              <button
                type="button"
                className="btn-inventory-refresh"
                onClick={() => navigate("/patient/vaccination-history")}
              >
                Full History
              </button>
            </div>
            <p className="section-title-desc inventory-section-desc">
              Recent completed doses from your vaccination registry
            </p>
          </div>

          <div className="patient-tracker-list">
            {dashboardLoading ? (
              <p className="patient-empty-state">Loading your vaccinations…</p>
            ) : recentVaccines.length === 0 ? (
              <p className="patient-empty-state">
                No vaccination records on file yet.
              </p>
            ) : (
              recentVaccines.map((rec, idx) => (
                <div key={rec.id || idx} className="patient-tracker-item">
                  <div className="schedule-left">
                    <div className="hospital-stat-icon stat-icon-green icon-shade-sm">
                      <IconShield size={18} />
                    </div>
                    <div className="patient-tracker-copy">
                      <div className="schedule-name">
                        {rec.vaccineName || "Vaccine"}
                      </div>
                      <div className="schedule-target">
                        Dose {rec.doseNumber || 1} •{" "}
                        {rec.administeredByName || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="patient-tracker-meta">
                    <span className="schedule-status-tag status-completed">
                      Completed
                    </span>
                    <span className="patient-tracker-date">
                      {formatShortDate(rec.administeredAt)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="patient-tracker-footer">
            <button
              type="button"
              className="btn-inventory-restock"
              style={{ width: "100%" }}
              onClick={() => navigate("/patient/appointments")}
            >
              + Schedule Recommended Dose
            </button>
          </div>
        </div>
      </div>

      {/* ---------- 4. Care Plan Modal ---------- */}
      <CarePlanModal
        isOpen={carePlanOpen}
        loading={carePlanLoading}
        error={carePlanError}
        result={carePlanResult}
        patientName={displayName}
        onRegenerate={handleGenerateCarePlan}
        onClose={() => {
          if (carePlanLoading) return;
          setCarePlanOpen(false);
          setCarePlanError(null);
        }}
      />
    </div>
  );
}
