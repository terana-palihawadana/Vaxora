import { useState, useRef } from 'react';
import { authService } from '../services/authService';
import { IconDoctor, IconFile } from '../../../shared/icons/AppIcons';

export default function DoctorSignupForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    fullName: '',
    slmcNumber: '',
    phoneNumber: '',
    specialization: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [profilePicFile, setProfilePicFile] = useState(null);
  const [profilePicName, setProfilePicName] = useState('');
  const [profilePicPreview, setProfilePicPreview] = useState(null);

  const [slmcDocFile, setSlmcDocFile] = useState(null);
  const [slmcDocName, setSlmcDocName] = useState('');

  const [supportingDocFile, setSupportingDocFile] = useState(null);
  const [supportingDocName, setSupportingDocName] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const profilePicRef = useRef(null);
  const slmcDocRef = useRef(null);
  const supportingDocRef = useRef(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleProfilePicChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setProfilePicFile(file);
      setProfilePicName(file.name);
      setProfilePicPreview(URL.createObjectURL(file));
    }
  };

  const handleSlmcDocChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSlmcDocFile(file);
      setSlmcDocName(file.name);
    }
  };

  const handleSupportingDocChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSupportingDocFile(file);
      setSupportingDocName(file.name);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (!slmcDocFile) {
      setError('Please upload your Medical Council (SLMC) Registration Certificate/Card');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = new FormData();
      payload.append('fullName', formData.fullName);
      payload.append('slmcNumber', formData.slmcNumber);
      payload.append('email', formData.email);
      payload.append('password', formData.password);
      if (formData.phoneNumber) payload.append('phoneNumber', formData.phoneNumber);
      if (formData.specialization) payload.append('specialization', formData.specialization);

      if (profilePicFile) payload.append('profilePhoto', profilePicFile);
      if (slmcDocFile) payload.append('slmcCertificate', slmcDocFile);
      if (supportingDocFile) payload.append('supportingDocument', supportingDocFile);

      const response = await authService.signupDoctor(payload);
      onSuccess?.(response);
    } catch (err) {
      setError(err.message || 'Doctor registration failed. Please try again.');
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

      {/* Profile Picture Upload (at top) */}
      <div className="auth-input-group">
        <label className="auth-label">Doctor Profile Picture (Optional)</label>
        <div
          className="file-upload-box"
          onClick={() => profilePicRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="file-upload-info">
            {profilePicPreview ? (
              <img src={profilePicPreview} alt="Preview" className="file-upload-thumb" />
            ) : (
              <span style={{ display: 'inline-flex' }}><IconDoctor size={22} /></span>
            )}
            <span>{profilePicName || 'Upload Profile Photo (JPG/PNG)'}</span>
          </div>
          <span className="file-upload-btn-text">Browse</span>
        </div>
        <input
          ref={profilePicRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          onChange={handleProfilePicChange}
          disabled={loading}
          className="hidden-file-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="text"
          name="fullName"
          value={formData.fullName}
          onChange={handleChange}
          placeholder="Full Name (e.g., Dr. Samantha Perera) *"
          required
          disabled={loading}
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="text"
          name="slmcNumber"
          value={formData.slmcNumber}
          onChange={handleChange}
          placeholder="SLMC Registration Number *"
          required
          disabled={loading}
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="text"
          name="specialization"
          value={formData.specialization}
          onChange={handleChange}
          placeholder="Specialization (e.g. Pediatrics, General)"
          disabled={loading}
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="tel"
          name="phoneNumber"
          value={formData.phoneNumber}
          onChange={handleChange}
          placeholder="Direct Phone Number"
          disabled={loading}
          className="auth-input"
        />
      </div>

      {/* SLMC Registration Document Upload */}
      <div className="auth-input-group">
        <label className="auth-label">SLMC Registration Certificate / ID *</label>
        <div
          className="file-upload-box"
          onClick={() => slmcDocRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="file-upload-info">
            <span style={{ display: 'inline-flex' }}><IconFile size={20} /></span>
            <span>{slmcDocName || 'Upload SLMC Certificate (PDF/JPG/PNG)'}</span>
          </div>
          <span className="file-upload-btn-text">Browse</span>
        </div>
        <input
          ref={slmcDocRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleSlmcDocChange}
          disabled={loading}
          className="hidden-file-input"
        />
      </div>

      {/* Supporting Document Upload */}
      <div className="auth-input-group">
        <label className="auth-label">Supporting Documents (Optional)</label>
        <div
          className="file-upload-box"
          onClick={() => supportingDocRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="file-upload-info">
            <span style={{ display: 'inline-flex' }}><IconFile size={20} /></span>
            <span>{supportingDocName || 'Upload Additional Proof (PDF/JPG)'}</span>
          </div>
          <span className="file-upload-btn-text">Browse</span>
        </div>
        <input
          ref={supportingDocRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleSupportingDocChange}
          disabled={loading}
          className="hidden-file-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="Professional Email Address *"
          required
          disabled={loading}
          className="auth-input"
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
        {loading ? 'Registering...' : 'Register as Doctor'}
      </button>
    </form>
  );
}
