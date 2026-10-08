import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useEffect, useMemo, useState } from 'react';

const FALLBACK_VACCINES = [
  'Pfizer-BioNTech Bivalent',
  'Moderna Spikevax',
  'Influenza Quadrivalent',
  'Hepatitis B Recombinant',
  'MMR (Measles, Mumps, Rubella)',
  'Tdap (Tetanus, Diphtheria, Pertussis)',
];

const DOSE_OPTIONS = [
  'Dose 1 (Primary)',
  'Dose 2 (Primary)',
  'Booster Dose (3)',
  'Annual Booster',
];

const EMPTY_FORM = {
  patientName: '',
  nic: '',
  email: '',
  phone: '',
  gender: 'Male',
  age: '',
  vaccine: '',
  dose: DOSE_OPTIONS[0],
  assignedBooth: '',
};

export default function WalkInRegistrationModal({
  isOpen,
  onClose,
  onAddPatient,
  vaccines,
  vaccinePrices,
  booths,
}) {
  const vaccineOptions = useMemo(
    () => vaccines?.length > 0 ? vaccines : FALLBACK_VACCINES,
    [vaccines]
  );
  const [formData, setFormData] = useState({
    ...EMPTY_FORM,
    vaccine: vaccineOptions[0] || '',
  });

  // Only offer booths that stock the chosen vaccine (all booths when none list it).
  // "Auto" (empty value) lets the server pick a staffed booth with the shortest queue.
  const boothOptions = useMemo(() => {
    const list = Array.isArray(booths) ? booths : [];
    const wanted = String(formData.vaccine || '').trim().toLowerCase();
    const offering = list.filter((booth) =>
      (booth.vaccineNames || []).some((name) => {
        const value = String(name || '').trim().toLowerCase();
        return value && (value === wanted || value.includes(wanted) || wanted.includes(value));
      })
    );
    return offering.length > 0 ? offering : list;
  }, [booths, formData.vaccine]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => deferEffectCallback(() => {
    if (!isOpen) return;
    setError('');
    setFormData({
      ...EMPTY_FORM,
      vaccine: vaccineOptions[0] || '',
      dose: DOSE_OPTIONS[0],
    });
  }), [isOpen, vaccineOptions]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    // A new vaccine may not be offered at the previously chosen booth.
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'vaccine' ? { assignedBooth: '' } : {}),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.patientName || !formData.nic || !formData.email || !formData.phone || submitting) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onAddPatient({
        patientName: formData.patientName.trim(),
        patientNic: formData.nic.trim(),
        patientEmail: formData.email.trim(),
        patientPhone: formData.phone.trim(),
        vaccineName: formData.vaccine,
        dose: formData.dose,
        boothLabel: formData.assignedBooth || null,
        age: formData.age ? Number(formData.age) : null,
        gender: formData.gender,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to register walk-in patient.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="hospital-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Register Walk-In Patient</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div
                role="alert"
                style={{
                  marginBottom: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid #ef4444',
                  color: '#b91c1c',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                {error}
              </div>
            )}

            <div className="modal-form-group">
              <label className="modal-label">Full Name *</label>
              <input
                type="text"
                name="patientName"
                value={formData.patientName}
                onChange={handleChange}
                placeholder="e.g. Kasun Chamara"
                required
                className="modal-input"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="modal-form-group">
                <label className="modal-label">NIC / National ID *</label>
                <input
                  type="text"
                  name="nic"
                  value={formData.nic}
                  onChange={handleChange}
                  placeholder="Patient NIC"
                  required
                  className="modal-input"
                />
                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                  Matches an existing account by NIC, or creates one with the email/phone below.
                </p>
              </div>

              <div className="modal-form-group">
                <label className="modal-label">Age / Gender</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <input
                    type="number"
                    name="age"
                    value={formData.age}
                    onChange={handleChange}
                    placeholder="Age"
                    className="modal-input"
                  />
                  <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleChange}
                    className="modal-select"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="modal-form-group">
                <label className="modal-label">Email *</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="patient@email.com"
                  required
                  className="modal-input"
                />
                <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                  For new guest accounts only: this is their login email, and the default password is their NIC.
                </p>
              </div>
              <div className="modal-form-group">
                <label className="modal-label">Phone *</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="07XXXXXXXX"
                  required
                  className="modal-input"
                />
              </div>
            </div>

            <div className="modal-form-group">
              <label className="modal-label">Vaccine Formulation</label>
              <select
                name="vaccine"
                value={formData.vaccine}
                onChange={handleChange}
                className="modal-select"
              >
                {vaccineOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {vaccinePrices?.[formData.vaccine] ? (
                <span style={{ display: 'block', marginTop: 4, fontSize: '0.75rem', color: '#64748b' }}>
                  Fee: {vaccinePrices[formData.vaccine]}
                  {vaccinePrices[formData.vaccine] !== 'Free' ? ' — collect at the desk (Mark paid)' : ''}
                </span>
              ) : null}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="modal-form-group">
                <label className="modal-label">Dose Sequence</label>
                <select
                  name="dose"
                  value={formData.dose}
                  onChange={handleChange}
                  className="modal-select"
                >
                  {DOSE_OPTIONS.map((dose) => (
                    <option key={dose} value={dose}>{dose}</option>
                  ))}
                </select>
              </div>

              <div className="modal-form-group">
                <label className="modal-label">Assign to Booth</label>
                <select
                  name="assignedBooth"
                  value={formData.assignedBooth}
                  onChange={handleChange}
                  className="modal-select"
                >
                  <option value="">Auto — best booth for this vaccine</option>
                  {boothOptions.map((booth) => (
                    <option key={booth.id} value={booth.label}>{booth.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <span style={{ display: 'block', marginTop: 6, fontSize: '0.75rem', color: '#64748b' }}>
              A doctor prescribes the dosage at the booth. Only booths offering this vaccine are listed.
            </span>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-modal-cancel" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-modal-submit" disabled={submitting}>
              {submitting ? 'Saving...' : '+ Enqueue Walk-In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
