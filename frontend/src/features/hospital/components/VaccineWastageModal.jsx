import { useState } from 'react';
import { hospitalToday } from '../utils/hospitalDate';

function initialForm(inventoryItems) {
  const first = inventoryItems && inventoryItems.length > 0 ? inventoryItems[0] : null;
  return {
    vaccineId: first ? first.id : '',
    lotNumber: first ? first.lotNumber : '',
    quantity: '5',
    reason: 'vial_breakage',
    reportedBy: 'Staff Pharmacist / Nurse Station 2',
    notes: '',
    incidentDate: hospitalToday(),
  };
}

export default function VaccineWastageModal({ isOpen, onClose, inventoryItems, onLogWastage }) {
  const [formData, setFormData] = useState(() => initialForm(inventoryItems));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Start fresh each time the modal opens: stock loads after this component mounts,
  // so the first batch can only be preselected at open time.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    setSubmitting(false);
    setError('');
    setFormData(initialForm(inventoryItems));
  }

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'vaccineId') {
      // FIX: GUIDs are strings — do not parseInt
      const selected = inventoryItems.find((item) => item.id === value);
      setFormData((prev) => ({
        ...prev,
        vaccineId: value,
        lotNumber: selected ? selected.lotNumber : '',
      }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const qty = parseInt(formData.quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      setError('Please enter a valid quantity of wasted/discarded doses.');
      return;
    }
    const batch = inventoryItems.find((item) => item.id === formData.vaccineId);
    if (!batch) {
      setError('Select the batch the wasted vials came from.');
      return;
    }
    if (qty > Number(batch.available ?? 0)) {
      setError(`Only ${batch.available} vials of this lot are in stock.`);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      // FIX: pass vaccineId (batch GUID) as string, not parsed int
      await onLogWastage({
        ...formData,
        quantity: qty,
      });
      onClose();
    } catch (err) {
      // Keep the form open so the entry can be corrected and retried.
      setError(err?.message || 'Failed to record wastage.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="hospital-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px' }}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>Record Vaccine Wastage</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              Wasted or spoiled vials are deducted from stock and added to the MOH audit trail.
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={submitting}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="modal-form-group">
              <label className="modal-label">Select Vaccine Formulation *</label>
              <select
                name="vaccineId"
                value={formData.vaccineId}
                onChange={handleChange}
                className="modal-select"
                disabled={submitting}
                required
              >
                {inventoryItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · Lot {item.lotNumber} ({item.available} vials in stock)
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="modal-form-group">
                <label className="modal-label">Batch / Lot Number</label>
                <input
                  type="text"
                  name="lotNumber"
                  value={formData.lotNumber}
                  readOnly
                  className="modal-input"
                  style={{ background: 'var(--color-surface-subtle)', cursor: 'not-allowed' }}
                />
              </div>

              <div className="modal-form-group">
                <label className="modal-label">Wasted Vials / Doses *</label>
                <input
                  type="number"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleChange}
                  min="1"
                  placeholder="e.g. 5"
                  required
                  className="modal-input"
                  disabled={submitting}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div className="modal-form-group">
                <label className="modal-label">Reason for Wastage *</label>
                <select
                  name="reason"
                  value={formData.reason}
                  onChange={handleChange}
                  className="modal-select"
                  disabled={submitting}
                >
                  <option value="vial_breakage">Physical Damage / Vial Breakage</option>
                  <option value="cold_chain_excursion">Cold Chain / Temperature Excursion</option>
                  <option value="expired_unopened">Passed Expiration Date (Unopened)</option>
                  <option value="open_vial_expiration">Multi-dose Open Vial Beyond 6-Hour Window</option>
                  <option value="reconstitution_error">Reconstitution / Diluent Error</option>
                  <option value="contamination">Suspected Particulate / Contamination</option>
                </select>
              </div>

              <div className="modal-form-group">
                <label className="modal-label">Incident Date *</label>
                <input
                  type="date"
                  name="incidentDate"
                  value={formData.incidentDate}
                  onChange={handleChange}
                  max={hospitalToday()}
                  className="modal-input"
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            <div className="modal-form-group">
              <label className="modal-label">Reporting Healthcare Staff *</label>
              <input
                type="text"
                name="reportedBy"
                value={formData.reportedBy}
                onChange={handleChange}
                placeholder="e.g. Nurse K. Jayasinghe / Pharmacy Lead"
                required
                className="modal-input"
                disabled={submitting}
              />
            </div>

            <div className="modal-form-group">
              <label className="modal-label">Clinical / Technical Remarks</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Briefly describe what happened (e.g., dropped during tray prep in Booth 02, cold unit sensor tripped for 40 mins)"
                className="modal-input"
                rows="3"
                style={{ resize: 'vertical' }}
                disabled={submitting}
              />
            </div>

            {error && (
              <p role="alert" style={{ margin: '4px 0 0', color: 'var(--color-error)', fontSize: '0.875rem', fontWeight: 600 }}>
                {error}
              </p>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-modal-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-danger" disabled={submitting}>
              {submitting ? 'Saving...' : 'Deduct Wasted Stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
