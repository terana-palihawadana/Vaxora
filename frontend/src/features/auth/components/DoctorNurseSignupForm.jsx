import { useState, useRef } from 'react';
import { IconFile, IconUser } from '../../../shared/icons/AppIcons';

export default function DoctorNurseSignupForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    fullName: '',
    nic: '',
    licenseNumber: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [profilePicFile, setProfilePicFile] = useState(null);
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const [registrationCardFile, setRegistrationCardFile] = useState(null);
  const [error, setError] = useState('');

  const profilePicRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleProfilePicChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setProfilePicFile(file.name);
      setProfilePicPreview(URL.createObjectURL(file));
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setRegistrationCardFile(e.target.files[0].name);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!registrationCardFile) {
      setError('Please upload your Medical Registration Card');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    onSuccess?.({ fullName: formData.fullName });
  };

  return (
    <form onSubmit={handleSubmit} className="auth-form auth-form-scrollable">
      {error && <div style={{ color: 'var(--color-error)', fontSize: '0.85rem', fontWeight: 600 }}>{error}</div>}

      <div className="auth-input-group">
        <input
          type="text"
          name="fullName"
          value={formData.fullName}
          onChange={handleChange}
          placeholder="Full Name"
          required
          className="auth-input"
        />
      </div>

      {/* Profile Picture Upload Field */}
      <div className="auth-input-group">
        <label className="auth-label">Profile Picture (Optional)</label>
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
              <span style={{ display: 'inline-flex' }}><IconUser size={22} /></span>
            )}
            <span>{profilePicFile || 'Upload Profile Picture (JPG/PNG)'}</span>
          </div>
          <span className="file-upload-btn-text">Browse</span>
        </div>
        <input
          ref={profilePicRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          onChange={handleProfilePicChange}
          className="hidden-file-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="text"
          name="nic"
          value={formData.nic}
          onChange={handleChange}
          placeholder="NIC / National ID Number"
          required
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="text"
          name="licenseNumber"
          value={formData.licenseNumber}
          onChange={handleChange}
          placeholder="Medical License Number"
          required
          className="auth-input"
        />
      </div>

      {/* Medical Registration Card Upload */}
      <div className="auth-input-group">
        <label className="auth-label">Medical Registration Card *</label>
        <div
          className="file-upload-box"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="file-upload-info">
            <span style={{ display: 'inline-flex' }}><IconFile size={20} /></span>
            <span>{registrationCardFile || 'Upload Card (PDF/JPG)'}</span>
          </div>
          <span className="file-upload-btn-text">Browse</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileChange}
          className="hidden-file-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="Email"
          required
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          placeholder="Password"
          required
          className="auth-input"
        />
      </div>

      <div className="auth-input-group">
        <input
          type="password"
          name="confirmPassword"
          value={formData.confirmPassword}
          onChange={handleChange}
          placeholder="Confirm Password"
          required
          className="auth-input"
        />
      </div>

      <button type="submit" className="btn-auth-submit">
        Create Doctor/Nurse Account
      </button>
    </form>
  );
}
