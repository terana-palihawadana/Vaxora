import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import staffService from '../services/staffService';
import { RoleAvatarIcon } from './HospitalIcons';
import { hospitalMinutesNow, hospitalToday } from '../utils/hospitalDate';

function roleLabel(role) {
  const value = String(role || '').toUpperCase();
  if (value === 'DOCTOR') return 'Doctor';
  if (value === 'NURSE') return 'Nurse';
  return role || 'Staff';
}

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const word = parts[0];
    return word.slice(0, Math.min(2, word.length)).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatShiftLine(request) {
  const date = request.shiftDate
    ? new Date(`${request.shiftDate}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : 'Date TBD';
  const window = request.shiftWindow || 'Time TBD';
  const booth = request.boothOrStation ? ` · ${request.boothOrStation}` : '';
  return `${date} · ${window}${booth}`;
}

/** A started shift can no longer be reassigned (the API rejects it too). */
function hasShiftStarted(request) {
  const day = String(request.shiftDate || '').slice(0, 10);
  if (!day) return false;
  const today = hospitalToday();
  if (day < today) return true;
  if (day > today) return false;
  const match = /^(\d{1,2}):(\d{2})/.exec(String(request.shiftWindow || ''));
  if (!match) return false;
  return hospitalMinutesNow() >= Number(match[1]) * 60 + Number(match[2]);
}

function requestNote(request) {
  const reason = String(request.reason || '').trim();
  if (reason) return reason;
  const snippet = String(request.conversationSnippet || '').trim();
  return snippet || null;
}

function CoverRequestCard({ request, busy, onApprove, onDecline, onRanked }) {
  const [selectedAffiliationId, setSelectedAffiliationId] = useState('');
  const [ranking, setRanking] = useState(false);
  const [rankNote, setRankNote] = useState('');
  const suggestions = useMemo(
    () => (request.suggestions || []).filter((s) => s.available !== false),
    [request.suggestions]
  );
  const hasCover = suggestions.length > 0;
  const isPending = String(request.status || '').toLowerCase() === 'pending';
  const isApproved = String(request.status || '').toLowerCase() === 'approved';
  const isDeclined = String(request.status || '').toLowerCase() === 'declined';
  const isCancelled = String(request.status || '').toLowerCase() === 'cancelled';
  const note = requestNote(request);
  const started = isPending && hasShiftStarted(request);
  const canApprove = isPending && !started && hasCover && Boolean(selectedAffiliationId);

  const statusLabel = isApproved
    ? 'Approved'
    : isDeclined
      ? 'Declined'
      : isCancelled
        ? 'Cancelled'
        : 'Needs review';
  const statusTone = isApproved
    ? 'success'
    : isDeclined
      ? 'danger'
      : isCancelled
        ? 'neutral'
        : 'warning';

  // AI ranking runs only on request so a slow model never blocks the inbox.
  const handleRankWithAi = async () => {
    setRanking(true);
    setRankNote('');
    try {
      const ranked = await staffService.rankShiftSwap(request.id);
      onRanked?.(ranked);
      if (!ranked?.aiRanked) setRankNote('AI ranking unavailable right now — showing roster order.');
    } catch (err) {
      setRankNote(err.message || 'AI ranking unavailable right now — showing roster order.');
    } finally {
      setRanking(false);
    }
  };
  const canRank = isPending && !started && suggestions.length > 1;

  const reviewSummary = started
    ? 'This shift has already started — it can no longer be reassigned. Decline to close the request.'
    : request.reviewSummary ||
    (suggestions.length === 0
      ? 'No other staff of this role on the roster.'
      : hasCover
        ? 'Pick who should take this shift.'
        : 'No one is free in this window.');

  return (
    <article className="hospital-cover-card">
      <div className="hospital-cover-card-top">
        <div className="hospital-cover-avatar">
          {request.requesterPhotoUrl ? (
            <img src={request.requesterPhotoUrl} alt="" />
          ) : (
            <span className="hospital-cover-avatar-fallback" aria-hidden="true">
              {initials(request.requesterName)}
            </span>
          )}
        </div>
        <div className="hospital-cover-card-meta">
          <div className="hospital-cover-card-title-row">
            <h3>{request.requesterName || 'Staff member'}</h3>
            <span className={`hospital-cover-status hospital-cover-status--${statusTone}`}>
              {statusLabel}
            </span>
          </div>
          <p className="hospital-cover-role">{roleLabel(request.requesterRole)}</p>
          <p className="hospital-cover-shift">{formatShiftLine(request)}</p>
          {isApproved && request.replacementName ? (
            <p className="hospital-cover-replacement">Covered by {request.replacementName}</p>
          ) : null}
        </div>
      </div>

      {note ? <p className="hospital-cover-note">{note}</p> : null}

      {isPending ? (
        <>
          <div className="hospital-cover-review-banner">
            <span aria-hidden="true">✦</span>
            <p>{reviewSummary}</p>
            {request.aiRanked ? (
              <span className="hospital-cover-ai-chip">Ranked by AI</span>
            ) : canRank ? (
              <button
                type="button"
                className="hospital-cover-ai-btn"
                onClick={handleRankWithAi}
                disabled={busy || ranking}
              >
                {ranking ? 'Ranking…' : 'Rank with AI'}
              </button>
            ) : null}
          </div>
          {rankNote ? <p className="hospital-cover-rank-note">{rankNote}</p> : null}

          {suggestions.length > 0 ? (
            <div className="hospital-cover-suggestions" role="radiogroup" aria-label="Replacement staff">
              {suggestions.map((suggestion) => {
                const selected = selectedAffiliationId === suggestion.affiliationId;
                return (
                  <button
                    key={suggestion.affiliationId}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`hospital-cover-suggestion${selected ? ' selected' : ''}`}
                    disabled={busy || suggestion.available === false}
                    onClick={() => setSelectedAffiliationId(suggestion.affiliationId)}
                  >
                    <div className="hospital-cover-suggestion-avatar">
                      {suggestion.staffPhotoUrl ? (
                        <img src={suggestion.staffPhotoUrl} alt="" />
                      ) : (
                        <RoleAvatarIcon
                          role={roleLabel(suggestion.staffRole)}
                          size={16}
                        />
                      )}
                    </div>
                    <div className="hospital-cover-suggestion-copy">
                      <strong>{suggestion.staffName}</strong>
                      <span>
                        {roleLabel(suggestion.staffRole)}
                        {suggestion.specialization ? ` · ${suggestion.specialization}` : ''}
                      </span>
                      {suggestion.why ? <em>{suggestion.why}</em> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="hospital-cover-actions">
            <button
              type="button"
              className="hospital-cover-btn decline"
              disabled={busy}
              onClick={onDecline}
            >
              Decline
            </button>
            <button
              type="button"
              className="hospital-cover-btn approve"
              disabled={busy || !canApprove}
              onClick={() => onApprove(selectedAffiliationId)}
            >
              {busy ? 'Saving…' : started ? 'Shift started' : hasCover ? 'Assign' : 'No cover'}
            </button>
          </div>
        </>
      ) : null}
    </article>
  );
}

export default function HospitalCoverRequestsPanel({ onPendingCountChange }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState([]);
  const [decidingId, setDecidingId] = useState(null);
  const [filter, setFilter] = useState('pending'); // pending | all

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await staffService.getHospitalShiftSwaps({ limit: 40 });
      const list = Array.isArray(data) ? data : [];
      setRequests(list);
      const pendingCount = list.filter(
        (r) => String(r.status || '').toLowerCase() === 'pending'
      ).length;
      onPendingCountChange?.(pendingCount);
    } catch (err) {
      setRequests([]);
      setError(err.message || 'Failed to load cover requests.');
      onPendingCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => deferEffectCallback(() => {
    load();
  }), [load]);

  const pending = useMemo(
    () => requests.filter((r) => String(r.status || '').toLowerCase() === 'pending'),
    [requests]
  );

  const visible = filter === 'pending' ? pending : requests;

  const decide = async (request, { approved, replacementAffiliationId }) => {
    if (decidingId) return;
    setDecidingId(request.id);
    setError('');
    try {
      const updated = await staffService.decideShiftSwap(request.id, {
        approved,
        replacementAffiliationId,
      });
      setRequests((prev) => {
        const next = prev.map((row) => (row.id === updated.id ? updated : row));
        const pendingCount = next.filter(
          (r) => String(r.status || '').toLowerCase() === 'pending'
        ).length;
        onPendingCountChange?.(pendingCount);
        return next;
      });
    } catch (err) {
      setError(err.message || 'Could not record that decision.');
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <div className="hospital-cover-panel">
      <div className="hospital-staff-toolbar">
        <div className="hospital-cover-toolbar-copy">
          <h2>Cover requests</h2>
          <p>
            {pending.length === 0
              ? 'Nothing waiting for review'
              : pending.length === 1
                ? '1 waiting for review'
                : `${pending.length} waiting for review`}
          </p>
        </div>
        <div className="hospital-cover-toolbar-actions">
          <div className="hospital-staff-filters" role="group" aria-label="Filter cover requests">
            <button
              type="button"
              className={`hospital-nav-btn ${filter === 'pending' ? 'active' : ''}`}
              onClick={() => setFilter('pending')}
              style={{
                background: filter === 'pending' ? '#19469d' : '#ffffff',
                border: '1px solid #cbd5e1',
              }}
            >
              Pending ({pending.length})
            </button>
            <button
              type="button"
              className={`hospital-nav-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
              style={{
                background: filter === 'all' ? '#19469d' : '#ffffff',
                border: '1px solid #cbd5e1',
              }}
            >
              All ({requests.length})
            </button>
          </div>
          <button
            type="button"
            className="hospital-staff-hero-btn secondary"
            onClick={load}
            disabled={loading || Boolean(decidingId)}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="hospital-cover-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      ) : null}

      {loading && requests.length === 0 ? (
        <div className="hospital-cover-empty">Loading cover requests…</div>
      ) : visible.length === 0 ? (
        <div className="hospital-cover-empty">
          {filter === 'pending' ? 'No cover requests waiting.' : 'No cover requests yet.'}
        </div>
      ) : (
        <div className="hospital-cover-list">
          {visible.map((request) => (
            <CoverRequestCard
              key={request.id}
              request={request}
              busy={decidingId === request.id}
              onApprove={(affiliationId) =>
                decide(request, {
                  approved: true,
                  replacementAffiliationId: affiliationId,
                })
              }
              onDecline={() => decide(request, { approved: false })}
              onRanked={(ranked) =>
                setRequests((prev) => prev.map((row) => (row.id === ranked.id ? ranked : row)))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
