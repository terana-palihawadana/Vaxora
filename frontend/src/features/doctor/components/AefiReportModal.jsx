import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useEffect, useState } from 'react';

const tomorrowIso = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const emptyReport = {
  patientToken: '',
  patientName: '',
  vaccineName: '',
  reactionType: '',
  severity: 'Mild',
  treatmentGiven: '',
  followUpAt: tomorrowIso(),
  followUpPlan: '',
  notifyDoctor: true,
};

export default function AefiReportModal({ isOpen, onClose, onSubmitReport, patient }) {
  const [aefiData, setAefiData] = useState(emptyReport);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => deferEffectCallback(() => {
    if (!isOpen) return;
    setError('');
    setSubmitting(false);
    setAefiData({
      ...emptyReport,
      followUpAt: tomorrowIso(),
      patientToken: patient?.token || '',
      patientName: patient?.name || '',
      vaccineName: patient?.vaccine && patient.vaccine !== '—' ? patient.vaccine : '',
    });
  }), [isOpen, patient?.id, patient?.token, patient?.name, patient?.vaccine]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!patient?.id) {
      setError('Select an active patient before reporting AEFI.');
      return;
    }
    if (!String(aefiData.treatmentGiven || '').trim()) {
      setError('Immediate care / treatment given is required.');
      return;
    }
    if (!String(aefiData.followUpPlan || '').trim()) {
      setError('Follow-up plan is required.');
      return;
    }
    if (!aefiData.followUpAt) {
      setError('Follow-up date is required.');
      return;
    }

    try {
      setSubmitting(true);
      await onSubmitReport(aefiData);
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to submit AEFI report.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="doctor-modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="doctor-modal-header" style={{ background: 'linear-gradient(135deg, var(--color-error) 0%, var(--color-error) 100%)' }}>
          <div>
            <h3 className="doctor-modal-title">Report Adverse Event (AEFI)</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.9)' }}>
              Capture care, document on dose, schedule follow-up
            </p>
          </div>
          <button type="button" className="doctor-modal-close-btn" onClick={onClose} disabled={submitting}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="doctor-modal-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="doctor-form-group">
                <label className="doctor-form-label">Patient Token / ID</label>
                <input
                  type="text"
                  className="doctor-form-input"
                  value={aefiData.patientToken}
                  readOnly={Boolean(patient?.token)}
                  onChange={(e) => setAefiData({ ...aefiData, patientToken: e.target.value })}
                  required
                />
              </div>
              <div className="doctor-form-group">
                <label className="doctor-form-label">Patient Full Name</label>
                <input
                  type="text"
                  className="doctor-form-input"
                  value={aefiData.patientName}
                  readOnly={Boolean(patient?.name)}
                  onChange={(e) => setAefiData({ ...aefiData, patientName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="doctor-form-group">
                <label className="doctor-form-label">Suspected Vaccine</label>
                <input
                  type="text"
                  className="doctor-form-input"
                  value={aefiData.vaccineName}
                  readOnly={Boolean(patient?.vaccine && patient.vaccine !== '—')}
                  onChange={(e) => setAefiData({ ...aefiData, vaccineName: e.target.value })}
                  required
                />
              </div>
              <div className="doctor-form-group">
                <label className="doctor-form-label">Severity Level</label>
                <select
                  className="doctor-form-select"
                  value={aefiData.severity}
                  onChange={(e) => setAefiData({ ...aefiData, severity: e.target.value })}
                  disabled={submitting}
                >
                  <option value="Mild">Mild (Rash, Local swelling, Dizziness)</option>
                  <option value="Moderate">Moderate (Extensive hives, Pyrexia, Syncope)</option>
                  <option value="Severe">Severe (Anaphylaxis, Respiratory Distress)</option>
                </select>
              </div>
            </div>

            <div className="doctor-form-group">
              <label className="doctor-form-label">Symptoms &amp; Clinical Signs</label>
              <input
                type="text"
                className="doctor-form-input"
                value={aefiData.reactionType}
                onChange={(e) => setAefiData({ ...aefiData, reactionType: e.target.value })}
                required
                disabled={submitting}
              />
            </div>

            <div className="doctor-form-group">
              <label className="doctor-form-label">Immediate Clinical Action &amp; Treatment Given</label>
              <textarea
                className="doctor-form-textarea"
                rows={3}
                value={aefiData.treatmentGiven}
                onChange={(e) => setAefiData({ ...aefiData, treatmentGiven: e.target.value })}
                required
                disabled={submitting}
                placeholder="e.g. IM adrenaline 0.5 mg, oxygen, observation continued…"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="doctor-form-group">
                <label className="doctor-form-label">Follow-up Date</label>
                <input
                  type="date"
                  className="doctor-form-input"
                  value={aefiData.followUpAt}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setAefiData({ ...aefiData, followUpAt: e.target.value })}
                  required
                  disabled={submitting}
                />
              </div>
              <div className="doctor-form-group">
                <label className="doctor-form-label">Follow-up Plan</label>
                <input
                  type="text"
                  className="doctor-form-input"
                  value={aefiData.followUpPlan}
                  onChange={(e) => setAefiData({ ...aefiData, followUpPlan: e.target.value })}
                  required
                  disabled={submitting}
                  placeholder="Phone check-in, clinic review…"
                />
              </div>
            </div>

            {error ? (
              <p style={{ margin: '12px 0 0', color: 'var(--color-error)', fontSize: '0.85rem' }}>{error}</p>
            ) : null}
          </div>

          <div className="doctor-modal-footer">
            <button type="button" className="doctor-btn-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="doctor-btn-submit danger" disabled={submitting || !patient?.id}>
              {submitting ? 'Saving…' : 'Log AEFI & Schedule Follow-up'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
