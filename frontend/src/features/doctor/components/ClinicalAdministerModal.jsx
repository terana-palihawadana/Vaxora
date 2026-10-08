import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useEffect, useMemo, useState } from 'react';
import ClinicalContextPanel from './ClinicalContextPanel';

/** Blank administration record. Confirmations start unticked so the clinician must sign off. */
const emptyAdministration = {
  batchId: '',
  lotNumber: '',
  injectionSite: 'Left Deltoid',
  route: 'Intramuscular (IM)',
  dosage: '',
  notes: '',
  doseConfirmed: false,
  consentConfirmed: false,
  vitalsConfirmed: false,
};

export default function ClinicalAdministerModal({
  isOpen,
  onClose,
  patient,
  onCertify,
  lotOptions = [],
  isDoctor = false,
}) {
  const [formData, setFormData] = useState(emptyAdministration);
  const [submitting, setSubmitting] = useState(false);

  const usableLots = useMemo(() => {
    const vaccineName = String(patient?.vaccine || '').trim().toLowerCase();
    return (lotOptions || []).filter((lot) => {
      const doses = Number(lot.availableDoses ?? 0);
      const vials = Number(lot.available ?? 0);
      const open = Number(lot.openVialDosesRemaining ?? 0);
      if (doses <= 0 && vials <= 0 && open <= 0) return false;
      if (!vaccineName) return true;
      return String(lot.name || '').trim().toLowerCase() === vaccineName
        || String(lot.name || '').toLowerCase().includes(vaccineName)
        || vaccineName.includes(String(lot.name || '').trim().toLowerCase());
    });
  }, [lotOptions, patient?.vaccine]);

  // Reset per patient so one patient's entries can never be certified against another.
  useEffect(() => deferEffectCallback(() => {
    if (!isOpen) return;
    const firstLot = usableLots[0];
    setSubmitting(false);
    setFormData({
      ...emptyAdministration,
      dosage: patient?.hasDosage ? patient.dose : '',
      batchId: firstLot?.id || '',
      lotNumber: firstLot?.lotNumber || '',
    });
  }), [isOpen, patient?.id, patient?.dose, patient?.hasDosage, usableLots]);

  if (!isOpen || !patient) return null;

  const handleLotChange = (batchId) => {
    const selected = usableLots.find((lot) => String(lot.id) === String(batchId));
    setFormData((prev) => ({
      ...prev,
      batchId: selected?.id || '',
      lotNumber: selected?.lotNumber || '',
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.doseConfirmed || !formData.consentConfirmed || !formData.vitalsConfirmed) {
      alert('Please confirm the prescribed dose, informed consent and pre-vaccination vitals.');
      return;
    }
    if (!formData.batchId && !formData.lotNumber) {
      alert('Select the vaccine lot being administered from hospital inventory.');
      return;
    }
    setSubmitting(true);
    try {
      await onCertify({
        ...patient,
        administrationDetails: formData,
        administeredAt: new Date().toISOString(),
      });
      onClose();
    } catch {
      // Parent shows toast; keep modal open so the clinician can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="doctor-modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="doctor-modal-header">
          <div>
            <h3 className="doctor-modal-title">Clinical Administration &amp; Certification</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)' }}>
              Record administration &amp; issue national vaccination digital pass
            </p>
          </div>
          <button type="button" className="doctor-modal-close-btn" onClick={onClose} disabled={submitting}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="doctor-modal-body">
            <div style={{
              background: 'var(--color-bg)',
              border: '1.5px solid var(--color-border-light)',
              borderRadius: '12px',
              padding: '14px 18px',
              marginBottom: '18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <span className="doctor-token-pill">{patient.token}</span>
                <span style={{ fontWeight: 800, color: 'var(--color-text-title)', fontSize: '1.05rem', marginLeft: '10px' }}>
                  {patient.name}
                </span>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '3px' }}>
                  NIC: {patient.nic}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--color-success)', fontWeight: 700, background: 'var(--color-success-bg)', padding: '3px 8px', borderRadius: '6px' }}>
                  {patient.vaccine}
                </span>
                <div style={{ fontSize: '0.78rem', color: 'var(--color-success)', marginTop: '4px' }}>
                  {patient.dose}
                </div>
              </div>
            </div>

            <ClinicalContextPanel patientProfileId={patient.patientProfileId} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="doctor-form-group">
                <label className="doctor-form-label">Vaccine Lot / Batch #</label>
                <select
                  className="doctor-form-select"
                  value={formData.batchId}
                  onChange={(e) => handleLotChange(e.target.value)}
                  required
                  disabled={submitting}
                >
                  <option value="">Select the lot being administered</option>
                  {usableLots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      Lot #{lot.lotNumber} · {lot.availableDoses ?? lot.available} doses · Exp {lot.expiry}
                    </option>
                  ))}
                </select>
                {usableLots.length === 0 && (
                  <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--color-warning)' }}>
                    No usable stock for this vaccine. Restock inventory before certifying.
                  </p>
                )}
              </div>

              <div className="doctor-form-group">
                <label className="doctor-form-label">Prescribed dose (locked)</label>
                <input
                  type="text"
                  className="doctor-form-input"
                  value={formData.dosage}
                  required
                  readOnly
                  disabled={submitting}
                  title="Locked once administration starts — return the patient to the queue to change it"
                />
                {!isDoctor && (
                  <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Prescribed by {patient.prescribedBy || 'the doctor'}. Contact the doctor to change it.
                  </p>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="doctor-form-group">
                <label className="doctor-form-label">Injection Anatomical Site</label>
                <select
                  className="doctor-form-select"
                  value={formData.injectionSite}
                  onChange={(e) => setFormData({ ...formData, injectionSite: e.target.value })}
                  disabled={submitting}
                >
                  <option value="Left Deltoid">Left Deltoid (Upper Arm)</option>
                  <option value="Right Deltoid">Right Deltoid (Upper Arm)</option>
                  <option value="Left Anterolateral Thigh">Left Anterolateral Thigh</option>
                  <option value="Right Anterolateral Thigh">Right Anterolateral Thigh</option>
                </select>
              </div>

              <div className="doctor-form-group">
                <label className="doctor-form-label">Administration Route</label>
                <select
                  className="doctor-form-select"
                  value={formData.route}
                  onChange={(e) => setFormData({ ...formData, route: e.target.value })}
                  disabled={submitting}
                >
                  <option value="Intramuscular (IM)">Intramuscular (IM)</option>
                  <option value="Subcutaneous (SC)">Subcutaneous (SC)</option>
                  <option value="Intradermal (ID)">Intradermal (ID)</option>
                  <option value="Oral (PO)">Oral (PO)</option>
                </select>
              </div>
            </div>

            <div style={{ background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)', borderRadius: '10px', padding: '12px 14px', margin: '14px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-success)', cursor: 'pointer', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  checked={formData.doseConfirmed}
                  onChange={(e) => setFormData({ ...formData, doseConfirmed: e.target.checked })}
                  disabled={submitting}
                />
                Prescribed dose checked against the doctor&apos;s order ({patient?.dose || 'not set'})
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-success)', cursor: 'pointer', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  checked={formData.consentConfirmed}
                  onChange={(e) => setFormData({ ...formData, consentConfirmed: e.target.checked })}
                  disabled={submitting}
                />
                Informed patient consent confirmed &amp; no acute fever/contraindications
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-success)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formData.vitalsConfirmed}
                  onChange={(e) => setFormData({ ...formData, vitalsConfirmed: e.target.checked })}
                  disabled={submitting}
                />
                Pre-administration vitals verified (BP, pulse, temp within normal range)
              </label>
            </div>

            <div className="doctor-form-group">
              <label className="doctor-form-label">Clinical Observations &amp; Advice</label>
              <textarea
                className="doctor-form-textarea"
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Enter any specific clinical remarks, guidance, or observation notes..."
                disabled={submitting}
              />
            </div>
          </div>

          <div className="doctor-modal-footer">
            <button type="button" className="doctor-btn-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="doctor-btn-submit" disabled={usableLots.length === 0 || submitting}>
              {submitting ? 'Certifying…' : 'Certify & Transfer to Observation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
