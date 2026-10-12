import { useState } from 'react';

function formFor(batch) {
  return {
    lotNumber: '',
    quantity: batch?.capacity ? String(batch.capacity) : '',
    expiryDate: '',
    storageUnit: '',
  };
}

// Confirms a delivery against an on-order row: the real lot number, expiry and
// quantity are only known once the vials are in hand.
export default function ReceiveOrderModal({ batch, onClose, onReceive }) {
  const [formData, setFormData] = useState(() => formFor(batch));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset whenever a different order is opened (adjusted during render, not in an effect).
  const [shownId, setShownId] = useState(batch?.id);
  if ((batch?.id ?? null) !== (shownId ?? null)) {
    setShownId(batch?.id);
    setSubmitting(false);
    setError('');
    setFormData(formFor(batch));
  }

  if (!batch) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.lotNumber.trim() || !String(formData.quantity).trim() || !formData.expiryDate) {
      setError('Please fill the lot number, quantity and expiry date.');
      return;
    }
    if (!formData.storageUnit) {
      setError('Please select a cold vault.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onReceive(batch, {
        lotNumber: formData.lotNumber.trim(),
        quantity: parseInt(formData.quantity, 10),
        expiryDate: formData.expiryDate,
        storageUnit: formData.storageUnit,
      });
      onClose();
    } catch (err) {
      // Keep values so the user can fix and retry.
      setError(err?.message || 'Failed to receive the delivery.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onClose}>
      <div className="hospital-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>Receive delivery</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              {batch.name} · {batch.capacity} vials ordered · {batch.lotNumber}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={submitting}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="modal-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="modal-form-group">
                <label className="modal-label" htmlFor="receive-lot-number">Batch / lot number *</label>
                <input
                  id="receive-lot-number"
                  type="text"
                  name="lotNumber"
                  value={formData.lotNumber}
                  onChange={handleChange}
                  placeholder="e.g. PF-9921"
                  required
                  className="modal-input"
                  disabled={submitting}
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <div className="modal-form-group">
                <label className="modal-label" htmlFor="receive-quantity">Quantity received (vials) *</label>
                <input
                  id="receive-quantity"
                  type="number"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleChange}
                  min="1"
                  required
                  className="modal-input"
                  disabled={submitting}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="modal-form-group">
                <label className="modal-label" htmlFor="receive-expiry">Expiry date *</label>
                <input
                  id="receive-expiry"
                  type="date"
                  name="expiryDate"
                  value={formData.expiryDate}
                  onChange={handleChange}
                  required
                  className="modal-input"
                  disabled={submitting}
                />
              </div>
              <div className="modal-form-group">
                <label className="modal-label" htmlFor="receive-vault">Assigned cold vault *</label>
                <select
                  id="receive-vault"
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
            <button type="submit" className="btn-modal-submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Add to stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
