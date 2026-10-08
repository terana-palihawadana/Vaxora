import { useState, useRef } from 'react';
import { authService } from '../services/authService';
import { IconFile, IconHospital } from '../../../shared/icons/AppIcons';

const SRI_LANKA_PROVINCES = [
  {
    province: 'Western Province',
    districts: ['Colombo', 'Gampaha', 'Kalutara'],
  },
  {
    province: 'Central Province',
    districts: ['Kandy', 'Matale', 'Nuwara Eliya'],
  },
  {
    province: 'Southern Province',
    districts: ['Galle', 'Matara', 'Hambantota'],
  },
  {
    province: 'Northern Province',
    districts: ['Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu'],
  },
  {
    province: 'Eastern Province',
    districts: ['Batticaloa', 'Ampara', 'Trincomalee'],
  },
  {
    province: 'North Western Province',
    districts: ['Kurunegala', 'Puttalam'],
  },
  {
    province: 'North Central Province',
    districts: ['Anuradhapura', 'Polonnaruwa'],
  },
  {
    province: 'Uva Province',
    districts: ['Badulla', 'Monaragala'],
  },
  {
    province: 'Sabaragamuwa Province',
    districts: ['Ratnapura', 'Kegalle'],
  },
];

const DISTRICT_TO_PROVINCE = {};
SRI_LANKA_PROVINCES.forEach((p) => {
  p.districts.forEach((d) => {
    DISTRICT_TO_PROVINCE[d] = p.province;
  });
});

