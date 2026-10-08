import { useEffect, useState } from 'react';
import ClinicalContextPanel from './ClinicalContextPanel';
import clinicalPatientService from '../services/clinicalPatientService';

/** Doctor-only: review history and prescribe the dose the nurse will administer. */
export default function ClinicalPrescribeModal({ isOpen, onClose, patient, onSaved }) {
  const [dosage, setDosage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDosage(patient?.hasDosage ? patient.dose : '');
    setError('');
    setSaving(false);
  }, [isOpen, patient?.id, patient?.dose, patient?.hasDosage]);

  if (!isOpen || !patient) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const value = dosage.trim();
    if (!value) {
      setError('Enter the dose to prescribe.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await clinicalPatientService.updateDosage(patient.id, value);
      await onSaved?.(patient, value);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save the prescription.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="doctor-modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="doctor-modal-header">
          <div>
            <h3 className="doctor-modal-title">Prescribe Dose</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)' }}>
              {patient.name} · {patient.vaccine}
            </p>
          </div>
          <button type="button" className="doctor-modal-close-btn" onClick={onClose} disabled={saving}>
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="doctor-modal-body">
            <ClinicalContextPanel patientProfileId={patient.patientProfileId} />
            <div className="doctor-form-group">
              <label className="doctor-form-label">Prescribed dose &amp; volume</label>
              <input
                type="text"
                className="doctor-form-input"
                value={dosage}
                maxLength={100}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="e.g. 0.5 mL"
                disabled={saving}
                required
              />
              <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                The nurse will confirm and administer exactly this dose.
              </p>
            </div>
            {error && <p style={{ color: 'var(--color-error)', fontSize: '0.82rem' }}>{error}</p>}
          </div>
          <div className="doctor-modal-footer">
            <button type="button" className="doctor-btn-cancel" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="doctor-btn-submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save prescription'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
