import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useEffect, useMemo, useState } from 'react';

/** Blank administration record. Confirmations start unticked so the nurse must sign off. */
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

export default function NurseClinicalAdministerModal({
  isOpen,
  onClose,
  patient,
  onCertify,
  lotOptions = [],
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
      // Parent shows toast; keep modal open so the nurse can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="doctor-modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="doctor-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="doctor-modal-header" style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' }}>
          <div>
            <h3 className="doctor-modal-title">Clinical Administration &amp; Verification</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.9)' }}>
              Nurse Immunization Record • National Vaccine Registry
            </p>
          </div>
          <button type="button" className="doctor-modal-close-btn" onClick={onClose} disabled={submitting}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="doctor-modal-body">
            <div style={{
              background: '#f0f9ff',
              border: '1.5px solid #bae6fd',
              borderRadius: '12px',
              padding: '14px 18px',
              marginBottom: '18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <span className="doctor-token-pill">{patient.token}</span>
                <span style={{ fontWeight: 800, color: '#0c4a6e', fontSize: '1.05rem', marginLeft: '10px' }}>
                  {patient.name}
                </span>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '3px' }}>
                  NIC: {patient.nic}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.78rem', color: '#0369a1', fontWeight: 700, background: '#e0f2fe', padding: '3px 8px', borderRadius: '6px' }}>
                  {patient.vaccine}
                </span>
                <div style={{ fontSize: '0.78rem', color: '#0284c7', marginTop: '4px', fontWeight: 600 }}>
                  Prescribed: {patient.dose}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="doctor-form-group">
                <label className="doctor-form-label">Cold-Box Lot / Batch #</label>
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
                  <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#b45309' }}>
                    No usable stock for this vaccine. Restock inventory before certifying.
                  </p>
                )}
              </div>

              <div className="doctor-form-group">
                <label className="doctor-form-label">Prescribed Dosage (Doctor Approved)</label>
                <input
                  type="text"
                  className="doctor-form-input readonly-dosage-input"
                  value={formData.dosage}
                  readOnly
                  title="Prescribed by physician"
                />
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

            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '12px 14px', margin: '14px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', fontWeight: 600, color: '#166534', cursor: 'pointer', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  checked={formData.doseConfirmed}
                  onChange={(e) => setFormData({ ...formData, doseConfirmed: e.target.checked })}
                  disabled={submitting}
                />
                Prescribed dose checked against the doctor&apos;s order ({patient?.dose || 'not set'})
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', fontWeight: 600, color: '#166534', cursor: 'pointer', marginBottom: '8px' }}>
                <input
                  type="checkbox"
                  checked={formData.consentConfirmed}
                  onChange={(e) => setFormData({ ...formData, consentConfirmed: e.target.checked })}
                  disabled={submitting}
                />
                Informed patient consent verified
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', fontWeight: 600, color: '#166534', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formData.vitalsConfirmed}
                  onChange={(e) => setFormData({ ...formData, vitalsConfirmed: e.target.checked })}
                  disabled={submitting}
                />
                Pre-administration vitals checked (BP, Temp, Pulse stable)
              </label>
            </div>

            <div className="doctor-form-group">
              <label className="doctor-form-label">Nurse Observation Notes</label>
              <textarea
                className="doctor-form-textarea"
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Enter nursing observations, site reaction checks, or care instructions..."
                disabled={submitting}
              />
            </div>
          </div>

          <div className="doctor-modal-footer">
            <button type="button" className="doctor-btn-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="doctor-btn-submit"
              style={{ background: '#0284c7' }}
              disabled={usableLots.length === 0 || submitting}
            >
              {submitting ? 'Confirming…' : 'Confirm Dose & Transfer to Observation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