export default function HospitalSignupForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    hospitalName: '',
    registrationNumber: '',
    type: 'Government',
    operatingHoursType: '24hrs',
    openingTime: '08:00',
    closingTime: '18:00',
    officialEmail: '',
    contactNumber: '',
    address: '',
    district: '',
    province: '',
    password: '',
    confirmPassword: '',
  });

  const [hospitalLogoFile, setHospitalLogoFile] = useState(null);
  const [logoName, setLogoName] = useState('');
  const [logoPreview, setLogoPreview] = useState(null);

  const [registrationProofFile, setRegistrationProofFile] = useState(null);
  const [regProofName, setRegProofName] = useState('');

  const [addressProofFile, setAddressProofFile] = useState(null);
  const [addrProofName, setAddrProofName] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const logoRef = useRef(null);
  const regProofRef = useRef(null);
  const addrProofRef = useRef(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleProvinceChange = (e) => {
    const selectedProvince = e.target.value;
    if (!selectedProvince) {
      setFormData((prev) => ({ ...prev, province: '', district: '' }));
      setError('');
      return;
    }
    setFormData((prev) => {
      const allowedDistricts = SRI_LANKA_PROVINCES.find((p) => p.province === selectedProvince)?.districts || [];
      const keepDistrict = allowedDistricts.includes(prev.district) ? prev.district : '';
      return {
        ...prev,
        province: selectedProvince,
        district: keepDistrict,
      };
    });
    setError('');
  };

  const handleDistrictChange = (e) => {
    const selectedDistrict = e.target.value;
    if (!selectedDistrict) {
      setFormData((prev) => ({ ...prev, district: '' }));
      setError('');
      return;
    }
    const matchingProvince = DISTRICT_TO_PROVINCE[selectedDistrict] || '';
    setFormData((prev) => ({
      ...prev,
      district: selectedDistrict,
      province: matchingProvince,
    }));
    setError('');
  };

  const handleLogoChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setHospitalLogoFile(file);
      setLogoName(file.name);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleRegFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setRegistrationProofFile(file);
      setRegProofName(file.name);
    }
  };

  const handleAddrFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAddressProofFile(file);
      setAddrProofName(file.name);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.province) {
      setError('Please select a Province');
      return;
    }
    if (!formData.district) {
      setError('Please select a District');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (!registrationProofFile) {
      setError('Please upload Hospital Registration Proof');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = new FormData();
      payload.append('hospitalName', formData.hospitalName);
      payload.append('registrationNumber', formData.registrationNumber || `HOSP-${Date.now().toString().slice(-6)}`);
      payload.append('hospitalType', formData.type);
      payload.append('address', formData.address);
      payload.append('district', formData.district);
      payload.append('province', formData.province);
      payload.append('contactNumber', formData.contactNumber);
      payload.append('email', formData.officialEmail);
      payload.append('password', formData.password);

      if (hospitalLogoFile) payload.append('logo', hospitalLogoFile);
      if (registrationProofFile) payload.append('registrationCertificate', registrationProofFile);
      if (addressProofFile) payload.append('mohDocument', addressProofFile);

      const response = await authService.signupHospital(payload);
      onSuccess?.(response);
    } catch (err) {
      setError(err.message || 'Hospital registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="auth-form auth-form-scrollable">
      {error && (
        <div style={{ 
          backgroundColor: 'rgba(var(--rgb-error), 0.1)', 
          color: 'var(--color-error)', 
          padding: '10px 14px', 
          borderRadius: '8px', 
          fontSize: '0.85rem', 
          fontWeight: 600,
          border: '1px solid rgba(var(--rgb-error), 0.2)' 
        }}>
          {error}
        </div>
      )}

      {/* Hospital Logo Upload Field (at top) */}
      <div className="auth-input-group">
        <label className="auth-label">Hospital Logo (Optional)</label>
        <div
          className="file-upload-box"
          onClick={() => logoRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="file-upload-info">
            {logoPreview ? (
              <img
                src={logoPreview}
                alt="Logo preview"
                className="file-upload-thumb"
                style={{ borderRadius: '6px' }}
              />
            ) : (
              <span style={{ display: 'inline-flex' }}><IconHospital size={22} /></span>
            )}
            <span>{logoName || 'Upload Hospital Logo (JPG/PNG)'}</span>
          </div>
          <span className="file-upload-btn-text">Browse</span>
        </div>
        <input
          ref={logoRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
          onChange={handleLogoChange}
          disabled={loading}
          className="hidden-file-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="text"
          name="hospitalName"
          value={formData.hospitalName}
          onChange={handleChange}
          placeholder="Hospital / Medical Institution Name *"
          required
          disabled={loading}
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="text"
          name="registrationNumber"
          value={formData.registrationNumber}
          onChange={handleChange}
          placeholder="MOH / PHSRC Registration Number *"
          required
          disabled={loading}
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <label className="auth-label">Hospital Type</label>
        <select
          name="type"
          value={formData.type}
          onChange={handleChange}
          disabled={loading}
          className="auth-select"
        >
          <option value="Government">Government / Base Hospital</option>
          <option value="Private">Private Hospital / Center</option>
          <option value="MOH">MOH Office / Immunization Clinic</option>
        </select>
      </div>

      <div className="auth-input-group">
        <input
          type="email"
          name="officialEmail"
          value={formData.officialEmail}
          onChange={handleChange}
          placeholder="Official Administration Email *"
          required
          disabled={loading}
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="tel"
          name="contactNumber"
          value={formData.contactNumber}
          onChange={handleChange}
          placeholder="Official Contact Phone Number *"
          required
          disabled={loading}
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="text"
          name="address"
          value={formData.address}
          onChange={handleChange}
          placeholder="Complete Hospital Address *"
          required
          disabled={loading}
          className="auth-input"
        />
      </div>

      {(() => {
        const availableProvinces = formData.district
          ? SRI_LANKA_PROVINCES.filter((p) => p.province === DISTRICT_TO_PROVINCE[formData.district])
          : SRI_LANKA_PROVINCES;

        const availableDistricts = formData.province
          ? (SRI_LANKA_PROVINCES.find((p) => p.province === formData.province)?.districts || [])
          : SRI_LANKA_PROVINCES.flatMap((p) => p.districts);

        return (
          <div className="auth-grid-2col">
            <div className="auth-input-group">
              <label className="auth-label" style={{ fontSize: '0.82rem', color: 'var(--color-text-body)', fontWeight: 600 }}>
                Province *
              </label>
              <select
                name="province"
                value={formData.province}
                onChange={handleProvinceChange}
                required
                disabled={loading}
                className="auth-select"
              >
                <option value="">{formData.district ? 'All Provinces (Reset)' : 'Select Province'}</option>
                {availableProvinces.map((p) => (
                  <option key={p.province} value={p.province}>
                    {p.province}
                  </option>
                ))}
              </select>
            </div>

            <div className="auth-input-group">
              <label className="auth-label" style={{ fontSize: '0.82rem', color: 'var(--color-text-body)', fontWeight: 600 }}>
                District *
              </label>
              <select
                name="district"
                value={formData.district}
                onChange={handleDistrictChange}
                required
                disabled={loading}
                className="auth-select"
              >
                <option value="">Select District</option>
                {availableDistricts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })()}

      {/* Registration Proof */}
      <div className="auth-input-group">
        <label className="auth-label">Hospital Registration Certificate *</label>
        <div
          className="file-upload-box"
          onClick={() => regProofRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="file-upload-info">
            <span style={{ display: 'inline-flex' }}><IconFile size={20} /></span>
            <span>{regProofName || 'Upload Registration Certificate (PDF/JPG)'}</span>
          </div>
          <span className="file-upload-btn-text">Browse</span>
        </div>
        <input
          ref={regProofRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleRegFileChange}
          disabled={loading}
          className="hidden-file-input"
        />
      </div>

      {/* Address Proof / MOH Document */}
      <div className="auth-input-group">
        <label className="auth-label">MOH Affiliation / Hospital Document (Optional)</label>
        <div
          className="file-upload-box"
          onClick={() => addrProofRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="file-upload-info">
            <span style={{ display: 'inline-flex' }}><IconFile size={20} /></span>
            <span>{addrProofName || 'Upload MOH / Hospital Letter (PDF/JPG)'}</span>
          </div>
          <span className="file-upload-btn-text">Browse</span>
        </div>
        <input
          ref={addrProofRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleAddrFileChange}
          disabled={loading}
          className="hidden-file-input"
        />
      </div>

      <div className="auth-input-group">
        <div className="password-input-container">
          <input
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="Password (Min 6 characters) *"
            required
            disabled={loading}
            className="auth-input"
          />
          <button
            type="button"
            className="btn-password-toggle"
            onClick={() => setShowPassword((prev) => !prev)}
            tabIndex={-1}
            title={showPassword ? 'Hide password' : 'Show password'}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="auth-input-group">
        <div className="password-input-container">
          <input
            type={showConfirmPassword ? 'text' : 'password'}
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
            placeholder="Confirm Password *"
            required
            disabled={loading}
            className="auth-input"
          />
          <button
            type="button"
            className="btn-password-toggle"
            onClick={() => setShowConfirmPassword((prev) => !prev)}
            tabIndex={-1}
            title={showConfirmPassword ? 'Hide password' : 'Show password'}
            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
          >
            {showConfirmPassword ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <button type="submit" className="btn-auth-submit" disabled={loading}>
        {loading ? 'Registering...' : 'Register as Hospital'}
      </button>
    </form>
  );
}
