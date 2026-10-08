

// Renders a formal draft document (Purchase Order or Expiry Memo)
export default function DraftDocument({ draft, onApprove, onReject, disabled }) {
  if (!draft) return null;

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-card)',
        borderRadius: '10px',
        overflow: 'hidden',
        boxShadow: '0 4px 14px rgba(var(--rgb-primary-dark), 0.08)',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: draft.draft_type === 'purchase_order' ? 'var(--color-primary)' : 'var(--color-ai)',
          color: 'var(--color-text-inverse)',
          padding: '16px 22px',
        }}
      >
        <div style={{ fontSize: '0.72rem', letterSpacing: '0.1em', opacity: 0.85, fontWeight: 700 }}>
          AGENT DRAFT — {draft.draft_type === 'purchase_order' ? 'PURCHASE ORDER' : 'OFFICIAL MEMO'}
        </div>
        <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '4px' }}>
          {draft.title}
        </div>
        <div style={{ fontSize: '0.82rem', opacity: 0.9, marginTop: '4px' }}>
          Document No: <strong>{draft.document_number}</strong> • Generated {new Date(draft.generated_at).toLocaleString()}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '20px 22px' }}>
        {draft.draft_type === 'purchase_order' && <PurchaseOrderBody draft={draft} />}
        {draft.draft_type === 'expiry_memo' && <ExpiryMemoBody draft={draft} />}

        {/* Validation checks */}
        {draft.validation_checks && draft.validation_checks.length > 0 && (
          <div style={{ marginTop: '20px', padding: '14px', background: 'var(--color-bg)', borderRadius: '8px', border: '1px solid var(--color-border-light)' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-body)', letterSpacing: '0.05em', marginBottom: '8px' }}>
              DETERMINISTIC VALIDATION
            </div>
            {draft.validation_checks.map((v, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', marginBottom: '4px', color: v.passed ? 'var(--color-success)' : 'var(--color-error)' }}>
                <span>{v.passed ? '✔' : '✘'}</span>
                <span>{v.rule}</span>
                {v.detail && <span style={{ color: 'var(--color-text-muted)' }}>({v.detail})</span>}
              </div>
            ))}
          </div>
        )}

        {draft.notes && (
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '14px', fontStyle: 'italic' }}>
            ℹ️ {draft.notes}
          </div>
        )}
      </div>

      {/* Action footer */}
      <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onReject}
          disabled={disabled}
          style={{
            background: 'var(--color-surface)', color: 'var(--color-error)', border: '1px solid var(--color-error-border)',
            padding: '10px 20px', borderRadius: '8px', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          ❌ Reject
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled}
          style={{
            background: 'var(--color-success)', color: 'var(--color-text-inverse)', border: 'none',
            padding: '10px 22px', borderRadius: '8px', fontWeight: 700,
            cursor: disabled ? 'not-allowed' : 'pointer',
            boxShadow: '0 4px 12px rgba(var(--rgb-success), 0.3)',
          }}
        >
          ✅ {draft.action_label || 'Approve & Execute'}
        </button>
      </div>
    </div>
  );
}

// ==================== PURCHASE ORDER BODY ====================

