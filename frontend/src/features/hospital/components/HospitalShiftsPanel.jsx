import { deferEffectCallback } from '../../../shared/utils/deferEffectCallback.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import staffService from '../services/staffService';
import agentService from '../../patient/services/agentService';
import StaffSchedulingAgentChat from './StaffSchedulingAgentChat';
import SuggestWeekCalendarModal from './SuggestWeekCalendarModal';
import { proposalIdentity } from './proposalIdentity';
import { hospitalMinutesNow, hospitalToday } from '../utils/hospitalDate';
import { IconCalendar, IconDoctor, IconNurse, IconShield, RoleAvatarIcon } from './HospitalIcons';
import { IconBot } from '../../../shared/icons/AppIcons';
import useConfirmDialog from '../../../shared/hooks/useConfirmDialog';

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

// stripe: bright role colour for the card edge and legend; accent: readable text colour.
const roleCalendarStyle = {
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
  const [confirm, confirmDialog] = useConfirmDialog();
  const [activeStaff, setActiveStaff] = useState([]);
  const [booths, setBooths] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [coverage, setCoverage] = useState(null);
  // Add/edit form stays tucked away until needed, so the calendar sits near the top.
  const [formOpen, setFormOpen] = useState(false);
  const formPanelRef = useRef(null);
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

  const lowCoverageDays = coverage?.daysWithLowCoverage ?? 0;

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
    setFormOpen(true);
    requestAnimationFrame(() => formPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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
      if (editingShiftId) setFormOpen(false);
      resetForm();
      await refreshRosterQuietly();
    } catch (err) {
      setError(err.message || (editingShiftId ? 'Failed to update shift.' : 'Failed to create shift.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (shiftId) => {
    const shift = shifts.find((s) => s.shiftId === shiftId);
    const ok = await confirm({
      title: 'Delete shift?',
      message: shift
        ? `Remove ${shift.staffName || 'this staff member'}'s ${String(shift.startTime || '').slice(0, 5)}–${String(shift.endTime || '').slice(0, 5)} shift on ${String(shift.shiftDate || '').slice(0, 10)}?`
        : 'Remove this shift from the roster?',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

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
    const ok = await confirm({
      title: 'Approve selected shifts?',
      message: `Create ${pending.length} shift${pending.length === 1 ? '' : 's'} on the hospital roster? This cannot be undone from here.`,
      confirmLabel: `Approve (${pending.length})`,
    });
    if (!ok) return;
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
    const ok = await confirm({
      title: 'Decline suggestion?',
      message: `Remove ${proposal.staffName || 'this staff member'} · ${String(proposal.startTime || '').slice(0, 5)}–${String(proposal.endTime || '').slice(0, 5)} from this plan? You can reroll later for new suggestions.`,
      confirmLabel: 'Decline',
      destructive: true,
    });
    if (!ok) return;

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
          style={{ marginBottom: '16px', background: 'var(--color-error-bg)', color: 'var(--color-error)', borderColor: 'var(--color-error-border)' }}
        >
          {error}
        </div>
      )}

      <div className="hospital-section-card" style={{ marginBottom: '20px' }}>
        <div className="roster-toolbar">
          <div className="section-title-group">
            <h2 style={{ margin: 0 }}>
              <span className="section-title-icon icon-shade-blue"><IconCalendar size={22} /></span> Staff shift roster
            </h2>
            <p className="section-title-desc">
              Weekly roster with coverage insights. Overlaps and shifts over 12 hours are blocked.
            </p>
          </div>

          <div className="roster-ai-actions">
            <button
              type="button"
              className="roster-ai-btn"
              onClick={() => {
                setAgentPrompt(null);
                setShowAgentChat(true);
              }}
            >
              <IconBot size={17} className="roster-ai-bot-icon" /> Scheduling agent{' '}
              <span className="roster-ai-tag">AI</span>
            </button>
            <button
              type="button"
              className="roster-ai-btn is-primary"
              onClick={handleSuggestWeek}
              disabled={loading || suggestingWeek || staffOptions.length === 0}
            >
              {suggestingWeek ? 'Suggesting…' : 'Suggest week'} <span className="roster-ai-tag">AI</span>
            </button>
          </div>
        </div>

        <div className="roster-week-bar">
          <div className="roster-week-nav">
            <button
              type="button"
              className="roster-week-step"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              aria-label="Previous week"
            >
              ‹
            </button>
            <label className="roster-week-label" htmlFor="roster-week-start">
              <span>Week of {formatDayLabel(weekStart)} – {formatDayLabel(weekEnd)}</span>
              <input
                id="roster-week-start"
                type="date"
                aria-label="Jump to week"
                value={weekStart}
                onChange={(e) => setWeekStart(startOfWeek(e.target.value || hospitalToday()))}
              />
            </label>
            <button
              type="button"
              className="roster-week-step"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              aria-label="Next week"
            >
              ›
            </button>
            <button
              type="button"
              className="btn-hospital-secondary roster-week-btn"
              onClick={() => setWeekStart(startOfWeek(today))}
              disabled={weekStart === startOfWeek(today)}
            >
              This week
            </button>
            <button
              type="button"
              className="btn-hospital-secondary roster-week-btn"
              onClick={loadData}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {!formOpen && (
            <button
              type="button"
              className="btn-hospital-primary"
              onClick={() => {
                resetForm();
                setFormOpen(true);
              }}
              disabled={staffOptions.length === 0}
            >
              + Add shift
            </button>
          )}
        </div>

        <div className="hospital-metrics-grid hospital-metrics-grid--4" style={{ marginBottom: formOpen ? '20px' : 0 }}>
          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-blue">
              <IconDoctor size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Doctors on roster</span>
              <span className="hospital-stat-value">{coverage?.activeDoctors ?? 0}</span>
              <span className="hospital-stat-meta">Active affiliations</span>
            </div>
          </div>
          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-green">
              <IconNurse size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Nurses on roster</span>
              <span className="hospital-stat-value">{coverage?.activeNurses ?? 0}</span>
              <span className="hospital-stat-meta">Active affiliations</span>
            </div>
          </div>
          <div className="hospital-stat-card">
            <div className="hospital-stat-icon stat-icon-blue">
              <IconCalendar size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Shifts this week</span>
              <span className="hospital-stat-value">{shifts.length}</span>
              <span className="hospital-stat-meta">Across all booths</span>
            </div>
          </div>
          <div className="hospital-stat-card">
            <div className={`hospital-stat-icon ${lowCoverageDays > 0 ? 'stat-icon-amber' : 'stat-icon-green'}`}>
              <IconShield size={22} />
            </div>
            <div className="hospital-stat-info">
              <span className="hospital-stat-label">Low coverage days</span>
              <span className="hospital-stat-value">{lowCoverageDays}</span>
              <span className={`hospital-stat-meta ${lowCoverageDays > 0 ? 'meta-warning' : 'meta-positive'}`}>
                {lowCoverageDays > 0 ? 'Need more staff' : 'Every day covered'}
              </span>
            </div>
          </div>
        </div>

        {formOpen && (
        <div className="roster-form-panel" ref={formPanelRef}>
          <h3 className="roster-form-title">{editingShiftId ? 'Edit shift' : 'Add a shift'}</h3>
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
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border-card)',
                    borderRadius: 8,
                    boxShadow: '0 8px 20px rgba(var(--rgb-primary-dark), 0.08)',
                  }}
                >
                  {filteredStaff.length === 0 ? (
                    <div style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
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
                          borderBottom: '1px solid var(--color-border-light)',
                          background: form.affiliationId === opt.value ? 'var(--color-info-bg)' : 'var(--color-surface)',
                          color: 'var(--color-text-title)',
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
                <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
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
            <button
              type="button"
              className="btn-hospital-secondary"
              onClick={() => {
                resetForm();
                setFormOpen(false);
              }}
              disabled={saving}
            >
              {editingShiftId ? 'Cancel edit' : 'Close'}
            </button>
          </div>
          {error && (
            <p role="alert" style={{ margin: 0, color: 'var(--color-error)', fontSize: '0.85rem' }}>
              {error}
            </p>
          )}

          {staffOptions.length === 0 && !loading && (
            <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
              No active staff yet. Invite and accept affiliations in the Directory tab first.
            </p>
          )}
        </form>
        </div>
        )}
      </div>

      {showAgentChat && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(var(--rgb-primary-dark), 0.65)',
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
          <p style={{ color: 'var(--color-text-muted)' }}>Loading roster...</p>
        </div>
      ) : staffCalendarRows.length === 0 ? (
        <div className="hospital-section-card">
          <p style={{ color: 'var(--color-text-muted)' }}>No active staff to show on the calendar yet.</p>
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
                            <span className="shift-week-calendar-empty" aria-label="No shift" />
                          ) : (
                            dayShifts.map((shift) => (
                              <div
                                key={shift.shiftId}
                                className="shift-week-card"
                                style={{ borderLeftColor: roleStyle.stripe }}
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
                style={{ background: roleCalendarStyle.DOCTOR.stripe }}
              />
              Doctor shift
            </span>
            <span className="shift-week-calendar-legend-item">
              <span
                className="shift-week-calendar-legend-swatch"
                style={{ background: roleCalendarStyle.NURSE.stripe }}
              />
              Nurse shift
            </span>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
