/** Normalize appointment Status from the API for patient UI comparisons. */
export function normalizePatientAppointmentStatus(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/**
 * Patient-facing status badge for appointments (label + colors).
 */
export function getPatientAppointmentStatusDisplay(status) {
  const s = normalizePatientAppointmentStatus(status);

  switch (s) {
    case 'confirmed':
    case 'accepted':
      return { label: 'Confirmed', backgroundColor: 'var(--color-success-bg)', color: 'var(--color-success)' };
    case 'pendingpayment':
      return { label: 'Awaiting payment', backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    case 'pending':
      return { label: 'Pending', backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
    case 'administering':
    case 'insession':
      return { label: 'In session', backgroundColor: 'var(--color-info-bg)', color: 'var(--color-info)' };
    case 'observation':
      return { label: 'Observation', backgroundColor: 'var(--color-ai-bg)', color: 'var(--color-ai)' };
    case 'completed':
      return { label: 'Completed', backgroundColor: 'var(--color-success-bg)', color: 'var(--color-success)' };
    case 'cancelled':
      return { label: 'Cancelled', backgroundColor: 'var(--color-error-bg)', color: 'var(--color-error)' };
    case 'rejected':
      return { label: 'Rejected', backgroundColor: 'var(--color-error-bg)', color: 'var(--color-error)' };
    default:
      return {
        label: status || 'Unknown',
        backgroundColor: 'var(--color-surface-subtle)',
        color: 'var(--color-text-body)',
      };
  }
}

/** Patient can only cancel before the clinical session starts. */
export function canPatientCancelByStatus(status) {
  const s = normalizePatientAppointmentStatus(status);
  return (
    s === 'confirmed' ||
    s === 'accepted' ||
    s === 'pending' ||
    s === 'pendingpayment'
  );
}
