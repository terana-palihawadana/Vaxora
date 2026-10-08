
import { IconRocket, IconShield } from '../../../shared/icons/AppIcons';

export default function PatientAboutTab() {
  return (
    <div className="manage-appointments-wrapper">
      <div className="manage-appointments-card" style={{ padding: '36px 48px 44px' }}>
        <h1 className="history-page-title" style={{ textAlign: 'center', marginBottom: '16px' }}>
          About Vaxora Patient Portal
        </h1>
        <p
          style={{
            textAlign: 'center',
            color: 'var(--color-text-body)',
            fontFamily: "var(--font-body)",
            fontSize: '1.05rem',
            maxWidth: '680px',
            margin: '0 auto 36px',
            lineHeight: 1.6,
          }}
        >
          Vaxora is Sri Lanka's unified national digital immunization registry and scheduling
          platform, connecting patients directly to verified vaccination clinics and hospitals.
        </p>

        {/* 3 Value Pillars */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '36px' }}>
          <div
            style={{
              background: 'var(--color-surface-subtle)',
              padding: '24px',
              borderRadius: '16px',
              border: '1px solid var(--color-border-card)',
            }}
          >
            <div style={{ marginBottom: '10px', color: 'var(--color-text-title)' }}><IconShield size={28} /></div>
            <h3 style={{ fontFamily: "var(--font-heading)", fontSize: '1.15rem', color: 'var(--color-text-title)', marginBottom: '8px' }}>
              Cryptographically Verified
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-body)', lineHeight: 1.5 }}>
              Every dose recorded is digitally signed by certified medical practitioners and verifiable internationally.
            </p>
          </div>

          <div
            style={{
              background: 'var(--color-surface-subtle)',
              padding: '24px',
              borderRadius: '16px',
              border: '1px solid var(--color-border-card)',
            }}
          >
            <div style={{ marginBottom: '10px', color: 'var(--color-text-title)' }}><IconRocket size={28} /></div>
            <h3 style={{ fontFamily: "var(--font-heading)", fontSize: '1.15rem', color: 'var(--color-text-title)', marginBottom: '8px' }}>
              Instant Scheduling
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-body)', lineHeight: 1.5 }}>
              Directly book vaccination slots at national, private, and regional healthcare centers with zero waiting queues.
            </p>
          </div>

          <div
            style={{
              background: 'var(--color-surface-subtle)',
              padding: '24px',
              borderRadius: '16px',
              border: '1px solid var(--color-border-card)',
            }}
          >
            <div style={{ marginBottom: '10px', color: 'var(--color-text-title)' }}><IconShield size={28} /></div>
            <h3 style={{ fontFamily: "var(--font-heading)", fontSize: '1.15rem', color: 'var(--color-text-title)', marginBottom: '8px' }}>
              Patient Privacy First
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-body)', lineHeight: 1.5 }}>
              Your health data is protected under national medical privacy frameworks with optional anonymous feedback.
            </p>
          </div>
        </div>

        {/* Support & Contact */}
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1.5px solid var(--color-border-card)',
            borderRadius: '16px',
            padding: '20px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, color: 'var(--color-text-title)', fontSize: '1.05rem' }}>
              Need Help or Medical Inquiries?
            </div>
            <div style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
              National Immunization Hotline: <strong>1990</strong> • Support: <strong>support@vaxora.lk</strong>
            </div>
          </div>
          <a
            href="tel:1990"
            className="btn-book-appointment"
            style={{ textDecoration: 'none', display: 'inline-block', padding: '9px 24px' }}
          >
            Call 1990 Helpline
          </a>
        </div>
      </div>
    </div>
  );
}
