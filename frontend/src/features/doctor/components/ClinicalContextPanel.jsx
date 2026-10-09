import { useEffect, useState } from 'react';
import clinicalPatientService from '../services/clinicalPatientService';

const isActiveRecord = (r) => String(r.status || '').toLowerCase() !== 'resolved';
const isAlert = (r) => ['severe', 'critical'].includes(String(r.severity || '').toLowerCase());

/** Medical history, allergies and prior AEFI shown beside the dose decision. */
export default function ClinicalContextPanel({ patientProfileId }) {
  const [state, setState] = useState({ loading: false, error: '', history: [], vaccinations: [] });

  useEffect(() => {
    if (!patientProfileId) return undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ loading: true, error: '', history: [], vaccinations: [] });
    Promise.allSettled([
      clinicalPatientService.getMedicalTimeline(patientProfileId),
      clinicalPatientService.getVaccinationTimeline(patientProfileId),
    ]).then(([h, v]) => {
      if (cancelled) return;
      setState({
        loading: false,
        error: h.status === 'rejected' && v.status === 'rejected'
          ? 'Could not load the patient history.'
          : '',
        history: h.status === 'fulfilled' ? h.value?.records || [] : [],
        vaccinations: v.status === 'fulfilled' ? v.value?.records || [] : [],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [patientProfileId]);

  if (!patientProfileId) {
    return <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Patient history is unavailable for this booking.</p>;
  }
  if (state.loading) return <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Loading patient history…</p>;
  if (state.error) return <p style={{ fontSize: '0.8rem', color: 'var(--color-error)' }}>{state.error}</p>;

  const allergies = state.history.filter((r) => r.recordType === 'Allergy' && isActiveRecord(r));
  const conditions = state.history.filter((r) => r.recordType !== 'Allergy' && isActiveRecord(r));
  const aefi = state.vaccinations.filter((v) => v.adverseEventReported);

  const section = (title, items, render, empty) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', color: 'var(--color-text-body)', textTransform: 'uppercase' }}>
        {title}
      </div>
      {items.length === 0
        ? <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{empty}</div>
        : items.map(render)}
    </div>
  );

  return (
    <div style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
      {section('Allergies', allergies, (r, i) => (
        <div key={i} style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-error)' }}>
          {r.title}{r.severity ? ` (${r.severity})` : ''}
        </div>
      ), 'No allergies on record')}
      {section('Active conditions', conditions, (r, i) => (
        <div key={i} style={{ fontSize: '0.82rem', color: isAlert(r) ? 'var(--color-error)' : 'var(--color-text-title)', fontWeight: isAlert(r) ? 700 : 500 }}>
          {r.title} · {r.recordType}{r.severity ? ` · ${r.severity}` : ''}
        </div>
      ), 'No active conditions on record')}
      {section('Adverse events (AEFI)', aefi, (v) => (
        <div key={v.id} style={{ fontSize: '0.82rem', color: 'var(--color-error)', fontWeight: 600 }}>
          {v.vaccineName} dose {v.doseNumber}: {v.adverseEventNotes || 'Adverse event reported'}
        </div>
      ), 'No prior adverse events')}
      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        {state.vaccinations.length} prior vaccination record(s)
      </div>
    </div>
  );
}
