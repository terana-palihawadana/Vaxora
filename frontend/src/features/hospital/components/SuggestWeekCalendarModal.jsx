import React, { useMemo, useState } from 'react';
import { IconClose, IconRefresh } from '../../../shared/icons/AppIcons';
import { RoleAvatarIcon } from './HospitalIcons';
import { proposalIdentity } from './proposalIdentity';

function formatDayHeader(dateInput) {
  const date = new Date(`${dateInput}T00:00:00`);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    dateLabel: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  };
}

function formatDayRange(from, to) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return `${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// Same role colours as the live roster: bright stripe, readable accent text.
const roleStyleMap = {
  DOCTOR: {
    stripe: 'var(--color-role-doctor)',
    accent: 'var(--color-blue)',
    bg: 'var(--color-blue-bg)',
    border: 'var(--color-blue-border)',
    label: 'Doctor',
  },
  NURSE: {
    stripe: 'var(--color-role-nurse)',
    accent: 'var(--color-success)',
    bg: 'var(--color-success-bg)',
    border: 'var(--color-success-border)',
    label: 'Nurse',
  },
};

/**
 * Separate full-week calendar window for reviewing agent shift suggestions.
 * Not the live roster calendar — select cards here, then approve.
 */
export default function SuggestWeekCalendarModal({
  weekStart,
  weekEnd,
  weekDays,
  today,
  activeStaff,
  proposals,
  actionId,
  loading,
  error,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onApproveSelected,
  onDecline,
  onReroll,
  onClose,
}) {
  const [filterRole, setFilterRole] = useState('ALL');

  const pending = useMemo(
    () => (proposals || []).filter((p) => p._status !== 'approved' && p._status !== 'declined'),
    [proposals]
  );

  const selectedCount = useMemo(
    () => pending.filter((p) => p._selected).length,
    [pending]
  );

  const rows = useMemo(() => {
    const byAffiliation = new Map();
    for (const proposal of pending) {
      const key = String(proposal.affiliationId || '');
      if (!byAffiliation.has(key)) byAffiliation.set(key, []);
      byAffiliation.get(key).push(proposal);
    }

    const staffById = new Map(
      (activeStaff || []).map((s) => [String(s.affiliationId), s])
    );

    const list = [];
    for (const [affiliationId, items] of byAffiliation) {
      const fromRoster = staffById.get(affiliationId);
      const member = {
        affiliationId,
        staffName: fromRoster?.staffName || items[0]?.staffName || 'Staff',
        staffRole: fromRoster?.staffRole || items[0]?.staffRole || 'NURSE',
        specialization:
          fromRoster?.specialization || items[0]?.specialization || '',
        staffProfilePhotoUrl: fromRoster?.staffProfilePhotoUrl || null,
      };
      const roleKey = String(member.staffRole || '').toUpperCase();
      if (filterRole !== 'ALL' && roleKey !== filterRole) continue;

      const byDay = {};
      weekDays.forEach((day) => {
        byDay[day] = [];
      });
      items.forEach((proposal) => {
        const day = String(proposal.shiftDate).slice(0, 10);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(proposal);
      });
      weekDays.forEach((day) => {
        byDay[day].sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
      });
      list.push({ member, byDay, roleKey });
    }

    list.sort((a, b) => {
      const roleOrder = { DOCTOR: 0, NURSE: 1 };
      const roleDiff = (roleOrder[a.roleKey] ?? 2) - (roleOrder[b.roleKey] ?? 2);
      if (roleDiff !== 0) return roleDiff;
      return String(a.member.staffName || '').localeCompare(String(b.member.staffName || ''));
    });
    return list;
  }, [pending, activeStaff, weekDays, filterRole]);

  return (
    <div
      className="suggest-week-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="suggest-week-modal" role="dialog" aria-modal="true" aria-labelledby="suggest-week-title">
        <header className="suggest-week-modal-header">
          <div>
            <h2 id="suggest-week-title">Suggested week</h2>
            <p>
              {formatDayRange(weekStart, weekEnd)} · click cards to select, then approve
            </p>
          </div>
          <button type="button" className="suggest-week-modal-close" onClick={onClose} aria-label="Close">
            <IconClose size={18} />
          </button>
        </header>

        <div className="suggest-week-modal-toolbar">
          <div className="suggest-week-modal-toolbar-left">
            <span className="suggest-week-modal-count">
              {pending.length} suggestion{pending.length === 1 ? '' : 's'}
              {selectedCount > 0 ? ` · ${selectedCount} selected` : ''}
            </span>
            <div className="suggest-week-modal-filters">
              {['ALL', 'DOCTOR', 'NURSE'].map((role) => (
                <button
                  key={role}
                  type="button"
                  className={`suggest-week-filter${filterRole === role ? ' is-active' : ''}`}
                  onClick={() => setFilterRole(role)}
                >
                  {role === 'ALL' ? 'All' : role === 'DOCTOR' ? 'Doctors' : 'Nurses'}
                </button>
              ))}
            </div>
          </div>
          <div className="suggest-week-modal-toolbar-actions">
            <button
              type="button"
              className="suggest-week-btn ghost suggest-week-btn-reroll"
              onClick={onReroll}
              disabled={loading || !onReroll}
              title="Generate a different set of suggestions"
            >
              <IconRefresh size={14} />
              Reroll
            </button>
            <button type="button" className="suggest-week-btn ghost" onClick={onSelectAll} disabled={loading || pending.length === 0}>
              Select all
            </button>
            <button type="button" className="suggest-week-btn ghost" onClick={onClearSelection} disabled={loading || selectedCount === 0}>
              Clear selection
            </button>
            <button
              type="button"
              className="suggest-week-btn primary"
              onClick={onApproveSelected}
              disabled={loading || selectedCount === 0 || actionId === 'batch'}
            >
              {actionId === 'batch' ? 'Approving…' : `Approve selected (${selectedCount})`}
            </button>
          </div>
        </div>

        <div className="suggest-week-modal-body">
          {loading ? (
            <div className="suggest-week-modal-waiting">
              <div className="suggest-week-modal-waiting-icon" aria-hidden>
                🤖
              </div>
              <h3>Agent is working…</h3>
              <p>Suggest Week — agent is working</p>
              <div className="suggest-week-modal-waiting-track">
                <div className="suggest-week-modal-waiting-bar" />
              </div>
            </div>
          ) : error ? (
            <div className="suggest-week-modal-error" role="alert">
              {error}
            </div>
          ) : pending.length === 0 ? (
            <div className="suggest-week-modal-empty">
              No pending suggestions. Close this window or run Suggest Week again.
            </div>
          ) : rows.length === 0 ? (
            <div className="suggest-week-modal-empty">No suggestions match this filter.</div>
          ) : (
            <div className="suggest-week-calendar-scroll">
              <div className="suggest-week-calendar-grid">
                <div className="suggest-week-calendar-corner">
                  <span className="suggest-week-calendar-corner-label">Staff</span>
                </div>
                {weekDays.map((day) => {
                  const header = formatDayHeader(day);
                  const isToday = day === today;
                  return (
                    <div
                      key={`head-${day}`}
                      className={`suggest-week-calendar-day-head${isToday ? ' is-today' : ''}`}
                    >
                      <span className="suggest-week-calendar-weekday">{header.weekday}</span>
                      <span className="suggest-week-calendar-date">{header.dateLabel}</span>
                    </div>
                  );
                })}

                {rows.map(({ member, byDay, roleKey }) => {
                  const roleStyle = roleStyleMap[roleKey] || roleStyleMap.NURSE;
                  const avatarRole = roleKey === 'DOCTOR' ? 'Doctor' : 'Nurse';
                  const photoUrl = member.staffProfilePhotoUrl || null;
                  const subtitle = member.specialization || roleStyle.label;
                  return (
                    <React.Fragment key={member.affiliationId}>
                      <div className="suggest-week-calendar-staff">
                        <div
                          className={`suggest-week-calendar-avatar${photoUrl ? ' has-photo' : ''}`}
                          style={{
                            background: roleStyle.bg,
                            color: roleStyle.accent,
                            borderColor: roleStyle.border,
                          }}
                        >
                          {photoUrl ? (
                            <img
                              src={photoUrl}
                              alt=""
                              className="suggest-week-calendar-avatar-img"
                            />
                          ) : (
                            <RoleAvatarIcon role={avatarRole} size={16} />
                          )}
                        </div>
                        <div className="suggest-week-calendar-staff-text">
                          <span className="suggest-week-calendar-staff-name">{member.staffName}</span>
                          <span className="suggest-week-calendar-staff-role" style={{ color: roleStyle.accent }}>
                            {subtitle}
                          </span>
                        </div>
                      </div>
                      {weekDays.map((day) => {
                        const dayItems = byDay[day] || [];
                        return (
                          <div
                            key={`${member.affiliationId}-${day}`}
                            className={`suggest-week-calendar-cell${day === today ? ' is-today' : ''}`}
                          >
                            {dayItems.length === 0 ? (
                              <span className="suggest-week-calendar-empty">—</span>
                            ) : (
                              dayItems.map((proposal) => {
                                const id = proposalIdentity(proposal);
                                const selected = Boolean(proposal._selected);
                                const busy = actionId === id || actionId === 'batch';
                                return (
                                  <div
                                    key={id}
                                    className={`suggest-week-card${selected ? ' is-selected' : ''}`}
                                    style={{ borderLeftColor: roleStyle.stripe }}
                                    onClick={() => !busy && onToggleSelect(id)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        if (!busy) onToggleSelect(id);
                                      }
                                    }}
                                  >
                                    <div className="suggest-week-card-check" aria-hidden>
                                      {selected ? '✓' : ''}
                                    </div>
                                    <div className="suggest-week-card-time">
                                      {String(proposal.startTime).slice(0, 5)} –{' '}
                                      {String(proposal.endTime).slice(0, 5)}
                                    </div>
                                    {(proposal.boothOrStation || proposal.boothLabel) && (
                                      <div className="suggest-week-card-meta">
                                        {proposal.boothOrStation || proposal.boothLabel}
                                      </div>
                                    )}
                                    {proposal.vaccineName ? (
                                      <div className="suggest-week-card-meta">{proposal.vaccineName}</div>
                                    ) : null}
                                    {proposal.specialization ? (
                                      <div className="suggest-week-card-meta">{proposal.specialization}</div>
                                    ) : null}
                                    <div className="suggest-week-card-actions">
                                      <button
                                        type="button"
                                        className="suggest-week-card-decline"
                                        disabled={busy}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDecline(proposal);
                                        }}
                                      >
                                        Decline
                                      </button>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
