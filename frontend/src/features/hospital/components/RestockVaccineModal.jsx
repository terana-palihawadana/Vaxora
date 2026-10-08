import { useEffect, useLayoutEffect, useState } from 'react';

const DEFAULT_LIST = [
  'Pfizer-BioNTech Bivalent (mRNA)',
  'Moderna Spikevax mRNA-1273',
  'Influenza Quadrivalent (Seasonal)',
  'Hepatitis B Recombinant',
  'MMR (Measles, Mumps, Rubella)',
  'Tdap (Tetanus, Diphtheria, Pertussis)',
  'Rabies Inactivated Vaccine (Verorab)',
];

function emptyForm() {
  return {
    vaccineName: '',
    customVaccineName: '',
    category: 'routine',
    lotNumber: '',
    quantity: '',
    expiryDate: '',
    storageUnit: '',
    supplier: '',
  };
}

export default function RestockVaccineModal({
  isOpen,
  onClose,
  onAddStock,
  registeredVaccines = [],
}) {
  // Accept either string names or formulary row objects { name / vaccineName }
  const vaccineOptions = (
    registeredVaccines.length > 0 ? registeredVaccines : DEFAULT_LIST
  )
    .map((v) => (typeof v === 'string' ? v : String(v?.name || v?.vaccineName || '').trim()))
    .filter(Boolean);

  const [formData, setFormData] = useState(emptyForm);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset before paint when opening, and again when closing — avoids flashing custom-mode UI.
  useLayoutEffect(() => {
    if (isOpen) {
      setIsCustomMode(false);
      setSubmitting(false);
      setFormData(emptyForm());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsCustomMode(false);
      setSubmitting(false);
      setFormData(emptyForm());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'vaccineName') {
      if (value === '__custom__') {
        setIsCustomMode(true);
        setFormData((prev) => ({ ...prev, vaccineName: '', customVaccineName: '' }));
      } else {
        setIsCustomMode(false);
        setFormData((prev) => ({ ...prev, vaccineName: value, customVaccineName: '' }));
      }
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const finalName = isCustomMode
      ? formData.customVaccineName.trim()
      : formData.vaccineName.trim();

    if (!finalName) {
      alert('Please select or enter a valid vaccine product name.');
      return;
    }
    if (!formData.lotNumber.trim() || !String(formData.quantity).trim()) {
      alert('Please fill the Lot Number and Quantity.');
      return;
    }
    if (!formData.storageUnit) {
      alert('Please select a cold vault.');
      return;
    }

    setSubmitting(true);
    try {
      await onAddStock({
        vaccineName: finalName,
        lotNumber: formData.lotNumber.trim(),
        quantity: parseInt(formData.quantity, 10),
        storageUnit: formData.storageUnit,
        expiryDate: formData.expiryDate || undefined,
        supplier: formData.supplier.trim(),
        ...(isCustomMode ? { category: formData.category || 'routine' } : {}),
      });
      setIsCustomMode(false);
      setFormData(emptyForm());
      onClose();
    } catch {
      // Parent toasts; keep values so the user can fix and retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="hospital-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>
              {isCustomMode ? 'Add new vaccine product' : 'Log Vaccine Restock Shipment'}
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: '#64748b' }}>
              {isCustomMode
                ? 'Enter the product details, then continue with lot and vault info below.'
                : 'Select from hospital-registered vaccine formulations or enter a new product name.'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {isCustomMode && (
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => {
                  setIsCustomMode(false);
                  setFormData((prev) => ({
                    ...prev,
                    vaccineName: '',
                    customVaccineName: '',
                    category: 'routine',
                  }));
                }}
                disabled={submitting}
                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              >
                ← Back to list
              </button>
            )}
            <button type="button" className="modal-close-btn" onClick={onClose} disabled={submitting}>
              &times;
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="modal-body">
            {!isCustomMode ? (
              <div className="modal-form-group">
                <label className="modal-label">Vaccine product *</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    name="vaccineName"
                    value={formData.vaccineName}
                    onChange={handleChange}
                    className="modal-select"
                    style={{ flex: 1 }}
                    disabled={submitting}
                    required
                  >
                    <option value="" disabled>
                      Select a formulation...
                    </option>
                    {vaccineOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    <option value="__custom__">+ Enter a new vaccine product…</option>
                  </select>
                  <button
                    type="button"
                    className="btn-quick-adjust btn-adjust-plus"
                    onClick={() => {
                      setIsCustomMode(true);
                      setFormData((prev) => ({ ...prev, vaccineName: '', customVaccineName: '' }));
                    }}
                    style={{ padding: '0 14px', fontSize: '0.82rem' }}
                    disabled={submitting}
                  >
                    + New
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(140px, 0.65fr)', gap: '12px' }}>
                  <div className="modal-form-group">
                    <label className="modal-label" htmlFor="restock-custom-name">
                      New product name *
                    </label>
                    <input
                      id="restock-custom-name"
                      type="text"
                      name="customVaccineName"
                      value={formData.customVaccineName}
                      onChange={handleChange}
                      placeholder="e.g. Sinopharm BBIBP-CorV"
                      required
                      className="modal-input"
                      autoFocus
                      disabled={submitting}
                      autoComplete="off"
                    />
                  </div>
                  <div className="modal-form-group">
                    <label className="modal-label" htmlFor="restock-vaccine-category">
                      Category *
                    </label>
                    <select
                      id="restock-vaccine-category"
                      name="category"
                      value={formData.category}
                      onChange={handleChange}
                      className="modal-select"
                      disabled={submitting}
                      required
                    >
                      <option value="routine">Routine</option>
                      <option value="mrna">mRNA</option>
                      <option value="seasonal">Seasonal</option>
                      <option value="pediatric">Pediatric</option>
                    </select>
                  </div>
                </div>
                <p style={{ margin: '-4px 0 12px', fontSize: '0.76rem', color: '#64748b' }}>
                  New products are saved to your formulary when the shipment is committed.
                </p>
              </>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="modal-form-group">
                <label className="modal-label">Batch / lot number *</label>
                <input
                  type="text"
                  name="lotNumber"
                  value={formData.lotNumber}
                  onChange={handleChange}
                  placeholder="e.g. PF-9921"
                  required
                  className="modal-input"
                  disabled={submitting}
                  autoComplete="off"
                />
              </div>
              <div className="modal-form-group">
                <label className="modal-label">Quantity received (vials) *</label>
                <input
                  type="number"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleChange}
                  placeholder="e.g. 250"
                  min="1"
                  required
                  className="modal-input"
                  disabled={submitting}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="modal-form-group">
                <label className="modal-label">Expiry date</label>
                <input
                  type="date"
                  name="expiryDate"
                  value={formData.expiryDate}
                  onChange={handleChange}
                  className="modal-input"
                  disabled={submitting}
                />
              </div>
              <div className="modal-form-group">
                <label className="modal-label">Assigned cold vault *</label>
                <select
                  name="storageUnit"
                  value={formData.storageUnit}
                  onChange={handleChange}
                  className="modal-select"
                  disabled={submitting}
                  required
                >
                  <option value="" disabled>
                    Select vault...
                  </option>
                  <option value="Freezer Unit A (-70°C)">Ultra-Cold Vault A (-70°C)</option>
                  <option value="Chiller Unit B (2-8°C)">Chiller Unit B (2°C - 8°C)</option>
                  <option value="Mobile Chiller C">Mobile Deployment Chiller C</option>
                </select>
              </div>
            </div>

            <div className="modal-form-group">
              <label className="modal-label">Authorized supplier / batch dispatch</label>
              <input
                type="text"
                name="supplier"
                value={formData.supplier}
                onChange={handleChange}
                placeholder="e.g. State Pharmaceuticals Corporation (SPC) / MOH"
                className="modal-input"
                disabled={submitting}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-modal-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-modal-submit" disabled={submitting}>
              {submitting ? 'Saving...' : '+ Commit Shipment to Cold Chain'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
