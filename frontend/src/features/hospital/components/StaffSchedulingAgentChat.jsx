import { useEffect, useMemo, useRef, useState } from 'react';
import agentService from '../../patient/services/agentService';
import staffService from '../services/staffService';
import { IconBot, IconClose } from '../../../shared/icons/AppIcons';
import { proposalIdentity } from './proposalIdentity';
import useConfirmDialog from '../../../shared/hooks/useConfirmDialog';

function speakDate(iso) {
  const [year, month, day] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return iso || '';
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function FairnessSummary({ summary, validation }) {
  const before = Array.isArray(summary?.before) ? summary.before : [];
  const after = Array.isArray(summary?.after) ? summary.after : [];
  if (before.length === 0 && after.length === 0) return null;

  const renderRows = (rows, title) => (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ fontWeight: 700, color: 'var(--color-text-title)', marginBottom: '6px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {rows.slice(0, 6).map((row) => (
          <div key={`${title}-${row.affiliationId || row.staffName}`} style={{ fontSize: '12px', color: 'var(--color-text-body)' }}>
            {row.staffName} · {row.shiftCount} shift{row.shiftCount === 1 ? '' : 's'}
            {row.load ? ` · ${row.load}` : ''}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      style={{
        marginTop: '10px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--color-info-bg)',
        background: 'var(--color-info-bg)',
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--color-primary-hover)', marginBottom: '8px' }}>Workload fairness</div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {before.length > 0 ? renderRows(before, 'Before') : null}
        {after.length > 0 ? renderRows(after, 'After plan') : null}
      </div>
      {validation && Array.isArray(validation.issues) && validation.issues.length > 0 ? (
        <div style={{ marginTop: '8px', color: 'var(--color-warning)', fontSize: '12px' }}>
          {validation.issues.length} proposal(s) need review before approval.
        </div>
      ) : null}
    </div>
  );
}

function BookingBrief({ briefing }) {
  const days = Array.isArray(briefing?.days) ? briefing.days : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {days.map((day) => (
        <div key={day.date}>
          <div style={{ fontWeight: 700, color: 'var(--color-text-title)', marginBottom: '6px' }}>{speakDate(day.date)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(day.slots || []).map((slot) => (
              <div
                key={`${day.date}-${slot.name}-${slot.vaccine}`}
                style={{
                  border: '1px solid var(--color-border-light)',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  background: 'var(--color-bg)',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--color-accent)', fontSize: '13px' }}>{slot.name}</div>
                <div style={{ color: 'var(--color-text-title)', marginTop: '2px' }}>
                  {slot.count} bookings · {slot.vaccine}
                </div>
                {(slot.booths || []).map((booth) => (
                  <div key={booth} style={{ color: 'var(--color-text-body)', fontSize: '13px', marginTop: '2px' }}>
                    {booth}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
      {briefing?.shiftCount ? (
        <div>
          {briefing.shiftCount} suggested shifts are ready. Press Approve all, or Approve or Decline on each one.
        </div>
      ) : null}
    </div>
  );
}

const formatMarkdownText = (text, isUser = false) => {
  if (!text) return '';

  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    let trimmed = line.trim();
    if (!trimmed) {
      return <div key={lineIdx} style={{ height: '6px' }} />;
    }

    const isBullet = trimmed.startsWith('- ') || (trimmed.startsWith('* ') && !trimmed.startsWith('**'));
    if (isBullet) {
      trimmed = trimmed.substring(2).trim();
    }

    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    let itemNumber = null;
    if (numMatch) {
      itemNumber = numMatch[1];
      trimmed = numMatch[2];
    }

    const parts = [];
    const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(trimmed)) !== null) {
      if (match.index > lastIndex) {
        parts.push(trimmed.substring(lastIndex, match.index));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(
          <strong key={`${lineIdx}-${match.index}`} style={{ fontWeight: 700, color: isUser ? 'var(--color-text-inverse)' : 'var(--color-text-title)' }}>
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith('`') && token.endsWith('`')) {
        parts.push(
          <code
            key={`${lineIdx}-${match.index}`}
            style={{
              background: isUser ? 'rgba(255,255,255,0.2)' : 'var(--color-soft-panel-deep)',
              padding: '1px 5px',
              borderRadius: '4px',
              fontSize: '0.88em',
              fontFamily: 'monospace',
            }}
          >
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(<em key={`${lineIdx}-${match.index}`}>{token.slice(1, -1)}</em>);
      }
      lastIndex = match.index + token.length;
    }
    if (lastIndex < trimmed.length) {
      parts.push(trimmed.substring(lastIndex));
    }

    if (isBullet) {
      return (
        <div
          key={lineIdx}
          style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '3px 0', paddingLeft: '4px' }}
        >
          <span style={{ color: isUser ? 'var(--color-text-inverse)' : 'var(--color-accent)', fontSize: '9px', marginTop: '6px' }}>●</span>
          <div style={{ flex: 1 }}>{parts}</div>
        </div>
      );
    }

    if (itemNumber) {
      return (
        <div
          key={lineIdx}
          style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '3px 0', paddingLeft: '4px' }}
        >
          <span style={{ fontWeight: 700, color: isUser ? 'var(--color-text-inverse)' : 'var(--color-accent)', fontSize: '13px' }}>
            {itemNumber}.
          </span>
          <div style={{ flex: 1 }}>{parts}</div>
        </div>
      );
    }

    return (
      <div key={lineIdx} style={{ margin: '2px 0' }}>
        {parts}
      </div>
    );
  });
};

function normalizeTime(value) {
  const s = String(value || '').trim();
  if (s.length === 5) return `${s}:00`;
  return s;
}

function shiftPayload(proposal) {
  return {
    affiliationId: proposal.affiliationId,
    shiftDate: String(proposal.shiftDate).slice(0, 10),
    startTime: normalizeTime(proposal.startTime),
    endTime: normalizeTime(proposal.endTime),
    boothId: proposal.boothId || null,
    boothOrStation: proposal.boothOrStation || null,
    notes: proposal.notes || 'Approved via Staff Scheduling Agent',
  };
}

function proposalSlot(p) {
  const start = String(p.startTime || '').slice(0, 5);
  const hour = Number(start.split(':')[0] || 0);
  return hour < 12 ? 'Morning' : 'Afternoon';
}

function boothKey(p) {
  if (p.boothId) return String(p.boothId);
  const raw = String(p.boothOrStation || '')
    .replace(/\s*[—–-]\s*(Morning|Afternoon)\s*$/i, '')
    .replace(/\s*·\s*/g, ' - ')
    .trim();
  return raw || 'Unassigned';
}

function boothLabel(p) {
  const raw = String(p.boothOrStation || '')
    .replace(/\s*[—–-]\s*(Morning|Afternoon)\s*$/i, '')
    .replace(/\s*·\s*/g, ' - ')
    .trim();
  return raw || 'Unassigned';
}

function shortDateLabel(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateStr).slice(0, 10);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function buildRosterGrid(proposals) {
  const dates = [...new Set(proposals.map((p) => String(p.shiftDate).slice(0, 10)))].sort();
  const boothOrder = [];
  const boothNames = new Map();
  for (const p of proposals) {
    const key = boothKey(p);
    if (!boothNames.has(key)) {
      boothOrder.push(key);
      boothNames.set(key, boothLabel(p));
    }
  }
  const cells = new Map();
  for (const p of proposals) {
    const key = `${boothKey(p)}|${String(p.shiftDate).slice(0, 10)}|${proposalSlot(p)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p);
  }
  return { dates, boothOrder, boothNames, cells };
}

/**
 * Staff Scheduling Agent chat — UI aligned with BookingAgentChat.
 */
export default function StaffSchedulingAgentChat({
  weekStart,
  weekEnd,
  initialPrompt,
  onShiftsChanged,
  onProposalsReady,
  onClose,
}) {
  const [confirm, confirmDialog] = useConfirmDialog();
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Hello! I am your **Vaxora Staff Scheduling Agent**.\n\nI can help you:\n- Review active doctors and nurses\n- Open booths from booked appointments\n- Suggest the nurses and doctors those booths need\n- Propose changes that require **your approval** before anything is saved\n\nHow can I help with this week’s roster?',
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [agentHealth, setAgentHealth] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(true);
  const [approvingId, setApprovingId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const [followUpPrompts, setFollowUpPrompts] = useState([]);

  const defaultPrompts = useMemo(
    () => [
      'Staff the rest of the week',
      'Who is working tomorrow?',
      'Who is on my staff?',
      'How busy are we this week?',
    ],
    []
  );

  const chipPrompts = followUpPrompts.length > 0 ? followUpPrompts : defaultPrompts;

  useEffect(() => {
    setFollowUpPrompts([]);
  }, [weekStart, weekEnd]);

  useEffect(() => {
    let mounted = true;
    agentService.checkHealth().then((status) => {
      if (mounted) {
        setAgentHealth(status);
        setCheckingHealth(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend = null) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isLoading) return;

    stickToBottomRef.current = true;
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInputMessage('');
    setIsLoading(true);

    try {
      const res = await agentService.sendMessage(newMessages, {
        targetAgent: 'StaffSchedulingAgent',
      });

      const proposals = Array.isArray(res.proposals)
        ? res.proposals
        : res.proposal
          ? [res.proposal]
          : [];

      const nextFollowUps = Array.isArray(res.suggestedFollowUps)
        ? res.suggestedFollowUps.filter((p) => typeof p === 'string' && p.trim())
        : Array.isArray(res.suggested_follow_ups)
          ? res.suggested_follow_ups.filter((p) => typeof p === 'string' && p.trim())
          : [];
      if (nextFollowUps.length > 0) {
        setFollowUpPrompts(nextFollowUps);
      }

      const workflowId = res.workflowId || res.WorkflowId || null;
      if (proposals.length > 0 && typeof onProposalsReady === 'function') {
        onProposalsReady(proposals, {
          workflowId,
          fairnessSummary: res.fairnessSummary || res.fairness_summary || null,
          validation: res.validation || null,
          briefing: res.briefing || null,
        });
      }

      const chatContent =
        proposals.length > 0 && typeof onProposalsReady === 'function'
          ? `${res.content || 'I prepared shift suggestions.'}\n\n**${proposals.length} suggested shift${proposals.length === 1 ? '' : 's'}** are in the Suggested week window — select which to approve there.`
          : res.content || 'I processed your scheduling request.';

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: chatContent,
          briefing: proposals.length > 0 && onProposalsReady ? null : res.briefing || null,
          fairnessSummary:
            proposals.length > 0 && onProposalsReady
              ? null
              : res.fairnessSummary || res.fairness_summary || null,
          validation: proposals.length > 0 && onProposalsReady ? null : res.validation || null,
          // Proposals render on the week calendar, not in this chat.
          proposals: proposals.length > 0 && onProposalsReady ? [] : proposals,
          workflowId,
          createdShifts: res.created_shifts || res.createdShifts || null,
        },
      ]);

      if ((res.created_shifts || res.createdShifts)?.length && onShiftsChanged) {
        onShiftsChanged();
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `**Agent Communication Error**: ${
            err.message ||
            'Could not connect to the Staff Scheduling Agent service. Please ensure the agent backend is running.'
          }`,
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const autoSentRef = useRef(false);
  useEffect(() => {
    if (!initialPrompt || autoSentRef.current) return;
    autoSentRef.current = true;
    handleSendMessage(initialPrompt);
    // Suggest Week opens the chat and sends this prompt once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const handleApproveProposal = async (proposal, workflowId, remainingCount) => {
    const id = proposalIdentity(proposal);
    stickToBottomRef.current = false;
    setApprovingId(id);
    try {
      await staffService.createShift(shiftPayload(proposal));

      if (workflowId && remainingCount <= 1) {
        try {
          await agentService.recordDecision(workflowId, {
            approved: true,
            note: 'Approved shift proposal(s) from agent run',
          });
        } catch {
          // The shift is already saved. The workflow note is optional.
        }
      }

      // Keep scroll position: mark approved in-place, do not append a new chat bubble.
      setMessages((prev) =>
        prev.map((msg) => {
          if (!Array.isArray(msg.proposals) || msg.proposals.length === 0) return msg;
          if (workflowId && msg.workflowId !== workflowId) return msg;
          const nextProposals = msg.proposals.map((p) =>
            proposalIdentity(p) === id ? { ...p, _status: 'approved' } : p
          );
          const pending = nextProposals.filter((p) => p._status !== 'approved' && p._status !== 'declined');
          return {
            ...msg,
            proposals: nextProposals,
            approvedCount: (msg.approvedCount || 0) + 1,
            decision: pending.length === 0 ? 'Approved' : msg.decision,
          };
        })
      );

      if (onShiftsChanged) onShiftsChanged();
    } catch (err) {
      stickToBottomRef.current = true;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Failed to create shift: ${err.message || 'Request failed'}`,
          isError: true,
        },
      ]);
    } finally {
      setApprovingId(null);
    }
  };

  const handleApproveAll = async (proposals, workflowId) => {
    const pending = (proposals || []).filter(
      (p) => p._status !== 'approved' && p._status !== 'declined'
    );
    if (pending.length === 0) return;
    const ok = await confirm({
      title: 'Approve selected shifts?',
      message: `Create ${pending.length} shift${pending.length === 1 ? '' : 's'} on the hospital roster? This cannot be undone from here.`,
      confirmLabel: `Approve (${pending.length})`,
    });
    if (!ok) return;
    stickToBottomRef.current = false;
    setApprovingId('batch');
    const approvedIds = new Set();
    const failed = [];
    // Created one at a time on purpose: the API checks for overlapping shifts per
    // request, so concurrent creates could both pass the check and double-book staff.
    for (const proposal of pending) {
      try {
        await staffService.createShift(shiftPayload(proposal));
        approvedIds.add(proposalIdentity(proposal));
      } catch {
        failed.push(proposal.staffName || 'A shift');
      }
    }

    if (workflowId && approvedIds.size === pending.length) {
      try {
        await agentService.recordDecision(workflowId, {
          approved: true,
          note: 'Approved the whole batch of shift proposals',
        });
      } catch {
        // The shifts are already saved. The workflow note is optional.
      }
    }

    if (approvedIds.size > 0) {
      setMessages((prev) =>
        prev.map((msg) => {
          if (!Array.isArray(msg.proposals) || msg.proposals.length === 0) return msg;
          if (workflowId && msg.workflowId !== workflowId) return msg;
          const nextProposals = msg.proposals.map((p) =>
            approvedIds.has(proposalIdentity(p)) ? { ...p, _status: 'approved' } : p
          );
          const stillPending = nextProposals.filter(
            (p) => p._status !== 'approved' && p._status !== 'declined'
          );
          return {
            ...msg,
            proposals: nextProposals,
            approvedCount: (msg.approvedCount || 0) + approvedIds.size,
            decision: stillPending.length === 0 ? 'Approved' : msg.decision,
          };
        })
      );
      if (onShiftsChanged) onShiftsChanged();
    }

    if (failed.length > 0) {
      stickToBottomRef.current = true;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            approvedIds.size === 0
              ? 'Could not create those shifts. Nothing was saved.'
              : `Could not create ${failed.length} shift${failed.length === 1 ? '' : 's'}: ${failed.join(', ')}. The others were saved.`,
          isError: true,
        },
      ]);
    }
    setApprovingId(null);
  };

  const handleDeclineProposal = async (proposal, workflowId, remainingCount, approvedCount = 0) => {
    const ok = await confirm({
      title: 'Decline suggestion?',
      message: `Remove ${proposal.staffName || 'this staff member'} · ${String(proposal.startTime || '').slice(0, 5)}–${String(proposal.endTime || '').slice(0, 5)} from this plan? You can ask again for new suggestions.`,
      confirmLabel: 'Decline',
      destructive: true,
    });
    if (!ok) return;

    const id = proposalIdentity(proposal);
    stickToBottomRef.current = false;

    let alternative = null;
    try {
      const res = await agentService.sendMessage(
        [
          {
            role: 'user',
            content: `__shift_declined__ ${JSON.stringify({
              affiliationId: proposal.affiliationId,
              gapId: proposal.gapId,
              shiftDate: String(proposal.shiftDate).slice(0, 10),
              startTime: normalizeTime(proposal.startTime),
              endTime: normalizeTime(proposal.endTime),
              requestAlternative: Boolean(proposal.gapId),
            })}`,
          },
        ],
        { targetAgent: 'StaffSchedulingAgent' },
      );
      if (Array.isArray(res.proposals) && res.proposals.length > 0) {
        alternative = res.proposals[0];
      } else if (res.proposal) {
        alternative = res.proposal;
      }
    } catch (err) {
      stickToBottomRef.current = true;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Could not remember that decline: ${err.message || 'Request failed'}`,
          isError: true,
        },
      ]);
      return;
    }

    const pendingLeft = remainingCount - 1;
    if (workflowId && pendingLeft <= 0) {
      try {
        await agentService.recordDecision(workflowId, {
          approved: approvedCount > 0,
          note:
            approvedCount > 0
              ? 'Accepted some proposals and declined the rest'
              : 'Declined shift proposal(s)',
        });
      } catch {
        // The decline is already remembered. The workflow note is optional.
      }
    }

    setMessages((prev) =>
      prev.map((msg) => {
        if (!Array.isArray(msg.proposals) || msg.proposals.length === 0) return msg;
        if (workflowId && msg.workflowId !== workflowId) return msg;
        const nextProposals = msg.proposals.map((p) =>
          proposalIdentity(p) === id ? { ...p, _status: 'declined' } : p
        );
        if (alternative) {
          nextProposals.push(alternative);
        }
        const pending = nextProposals.filter((p) => p._status !== 'approved' && p._status !== 'declined');
        return {
          ...msg,
          proposals: nextProposals,
          fairnessSummary: alternative
            ? msg.fairnessSummary
            : msg.fairnessSummary,
          decision:
            pending.length === 0
              ? approvedCount > 0
                ? 'Approved'
                : 'Rejected'
              : msg.decision,
        };
      })
    );
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: '16px',
        border: '1px solid var(--color-border-light)',
        boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        height: '620px',
        overflow: 'hidden',
        fontFamily: 'inherit',
      }}
    >
      {/* Header — same pattern as BookingAgentChat */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--color-info) 0%, var(--color-accent) 100%)',
          color: 'var(--color-text-inverse)',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconBot size={20} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Vaxora Staff Scheduling Agent</h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', opacity: 0.9 }}>
              Coverage · Shift proposals · Human approval required
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: agentHealth?.online ? 'rgba(var(--rgb-success), 0.2)' : 'rgba(var(--rgb-error), 0.2)',
              border: `1px solid ${agentHealth?.online ? 'rgba(var(--rgb-success), 0.4)' : 'rgba(var(--rgb-error), 0.4)'}`,
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: agentHealth?.online ? 'var(--color-success)' : 'var(--color-error)',
                display: 'inline-block',
              }}
            />
            {checkingHealth ? 'Checking Agent...' : agentHealth?.online ? 'Agent Online' : 'Agent Offline'}
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Close Scheduling Agent"
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                color: 'var(--color-text-inverse)',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.35)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              }}
              aria-label="Close scheduling agent"
            >
              <IconClose size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          background: 'var(--color-bg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
                gap: '8px',
              }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  padding: '14px 18px',
                  borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: isUser ? 'var(--color-accent)' : msg.isError ? 'var(--color-error-bg)' : 'var(--color-surface)',
                  color: isUser ? 'var(--color-text-inverse)' : msg.isError ? 'var(--color-error)' : 'var(--color-text-title)',
                  border: isUser ? 'none' : msg.isError ? '1px solid var(--color-error-border)' : '1px solid var(--color-border-light)',
                  boxShadow: isUser
                    ? '0 2px 8px rgba(var(--rgb-info), 0.2)'
                    : '0 2px 6px rgba(0, 0, 0, 0.04)',
                  fontSize: '14px',
                  lineHeight: '1.6',
                }}
              >
                {msg.briefing ? <BookingBrief briefing={msg.briefing} /> : formatMarkdownText(msg.content, isUser)}
                {msg.fairnessSummary ? (
                  <FairnessSummary summary={msg.fairnessSummary} validation={msg.validation} />
                ) : null}
              </div>

              {Array.isArray(msg.proposals) && msg.proposals.length > 0 && (() => {
                const { dates, boothOrder, boothNames, cells } = buildRosterGrid(msg.proposals);
                const pendingCount = msg.proposals.filter(
                  (p) => p._status !== 'approved' && p._status !== 'declined'
                ).length;
                const cellStyle = {
                  padding: '8px',
                  borderBottom: '1px solid var(--color-border-light)',
                  borderRight: '1px solid var(--color-border-light)',
                  verticalAlign: 'top',
                  wordBreak: 'break-word',
                };

                const renderCell = (booth, date, slot) => {
                  const people = cells.get(`${booth}|${date}|${slot}`) || [];
                  if (people.length === 0) {
                    return (
                      <td key={`${booth}|${date}|${slot}`} style={{ ...cellStyle, background: 'var(--color-bg)', color: 'var(--color-text-placeholder)', textAlign: 'center' }}>
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={`${booth}|${date}|${slot}`} style={cellStyle}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {people.map((proposal) => {
                          const id = proposalIdentity(proposal);
                          const status = proposal._status;
                          const resolved = status === 'approved' || status === 'declined';
                          return (
                            <div
                              key={id}
                              style={{
                                padding: '6px',
                                borderRadius: '6px',
                                border: `1px solid ${
                                  status === 'approved'
                                    ? 'var(--color-success-border)'
                                    : status === 'declined'
                                      ? 'var(--color-border-light)'
                                      : 'var(--color-info-border)'
                                }`,
                                background:
                                  status === 'approved'
                                    ? 'var(--color-success-bg)'
                                    : status === 'declined'
                                      ? 'var(--color-bg)'
                                      : 'var(--color-info-bg)',
                              }}
                            >
                              <div style={{ fontWeight: 700, color: 'var(--color-text-title)', lineHeight: 1.3 }}>
                                {proposal.staffName}
                              </div>
                              {proposal.specialization ? (
                                <div style={{ color: 'var(--color-text-body)', fontSize: '11px', lineHeight: 1.3 }}>
                                  {proposal.specialization}
                                </div>
                              ) : null}
                              {proposal.vaccineName ? (
                                <div style={{ color: 'var(--color-accent)', fontSize: '11px', fontWeight: 600, lineHeight: 1.3 }}>
                                  {proposal.vaccineName}
                                </div>
                              ) : null}
                              <div style={{ color: 'var(--color-text-muted)', fontSize: '11px', lineHeight: 1.3 }}>
                                {proposal.staffRole || 'Staff'} · {String(proposal.startTime).slice(0, 5)}–
                                {String(proposal.endTime).slice(0, 5)}
                              </div>
                              {typeof proposal.reason === 'string' &&
                              proposal.reason.toLowerCase().includes('specialization') ? (
                                <div style={{ color: 'var(--color-primary)', fontSize: '10px', marginTop: '2px', lineHeight: 1.3 }}>
                                  {proposal.reason.includes('·')
                                    ? proposal.reason.split('·').slice(1).join('·').trim()
                                    : proposal.reason}
                                </div>
                              ) : null}
                              {Array.isArray(proposal.alternatives) && proposal.alternatives.length > 0 ? (
                                <div style={{ color: 'var(--color-text-muted)', fontSize: '10px', marginTop: '4px' }}>
                                  Alt: {proposal.alternatives.map((alt) => alt.staffName).join(', ')}
                                </div>
                              ) : null}
                              {resolved ? (
                                <div
                                  style={{
                                    marginTop: '4px',
                                    fontWeight: 700,
                                    fontSize: '11px',
                                    color: status === 'approved' ? 'var(--color-success)' : 'var(--color-text-muted)',
                                  }}
                                >
                                  {status === 'approved' ? 'Created' : 'Declined'}
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDeclineProposal(
                                        proposal,
                                        msg.workflowId,
                                        pendingCount,
                                        msg.approvedCount || 0
                                      )
                                    }
                                    disabled={isLoading || approvingId !== null}
                                    style={{
                                      flex: 1,
                                      padding: '4px 6px',
                                      borderRadius: '4px',
                                      border: '1px solid var(--color-border-card)',
                                      background: 'var(--color-surface)',
                                      color: 'var(--color-text-muted)',
                                      fontWeight: 600,
                                      fontSize: '11px',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Decline
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleApproveProposal(
                                        proposal,
                                        msg.workflowId,
                                        pendingCount
                                      )
                                    }
                                    disabled={isLoading || approvingId !== null}
                                    style={{
                                      flex: 1,
                                      padding: '4px 6px',
                                      borderRadius: '4px',
                                      border: 'none',
                                      background: 'var(--color-success)',
                                      color: 'var(--color-text-inverse)',
                                      fontWeight: 600,
                                      fontSize: '11px',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {approvingId === id ? '…' : 'Approve'}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  );
                };

                return (
                  <div
                    style={{
                      alignSelf: 'stretch',
                      width: '100%',
                      marginTop: '4px',
                      border: '1px solid var(--color-info-border)',
                      borderRadius: '10px',
                      background: 'var(--color-surface)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid var(--color-info-border)',
                        background: 'var(--color-info-bg)',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'var(--color-accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        {pendingCount > 0
                          ? `Proposed roster · ${pendingCount} left`
                          : 'Proposed roster · saved'}
                      </span>
                      {pendingCount > 1 ? (
                        <button
                          type="button"
                          onClick={() => handleApproveAll(msg.proposals, msg.workflowId)}
                          disabled={isLoading || approvingId !== null}
                          style={{
                            flexShrink: 0,
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: 'none',
                            background: 'var(--color-success)',
                            color: 'var(--color-text-inverse)',
                            fontWeight: 700,
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          {approvingId === 'batch' ? 'Approving…' : 'Approve all'}
                        </button>
                      ) : null}
                    </div>
                    {dates.map((date) => {
                      const dayBooths = boothOrder.filter(
                        (booth) =>
                          cells.has(`${booth}|${date}|Morning`) || cells.has(`${booth}|${date}|Afternoon`)
                      );
                      return (
                        <div key={date}>
                          <div
                            style={{
                              padding: '8px 12px',
                              background: 'var(--color-bg)',
                              borderBottom: '1px solid var(--color-border-light)',
                              fontWeight: 700,
                              fontSize: '13px',
                              color: 'var(--color-text-title)',
                            }}
                          >
                            {shortDateLabel(date)}
                          </div>
                          <table
                            style={{
                              width: '100%',
                              tableLayout: 'fixed',
                              borderCollapse: 'collapse',
                              fontSize: '12px',
                              color: 'var(--color-text-title)',
                            }}
                          >
                            <thead>
                              <tr style={{ background: 'var(--color-info-bg)' }}>
                                <th style={{ width: '28%', padding: '6px 8px', textAlign: 'left', color: 'var(--color-accent)', borderBottom: '1px solid var(--color-info-border)' }}>
                                  Booth
                                </th>
                                <th style={{ width: '36%', padding: '6px 8px', textAlign: 'center', color: 'var(--color-accent)', borderBottom: '1px solid var(--color-info-border)' }}>
                                  Morning
                                </th>
                                <th style={{ width: '36%', padding: '6px 8px', textAlign: 'center', color: 'var(--color-accent)', borderBottom: '1px solid var(--color-info-border)' }}>
                                  Afternoon
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {dayBooths.map((booth) => (
                                <tr key={`${date}|${booth}`}>
                                  <td
                                    style={{
                                      padding: '8px',
                                      borderBottom: '1px solid var(--color-border-light)',
                                      borderRight: '1px solid var(--color-border-light)',
                                      fontWeight: 700,
                                      verticalAlign: 'top',
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {boothNames.get(booth) || booth}
                                  </td>
                                  {renderCell(booth, date, 'Morning')}
                                  {renderCell(booth, date, 'Afternoon')}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {msg.decision &&
                Array.isArray(msg.proposals) &&
                msg.proposals.every((p) => p._status === 'approved' || p._status === 'declined') && (
                <div
                  style={{
                    maxWidth: '90%',
                    background: msg.decision === 'Approved' ? 'var(--color-success-bg)' : 'var(--color-bg)',
                    border: `1px solid ${msg.decision === 'Approved' ? 'var(--color-success-border)' : 'var(--color-border-card)'}`,
                    borderRadius: '8px',
                    padding: '6px 10px',
                    marginTop: '2px',
                    fontSize: '11px',
                    color: 'var(--color-text-body)',
                    fontWeight: 600,
                  }}
                >
                  Batch {msg.decision.toLowerCase()}
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--color-text-muted)',
              fontSize: '13px',
              fontStyle: 'italic',
              padding: '8px 0',
            }}
          >
            <span>⏳</span> Agent is thinking & checking staff coverage...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {!isLoading && (
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--color-surface-subtle)',
            borderTop: '1px solid var(--color-border-light)',
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
          }}
        >
          {chipPrompts.map((prompt, i) => (
            <button
              key={`${i}-${prompt}`}
              type="button"
              onClick={() => handleSendMessage(prompt)}
              disabled={isLoading}
              style={{
                whiteSpace: 'nowrap',
                padding: '6px 12px',
                borderRadius: '20px',
                border: '1px solid var(--color-border-card)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-body)',
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          padding: '14px 18px',
          background: 'var(--color-surface)',
          borderTop: '1px solid var(--color-border-light)',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
        }}
      >
        <textarea
          ref={inputRef}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about coverage, staff, or request shift suggestions..."
          disabled={isLoading}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid var(--color-border-card)',
            outline: 'none',
            fontSize: '14px',
            fontFamily: 'inherit',
            maxHeight: '80px',
          }}
        />
        <button
          type="button"
          onClick={() => handleSendMessage()}
          disabled={isLoading || !inputMessage.trim()}
          style={{
            padding: '10px 20px',
            borderRadius: '10px',
            background: isLoading || !inputMessage.trim() ? 'var(--color-text-placeholder)' : 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
            border: 'none',
            fontWeight: 600,
            fontSize: '14px',
            cursor: isLoading || !inputMessage.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'background 0.2s',
          }}
        >
          <span>Send</span>
        </button>
      </div>
      {confirmDialog}
    </div>
  );
}
