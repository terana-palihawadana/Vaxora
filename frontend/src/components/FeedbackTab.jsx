import { useState, useEffect, useCallback } from "react";
import feedbackImg from "../assets/images/feedback.png";
import logo from "../assets/images/logo.png";
import { authService } from "../features/auth";
import { feedbackService } from "../shared/services/feedbackService";
import { deferEffectCallback } from "../shared/utils/deferEffectCallback.js";

// ---------- Helpers ----------
const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
};

const statusLabel = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "inreview") return "In Review";
  if (s === "new") return "New";
  if (s === "resolved") return "Resolved";
  if (s === "escalated") return "Escalated";
  return status || "—";
};

const statusColor = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "resolved") return "#10b981";
  if (s === "inreview") return "#b45309";
  if (s === "escalated") return "#dc2626";
  return "#0369a1";
};

const renderStars = (rating) => {
  return (
    <span style={{ color: "#fbbf24", fontSize: "0.9rem", letterSpacing: 1 }}>
      {"★".repeat(rating)}
      <span style={{ color: "#cbd5e1" }}>{"★".repeat(5 - rating)}</span>
    </span>
  );
};

export default function FeedbackTab() {
  const currentUser = authService.getUser() || {};
  const profile = currentUser.profileDetails || {};

  // ---------- Form state ----------
  const [formData, setFormData] = useState({
    name: profile.fullName || currentUser.name || "",
    email: currentUser.email || "",
    contactNo: currentUser.phoneNumber || profile.phoneNumber || "",
    message: "",
  });
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [isAnonymous, setIsAnonymous] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  // ---------- My feedbacks state ----------
  const [myFeedbacks, setMyFeedbacks] = useState([]);
  const [loadingFeedbacks, setLoadingFeedbacks] = useState(true);
  const [editingFeedback, setEditingFeedback] = useState(null);
  const [editForm, setEditForm] = useState({ message: "", rating: 5 });
  const [savingEdit, setSavingEdit] = useState(false);

  // ---------- Load my feedbacks ----------
  const loadMyFeedbacks = useCallback(async () => {
    setLoadingFeedbacks(true);
    try {
      const data = await feedbackService.getMine();
      setMyFeedbacks(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn("Could not load my feedbacks:", err);
      setMyFeedbacks([]);
    } finally {
      setLoadingFeedbacks(false);
    }
  }, []);

  useEffect(() => deferEffectCallback(loadMyFeedbacks), [loadMyFeedbacks]);

  // ---------- Form handlers ----------
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAnonymousToggle = (checked) => {
    setIsAnonymous(checked);
    if (checked) {
      // Clear submitter identity fields — the backend won't persist them anyway
      setFormData((prev) => ({ ...prev, name: "", email: "", contactNo: "" }));
    } else {
      // Restore from the logged-in user
      setFormData((prev) => ({
        ...prev,
        name: profile.fullName || currentUser.name || "",
        email: currentUser.email || "",
        contactNo: currentUser.phoneNumber || profile.phoneNumber || "",
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!formData.message.trim()) {
      setError("Please enter your feedback message.");
      return;
    }
    if (!isAnonymous) {
      if (
        !formData.name.trim() ||
        !formData.email.trim() ||
        !formData.contactNo.trim()
      ) {
        setError(
          "Please fill in your name, email, and contact number — or choose to remain anonymous.",
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      await feedbackService.submit({
        message: formData.message.trim(),
        rating,
        isAnonymous,
        submitterName: isAnonymous ? null : formData.name.trim(),
        submitterEmail: isAnonymous ? null : formData.email.trim(),
        submitterPhone: isAnonymous ? null : formData.contactNo.trim(),
      });
      setSubmitted(true);
      await loadMyFeedbacks();
    } catch (err) {
      setError(err.message || "Failed to submit feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormData({
      name: profile.fullName || currentUser.name || "",
      email: currentUser.email || "",
      contactNo: currentUser.phoneNumber || profile.phoneNumber || "",
      message: "",
    });
    setRating(5);
    setIsAnonymous(false);
    setSubmitted(false);
    setError("");
  };

  // ---------- Edit handlers ----------
  const handleOpenEdit = (fb) => {
    setEditingFeedback(fb);
    setEditForm({ message: fb.message || "", rating: fb.rating || 5 });
  };

  const handleCloseEdit = () => {
    setEditingFeedback(null);
    setEditForm({ message: "", rating: 5 });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingFeedback) return;

    if (!editForm.message.trim()) {
      setError("Message cannot be empty.");
      return;
    }

    setSavingEdit(true);
    setError("");
    try {
      await feedbackService.update(editingFeedback.id, {
        message: editForm.message.trim(),
        rating: editForm.rating,
        isAnonymous: editingFeedback.isAnonymous,
        submitterName: editingFeedback.isAnonymous
          ? null
          : editingFeedback.submitterName,
        submitterEmail: editingFeedback.isAnonymous
          ? null
          : editingFeedback.submitterEmail,
        submitterPhone: editingFeedback.isAnonymous
          ? null
          : editingFeedback.submitterPhone,
      });
      await loadMyFeedbacks();
      handleCloseEdit();
    } catch (err) {
      setError(err.message || "Failed to update feedback.");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div
      className="manage-appointments-wrapper"
      style={{ flexDirection: "column", alignItems: "center", gap: 28 }}
    >
      {/* =================================================================
          1. Feedback submission card (unchanged mockup layout)
         ================================================================= */}
      <div className="feedback-split-card">
        <div className="feedback-image-pane">
          <img
            src={feedbackImg}
            alt="Healthcare Patient Care"
            className="feedback-arch-img"
          />
        </div>

        <div className="feedback-form-pane">
          <h1 className="feedback-main-title">Share Your Feedback</h1>

          <div className="feedback-bordered-box">
            <div className="feedback-logo-wrap">
              <img src={logo} alt="Vaxora Logo" className="feedback-box-logo" />
            </div>

            {submitted ? (
              <div className="feedback-success-box">
                <div style={{ fontSize: "3rem", marginBottom: "12px" }}>🎉</div>
                <h3 className="feedback-success-title">
                  Thank You for Your Feedback!
                </h3>
                <p className="feedback-success-desc">
                  Your rating of <strong>{rating} stars</strong> has been
                  recorded.
                  {isAnonymous
                    ? " It has been submitted anonymously."
                    : " Our team will reach out to you if a follow-up is required."}
                </p>
                <button
                  type="button"
                  className="btn-feedback-submit"
                  style={{ marginTop: "16px" }}
                  onClick={handleReset}
                >
                  Submit Another Feedback
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="feedback-mockup-form">
                {error && (
                  <div
                    role="alert"
                    style={{
                      background: "rgba(239, 68, 68, 0.12)",
                      color: "#b91c1c",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      borderRadius: 8,
                      padding: "10px 14px",
                      marginBottom: 12,
                      fontSize: "0.85rem",
                    }}
                  >
                    ⚠ {error}
                  </div>
                )}

                {/* Anonymous toggle */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "#1e1b4b",
                    cursor: "pointer",
                    marginBottom: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isAnonymous}
                    onChange={(e) => handleAnonymousToggle(e.target.checked)}
                    disabled={submitting}
                  />
                  Submit anonymously
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 400,
                      color: "#64748b",
                    }}
                  >
                    (name, email, and phone will not be recorded)
                  </span>
                </label>

                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Name"
                  className="feedback-mockup-input"
                  disabled={isAnonymous || submitting}
                  style={{ opacity: isAnonymous ? 0.5 : 1 }}
                />

                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="Email"
                  className="feedback-mockup-input"
                  disabled={isAnonymous || submitting}
                  style={{ opacity: isAnonymous ? 0.5 : 1 }}
                />

                <input
                  type="tel"
                  name="contactNo"
                  value={formData.contactNo}
                  onChange={handleChange}
                  placeholder="Contact No"
                  className="feedback-mockup-input"
                  disabled={isAnonymous || submitting}
                  style={{ opacity: isAnonymous ? 0.5 : 1 }}
                />

                <div className="feedback-rating-row">
                  <span className="feedback-rating-label">Rating</span>
                  <div className="feedback-stars-container">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        className={`star-icon-btn ${(hoverRating || rating) >= star ? "active" : ""}`}
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        onClick={() => setRating(star)}
                        disabled={submitting}
                        aria-label={`Rate ${star} star`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  name="message"
                  value={formData.message}
                  onChange={handleChange}
                  placeholder="Message here"
                  rows="4"
                  className="feedback-mockup-textarea"
                  disabled={submitting}
                  required
                />

                <button
                  type="submit"
                  className="btn-feedback-submit"
                  disabled={submitting}
                >
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* =================================================================
          2. My past feedbacks
         ================================================================= */}
      <div
        className="manage-appointments-card"
        style={{ maxWidth: 960, width: "100%" }}
      >
        <h2
          className="appointments-section-heading"
          style={{ marginBottom: 16 }}
        >
          My Past Feedbacks
        </h2>

        {loadingFeedbacks ? (
          <p style={{ textAlign: "center", color: "#64748b", padding: 24 }}>
            Loading your feedback history…
          </p>
        ) : myFeedbacks.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              color: "#64748b",
              fontStyle: "italic",
              padding: 24,
            }}
          >
            You haven't submitted any feedback yet.
          </p>
        ) : (
          <div className="appointments-table-container">
            <table className="custom-appointments-table">
              <thead>
                <tr>
                  <th className="th-date">Date</th>
                  <th className="th-vaccine">Message</th>
                  <th style={{ width: 120 }}>Rating</th>
                  <th style={{ width: 130 }}>Status</th>
                  <th
                    style={{
                      width: 120,
                      borderRight: "none",
                      textAlign: "right",
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {myFeedbacks.map((fb) => (
                  <tr key={fb.id}>
                    <td className="td-date">{formatDate(fb.createdAt)}</td>
                    <td className="td-vaccine">
                      <div style={{ fontWeight: 600, color: "#1e1b4b" }}>
                        {fb.message.length > 120
                          ? fb.message.substring(0, 120) + "…"
                          : fb.message}
                      </div>
                      {fb.adminResponse && (
                        <div
                          style={{
                            marginTop: 6,
                            padding: "6px 10px",
                            background: "rgba(16, 185, 129, 0.08)",
                            borderLeft: "3px solid #10b981",
                            borderRadius: 4,
                            fontSize: "0.78rem",
                            color: "#065f46",
                          }}
                        >
                          ↩ Admin: {fb.adminResponse}
                        </div>
                      )}
                    </td>
                    <td>{renderStars(fb.rating)}</td>
                    <td>
                      <span
                        style={{
                          color: statusColor(fb.status),
                          fontWeight: 600,
                          fontSize: "0.85rem",
                        }}
                      >
                        ● {statusLabel(fb.status)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", borderRight: "none" }}>
                      {fb.status?.toLowerCase() === "resolved" ? (
                        <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                          Locked
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-profile-edit"
                          style={{ padding: "6px 14px", fontSize: "0.8rem" }}
                          onClick={() => handleOpenEdit(fb)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* =================================================================
          3. Edit modal
         ================================================================= */}
      {editingFeedback && (
        <div
          className="modal-overlay"
          onClick={savingEdit ? undefined : handleCloseEdit}
        >
          <div
            className="modal-content-card"
            style={{ maxWidth: 560, width: "92vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header-row">
              <h3
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 800,
                  color: "#1e1b4b",
                  margin: 0,
                }}
              >
                Edit Feedback
              </h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={handleCloseEdit}
                disabled={savingEdit}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ padding: "12px 0" }}>
              <div className="feedback-rating-row" style={{ marginBottom: 12 }}>
                <span className="feedback-rating-label">Rating</span>
                <div className="feedback-stars-container">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={`star-icon-btn ${editForm.rating >= star ? "active" : ""}`}
                      onClick={() =>
                        setEditForm((p) => ({ ...p, rating: star }))
                      }
                      disabled={savingEdit}
                      aria-label={`Rate ${star} star`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                className="feedback-mockup-textarea"
                rows="5"
                value={editForm.message}
                onChange={(e) =>
                  setEditForm((p) => ({ ...p, message: e.target.value }))
                }
                placeholder="Your feedback message…"
                disabled={savingEdit}
                style={{ marginBottom: 12 }}
              />

              {error && (
                <div
                  style={{
                    color: "#b91c1c",
                    fontSize: "0.85rem",
                    marginBottom: 10,
                  }}
                >
                  ⚠ {error}
                </div>
              )}

              <div
                style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}
              >
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={handleCloseEdit}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-feedback-submit"
                  style={{ width: "auto", padding: "8px 22px" }}
                  disabled={savingEdit}
                >
                  {savingEdit ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
