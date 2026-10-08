import { useState } from 'react';

export default function VaccineWastageModal({ isOpen, onClose, inventoryItems, onLogWastage }) {
  const [formData, setFormData] = useState({
    vaccineId: inventoryItems && inventoryItems.length > 0 ? inventoryItems[0].id : '',
    lotNumber: inventoryItems && inventoryItems.length > 0 ? inventoryItems[0].lotNumber : '',
    quantity: '5',
    reason: 'vial_breakage',
    reportedBy: 'Staff Pharmacist / Nurse Station 2',
    notes: '',
    incidentDate: new Date().toISOString().split('T')[0],
  });

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

  const handleSubmit = (e) => {
    e.preventDefault();
    const qty = parseInt(formData.quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      alert('Please enter a valid quantity of wasted/discarded doses.');
      return;
    }

    // FIX: pass vaccineId (batch GUID) as string, not parsed int
    onLogWastage({
      ...formData,
      quantity: qty,
    });

    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="hospital-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>⚠️</span>
            <h3 style={{ margin: 0 }}>Record Vaccine Wastage / Spoilage</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '16px', lineHeight: '1.5' }}>
              Accurately logging vaccine wastage ensures strict compliance with National Immunization &amp; Cold-Chain standards. All reported entries are stamped in the MOH audit trail.
            </p>

            <div className="modal-form-group">
              <label className="modal-label">Select Vaccine Formulation *</label>
              <select
                name="vaccineId"
                value={formData.vaccineId}
                onChange={handleChange}
                className="modal-select"
                required
              >
                {inventoryItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — Lot: {item.lotNumber} ({item.available} vials in stock)
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
                  className="modal-input"
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
              />
            </div>
          </div>

          <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: '16px' }}>
            <button type="button" className="btn-modal-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-modal-submit"
              style={{ background: 'var(--color-error)', borderColor: 'var(--color-error)', boxShadow: '0 4px 14px rgba(var(--rgb-error), 0.35)' }}
            >
              Confirm &amp; Deduct Wasted Stock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
