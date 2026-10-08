import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useEffect, useRef, useState } from 'react';
import staffService from '../services/staffService';

export default function AddStaffRequestModal({ isOpen, onClose, onSendRequest, isSubmitting = false }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handleClickOutside(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => deferEffectCallback(() => {
    if (!isOpen) return undefined;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (selected && trimmed === formatCandidate(selected)) {
      setResults([]);
      setShowDropdown(false);
      setSearching(false);
      return undefined;
    }

    if (trimmed.length < 2) {
      setResults([]);
      setShowDropdown(false);
      setSearching(false);
      return undefined;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await staffService.searchCandidates(trimmed, 8);
        setResults(Array.isArray(data) ? data : []);
        setShowDropdown(true);
        setError('');
      } catch (err) {
        setResults([]);
        setShowDropdown(false);
        setError(err.message || 'Failed to search staff.');
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }), [query, isOpen, selected]);

  if (!isOpen) return null;

  const resetForm = () => {
    setQuery('');
    setSelected(null);
    setResults([]);
    setShowDropdown(false);
    setError('');
    setSearching(false);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleSelect = (candidate) => {
    if (candidate.alreadyAffiliated) return;
    setSelected(candidate);
    setQuery(formatCandidate(candidate));
    setShowDropdown(false);
    setError('');
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    setSelected(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const registrationNumber = selected?.registrationNumber?.trim();
    if (!registrationNumber) {
      setError('Search by name, email, or Vaxora ID, then select a practitioner.');
      return;
    }

    if (selected?.alreadyAffiliated) {
      setError('This practitioner is already invited or affiliated with your hospital.');
      return;
    }

    setError('');
    try {
      await onSendRequest(registrationNumber);
      resetForm();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to send invitation.');
    }
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="hospital-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>Add New Staff</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '3px 0 0' }}>
              Search by name, email, or Vaxora ID and invite an approved doctor or nurse
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={handleClose} disabled={isSubmitting}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="modal-form-group" ref={wrapRef} style={{ position: 'relative' }}>
              <label className="modal-label">Name, Email, or Vaxora ID *</label>
              <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onFocus={() => {
                  if (results.length > 0) setShowDropdown(true);
                }}
                placeholder="e.g. Kasun, doctor.demo@vaxora.lk, VAX-D-9001"
                className="modal-input"
                disabled={isSubmitting}
                autoFocus
                autoComplete="off"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                Type at least 2 characters. Select a result, then send the request.
              </span>

              {showDropdown && (
                <div
                  style={{
                    position: 'absolute',
                    zIndex: 20,
                    left: 0,
                    right: 0,
                    top: '100%',
                    marginTop: 4,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border-card)',
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(var(--rgb-primary-dark), 0.12)',
                    maxHeight: 240,
                    overflowY: 'auto',
                  }}
                >
                  {searching && (
                    <div style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                      Searching...
                    </div>
                  )}

                  {!searching && results.length === 0 && (
                    <div style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                      No matching approved doctors or nurses found.
                    </div>
                  )}

                  {!searching &&
                    results.map((candidate) => {
                      const disabled = candidate.alreadyAffiliated;
                      return (
                        <button
                          key={candidate.userId}
                          type="button"
                          onClick={() => handleSelect(candidate)}
                          disabled={disabled}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 12px',
                            border: 'none',
                            borderBottom: '1px solid var(--color-border-light)',
                            background: disabled ? 'var(--color-bg)' : 'var(--color-surface)',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.7 : 1,
                          }}
                        >
                          <div style={{ fontWeight: 700, color: 'var(--color-text-title)', fontSize: '0.9rem' }}>
                            {candidate.fullName}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-body)', marginTop: 2 }}>
                            {candidate.registrationNumber} · {candidate.email} · {candidate.role}
                            {candidate.specialization ? ` · ${candidate.specialization}` : ''}
                          </div>
                          {disabled && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-warning)', marginTop: 2 }}>
                              Already invited or affiliated
                            </div>
                          )}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            {selected && (
              <div
                style={{
                  marginTop: 8,
                  padding: '10px 12px',
                  background: 'var(--color-info-bg)',
                  border: '1px solid var(--color-info-border)',
                  borderRadius: 8,
                  fontSize: '0.85rem',
                  color: 'var(--color-primary-dark)',
                }}
              >
                Selected: <strong>{selected.fullName}</strong> ({selected.registrationNumber})
              </div>
            )}

            {error && (
              <div style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginTop: '8px' }} role="alert">
                {error}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-modal-cancel" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-modal-submit"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              disabled={isSubmitting}
            >
              <span>✉️</span> {isSubmitting ? 'Sending...' : 'Send Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatCandidate(candidate) {
  return `${candidate.fullName} (${candidate.registrationNumber})`;
}
