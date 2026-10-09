import { useEffect, useState } from "react";
import { deferEffectCallback } from "../../../shared/utils/deferEffectCallback.js";
import clinicalPatientService from "../services/clinicalPatientService";

const VISIT_TYPES = [
  { value: "Checkup", label: "Checkup" },
  { value: "FollowUp", label: "Follow-up" },
  { value: "Emergency", label: "Emergency" },
  { value: "Vaccination", label: "Vaccination" },
];

const STATUSES = [
  { value: "Completed", label: "Completed" },
  { value: "Scheduled", label: "Scheduled" },
  { value: "Cancelled", label: "Cancelled" },
];

const todayIsoDate = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const createEmptyForm = () => ({
  visitType: "Checkup",
  status: "Completed",
  visitDate: todayIsoDate(),
  chiefComplaint: "",
  bloodPressure: "",
  temperature: "",
  weightKg: "",
  heightCm: "",
  heartRate: "",
  oxygenSaturation: "",
  diagnosisSummary: "",
  treatmentPlan: "",
  notes: "",
  followUpDate: "",
});

export default function RecordVisitModal({
  isOpen,
  onClose,
  patient,
  onSaved,
}) {
  const [form, setForm] = useState(createEmptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Correct pattern: wrap the deferred callback in `() =>` so it only runs
  // when the effect fires, not on every render.
  useEffect(
    () =>
      deferEffectCallback(() => {
        if (!isOpen) return;
        setForm(createEmptyForm());
        setError("");
        setSubmitting(false);
      }),
    [isOpen, patient?.patientProfileId],
  );

  if (!isOpen || !patient) return null;

  const setField = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.visitType) {
      setError("Visit type is required.");
      return;
    }
    if (!form.visitDate) {
      setError("Visit date is required.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        visitType: form.visitType,
        status: form.status || "Completed",
        visitDate: form.visitDate
          ? new Date(form.visitDate).toISOString()
          : null,
        chiefComplaint: form.chiefComplaint.trim() || null,
        bloodPressure: form.bloodPressure.trim() || null,
        temperature: form.temperature.trim() || null,
        weightKg: form.weightKg.trim() || null,
        heightCm: form.heightCm.trim() || null,
        heartRate: form.heartRate.trim() || null,
        oxygenSaturation: form.oxygenSaturation.trim() || null,
        diagnosisSummary: form.diagnosisSummary.trim() || null,
        treatmentPlan: form.treatmentPlan.trim() || null,
        notes: form.notes.trim() || null,
        followUpDate: form.followUpDate
          ? new Date(form.followUpDate).toISOString()
          : null,
      };
      await clinicalPatientService.createVisit(
        patient.patientProfileId,
        payload,
      );
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to record visit.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="doctor-modal-overlay"
      onClick={submitting ? undefined : onClose}
    >
      <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="doctor-modal-header">
          <div>
            <h3 className="doctor-modal-title">Record Patient Visit</h3>
            <p
              style={{
                margin: "4px 0 0 0",
                fontSize: "0.82rem",
                color: "rgba(255,255,255,0.85)",
              }}
            >
              Capture vitals, diagnosis, and treatment plan for this
              consultation
            </p>
          </div>
          <button
            type="button"
            className="doctor-modal-close-btn"
            onClick={onClose}
            disabled={submitting}
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="doctor-modal-body">
            {/* Patient summary bar */}
            <div
              style={{
                background: "var(--color-bg)",
                border: "1.5px solid var(--color-border-light)",
                borderRadius: "12px",
                padding: "14px 18px",
                marginBottom: "18px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span className="doctor-token-pill">
                  {patient.vaxoraId || "—"}
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    color: "var(--color-text-title)",
                    fontSize: "1.05rem",
                    marginLeft: "10px",
                  }}
                >
                  {patient.name}
                </span>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--color-text-muted)",
                    marginTop: "3px",
                  }}
                >
                  NIC: {patient.nic || "—"}
                </div>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  background: "var(--color-error-bg)",
                  color: "var(--color-error)",
                  border: "1px solid var(--color-error-border)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  marginBottom: "14px",
                  fontSize: "0.85rem",
                }}
              >
                {error}
              </div>
            )}

            {/* Visit type + status + date */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "14px",
              }}
            >
              <div className="doctor-form-group">
                <label className="doctor-form-label">Visit Type</label>
                <select
                  className="doctor-form-select"
                  value={form.visitType}
                  onChange={setField("visitType")}
                  disabled={submitting}
                  required
                >
                  {VISIT_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="doctor-form-group">
                <label className="doctor-form-label">Status</label>
                <select
                  className="doctor-form-select"
                  value={form.status}
                  onChange={setField("status")}
                  disabled={submitting}
                >
                  {STATUSES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="doctor-form-group">
                <label className="doctor-form-label">Visit Date</label>
                <input
                  type="date"
                  className="doctor-form-input"
                  value={form.visitDate}
                  onChange={setField("visitDate")}
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            {/* Chief complaint */}
            <div className="doctor-form-group">
              <label className="doctor-form-label">Chief Complaint</label>
              <textarea
                className="doctor-form-textarea"
                rows={2}
                value={form.chiefComplaint}
                onChange={setField("chiefComplaint")}
                placeholder="Patient's main concern or reason for the visit"
                maxLength={1000}
                disabled={submitting}
              />
            </div>

            {/* Vitals grid */}
            <div style={{ marginBottom: "6px" }}>
              <label
                className="doctor-form-label"
                style={{ display: "block", marginBottom: 8 }}
              >
                Vitals
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "12px",
                }}
              >
                <div className="doctor-form-group">
                  <label
                    className="doctor-form-label"
                    style={{ fontSize: "0.78rem" }}
                  >
                    BP (mmHg)
                  </label>
                  <input
                    type="text"
                    className="doctor-form-input"
                    value={form.bloodPressure}
                    onChange={setField("bloodPressure")}
                    placeholder="e.g. 120/80"
                    maxLength={20}
                    disabled={submitting}
                  />
                </div>

                <div className="doctor-form-group">
                  <label
                    className="doctor-form-label"
                    style={{ fontSize: "0.78rem" }}
                  >
                    Temperature (°C)
                  </label>
                  <input
                    type="text"
                    className="doctor-form-input"
                    value={form.temperature}
                    onChange={setField("temperature")}
                    placeholder="e.g. 36.8"
                    maxLength={10}
                    disabled={submitting}
                  />
                </div>

                <div className="doctor-form-group">
                  <label
                    className="doctor-form-label"
                    style={{ fontSize: "0.78rem" }}
                  >
                    Heart Rate (bpm)
                  </label>
                  <input
                    type="text"
                    className="doctor-form-input"
                    value={form.heartRate}
                    onChange={setField("heartRate")}
                    placeholder="e.g. 78"
                    maxLength={10}
                    disabled={submitting}
                  />
                </div>

                <div className="doctor-form-group">
                  <label
                    className="doctor-form-label"
                    style={{ fontSize: "0.78rem" }}
                  >
                    Weight (kg)
                  </label>
                  <input
                    type="text"
                    className="doctor-form-input"
                    value={form.weightKg}
                    onChange={setField("weightKg")}
                    placeholder="e.g. 72"
                    maxLength={10}
                    disabled={submitting}
                  />
                </div>

                <div className="doctor-form-group">
                  <label
                    className="doctor-form-label"
                    style={{ fontSize: "0.78rem" }}
                  >
                    Height (cm)
                  </label>
                  <input
                    type="text"
                    className="doctor-form-input"
                    value={form.heightCm}
                    onChange={setField("heightCm")}
                    placeholder="e.g. 170"
                    maxLength={10}
                    disabled={submitting}
                  />
                </div>

                <div className="doctor-form-group">
                  <label
                    className="doctor-form-label"
                    style={{ fontSize: "0.78rem" }}
                  >
                    SpO₂ (%)
                  </label>
                  <input
                    type="text"
                    className="doctor-form-input"
                    value={form.oxygenSaturation}
                    onChange={setField("oxygenSaturation")}
                    placeholder="e.g. 98"
                    maxLength={10}
                    disabled={submitting}
                  />
                </div>
              </div>
            </div>

            {/* Diagnosis */}
            <div className="doctor-form-group">
              <label className="doctor-form-label">Diagnosis Summary</label>
              <textarea
                className="doctor-form-textarea"
                rows={3}
                value={form.diagnosisSummary}
                onChange={setField("diagnosisSummary")}
                placeholder="Clinical impression and confirmed diagnoses"
                maxLength={2000}
                disabled={submitting}
              />
            </div>

            {/* Treatment plan */}
            <div className="doctor-form-group">
              <label className="doctor-form-label">Treatment Plan</label>
              <textarea
                className="doctor-form-textarea"
                rows={3}
                value={form.treatmentPlan}
                onChange={setField("treatmentPlan")}
                placeholder="Medications, dosages, referrals, follow-up advice"
                maxLength={2000}
                disabled={submitting}
              />
            </div>

            {/* Notes + follow-up */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr",
                gap: "14px",
              }}
            >
              <div className="doctor-form-group">
                <label className="doctor-form-label">Additional Notes</label>
                <textarea
                  className="doctor-form-textarea"
                  rows={2}
                  value={form.notes}
                  onChange={setField("notes")}
                  placeholder="Optional"
                  maxLength={1000}
                  disabled={submitting}
                />
              </div>

              <div className="doctor-form-group">
                <label className="doctor-form-label">
                  Follow-up Date (optional)
                </label>
                <input
                  type="date"
                  className="doctor-form-input"
                  value={form.followUpDate}
                  onChange={setField("followUpDate")}
                  disabled={submitting}
                />
              </div>
            </div>
          </div>

          <div className="doctor-modal-footer">
            <button
              type="button"
              className="doctor-btn-cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="doctor-btn-submit"
              disabled={submitting}
            >
              {submitting ? "Recording…" : "Record Visit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
