import { useState, useRef } from 'react';
import { authService } from '../services/authService';
import { IconFile, IconNurse } from '../../../shared/icons/AppIcons';

export default function NurseSignupForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    fullName: '',
    slncNumber: '',
    phoneNumber: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [profilePicFile, setProfilePicFile] = useState(null);
  const [profilePicName, setProfilePicName] = useState('');
  const [profilePicPreview, setProfilePicPreview] = useState(null);

  const [slncDocFile, setSlncDocFile] = useState(null);
  const [slncDocName, setSlncDocName] = useState('');

  const [supportingDocFile, setSupportingDocFile] = useState(null);
  const [supportingDocName, setSupportingDocName] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const profilePicRef = useRef(null);
  const slncDocRef = useRef(null);
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

  const handleSlncDocChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSlncDocFile(file);
      setSlncDocName(file.name);
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
    if (!slncDocFile) {
      setError('Please upload your Nursing Council (SLNC) Registration Certificate/Card');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = new FormData();
      payload.append('fullName', formData.fullName);
      payload.append('slncNumber', formData.slncNumber);
      payload.append('email', formData.email);
      payload.append('password', formData.password);
      if (formData.phoneNumber) payload.append('phoneNumber', formData.phoneNumber);

      if (profilePicFile) payload.append('profilePhoto', profilePicFile);
      if (slncDocFile) payload.append('slncCertificate', slncDocFile);
      if (supportingDocFile) payload.append('supportingDocument', supportingDocFile);

      const response = await authService.signupNurse(payload);
      onSuccess?.(response);
    } catch (err) {
      setError(err.message || 'Nurse registration failed. Please try again.');
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
        <label className="auth-label">Nurse Profile Picture (Optional)</label>
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
              <span style={{ display: 'inline-flex' }}><IconNurse size={22} /></span>
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
          placeholder="Full Name (e.g. Nurse K. L. Wickramasinghe) *"
          required
          disabled={loading}
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="text"
          name="slncNumber"
          value={formData.slncNumber}
          onChange={handleChange}
          placeholder="SLNC Registration / License Number *"
          required
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
          placeholder="Contact Number"
          disabled={loading}
          className="auth-input"
        />
      </div>

      {/* SLNC Registration Card Upload */}
      <div className="auth-input-group">
        <label className="auth-label">Nursing Council (SLNC) Registration Card *</label>
        <div
          className="file-upload-box"
          onClick={() => slncDocRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="file-upload-info">
            <span style={{ display: 'inline-flex' }}><IconFile size={20} /></span>
            <span>{slncDocName || 'Upload SLNC Certificate (PDF/JPG/PNG)'}</span>
          </div>
          <span className="file-upload-btn-text">Browse</span>
        </div>
        <input
          ref={slncDocRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleSlncDocChange}
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
            <span>{supportingDocName || 'Upload Supporting Letter (PDF/JPG)'}</span>
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
          placeholder="Email Address *"
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
        {loading ? 'Registering...' : 'Register as Nurse'}
      </button>
    </form>
  );
}