function PurchaseOrderBody({ draft }) {
  return (
    <>
      {/* Meta grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>BUYER</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-title)', marginTop: '2px' }}>{draft.buyer?.name || 'N/A'}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{draft.buyer?.registration || ''}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>SUPPLIER</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-title)', marginTop: '2px' }}>{draft.supplier || 'N/A'}</div>
        </div>
      </div>

      {/* Dates */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', background: 'var(--color-surface-subtle)', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px' }}>
        <MetaCell label="ORDER DATE" value={draft.order_date} />
        <MetaCell label="DELIVERY DATE" value={draft.delivery_date} />
        <MetaCell label="LEAD TIME" value={`${draft.delivery_lead_days} days`} />
      </div>

      {/* Line items */}
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '8px' }}>LINE ITEMS</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border-light)' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700 }}>#</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700 }}>Vaccine</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700 }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700 }}>Unit (LKR)</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700 }}>Total (LKR)</th>
            </tr>
          </thead>
          <tbody>
            {(draft.line_items || []).map((li, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                <td style={{ padding: '10px' }}>{i + 1}</td>
                <td style={{ padding: '10px' }}>
                  <div style={{ fontWeight: 700 }}>{li.vaccine_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>{li.justification}</div>
                  {li.urgency === 'high' && (
                    <span style={{ display: 'inline-block', marginTop: '4px', fontSize: '0.68rem', background: 'var(--color-error-bg)', color: 'var(--color-error)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      HIGH URGENCY
                    </span>
                  )}
                </td>
                <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>{li.quantity}</td>
                <td style={{ padding: '10px', textAlign: 'right' }}>{li.unit_price_lkr?.toLocaleString()}</td>
                <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>{li.total_lkr?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ minWidth: '260px', fontSize: '0.9rem' }}>
          <Row label="Subtotal" value={`LKR ${(draft.subtotal_lkr || 0).toLocaleString()}`} />
          <Row label="Tax" value={`LKR ${(draft.tax_lkr || 0).toLocaleString()}`} />
          <div style={{ borderTop: '1px solid var(--color-border-card)', marginTop: '8px', paddingTop: '8px' }}>
            <Row label="TOTAL" value={`LKR ${(draft.total_lkr || 0).toLocaleString()}`} bold />
          </div>
        </div>
      </div>
    </>
  );
}

function MetaCell({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-title)', marginTop: '2px' }}>{value}</div>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span style={{ color: 'var(--color-text-title)', fontWeight: bold ? 800 : 600 }}>{value}</span>
    </div>
  );
}

// ==================== EXPIRY MEMO BODY ====================

function ExpiryMemoBody({ draft }) {
  return (
    <>
      {/* Memo header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 700 }}>TO</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-title)' }}>{draft.recipient?.name || 'N/A'}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{draft.recipient?.role || ''}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 700 }}>SUBJECT</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-title)' }}>{draft.subject}</div>
        </div>
      </div>

      {/* Summary */}
      <div style={{ background: 'var(--color-ai-bg)', border: '1px solid var(--color-ai-border)', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.88rem', color: 'var(--color-ai)', lineHeight: 1.5 }}>
        {draft.summary}
      </div>

      {/* Affected batches */}
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '8px' }}>AFFECTED BATCHES</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '20px' }}>
        <thead>
          <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border-light)' }}>
            <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700 }}>Vaccine</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700 }}>Lot</th>
            <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700 }}>Vials</th>
            <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700 }}>Days Left</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700 }}>Priority</th>
          </tr>
        </thead>
        <tbody>
          {(draft.affected_batches || []).map((b, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
              <td style={{ padding: '10px', fontWeight: 700 }}>{b.vaccine_name}</td>
              <td style={{ padding: '10px', color: 'var(--color-text-body)' }}>{b.lot_number}</td>
              <td style={{ padding: '10px', textAlign: 'right' }}>{b.quantity_available}</td>
              <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: b.days_until_expiry <= 14 ? 'var(--color-error)' : b.days_until_expiry <= 30 ? 'var(--color-warning)' : 'var(--color-text-title)' }}>
                {b.days_until_expiry}
              </td>
              <td style={{ padding: '10px' }}>
                <PriorityBadge priority={b.priority} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Rescue plan */}
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: '8px' }}>RESCUE PLAN</div>
      <div>
        {(draft.rescue_plan || []).map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: '12px', padding: '10px 0', borderBottom: i < draft.rescue_plan.length - 1 ? '1px solid var(--color-border-light)' : 'none' }}>
            <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--color-ai)', color: 'var(--color-text-inverse)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0 }}>
              {s.step}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.88rem', color: 'var(--color-text-title)', fontWeight: 600 }}>{s.action_text}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                Lot {s.lot_number} • Deadline: {s.deadline}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PriorityBadge({ priority }) {
  const colors = {
    critical: { bg: 'var(--color-error-bg)', color: 'var(--color-error)' },
    high: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
    medium: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
    low: { bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
  };
  const c = colors[priority?.toLowerCase()] || colors.low;
  return (
    <span style={{ background: c.bg, color: c.color, padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>
      {priority}
    </span>
  );
}
