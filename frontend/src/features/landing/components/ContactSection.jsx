import { useState } from 'react';
import logo from '../../../assets/images/logo.png';
import { IconArrowRight } from '../../../shared/icons/AppIcons';

export default function ContactSection({ onArrowClick }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    contactNo: '',
    message: '',
  });
  const [formSubmitted, setFormSubmitted] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email) return;
    setFormSubmitted(true);
    setTimeout(() => {
      setFormData({ name: '', email: '', contactNo: '', message: '' });
      setFormSubmitted(false);
    }, 4000);
  };

  return (
    <section id="contact" className="contact-section">
      <div className="contact-grid">
        {/* Left Content */}
        <div className="contact-info">
          <div className="contact-title-group">
            <h2 className="contact-main-title">Contact Us</h2>
            <span className="contact-sub-title">we are here to help</span>
          </div>
          <p className="contact-paragraph">
            If you have any questions, concerns, or encounter any issues regarding booking an appointment or exploring partnership opportunities, we kindly request you to fill out the form and submit it.
          </p>
          <p className="contact-paragraph">
            Our team will review your submission and get back to you as soon as possible.
          </p>

          <div className="contact-arrow-container">
            <button
              type="button"
              className="btn-arrow"
              onClick={onArrowClick}
              aria-label="Proceed to contact form"
            >
              <IconArrowRight className="arrow-icon" />
            </button>
          </div>
        </div>

        {/* Right Form Card */}
        <div className="contact-form-wrapper">
          <div className="contact-form-card">
            <div className="form-header">
              <img src={logo} alt="Vaxora Logo" className="form-logo" />
            </div>

            {formSubmitted ? (
              <div className="form-success-banner" role="alert">
                <div className="success-icon">✓</div>
                <h4>Thank you for reaching out!</h4>
                <p>Your message has been received. Our support team will contact you shortly.</p>
              </div>
            ) : (
              <form onSubmit={handleFormSubmit} className="contact-form">
                <div className="form-group">
                  <input
                    id="contact-name-input"
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Name"
                    required
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="Email"
                    required
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <input
                    type="tel"
                    name="contactNo"
                    value={formData.contactNo}
                    onChange={handleInputChange}
                    placeholder="Contact No"
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleInputChange}
                    placeholder="Message here"
                    rows="4"
                    className="form-textarea"
                  />
                </div>

                <button type="submit" className="btn-submit">
                  Submit
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
