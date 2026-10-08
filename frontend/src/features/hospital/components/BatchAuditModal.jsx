import { useEffect, useState } from 'react';
import inventoryService from '../services/inventoryService';
import { IconFile, IconPackage } from './HospitalIcons';

export default function BatchAuditModal({ isOpen, onClose, vaccine }) {
  const [auditEntries, setAuditEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !vaccine?.id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await inventoryService.getBatchAudit(vaccine.id);
        if (!cancelled) setAuditEntries(data.entries || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load audit trail.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, vaccine?.id]);

  if (!isOpen || !vaccine) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="hospital-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px' }}>
        <div className="modal-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ display: 'inline-flex', color: 'var(--color-text-body)' }}><IconPackage size={22} /></span>
              <h3 style={{ margin: 0 }}>Batch Audit &amp; Traceability Ledger</h3>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.86rem', color: 'var(--color-text-muted)' }}>
              Lot Tracking &bull; <strong style={{ color: 'var(--color-text-title)' }}>{vaccine.lotNumber}</strong> &bull; {vaccine.name}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {/* Quick Stats Banner */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', padding: '16px', background: 'var(--color-bg)', border: '1px solid var(--color-border-light)', borderRadius: '12px', marginBottom: '20px' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block' }}>Current In-Stock</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-title)' }}>
                {vaccine.available} <small style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>/ {vaccine.capacity} vials</small>
              </span>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block' }}>Storage Vault</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                {vaccine.storageUnit || 'Cold Vault A'}
              </span>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block' }}>Expiration Date</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-success)' }}>
                {vaccine.expiry}
              </span>
            </div>
          </div>

          {/* Technical Specifications */}
          <h4 style={{ margin: '0 0 10px', fontSize: '0.98rem', color: 'var(--color-text-title)', fontWeight: 700 }}>Technical Product Metadata</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.88rem', background: 'var(--color-surface)', border: '1px solid var(--color-border-light)', borderRadius: '10px', padding: '12px 16px', marginBottom: '24px' }}>
            <div><strong style={{ color: 'var(--color-text-body)' }}>Manufacturer:</strong>{' '}<span style={{ color: 'var(--color-text-title)' }}>{vaccine.manufacturer || 'BioPharma Global'}</span></div>
            <div><strong style={{ color: 'var(--color-text-body)' }}>Dosage per Vial:</strong>{' '}<span style={{ color: 'var(--color-text-title)' }}>{vaccine.dosesPerVial ? `${vaccine.dosesPerVial} Doses` : '5 Doses (Multi-dose)'}</span></div>
            <div><strong style={{ color: 'var(--color-text-body)' }}>Required Temperature:</strong>{' '}<span style={{ color: 'var(--color-text-title)' }}>{vaccine.temp || '2°C to 8°C'}</span></div>
            <div><strong style={{ color: 'var(--color-text-body)' }}>NDDA / MOH Reg:</strong>{' '}<span style={{ color: 'var(--color-text-title)' }}>MOH-VAC-{String(vaccine.id).slice(0, 6).toUpperCase()}</span></div>
          </div>

          {/* Chronological Audit Timeline */}
          <h4 style={{ margin: '0 0 14px', fontSize: '0.98rem', color: 'var(--color-text-title)', fontWeight: 700 }}>Traceability &amp; Custody Events</h4>

          {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading audit trail…</p>}
          {error && <p style={{ color: 'var(--color-error)' }}>{error}</p>}

          {!loading && !error && auditEntries.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)' }}>No audit entries yet for this batch.</p>
          )}

          <div className="audit-timeline">
            {auditEntries.map((entry) => (
              <div key={entry.id} style={{ position: 'relative', paddingLeft: '28px', paddingBottom: '18px', borderLeft: '2px solid var(--color-border-card)', marginLeft: '8px' }}>
                <div style={{ position: 'absolute', left: '-7px', top: '0px', width: '12px', height: '12px', borderRadius: '50%', background: entry.type === 'restock' ? 'var(--color-primary)' : entry.type === 'sensor' ? 'var(--color-success)' : entry.type === 'dispense' ? 'var(--color-ai)' : 'var(--color-info)', border: '2px solid var(--color-surface)', boxShadow: '0 0 0 2px var(--color-border-light)' }} />
                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>{entry.timestamp}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-title)', fontWeight: 600, margin: '2px 0 3px' }}>{entry.event}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-body)' }}>Authorized: <em>{entry.actor}</em></div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: '14px' }}>
          <button type="button" className="btn-modal-cancel" onClick={() => alert(`Exporting audit log for Lot ${vaccine.lotNumber}...`)} style={{ marginRight: 'auto', background: 'var(--color-surface-subtle)', color: 'var(--color-text-title)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <IconFile size={16} /> Export Lot Audit PDF
            </span>
          </button>
          <button type="button" className="btn-modal-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
