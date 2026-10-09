import { useCallback, useEffect, useRef, useState } from 'react';
import staffService from '../services/staffService';
import inventoryService from '../services/inventoryService';
import { IconDoor } from './HospitalIcons';

const emptyForm = {
  code: '',
  name: '',
  vaccineIds: [],
};

export default function HospitalBoothsPanel() {
  const [booths, setBooths] = useState([]);
  const [vaccines, setVaccines] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef(null);

  const showToast = (message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const readBooths = useCallback(async () => {
    const [data, formulary] = await Promise.all([
      staffService.getHospitalBooths(),
      inventoryService.getFormulary().catch(() => []),
    ]);
    const boothList = Array.isArray(data) ? data : [];
    const options = Array.isArray(formulary)
      ? formulary
          .map((entry) => ({
            id: entry.vaccineId || entry.VaccineId,
            name: entry.vaccineName || entry.VaccineName,
          }))
          .filter((entry) => entry.id && entry.name)
      : [];
    return { boothList, options };
  }, []);

  const loadBooths = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { boothList, options } = await readBooths();
      setBooths(boothList);
      setVaccines(options);
    } catch (err) {
      setError(err.message || 'Failed to load booths.');
      setBooths([]);
    } finally {
      setLoading(false);
    }
  }, [readBooths]);

  useEffect(() => {
    let cancelled = false;
    readBooths()
      .then(({ boothList, options }) => {
        if (cancelled) return;
        setBooths(boothList);
        setVaccines(options);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load booths.');
        setBooths([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readBooths]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const beginEdit = (booth) => {
    setEditingId(booth.boothId);
    setForm({
      code: booth.code || '',
      name: booth.name || '',
      vaccineIds: Array.isArray(booth.vaccineIds) ? booth.vaccineIds : [],
    });
    setError('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      setError('Code and name are required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (editingId) {
        const current = booths.find((b) => b.boothId === editingId);
        await staffService.updateHospitalBooth(editingId, {
          code: form.code.trim(),
          name: form.name.trim(),
          isActive: current?.isActive !== false,
          sortOrder: current?.sortOrder,
          vaccineIds: form.vaccineIds,
        });
        showToast('Booth updated.');
      } else {
        await staffService.createHospitalBooth({
          code: form.code.trim(),
          name: form.name.trim(),
          vaccineIds: form.vaccineIds,
        });
        showToast('Booth created.');
      }
      resetForm();
      await loadBooths();
    } catch (err) {
      setError(err.message || 'Failed to save booth.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (booth) => {
    setActionId(booth.boothId);
    setError('');
    try {
      if (booth.isActive) {
        await staffService.deactivateHospitalBooth(booth.boothId);
        showToast('Booth deactivated.');
      } else {
        await staffService.updateHospitalBooth(booth.boothId, {
          code: booth.code,
          name: booth.name,
          isActive: true,
          sortOrder: booth.sortOrder,
          vaccineIds: booth.vaccineIds || [],
        });
        showToast('Booth reactivated.');
      }
      await loadBooths();
    } catch (err) {
      setError(err.message || 'Failed to update booth status.');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div>
      {toast && (
        <div className="appointment-alert-pill" role="status" style={{ marginBottom: '16px' }}>
          {toast}
        </div>
      )}
      {error && (
        <div
          className="appointment-alert-pill"
          role="alert"
          style={{ marginBottom: '16px', background: 'var(--color-error-bg)', color: 'var(--color-error)', borderColor: 'var(--color-error-border)' }}
        >
          {error}
        </div>
      )}

      <div className="hospital-section-card" style={{ marginBottom: '20px' }}>
        <div className="section-title-group" style={{ marginBottom: '14px' }}>
          <h2 style={{ margin: 0 }}>
            <span className="section-title-icon"><IconDoor size={22} /></span> Vaccination Booths
          </h2>
          <p className="section-title-desc">
            Each booth lists the vaccines it gives. Bookings for those vaccines open that booth.
          </p>
        </div>

        <form onSubmit={handleSave} style={{ display: 'grid', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <div className="modal-form-group" style={{ margin: 0 }}>
              <label className="modal-label">Code *</label>
              <input
                type="text"
                className="modal-input"
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="B01"
                maxLength={20}
                required
              />
            </div>
            <div className="modal-form-group" style={{ margin: 0 }}>
              <label className="modal-label">Name *</label>
              <input
                type="text"
                className="modal-input"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Adult Immunization"
                maxLength={100}
                required
              />
            </div>
          </div>

          <div className="modal-form-group" style={{ margin: 0 }}>
            <label className="modal-label">Vaccines this booth gives</label>
            {vaccines.length === 0 ? (
              <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                Register vaccines under Inventory before assigning them here.
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                {vaccines.map((vaccine) => {
                  const checked = form.vaccineIds.includes(vaccine.id);
                  return (
                    <label
                      key={vaccine.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 10px',
                        borderRadius: '999px',
                        border: `1px solid ${checked ? 'var(--color-info-border)' : 'var(--color-border-light)'}`,
                        background: checked ? 'var(--color-info-bg)' : 'var(--color-surface)',
                        fontSize: '0.82rem',
                        color: 'var(--color-text-title)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setForm((prev) => ({
                            ...prev,
                            vaccineIds: checked
                              ? prev.vaccineIds.filter((id) => id !== vaccine.id)
                              : [...prev.vaccineIds, vaccine.id],
                          }))
                        }
                      />
                      {vaccine.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '8px 16px',
                fontSize: '0.88rem',
                fontWeight: 700,
                color: 'var(--color-text-inverse)',
                background: 'var(--color-primary)',
                border: '1px solid var(--color-primary)',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Booth'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                style={{
                  padding: '8px 16px',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  color: 'var(--color-text-body)',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border-card)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={loadBooths}
              disabled={loading}
              style={{
                padding: '8px 16px',
                fontSize: '0.88rem',
                fontWeight: 600,
                color: 'var(--color-text-body)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border-card)',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          </div>
        </form>
      </div>

      {loading ? (
        <div className="hospital-section-card" style={{ maxWidth: '420px' }}>
          <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>Loading booths...</p>
        </div>
      ) : booths.length === 0 ? (
        <div className="hospital-section-card" style={{ maxWidth: '420px' }}>
          <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
            No booths yet. Use the form above to add one.
          </p>
        </div>
      ) : (
        <div className="booths-grid">
          {booths.map((booth) => (
            <div
              key={booth.boothId}
              className="booth-card"
              style={{ opacity: booth.isActive ? 1 : 0.72 }}
            >
              <div className="booth-card-header">
                <div className="booth-title-box">
                  <span className="booth-number-tag">{booth.code}</span>
                  <span className="booth-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {booth.name}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`Edit ${booth.code}`}
                  title="Edit"
                  onClick={() => beginEdit(booth)}
                  disabled={actionId === booth.boothId}
                  style={{
                    flexShrink: 0,
                    width: '28px',
                    height: '28px',
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-text-placeholder)',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                    <path d="M13.5 6.5l3 3" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                </button>
              </div>

              <hr className="booth-card-divider" />

              <div className="booth-card-vaccines">
                {Array.isArray(booth.vaccineNames) && booth.vaccineNames.length > 0 ? (
                  booth.vaccineNames.map((name) => (
                    <span key={name} className="booth-vaccine-chip">{name}</span>
                  ))
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-text-placeholder)' }}>No vaccines assigned</span>
                )}
              </div>

              <div className="booth-card-footer">
                <span
                  className="booth-status-indicator"
                  style={{ color: booth.isActive ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: booth.isActive ? 'var(--color-success)' : 'var(--color-text-placeholder)',
                      display: 'inline-block',
                    }}
                  />
                  {booth.isActive ? 'Active' : 'Inactive'}
                </span>
                <button
                  type="button"
                  onClick={() => handleToggleActive(booth)}
                  disabled={actionId === booth.boothId}
                  style={{
                    padding: '4px 2px',
                    border: 'none',
                    background: 'transparent',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: booth.isActive ? 'var(--color-error)' : 'var(--color-success)',
                  }}
                >
                  {actionId === booth.boothId
                    ? 'Updating...'
                    : booth.isActive
                      ? 'Deactivate'
                      : 'Restore'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
