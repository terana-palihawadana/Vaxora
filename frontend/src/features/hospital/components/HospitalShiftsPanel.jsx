import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import staffService from '../services/staffService';
import agentService from '../../patient/services/agentService';
import StaffSchedulingAgentChat from './StaffSchedulingAgentChat';
import SuggestWeekCalendarModal from './SuggestWeekCalendarModal';
import { proposalIdentity } from './proposalIdentity';
import { hospitalMinutesNow, hospitalToday } from '../utils/hospitalDate';
import { IconCalendar, RoleAvatarIcon } from './HospitalIcons';
import { IconBot } from '../../../shared/icons/AppIcons';

function toDateInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeek(dateInput) {
  const date = new Date(`${dateInput}T00:00:00`);
  const day = date.getDay(); // 0 Sun ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  date.setDate(date.getDate() + diff);
  return toDateInputValue(date);
}

function addDays(dateInput, days) {
  const date = new Date(`${dateInput}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function formatDayLabel(dateInput) {
  const date = new Date(`${dateInput}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDayHeader(dateInput) {
  const date = new Date(`${dateInput}T00:00:00`);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    dateLabel: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  };
}

function shiftDurationMinutes(shift) {
  const start = String(shift.startTime || '00:00').slice(0, 5);
  const end = String(shift.endTime || '00:00').slice(0, 5);
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

function formatHours(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function formatShiftTime(shift) {
  return `${String(shift.startTime).slice(0, 5)} – ${String(shift.endTime).slice(0, 5)}`;
}

function validateShiftForm({ shiftDate, startTime, endTime }, { isEdit = false, originalDate = '', originalStart = '' } = {}) {
  const today = hospitalToday();
  if (shiftDate < today) {
    return 'Shifts cannot be scheduled on past dates.';
  }

  if (endTime <= startTime) {
    return 'End time must be after start time.';
  }

  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const durationHours = (endH * 60 + endM - (startH * 60 + startM)) / 60;
  if (durationHours > 12) {
    return 'A single shift cannot exceed 12 hours.';
  }

  if (shiftDate === today) {
    const startUnchanged =
      isEdit &&
      originalDate === shiftDate &&
      String(originalStart).slice(0, 5) === String(startTime).slice(0, 5);

    // Editing an already-started today shift (booth/notes/end) must still be allowed.
    if (!startUnchanged) {
      const startMinutes = startH * 60 + startM;
      if (startMinutes < hospitalMinutesNow()) {
        return 'Shift start time cannot be in the past.';
      }
    }
  }

  return '';
}

const emptyForm = {
  affiliationId: '',
  shiftDate: hospitalToday(),
  startTime: '08:00',
  endTime: '16:00',
  boothId: '',
  notes: '',
};

const weekNavButtonStyle = {
  border: 'none',
  background: '#ffffff',
  color: '#19469d',
  fontSize: '1.1rem',
  fontWeight: 700,
  lineHeight: 1,
  padding: '8px 14px',
  cursor: 'pointer',
};

const roleCalendarStyle = {
  DOCTOR: { accent: '#6366f1', bg: '#eef2ff', border: '#c7d2fe', label: 'Doctor' },
  NURSE: { accent: '#059669', bg: '#ecfdf5', border: '#a7f3d0', label: 'Nurse' },
};

function normalizeProposalTime(value) {
  const s = String(value || '').trim();
  if (s.length === 5) return `${s}:00`;
  return s;
}

function shiftPayloadFromProposal(proposal) {
  return {
    affiliationId: proposal.affiliationId,
    shiftDate: String(proposal.shiftDate).slice(0, 10),
    startTime: normalizeProposalTime(proposal.startTime),
    endTime: normalizeProposalTime(proposal.endTime),
    boothId: proposal.boothId || null,
    boothOrStation: proposal.boothOrStation || null,
    notes: proposal.notes || 'Approved via Staff Scheduling Agent',
  };
}

export default function HospitalShiftsPanel() {
  const [activeStaff, setActiveStaff] = useState([]);
  const [booths, setBooths] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editingShiftId, setEditingShiftId] = useState(null);
  /** Original date/start of the shift being edited — allows saving booth/notes on an already-started today slot. */
  const [editingOriginal, setEditingOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAgentChat, setShowAgentChat] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState(null);
  const [pendingProposals, setPendingProposals] = useState([]);
  const [proposalWorkflowId, setProposalWorkflowId] = useState(null);
  const [suggestingWeek, setSuggestingWeek] = useState(false);
  const [suggestRerollSeed, setSuggestRerollSeed] = useState(0);
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [suggestModalError, setSuggestModalError] = useState('');
  const [proposalActionId, setProposalActionId] = useState(null);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [staffQuery, setStaffQuery] = useState('');
  const [staffMenuOpen, setStaffMenuOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(startOfWeek(hospitalToday()));

  const today = useMemo(() => hospitalToday(), []);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const toastTimerRef = useRef(null);

  const showToast = (message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setError('');
    try {
      const [staff, shiftList, boothList] = await Promise.all([
        staffService.getHospitalStaff({ status: 'Active' }),
        staffService.getHospitalShifts({ from: weekStart, to: weekEnd }),
        staffService.getHospitalBooths({ activeOnly: true }).catch(() => []),
      ]);

      setActiveStaff(Array.isArray(staff) ? staff : []);
      setShifts(Array.isArray(shiftList) ? shiftList : []);
      setBooths(Array.isArray(boothList) ? boothList : []);

      try {
        const coverageReport = await staffService.getCoverage({ from: weekStart, to: weekEnd });
        setCoverage(coverageReport || null);
      } catch {
        // Coverage is optional UI — don't block the roster with a hard error banner.
        setCoverage(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to load shifts.');
      if (!silent) {
        setActiveStaff([]);
        setShifts([]);
        setBooths([]);
        setCoverage(null);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [weekStart, weekEnd]);

  useEffect(() => deferEffectCallback(() => {
    loadData();
  }), [loadData]);

  /** Refresh shifts + coverage without blanking the calendar. */
  const refreshRosterQuietly = useCallback(async () => {
    try {
      const [shiftList, coverageReport, boothList] = await Promise.all([
        staffService.getHospitalShifts({ from: weekStart, to: weekEnd }),
        staffService.getCoverage({ from: weekStart, to: weekEnd }).catch(() => null),
        staffService.getHospitalBooths({ activeOnly: true }).catch(() => []),
      ]);
      setShifts(Array.isArray(shiftList) ? shiftList : []);
      if (coverageReport) setCoverage(coverageReport);
      setBooths(Array.isArray(boothList) ? boothList : []);
    } catch (err) {
      setError(err.message || 'Failed to refresh roster.');
    }
  }, [weekStart, weekEnd]);
  const staffOptions = useMemo(
    () =>
      activeStaff.map((s) => ({
        value: s.affiliationId,
        label: `${s.staffName} · ${s.staffRole === 'DOCTOR' ? 'Doctor' : 'Nurse'} · ${s.staffRegistrationNumber}`,
        search: `${s.staffName} ${s.staffRole} ${s.staffRegistrationNumber}`.toLowerCase(),
      })),
    [activeStaff]
  );

  const filteredStaff = useMemo(() => {
    const query = staffQuery.trim().toLowerCase();
    if (!query) return staffOptions;
    return staffOptions.filter((opt) => opt.search.includes(query));
  }, [staffOptions, staffQuery]);

  const staffCalendarRows = useMemo(() => {
    const sorted = [...activeStaff].sort((a, b) => {
      const roleOrder = { DOCTOR: 0, NURSE: 1 };
      const roleDiff = (roleOrder[a.staffRole] ?? 2) - (roleOrder[b.staffRole] ?? 2);
      if (roleDiff !== 0) return roleDiff;
      return String(a.staffName || '').localeCompare(String(b.staffName || ''));
    });
    return sorted.map((member) => {
      let weekMinutes = 0;
      const byDay = {};
      weekDays.forEach((day) => {
        byDay[day] = [];
      });
      shifts.forEach((shift) => {
        if (shift.affiliationId !== member.affiliationId) return;
        const day = String(shift.shiftDate).slice(0, 10);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(shift);
        weekMinutes += shiftDurationMinutes(shift);
      });
      weekDays.forEach((day) => {
        byDay[day].sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
      });
      return { member, byDay, weekMinutes };
    });
  }, [activeStaff, shifts, weekDays]);

  const applyAgentProposals = useCallback((proposals, meta = {}) => {
    const list = Array.isArray(proposals) ? proposals.filter(Boolean) : [];
    if (list.length === 0) return;
    setSuggestModalError('');
    setPendingProposals(list.map((p) => ({ ...p, _status: undefined, _selected: true })));
    setProposalWorkflowId(meta.workflowId || null);
    setShowSuggestModal(true);
    showToast(`${list.length} suggested shift${list.length === 1 ? '' : 's'} — select which to keep in the calendar window.`);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = (keepDate = true) => {
    setEditingShiftId(null);
    setEditingOriginal(null);
    setStaffQuery('');
    setStaffMenuOpen(false);
    setForm((prev) => ({ ...emptyForm, shiftDate: keepDate ? prev.shiftDate : emptyForm.shiftDate }));
  };

  const beginEdit = (shift) => {
    const date = String(shift.shiftDate).slice(0, 10);
    const startTime = String(shift.startTime).slice(0, 5);
    setEditingShiftId(shift.shiftId);
    setEditingOriginal({ date, startTime });
    setStaffQuery(`${shift.staffName || 'Staff'} · ${shift.staffRole === 'DOCTOR' ? 'Doctor' : 'Nurse'}`);
    setStaffMenuOpen(false);
    setForm({
      affiliationId: shift.affiliationId,
      shiftDate: date,
      startTime,
      endTime: String(shift.endTime).slice(0, 5),
      boothId: shift.boothId || '',
      notes: shift.notes || '',
    });
    setError('');
  };

  const handleSaveShift = async (e) => {
    e.preventDefault();
    if (!form.affiliationId) {
      setError('Select an active staff member.');
      return;
    }

    const formError = validateShiftForm(form, {
      isEdit: Boolean(editingShiftId),
      originalDate: editingOriginal?.date || '',
      originalStart: editingOriginal?.startTime || '',
    });
    if (formError) {
      setError(formError);
      return;
    }

    const payload = {
      shiftDate: form.shiftDate,
      startTime: form.startTime.length === 5 ? `${form.startTime}:00` : form.startTime,
      endTime: form.endTime.length === 5 ? `${form.endTime}:00` : form.endTime,
      boothId: form.boothId || null,
      boothOrStation: null,
      notes: form.notes || null,
    };

    setSaving(true);
    setError('');
    try {
      if (editingShiftId) {
        await staffService.updateShift(editingShiftId, payload);
        showToast('Shift updated.');
      } else {
        await staffService.createShift({
          affiliationId: form.affiliationId,
          ...payload,
        });
        showToast('Shift created.');
      }
      resetForm();
      await refreshRosterQuietly();
    } catch (err) {
      setError(err.message || (editingShiftId ? 'Failed to update shift.' : 'Failed to create shift.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (shiftId) => {
    setActionId(shiftId);
    setError('');
    // Optimistic remove so the calendar does not flash / remount.
    const previousShifts = shifts;
    setShifts((prev) => prev.filter((s) => s.shiftId !== shiftId));
    try {
      await staffService.deleteShift(shiftId);
      showToast('Shift deleted.');
      await refreshRosterQuietly();
    } catch (err) {
      setShifts(previousShifts);
      setError(err.message || 'Failed to delete shift.');
    } finally {
      setActionId(null);
    }
  };

  const handleSuggestWeek = async () => {
    setSuggestingWeek(true);
    setShowSuggestModal(true);
    setPendingProposals([]);
    setSuggestModalError('');
    setSuggestRerollSeed(0);
    try {
      const res = await agentService.sendMessage(
        [
          {
            role: 'user',
            content: `Suggest shifts for booked appointments from ${weekStart} to ${weekEnd}`,
          },
        ],
        { targetAgent: 'StaffSchedulingAgent' }
      );
      const proposals = Array.isArray(res.proposals)
        ? res.proposals
        : res.proposal
          ? [res.proposal]
          : [];
      if (proposals.length === 0) {
        setSuggestModalError(
          res.content ||
            'No new shifts to propose — this week looks fully covered already. Approval cards only appear when there are gaps. Try another week, add schedules/booths, or clear some existing shifts first.'
        );
        return;
      }
      applyAgentProposals(proposals, {
        workflowId: res.workflowId || res.WorkflowId || null,
      });
    } catch (err) {
      // AI agent unavailable: fall back to the rules-based backend suggestions.
      try {
        const fallback = await staffService.suggestWeek({ from: weekStart, to: weekEnd });
        const list = Array.isArray(fallback?.proposals) ? fallback.proposals : [];
        if (list.length === 0) {
          setSuggestModalError(fallback?.message || 'No new shifts to propose for this week.');
        } else {
          applyAgentProposals(list, {});
        }
      } catch (fallbackErr) {
        setSuggestModalError(fallbackErr.message || err.message || 'Failed to suggest week shifts.');
      }
    } finally {
      setSuggestingWeek(false);
    }
  };

  const handleRerollSuggestWeek = async () => {
    const excludeIds = [
      ...new Set(
        pendingProposals
          .filter((p) => p._status !== 'approved' && p._status !== 'declined')
          .map((p) => String(p.affiliationId || ''))
          .filter(Boolean)
      ),
    ];
    const nextSeed = suggestRerollSeed + 1;
    setSuggestRerollSeed(nextSeed);
    setSuggestingWeek(true);
    setSuggestModalError('');
    setPendingProposals([]);
    try {
      const excludeClause =
        excludeIds.length > 0
          ? ` Reroll exclude affiliation ids: ${excludeIds.join(',')}.`
          : '';
      const res = await agentService.sendMessage(
        [
          {
            role: 'user',
            content: `Suggest shifts for booked appointments from ${weekStart} to ${weekEnd}. Reroll seed: ${nextSeed}.${excludeClause}`,
          },
        ],
        { targetAgent: 'StaffSchedulingAgent' }
      );
      const proposals = Array.isArray(res.proposals)
        ? res.proposals
        : res.proposal
          ? [res.proposal]
          : [];
      if (proposals.length === 0) {
        setSuggestModalError(
          res.content ||
            'No alternate suggestions available. Try again or post more vaccine schedules.'
        );
        return;
      }
      applyAgentProposals(proposals, {
        workflowId: res.workflowId || res.WorkflowId || null,
      });
    } catch (err) {
      setSuggestModalError(err.message || 'Failed to reroll week suggestions.');
    } finally {
      setSuggestingWeek(false);
    }
  };

  const handleCloseAgentChat = () => {
    setShowAgentChat(false);
    setAgentPrompt(null);
  };

  const handleToggleProposalSelect = (id) => {
    setPendingProposals((prev) =>
      prev.map((p) =>
        proposalIdentity(p) === id ? { ...p, _selected: !p._selected } : p
      )
    );
  };

  const handleSelectAllProposals = () => {
    setPendingProposals((prev) =>
      prev.map((p) =>
        p._status === 'approved' || p._status === 'declined'
          ? p
          : { ...p, _selected: true }
      )
    );
  };

  const handleClearProposalSelection = () => {
    setPendingProposals((prev) => prev.map((p) => ({ ...p, _selected: false })));
  };

  const handleApproveSelectedProposals = async () => {
    const pending = pendingProposals.filter(
      (p) => p._selected && p._status !== 'approved' && p._status !== 'declined'
    );
    if (pending.length === 0) return;
    setProposalActionId('batch');
    setError('');
    const approvedIds = new Set();
    const failed = [];
    for (const proposal of pending) {
      try {
        await staffService.createShift(shiftPayloadFromProposal(proposal));
        approvedIds.add(proposalIdentity(proposal));
      } catch {
        failed.push(proposal.staffName || 'A shift');
      }
    }

    const nextProposals = pendingProposals.map((p) =>
      approvedIds.has(proposalIdentity(p)) ? { ...p, _status: 'approved', _selected: false } : p
    );
    const leftAfter = nextProposals.filter(
      (p) => p._status !== 'approved' && p._status !== 'declined'
    ).length;
    setPendingProposals(nextProposals);

    if (proposalWorkflowId && leftAfter === 0 && failed.length === 0) {
      try {
        await agentService.recordDecision(proposalWorkflowId, {
          approved: true,
          note: 'Approved selected shifts from suggest-week calendar',
        });
      } catch {
        /* optional */
      }
      setProposalWorkflowId(null);
    }
    if (failed.length > 0) {
      setError(`Could not create: ${failed.join(', ')}`);
    } else {
      showToast(`${approvedIds.size} shift${approvedIds.size === 1 ? '' : 's'} created.`);
    }
    setProposalActionId(null);
    await refreshRosterQuietly();
    if (leftAfter === 0 && failed.length === 0) {
      setShowSuggestModal(false);
      setPendingProposals([]);
    }
  };

  const handleDeclineProposal = async (proposal) => {
    const id = proposalIdentity(proposal);
    setProposalActionId(id);
    setError('');
    // Declining never depends on the agent; an alternative is a bonus when it answers.
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
              startTime: normalizeProposalTime(proposal.startTime),
              endTime: normalizeProposalTime(proposal.endTime),
              requestAlternative: Boolean(proposal.gapId),
            })}`,
          },
        ],
        { targetAgent: 'StaffSchedulingAgent' }
      );
      if (Array.isArray(res.proposals) && res.proposals.length > 0) {
        alternative = res.proposals[0];
      } else if (res.proposal) {
        alternative = res.proposal;
      }
    } catch {
      alternative = null;
    }

    setPendingProposals((prev) => {
      const next = prev.map((p) =>
        proposalIdentity(p) === id ? { ...p, _status: 'declined', _selected: false } : p
      );
      if (alternative) next.push({ ...alternative, _status: undefined, _selected: true });
      return next;
    });

    showToast(
      alternative
        ? `Declined — alternative: ${alternative.staffName || 'another staff member'}`
        : 'Suggestion declined.'
    );
    setProposalActionId(null);
  };

  const handleCloseSuggestModal = () => {
    setShowSuggestModal(false);
    setSuggestingWeek(false);
    setSuggestModalError('');
    setPendingProposals([]);
    setProposalWorkflowId(null);
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
          style={{ marginBottom: '16px', background: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' }}
        >
          {error}
        </div>
      )}

      <div className="hospital-section-card" style={{ marginBottom: '20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '14px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div className="section-title-group">
            <h2 style={{ margin: 0 }}>
              <span className="section-title-icon"><IconCalendar size={22} /></span> Staff Shift Roster
            </h2>
            <p className="section-title-desc">
              Weekly roster with coverage insights. Overlaps and shifts over 12 hours are blocked.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setAgentPrompt(null);
              setShowAgentChat(true);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 18px',
              background: 'linear-gradient(135deg, #0369a1 0%, #0369a1 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(2, 132, 199, 0.35)',
              transition: 'all 0.2s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <IconBot size={18} />
            <span>Open Scheduling Agent</span>
            <span
              style={{
                background: 'rgba(255, 255, 255, 0.25)',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              AI
            </span>
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
            marginBottom: '16px',
            paddingBottom: '16px',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                overflow: 'hidden',
                background: '#ffffff',
              }}
            >
              <button
                type="button"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                title="Previous week"
                style={weekNavButtonStyle}
              >
                ‹
              </button>
              <input
                type="date"
                aria-label="Week starting"
                value={weekStart}
                onChange={(e) => setWeekStart(startOfWeek(e.target.value || hospitalToday()))}
                style={{
                  border: 'none',
                  borderLeft: '1px solid #e2e8f0',
                  borderRight: '1px solid #e2e8f0',
                  padding: '8px 10px',
                  fontSize: '0.88rem',
                  color: '#0f172a',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <button
                type="button"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
                title="Next week"
                style={weekNavButtonStyle}
              >
                ›
              </button>
            </div>

            <button
              type="button"
              className="hospital-filter-btn"
              onClick={loadData}
              disabled={loading}
              style={{ padding: '8px 14px' }}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleSuggestWeek}
            disabled={loading || suggestingWeek || staffOptions.length === 0}
            style={{
              padding: '9px 18px',
              borderRadius: '8px',
              border: '1px solid #19469d',
              background:
                loading || suggestingWeek || staffOptions.length === 0 ? '#e2e8f0' : '#19469d',
              color:
                loading || suggestingWeek || staffOptions.length === 0 ? '#94a3b8' : '#ffffff',
              fontSize: '0.88rem',
              fontWeight: 700,
              cursor:
                loading || suggestingWeek || staffOptions.length === 0 ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            {suggestingWeek ? 'Suggesting…' : 'Suggest Week'}
          </button>
        </div>

        <div className="hospital-metrics-grid hospital-metrics-grid--4" style={{ marginBottom: '16px' }}>
          <div className="hospital-stat-card">
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Active Doctors</span>
              <span className="hospital-stat-value">{coverage?.activeDoctors ?? 0}</span>
            </div>
          </div>
          <div className="hospital-stat-card">
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Active Nurses</span>
              <span className="hospital-stat-value">{coverage?.activeNurses ?? 0}</span>
            </div>
          </div>
          <div className="hospital-stat-card">
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Low Coverage Days</span>
              <span className="hospital-stat-value" style={{ color: '#b91c1c' }}>
                {coverage?.daysWithLowCoverage ?? 0}
              </span>
            </div>
          </div>
          <div className="hospital-stat-card">
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Week</span>
              <span className="hospital-stat-value" style={{ fontSize: '1rem' }}>
                {weekStart} → {weekEnd}
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveShift} style={{ display: 'grid', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div className="modal-form-group" style={{ margin: 0, position: 'relative' }}>
              <label className="modal-label" htmlFor="shift-staff-search">Staff *</label>
              <input
                id="shift-staff-search"
                type="text"
                className="modal-input"
                value={staffQuery}
                placeholder="Search name or ID"
                autoComplete="off"
                disabled={Boolean(editingShiftId)}
                onFocus={() => {
                  if (!editingShiftId) setStaffMenuOpen(true);
                }}
                onBlur={() => {
                  setTimeout(() => setStaffMenuOpen(false), 150);
                }}
                onChange={(e) => {
                  setStaffQuery(e.target.value);
                  setStaffMenuOpen(true);
                  setForm((prev) => ({ ...prev, affiliationId: '' }));
                }}
              />
              {staffMenuOpen && !editingShiftId && (
                <div
                  role="listbox"
                  aria-label="Active staff"
                  style={{
                    position: 'absolute',
                    zIndex: 20,
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    maxHeight: 220,
                    overflowY: 'auto',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
                  }}
                >
                  {filteredStaff.length === 0 ? (
                    <div style={{ padding: '10px 12px', color: '#64748b', fontSize: '0.85rem' }}>
                      No matching staff
                    </div>
                  ) : (
                    filteredStaff.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="option"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setForm((prev) => ({ ...prev, affiliationId: opt.value }));
                          setStaffQuery(opt.label);
                          setStaffMenuOpen(false);
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 12px',
                          border: 'none',
                          borderBottom: '1px solid #f1f5f9',
                          background: form.affiliationId === opt.value ? '#eff6ff' : '#ffffff',
                          color: '#0f172a',
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="modal-form-group" style={{ margin: 0 }}>
              <label className="modal-label" htmlFor="shift-date">Date *</label>
              <input
                id="shift-date"
                type="date"
                name="shiftDate"
                value={form.shiftDate}
                onChange={handleChange}
                className="modal-input"
                min={today}
                required
              />
            </div>

            <div className="modal-form-group" style={{ margin: 0 }}>
              <label className="modal-label" htmlFor="shift-start">Start *</label>
              <input
                id="shift-start"
                type="time"
                name="startTime"
                value={form.startTime}
                onChange={handleChange}
                className="modal-input"
                required
              />
            </div>

            <div className="modal-form-group" style={{ margin: 0 }}>
              <label className="modal-label" htmlFor="shift-end">End *</label>
              <input
                id="shift-end"
                type="time"
                name="endTime"
                value={form.endTime}
                onChange={handleChange}
                className="modal-input"
                required
              />
            </div>

            <div className="modal-form-group" style={{ margin: 0 }}>
              <label className="modal-label" htmlFor="shift-booth">Booth</label>
              <select
                id="shift-booth"
                name="boothId"
                value={form.boothId}
                onChange={handleChange}
                className="modal-select"
              >
                <option value="">No booth assigned</option>
                {booths.map((booth) => (
                  <option key={booth.boothId} value={booth.boothId}>
                    {booth.displayLabel || `${booth.code} · ${booth.name}`}
                  </option>
                ))}
              </select>
              {booths.length === 0 && (
                <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  Add booths under Booths to assign stations here.
                </p>
              )}
            </div>
          </div>

          <div className="modal-form-group" style={{ margin: 0 }}>
            <label className="modal-label" htmlFor="shift-notes">Notes</label>
            <input
              id="shift-notes"
              type="text"
              name="notes"
              value={form.notes}
              onChange={handleChange}
              className="modal-input"
              placeholder="Optional"
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="submit" className="btn-hospital-primary" disabled={saving || staffOptions.length === 0}>
              {saving ? 'Saving...' : editingShiftId ? 'Save Changes' : 'Create Shift'}
            </button>
            {editingShiftId && (
              <button type="button" className="btn-hospital-secondary" onClick={() => resetForm()} disabled={saving}>
                Cancel
              </button>
            )}
          </div>
          {error && (
            <p role="alert" style={{ margin: 0, color: '#b91c1c', fontSize: '0.85rem' }}>
              {error}
            </p>
          )}

          {staffOptions.length === 0 && !loading && (
            <p style={{ color: '#64748b', margin: 0 }}>
              No active staff yet. Invite and accept affiliations in the Directory tab first.
            </p>
          )}
        </form>
      </div>

      {showAgentChat && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseAgentChat();
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '760px',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            }}
          >
            <StaffSchedulingAgentChat
              weekStart={weekStart}
              weekEnd={weekEnd}
              initialPrompt={agentPrompt}
              onShiftsChanged={refreshRosterQuietly}
              onProposalsReady={(proposals, meta) => {
                applyAgentProposals(proposals, meta);
                handleCloseAgentChat();
              }}
              onClose={handleCloseAgentChat}
            />
          </div>
        </div>
      )}

      {showSuggestModal && (
        <SuggestWeekCalendarModal
          weekStart={weekStart}
          weekEnd={weekEnd}
          weekDays={weekDays}
          today={today}
          activeStaff={activeStaff}
          proposals={pendingProposals}
          actionId={proposalActionId}
          loading={suggestingWeek}
          error={suggestModalError}
          onToggleSelect={handleToggleProposalSelect}
          onSelectAll={handleSelectAllProposals}
          onClearSelection={handleClearProposalSelection}
          onApproveSelected={handleApproveSelectedProposals}
          onDecline={handleDeclineProposal}
          onReroll={handleRerollSuggestWeek}
          onClose={handleCloseSuggestModal}
        />
      )}

      <h3 style={{ margin: '0 0 12px' }}>Week calendar</h3>
      {loading ? (
        <div className="hospital-section-card">
          <p style={{ color: '#64748b' }}>Loading roster...</p>
        </div>
      ) : staffCalendarRows.length === 0 ? (
        <div className="hospital-section-card">
          <p style={{ color: '#64748b' }}>No active staff to show on the calendar yet.</p>
        </div>
      ) : (
        <div className="shift-week-calendar">
          <div className="shift-week-calendar-scroll">
            <div className="shift-week-calendar-grid">
              <div className="shift-week-calendar-corner">
                <span className="shift-week-calendar-corner-label">Staff</span>
                <span className="shift-week-calendar-corner-sub">
                  {formatDayLabel(weekStart)} – {formatDayLabel(weekEnd)}
                </span>
              </div>

              {weekDays.map((day) => {
                const header = formatDayHeader(day);
                const isToday = day === today;
                return (
                  <div
                    key={`head-${day}`}
                    className={`shift-week-calendar-day-head ${isToday ? 'is-today' : ''}`}
                  >
                    <div className="shift-week-calendar-day-top">
                      <span className="shift-week-calendar-weekday">{header.weekday}</span>
                      {isToday ? <span className="shift-week-calendar-today-pill">Today</span> : null}
                    </div>
                    <span className="shift-week-calendar-date">{header.dateLabel}</span>
                  </div>
                );
              })}

              <div className="shift-week-calendar-total-head">Hours</div>

              {staffCalendarRows.map(({ member, byDay, weekMinutes }) => {
                const roleKey = String(member.staffRole || '').toUpperCase();
                const roleStyle = roleCalendarStyle[roleKey] || roleCalendarStyle.NURSE;
                const avatarRole = roleKey === 'DOCTOR' ? 'Doctor' : 'Nurse';
                const photoUrl = member.staffProfilePhotoUrl || null;
                const subtitle = member.specialization || roleStyle.label;

                return (
                  <React.Fragment key={member.affiliationId}>
                    <div className="shift-week-calendar-staff">
                      <div
                        className={`shift-week-calendar-avatar${photoUrl ? ' has-photo' : ''}`}
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
                            className="shift-week-calendar-avatar-img"
                          />
                        ) : (
                          <RoleAvatarIcon role={avatarRole} size={16} />
                        )}
                      </div>
                      <div className="shift-week-calendar-staff-text">
                        <span className="shift-week-calendar-staff-name">{member.staffName}</span>
                        <span
                          className="shift-week-calendar-staff-role"
                          style={{ color: roleStyle.accent }}
                        >
                          {subtitle}
                        </span>
                      </div>
                    </div>

                    {weekDays.map((day) => {
                      const dayShifts = byDay[day] || [];
                      const isToday = day === today;
                      return (
                        <div
                          key={`${member.affiliationId}-${day}`}
                          className={`shift-week-calendar-cell ${isToday ? 'is-today' : ''}`}
                        >
                          {dayShifts.length === 0 ? (
                            <span className="shift-week-calendar-empty">—</span>
                          ) : (
                            dayShifts.map((shift) => (
                              <div
                                key={shift.shiftId}
                                className="shift-week-card"
                                style={{ borderLeftColor: roleStyle.accent }}
                              >
                                <div className="shift-week-card-time">{formatShiftTime(shift)}</div>
                                <div
                                  className="shift-week-card-role"
                                  style={{ color: roleStyle.accent }}
                                >
                                  {roleStyle.label}
                                </div>
                                {shift.boothOrStation ? (
                                  <div className="shift-week-card-booth">{shift.boothOrStation}</div>
                                ) : null}
                                <div className="shift-week-card-actions">
                                  {String(shift.shiftDate).slice(0, 10) >= today && (
                                    <button
                                      type="button"
                                      onClick={() => beginEdit(shift)}
                                      disabled={saving || actionId === shift.shiftId}
                                      className="shift-week-card-action shift-week-card-action-edit"
                                    >
                                      {editingShiftId === shift.shiftId ? 'Editing' : 'Edit'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(shift.shiftId)}
                                    disabled={actionId === shift.shiftId}
                                    className="shift-week-card-action shift-week-card-action-delete"
                                  >
                                    {actionId === shift.shiftId ? 'Deleting...' : 'Delete'}
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })}

                    <div className="shift-week-calendar-total">
                      <span>{formatHours(weekMinutes)}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div className="shift-week-calendar-legend">
            <span className="shift-week-calendar-legend-item">
              <span
                className="shift-week-calendar-legend-swatch"
                style={{ background: '#6366f1' }}
              />
              Doctor shift
            </span>
            <span className="shift-week-calendar-legend-item">
              <span
                className="shift-week-calendar-legend-swatch"
                style={{ background: '#059669' }}
              />
              Nurse shift
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
