import { useEffect, useState } from 'react';
import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import clinicalPatientService from '../services/clinicalPatientService';

const RECORD_TYPES = [
  { value: 'Diagnosis', label: 'Diagnosis' },
  { value: 'Allergy', label: 'Allergy' },
  { value: 'Medication', label: 'Medication' },
  { value: 'Surgery', label: 'Surgery' },
  { value: 'Other', label: 'Other' },
];

const SEVERITIES = [
  { value: 'Info', label: 'Info' },
  { value: 'Mild', label: 'Mild' },
  { value: 'Moderate', label: 'Moderate' },
  { value: 'Severe', label: 'Severe' },
  { value: 'Critical', label: 'Critical' },
];

const STATUSES = [
  { value: 'Active', label: 'Active' },
  { value: 'Chronic', label: 'Chronic' },
  { value: 'Resolved', label: 'Resolved' },
  { value: 'InRemission', label: 'In Remission' },
];

const createEmptyForm = () => ({
  recordType: 'Diagnosis',
  title: '',
  description: '',
  severity: 'Info',
  status: 'Active',
  icd10Code: '',
  diagnosedAt: '',
  notes: '',
});

export default function AddMedicalHistoryModal({
  isOpen,
  onClose,
  patient,
  onSaved,
}) {
  const [form, setForm] = useState(createEmptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Correct pattern: wrap the deferred callback in `() =>` so it only runs
  // when the effect fires, not on every render.
  useEffect(
    () =>
      deferEffectCallback(() => {
        if (!isOpen) return;
        setForm(createEmptyForm());
        setError('');
        setSubmitting(false);
      }),
    [isOpen, patient?.patientProfileId]
  );

  if (!isOpen || !patient) return null;

  const setField = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!form.recordType) {
      setError('Record type is required.');
      return;
    }
    if (!form.severity) {
      setError('Severity is required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        recordType: form.recordType,
        title: form.title.trim(),
        description: form.description.trim() || null,
        severity: form.severity,
        status: form.status || 'Active',
        icd10Code: form.icd10Code.trim() || null,
        diagnosedAt: form.diagnosedAt
          ? new Date(form.diagnosedAt).toISOString()
          : null,
        notes: form.notes.trim() || null,
      };
      await clinicalPatientService.createMedicalHistory(
        patient.patientProfileId,
        payload
      );
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save medical history.');
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
            <h3 className="doctor-modal-title">Add Medical History</h3>
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: '0.82rem',
                color: 'rgba(255,255,255,0.85)',
              }}
            >
              Record a diagnosis, allergy, medication, or surgery for this
              patient
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
                background: 'var(--color-bg)',
                border: '1.5px solid var(--color-border-light)',
                borderRadius: '12px',
                padding: '14px 18px',
                marginBottom: '18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <span className="doctor-token-pill">
                  {patient.vaxoraId || '—'}
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    color: 'var(--color-text-title)',
                    fontSize: '1.05rem',
                    marginLeft: '10px',
                  }}
                >
                  {patient.name}
                </span>
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--color-text-muted)',
                    marginTop: '3px',
                  }}
                >
                  NIC: {patient.nic || '—'}
                </div>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  background: 'var(--color-error-bg)',
                  color: 'var(--color-error)',
                  border: '1px solid var(--color-error-border)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  marginBottom: '14px',
                  fontSize: '0.85rem',
                }}
              >
                {error}
              </div>
            )}

            {/* Record type + severity */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '14px',
              }}
            >
              <div className="doctor-form-group">
                <label className="doctor-form-label">Record Type</label>
                <select
                  className="doctor-form-select"
                  value={form.recordType}
                  onChange={setField('recordType')}
                  disabled={submitting}
                  required
                >
                  {RECORD_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="doctor-form-group">
                <label className="doctor-form-label">Severity</label>
                <select
                  className="doctor-form-select"
                  value={form.severity}
                  onChange={setField('severity')}
                  disabled={submitting}
                  required
                >
                  {SEVERITIES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Title */}
            <div className="doctor-form-group">
              <label className="doctor-form-label">Title</label>
              <input
                type="text"
                className="doctor-form-input"
                value={form.title}
                onChange={setField('title')}
                placeholder="e.g. Type 2 Diabetes Mellitus"
                maxLength={200}
                disabled={submitting}
                required
              />
            </div>

            {/* Status + ICD-10 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '14px',
              }}
            >
              <div className="doctor-form-group">
                <label className="doctor-form-label">Status</label>
                <select
                  className="doctor-form-select"
                  value={form.status}
                  onChange={setField('status')}
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
                <label className="doctor-form-label">
                  ICD-10 Code (optional)
                </label>
                <input
                  type="text"
                  className="doctor-form-input"
                  value={form.icd10Code}
                  onChange={setField('icd10Code')}
                  placeholder="e.g. E11.9"
                  maxLength={20}
                  disabled={submitting}
                />
              </div>
            </div>

            {/* Diagnosed date */}
            <div className="doctor-form-group">
              <label className="doctor-form-label">
                Diagnosed On (optional)
              </label>
              <input
                type="date"
                className="doctor-form-input"
                value={form.diagnosedAt}
                onChange={setField('diagnosedAt')}
                disabled={submitting}
              />
            </div>

            {/* Description */}
            <div className="doctor-form-group">
              <label className="doctor-form-label">Description</label>
              <textarea
                className="doctor-form-textarea"
                rows={3}
                value={form.description}
                onChange={setField('description')}
                placeholder="Clinical details, test results, notes from the diagnosis…"
                maxLength={2000}
                disabled={submitting}
              />
            </div>

            {/* Notes */}
            <div className="doctor-form-group">
              <label className="doctor-form-label">Additional Notes</label>
              <textarea
                className="doctor-form-textarea"
                rows={2}
                value={form.notes}
                onChange={setField('notes')}
                placeholder="Optional — will be visible in the patient's medical record"
                maxLength={1000}
                disabled={submitting}
              />
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
              {submitting ? 'Saving…' : 'Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
