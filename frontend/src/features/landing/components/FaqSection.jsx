const faqs = [
  {
    q: 'Who can use Vaxora?',
    a: 'Anyone in Sri Lanka can sign up as a patient. Doctors, nurses and hospitals register separately and are verified before they get access.',
  },
  {
    q: 'How are doctors and nurses verified?',
    a: 'A Ministry of Health admin checks each registration and its licence details before approving the account.',
  },
  {
    q: 'Can I cancel an appointment?',
    a: 'Yes. Open Appointments in your patient portal and cancel any booking that has not started yet.',
  },
  {
    q: 'Where can I see my past vaccinations?',
    a: 'Your vaccination history page lists every dose, with the date, vaccine and hospital.',
  },
  {
    q: 'Who can see my health records?',
    a: 'Only you and the staff treating you. Access is limited by role, and admin actions are recorded in an audit log.',
  },
];

export default function FaqSection() {
  return (
    <section id="faq" className="landing-section">
      <div className="section-head">
        <span className="section-eyebrow">FAQ</span>
        <h2 className="landing-section-title">Common questions</h2>
      </div>

      <div className="faq-list">
        {faqs.map((item) => (
          <details key={item.q} className="faq-item">
            <summary className="faq-question">{item.q}</summary>
            <p className="faq-answer">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
