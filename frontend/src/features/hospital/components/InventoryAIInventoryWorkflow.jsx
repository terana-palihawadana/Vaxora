import { useState } from 'react';
import { aiAgentService, inventoryDraftService } from '../services/inventoryAiAgentService';
import InventoryDraftDocument from './InventoryDraftDocument';
import useConfirmDialog from '../../../shared/hooks/useConfirmDialog';

const PRESET_ACTIONS = [
  {
    id: 'expiry',
    icon: '⏳',
    title: 'Scan Expiring Batches',
    description: 'Find batches nearing expiry and generate a rescue memo',
    objective: 'Which batches are about to expire?',
    color: 'var(--color-ai)',
  },
  {
    id: 'restock',
    icon: '📦',
    title: 'Suggest Restocks',
    description: 'Analyze stock levels and generate a draft purchase order',
    objective: 'Which vaccines do we need to restock?',
    color: 'var(--color-primary)',
  },
];

export default function InventoryAIInventoryWorkflow({ isOpen, onClose, onApproved }) {
  const [confirm, confirmDialog] = useConfirmDialog();
  const [status, setStatus] = useState('idle');
  const [activeAction, setActiveAction] = useState(null);
  const [agentResponse, setAgentResponse] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const getUserInfo = () => {
    try {
      const raw = localStorage.getItem('vaxora_user');
      const u = raw ? JSON.parse(raw) : null;
      return u ? { name: u.name, role: u.role, email: u.email } : null;
    } catch {
      return null;
    }
  };

  const reset = () => {
    setStatus('idle');
    setActiveAction(null);
    setAgentResponse(null);
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handleRun = async (action) => {
    setActiveAction(action);
    setStatus('running');
    setErrorMsg('');
    setSuccessMsg('');
    setAgentResponse(null);

    try {
      const result = await aiAgentService.run(action.objective, getUserInfo());
      setAgentResponse(result);
      setStatus('completed');
    } catch (err) {
      setErrorMsg(err.message || 'Agent failed to run.');
      setStatus('error');
    }
  };

  const handleApprove = async () => {
    if (!agentResponse?.draft) return;
    const draft = agentResponse.draft;
    const lineCount = Array.isArray(draft.line_items) ? draft.line_items.length : 0;
    const ok = await confirm({
      title: 'Approve AI purchase draft?',
      message:
        lineCount > 0
          ? `Execute this draft with ${lineCount} line item${lineCount === 1 ? '' : 's'}? Stock changes will be applied.`
          : 'Execute this draft? Stock changes will be applied.',
      confirmLabel: 'Approve',
    });
    if (!ok) return;

    setStatus('executing');
    setErrorMsg('');

    try {
      let payload;
      if (draft.draft_type === 'purchase_order') {
        payload = {
          po_number: draft.document_number,
          line_items: draft.line_items,
        };
      } else {
        const first = (draft.affected_batches || [])[0];
        payload = {
          memo_number: draft.document_number,
          batch_id: first?.batch_id,
          action: first?.recommended_action || 'dispense_first',
        };
      }

      const result = await inventoryDraftService.execute(
        agentResponse.workflow_id,
        draft.draft_type,
        payload
      );

      setSuccessMsg(result.message || 'Draft executed successfully.');
      setStatus('executed');
      if (onApproved) onApproved();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to execute draft.');
      setStatus('completed');
    }
  };

  const handleReject = async () => {
    const ok = await confirm({
      title: 'Discard AI draft?',
      message: 'Clear this proposal without executing it?',
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (!ok) return;
    reset();
  };
  const handleClose = () => { reset(); onClose(); };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="hospital-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '900px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🤖</span> AI Inventory Agent
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Run an agent to draft a formal document for your review
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={handleClose}>&times;</button>
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {status === 'idle' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {PRESET_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handleRun(a)}
                  style={{ textAlign: 'left', padding: '20px', borderRadius: '12px', border: '2px solid var(--color-border-light)', background: 'var(--color-surface)', cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = a.color; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-light)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>{a.icon}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-title)', marginBottom: '4px' }}>{a.title}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{a.description}</div>
                  <div style={{ marginTop: '14px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: a.color, color: 'var(--color-text-inverse)', padding: '6px 14px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 700 }}>
                    ▶ Run Agent
                  </div>
                </button>
              ))}
            </div>
          )}

          {status === 'running' && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🤖</div>
              <h3 style={{ margin: '0 0 8px', color: 'var(--color-primary)' }}>Agent is working…</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
                {activeAction?.title || 'Running'} — planning, calling tools, validating
              </p>
              <div style={{ maxWidth: '300px', margin: '0 auto' }}>
                <div style={{ height: '4px', background: 'var(--color-soft-panel-deep)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '40%', background: 'var(--color-ai)', animation: 'pulse 1.2s ease-in-out infinite' }} />
                </div>
              </div>
            </div>
          )}

          {status === 'completed' && agentResponse && (
            <div>
              {agentResponse.draft ? (
                <InventoryDraftDocument draft={agentResponse.draft} onApprove={handleApprove} onReject={handleReject} disabled={false} />
              ) : (
                <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)', borderRadius: '10px' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '12px' }}>✅</div>
                  <h3 style={{ margin: '0 0 8px', color: 'var(--color-success)' }}>No Action Needed</h3>
                  <p style={{ color: 'var(--color-success)', fontSize: '0.9rem', margin: 0 }}>
                    {agentResponse.content || 'The agent found nothing that requires your attention.'}
                  </p>
                  <button type="button" onClick={reset} style={{ marginTop: '16px', padding: '8px 16px', background: 'var(--color-success)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}>
                    Run Another
                  </button>
                </div>
              )}
            </div>
          )}

          {status === 'executing' && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⏳</div>
              <h3 style={{ margin: '0 0 8px', color: 'var(--color-primary)' }}>Executing draft…</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Creating audit log and inventory records</p>
            </div>
          )}

          {status === 'executed' && (
            <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--color-success-bg)', border: '1px solid var(--color-success-border)', borderRadius: '10px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px' }}>✅</div>
              <h3 style={{ margin: '0 0 8px', color: 'var(--color-success)' }}>Executed Successfully</h3>
              <p style={{ color: 'var(--color-success)', fontSize: '0.9rem', marginBottom: '20px' }}>{successMsg}</p>
              <button type="button" onClick={reset} style={{ padding: '10px 22px', background: 'var(--color-success)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>
                Run Another Agent
              </button>
            </div>
          )}

          {status === 'error' && (
            <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--color-error-bg)', border: '1px solid var(--color-error-border)', borderRadius: '10px' }}>
              <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⚠️</div>
              <h3 style={{ margin: '0 0 8px', color: 'var(--color-error)' }}>Agent Failed</h3>
              <p style={{ color: 'var(--color-error)', fontSize: '0.9rem', marginBottom: '20px' }}>{errorMsg}</p>
              <button type="button" onClick={reset} style={{ padding: '10px 22px', background: 'var(--color-error)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>
                Try Again
              </button>
            </div>
          )}

          {errorMsg && status === 'completed' && (
            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--color-error-bg)', border: '1px solid var(--color-error-border)', borderRadius: '8px', color: 'var(--color-error)', fontSize: '0.85rem' }}>
              ⚠️ {errorMsg}
            </div>
          )}
        </div>

        {status === 'idle' && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            Powered by AI Multi-Agent Intelligence • All drafts require your approval before any data is changed
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
