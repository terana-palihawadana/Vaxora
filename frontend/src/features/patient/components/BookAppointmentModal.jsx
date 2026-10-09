import { useState } from 'react';
import { IconClose, IconSyringe } from '../../../shared/icons/AppIcons';

export default function BookAppointmentModal({ isOpen, onClose, onBookSuccess }) {
  const [formData, setFormData] = useState({
    vaccine: 'COVID-19 mRNA Booster (Moderna)',
    hospital: 'National Hospital of Sri Lanka',
    date: '2026-10-18',
    timeSlot: '10:30 AM - 11:00 AM',
    notes: '',
  });

  const [isSubmitted, setIsSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsSubmitted(true);
    setTimeout(() => {
      onBookSuccess?.(formData);
      setIsSubmitted(false);
      onClose();
    }, 1500);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="icon-shade icon-shade-blue"><IconSyringe size={20} /></span>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-title)', margin: 0 }}>
              Schedule Vaccination
            </h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>

        {isSubmitted ? (
          <div style={{ textAlign: 'center', padding: '30px 10px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>✅</div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--color-text-title)', marginBottom: '6px' }}>
              Appointment Reserved!
            </h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.92rem' }}>
              Your vaccination slot for <strong>{formData.vaccine}</strong> at{' '}
              <strong>{formData.hospital}</strong> on <strong>{formData.date}</strong> has been confirmed.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="auth-input-group">
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-title)', marginBottom: '4px', display: 'block' }}>
                Vaccine Type *
              </label>
              <select
                name="vaccine"
                value={formData.vaccine}
                onChange={handleChange}
                className="auth-input"
                required
              >
                <option value="COVID-19 mRNA Booster (Moderna)">COVID-19 mRNA Booster (Moderna Spikevax)</option>
                <option value="COVID-19 mRNA (Pfizer-BioNTech)">COVID-19 mRNA (Pfizer-BioNTech Comirnaty)</option>
                <option value="Influenza (Quadrivalent 2026)">Influenza (Quadrivalent Seasonal 2026)</option>
                <option value="Hepatitis B (Recombinant)">Hepatitis B (Recombinant 3-Dose)</option>
                <option value="Tetanus, Reduced Diphtheria (Td)">Tetanus, Reduced Diphtheria (Td)</option>
                <option value="HPV 9-Valent (Gardasil 9)">HPV 9-Valent (Gardasil 9)</option>
                <option value="Yellow Fever International">Yellow Fever (Stamaril - Travel Required)</option>
              </select>
            </div>

            <div className="auth-input-group">
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-title)', marginBottom: '4px', display: 'block' }}>
                Vaccination Center / Hospital *
              </label>
              <select
                name="hospital"
                value={formData.hospital}
                onChange={handleChange}
                className="auth-input"
                required
              >
                <option value="National Hospital of Sri Lanka">National Hospital of Sri Lanka (Colombo 07)</option>
                <option value="Asiri Central Hospital">Asiri Central Hospital (Colombo 10)</option>
                <option value="The Lanka Hospitals">The Lanka Hospitals (Colombo 05)</option>
                <option value="Durdans Hospital">Durdans Hospital (Colombo 03)</option>
                <option value="Teaching Hospital Kandy">Teaching Hospital Kandy</option>
                <option value="Karapitiya Teaching Hospital Galle">Karapitiya Teaching Hospital Galle</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="auth-input-group">
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-title)', marginBottom: '4px', display: 'block' }}>
                  Preferred Date *
                </label>
                <input
                  type="date"
                  name="date"
                  value={formData.date}
                  onChange={handleChange}
                  min="2026-09-08"
                  className="auth-input"
                  required
                />
              </div>

              <div className="auth-input-group">
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-title)', marginBottom: '4px', display: 'block' }}>
                  Time Slot *
                </label>
                <select
                  name="timeSlot"
                  value={formData.timeSlot}
                  onChange={handleChange}
                  className="auth-input"
                  required
                >
                  <option value="09:00 AM - 09:30 AM">09:00 AM - 09:30 AM</option>
                  <option value="10:30 AM - 11:00 AM">10:30 AM - 11:00 AM</option>
                  <option value="02:00 PM - 02:30 PM">02:00 PM - 02:30 PM</option>
                  <option value="03:30 PM - 04:00 PM">03:30 PM - 04:00 PM</option>
                </select>
              </div>
            </div>

            <div className="auth-input-group">
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-title)', marginBottom: '4px', display: 'block' }}>
                Allergies or Medical Notes (Optional)
              </label>
              <input
                type="text"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="e.g. Allergy to penicillin, mild asthma"
                className="auth-input"
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
              <button type="submit" className="btn-auth-submit" style={{ flex: 1 }}>
                Confirm Booking
              </button>
              <button
                type="button"
                className="btn-outline-action"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
