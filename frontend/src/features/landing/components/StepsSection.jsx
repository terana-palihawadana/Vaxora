const steps = [
  {
    title: 'Create an account',
    text: 'Sign up with your details. It takes about a minute.',
  },
  {
    title: 'Book a slot',
    text: 'Choose a hospital, a vaccine and a time that suits you.',
  },
  {
    title: 'Get vaccinated',
    text: 'Visit the booth. Your record updates as soon as the dose is given.',
  },
];

export default function StepsSection() {
  return (
    <section id="how-it-works" className="landing-section">
      <div className="section-head">
        <span className="section-eyebrow">How it works</span>
        <h2 className="landing-section-title">Three steps to your next dose</h2>
      </div>

      <ol className="steps-list">
        {steps.map((step, idx) => (
          <li key={step.title} className="step-card">
            <span className="step-number">{idx + 1}</span>
            <h3 className="step-title">{step.title}</h3>
            <p className="step-text">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
