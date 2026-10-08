import { useState, useMemo, useEffect, useCallback } from "react";
import {
  IconClock,
  IconClose,
  IconSearch,
  IconShield,
} from "../../../shared/icons/AppIcons";
import { feedbackService } from "../../../shared/services/feedbackService";
import { deferEffectCallback } from "../../../shared/utils/deferEffectCallback.js";

const statusLabel = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "inreview") return "In Review";
  if (s === "new") return "New";
  if (s === "resolved") return "Resolved";
  if (s === "escalated") return "Escalated";
  return status || "New";
};

const statusKey = (status) => String(status || "").toLowerCase();

const formatDateTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").substring(0, 16);
  } catch {
    return iso;
  }
};

export default function AdminFeedbackTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [ratingFilter, setRatingFilter] = useState("ALL");

  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [adminReplyText, setAdminReplyText] = useState("");
  const [adminInternalNotes, setAdminInternalNotes] = useState("");
  const [resolutionStatus, setResolutionStatus] = useState("New");
  const [toastMessage, setToastMessage] = useState(null);

  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadFeedbacks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await feedbackService.getAll();
      setFeedbacks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load feedback.");
      setFeedbacks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffectCallback(loadFeedbacks), [loadFeedbacks]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ---------- Filtering ----------
  const filteredFeedbacks = useMemo(() => {
    return feedbacks.filter((item) => {
      const itemRole = (item.userRole || "").toUpperCase();
      const itemStatus = statusKey(item.status);
      const itemCategory = item.category || "";

      if (roleFilter !== "ALL" && itemRole !== roleFilter) return false;
      if (statusFilter !== "ALL" && itemStatus !== statusFilter.toLowerCase())
        return false;
      if (categoryFilter !== "ALL" && itemCategory !== categoryFilter)
        return false;

      if (ratingFilter !== "ALL") {
        if (ratingFilter === "5" && item.rating !== 5) return false;
        if (ratingFilter === "4" && item.rating !== 4) return false;
        if (ratingFilter === "3" && item.rating !== 3) return false;
        if (ratingFilter === "LOW" && item.rating > 2) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const haystack = [
          item.subject,
          item.message,
          item.submitterName,
          item.submitterEmail,
          item.hospitalName,
          item.id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [
    feedbacks,
    roleFilter,
    statusFilter,
    categoryFilter,
    ratingFilter,
    searchQuery,
  ]);

  // ---------- KPIs ----------
  const stats = useMemo(() => {
    const total = feedbacks.length;
    const resolved = feedbacks.filter(
      (f) => statusKey(f.status) === "resolved",
    ).length;
    const pending = feedbacks.filter((f) =>
      ["new", "inreview"].includes(statusKey(f.status)),
    ).length;
    const escalated = feedbacks.filter(
      (f) => statusKey(f.status) === "escalated",
    ).length;
    const avgRating = (
      feedbacks.reduce((acc, curr) => acc + (curr.rating || 0), 0) /
      (total || 1)
    ).toFixed(1);
    return { total, resolved, pending, escalated, avgRating };
  }, [feedbacks]);

  // ---------- Modal handlers ----------
  const handleOpenReviewModal = (feedback) => {
    setSelectedFeedback(feedback);
    setAdminReplyText(feedback.adminResponse || "");
    setAdminInternalNotes(feedback.internalNotes || "");
    setResolutionStatus(statusLabel(feedback.status));
  };

  const handleApplyTemplate = (template) => setAdminReplyText(template);

  const handleSaveResolution = async (e) => {
    e.preventDefault();
    if (!selectedFeedback) return;

    try {
      const statusForApi = resolutionStatus.replace(/\s+/g, ""); // "In Review" → "InReview"
      await feedbackService.resolve(selectedFeedback.id, {
        status: statusForApi,
        adminResponse: adminReplyText.trim() || null,
        internalNotes: adminInternalNotes.trim() || null,
      });
      showToast(
        `Feedback ${selectedFeedback.id.substring(0, 8)} updated to "${resolutionStatus}"`,
      );
      setSelectedFeedback(null);
      await loadFeedbacks();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleQuickResolve = async (id) => {
    try {
      await feedbackService.resolve(id, {
        status: "Resolved",
        adminResponse: null,
        internalNotes: null,
      });
      showToast(`Ticket ${id.substring(0, 8)} marked as Resolved.`);
      await loadFeedbacks();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  };

  const renderStars = (rating) => (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        color: "#fbbf24",
        fontSize: "0.9rem",
      }}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star}>{star <= rating ? "★" : "☆"}</span>
      ))}
    </div>
  );

  const renderStatusBadge = (status) => {
    const s = statusKey(status);
    if (s === "new") {
      return (
        <span className="admin-status-badge-new">
          <span className="admin-status-dot-blue" />
          New
        </span>
      );
    }
    if (s === "inreview") {
      return <span className="admin-pill-badge amber">In Review</span>;
    }
    if (s === "resolved") {
      return <span className="admin-pill-badge green">Resolved</span>;
    }
    if (s === "escalated") {
      return (
        <span
          className="admin-pill-badge"
          style={{
            background: "rgba(239, 68, 68, 0.18)",
            color: "#f87171",
            border: "1px solid rgba(239, 68, 68, 0.3)",
          }}
        >
          Escalated
        </span>
      );
    }
    return <span className="admin-pill-badge blue">{status}</span>;
  };

  return (
    <div className="admin-tab-content">
      {toastMessage && (
        <div className="doctor-toast">
          <span style={{ display: "inline-flex" }}>
            <IconShield size={18} />
          </span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hero */}
      <section className="doctor-hero-banner" style={{ marginBottom: 24 }}>
        <div className="doctor-hero-info">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 4,
            }}
          >
            <span className="admin-pill-badge blue">
              National Feedback Inbox
            </span>
            <span
              style={{ color: "#38bdf8", fontSize: "0.8rem", fontWeight: 600 }}
            >
              • Real-time Grievance Stream
            </span>
          </div>
          <h1 className="doctor-hero-title">
            Incoming Feedback &amp; Inquiries
          </h1>
          <p className="doctor-hero-subtitle">
            Central repository of user experiences, clinical issue reports, and
            system inquiries submitted by Patients, Doctors, Nurses, and
            Hospitals across Sri Lanka.
          </p>
        </div>

        <div
          className="doctor-hero-meta"
          style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
        >
          <button
            type="button"
            className="doctor-hero-session-pill"
            style={{ cursor: "pointer" }}
            onClick={loadFeedbacks}
            disabled={loading}
          >
            {loading ? "Loading…" : "🔄 Refresh"}
          </button>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          style={{
            background: "rgba(239, 68, 68, 0.15)",
            color: "#f87171",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 20,
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* KPIs */}
      <div className="doctor-stats-grid" style={{ marginBottom: 28 }}>
        <div className="doctor-stat-card">
          <div
            className="doctor-stat-icon-wrapper"
            style={{ background: "rgba(2, 132, 199, 0.15)", color: "#38bdf8" }}
          >
            💬
          </div>
          <div className="doctor-stat-content">
            <span className="doctor-stat-label">Total Received</span>
            <div className="doctor-stat-value">{stats.total}</div>
            <span className="doctor-stat-meta" style={{ color: "#38bdf8" }}>
              All stakeholder tiers
            </span>
          </div>
        </div>

        <div className="doctor-stat-card">
          <div
            className="doctor-stat-icon-wrapper"
            style={{ background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24" }}
          >
            ⭐
          </div>
          <div className="doctor-stat-content">
            <span className="doctor-stat-label">Average Rating</span>
            <div
              className="doctor-stat-value"
              style={{ display: "flex", alignItems: "baseline", gap: 6 }}
            >
              {stats.avgRating}{" "}
              <span style={{ fontSize: "0.9rem", color: "#94a3b8" }}>
                / 5.0
              </span>
            </div>
            <span className="doctor-stat-meta" style={{ color: "#fbbf24" }}>
              {renderStars(Math.round(Number(stats.avgRating)))}
            </span>
          </div>
        </div>

        <div className="doctor-stat-card">
          <div
            className="doctor-stat-icon-wrapper"
            style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8" }}
          >
            <IconClock size={22} />
          </div>
          <div className="doctor-stat-content">
            <span className="doctor-stat-label">Pending Review</span>
            <div className="doctor-stat-value" style={{ color: "#38bdf8" }}>
              {stats.pending}
            </div>
            <span className="doctor-stat-meta" style={{ color: "#94a3b8" }}>
              Requires admin reply
            </span>
          </div>
        </div>

        <div className="doctor-stat-card">
          <div
            className="doctor-stat-icon-wrapper"
            style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399" }}
          >
            ✅
          </div>
          <div className="doctor-stat-content">
            <span className="doctor-stat-label">Resolved Tickets</span>
            <div className="doctor-stat-value" style={{ color: "#34d399" }}>
              {stats.resolved}
            </div>
            <span className="doctor-stat-meta" style={{ color: "#34d399" }}>
              {Math.round((stats.resolved / (stats.total || 1)) * 100)}%
              resolution rate
            </span>
          </div>
        </div>
      </div>

      {/* Directory */}
      <div className="doctor-card" style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <h2 className="doctor-card-title" style={{ margin: 0 }}>
              Incoming Feedback Stream
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                color: "#94a3b8",
                fontSize: "0.85rem",
              }}
            >
              Showing {filteredFeedbacks.length} of {feedbacks.length} total
              submissions
            </p>
          </div>

          <div className="doctor-filter-pills">
            {["ALL", "NEW", "IN REVIEW", "RESOLVED", "ESCALATED"].map((st) => (
              <button
                key={st}
                type="button"
                className={`doctor-filter-btn ${statusFilter === st ? "active" : ""}`}
                onClick={() => setStatusFilter(st)}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div className="doctor-search-bar" style={{ margin: 0 }}>
            <span
              className="doctor-search-icon"
              style={{ display: "inline-flex" }}
            >
              <IconSearch size={16} />
            </span>
            <input
              type="text"
              className="doctor-search-input"
              placeholder="Search by user, keyword, hospital…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                style={{
                  background: "none",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: "0 8px",
                }}
              >
                <IconClose size={14} />
              </button>
            )}
          </div>

          <select
            aria-label="Filter feedback by role"
            className="doctor-form-select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{ height: 42, fontSize: "0.85rem" }}
          >
            <option value="ALL">All Stakeholder Roles</option>
            <option value="PATIENT">Patient</option>
            <option value="DOCTOR">Doctor</option>
            <option value="NURSE">Nurse</option>
            <option value="HOSPITAL">Hospital</option>
          </select>

          <select
            aria-label="Filter feedback by category"
            className="doctor-form-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ height: 42, fontSize: "0.85rem" }}
          >
            <option value="ALL">📂 All Categories</option>
            <option value="General Feedback">General Feedback</option>
            <option value="Vaccination Service">Vaccination Service</option>
            <option value="System / Bug">System / Bug</option>
            <option value="Vaccine Adverse Event">Vaccine Adverse Event</option>
            <option value="Hospital Supply">Hospital Supply</option>
            <option value="Scheduling / Booking">Scheduling / Booking</option>
          </select>

          <select
            aria-label="Filter feedback by rating"
            className="doctor-form-select"
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value)}
            style={{ height: 42, fontSize: "0.85rem" }}
          >
            <option value="ALL">⭐ All Ratings</option>
            <option value="5">5 Stars (Excellent)</option>
            <option value="4">4 Stars (Good)</option>
            <option value="3">3 Stars (Neutral)</option>
            <option value="LOW">1 - 2 Stars (Needs Attention)</option>
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <p style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
            Loading feedback…
          </p>
        ) : filteredFeedbacks.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "#94a3b8",
            }}
          >
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📭</div>
            <h3 style={{ color: "#ffffff", margin: "0 0 6px" }}>
              No Feedback Found
            </h3>
            <p style={{ margin: 0, fontSize: "0.88rem" }}>
              No feedback submissions match the current filter criteria.
            </p>
          </div>
        ) : (
          <div className="doctor-table-container">
            <table className="doctor-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Ticket</th>
                  <th style={{ width: 180 }}>Submitter</th>
                  <th style={{ width: 200 }}>Hospital / Location</th>
                  <th>Feedback Details</th>
                  <th style={{ width: 100 }}>Rating</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 150, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredFeedbacks.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div
                        className="admin-id-pill"
                        style={{ display: "inline-block", marginBottom: 4 }}
                      >
                        {item.id.substring(0, 8)}
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                        {formatDateTime(item.createdAt)}
                      </div>
                    </td>

                    <td>
                      <div
                        style={{
                          fontWeight: 700,
                          color: "#ffffff",
                          fontSize: "0.9rem",
                        }}
                      >
                        {item.isAnonymous
                          ? "Anonymous"
                          : item.submitterName || "Verified User"}
                      </div>
                      {item.userRole && (
                        <div style={{ marginTop: 3 }}>
                          <span
                            className={`admin-role-badge ${(item.userRole || "").toLowerCase()}`}
                          >
                            {item.userRole}
                          </span>
                        </div>
                      )}
                      {!item.isAnonymous && item.submitterEmail && (
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#94a3b8",
                            marginTop: 3,
                          }}
                        >
                          {item.submitterEmail}
                        </div>
                      )}
                    </td>

                    <td>
                      <div
                        style={{
                          fontSize: "0.82rem",
                          color: "#e2e8f0",
                          fontWeight: 600,
                        }}
                      >
                        {item.hospitalName || "—"}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <span
                          className="admin-pill-badge blue"
                          style={{ fontSize: "0.7rem" }}
                        >
                          {item.category}
                        </span>
                      </div>
                    </td>

                    <td>
                      <div
                        style={{
                          fontWeight: 700,
                          color: "#38bdf8",
                          fontSize: "0.88rem",
                          marginBottom: 3,
                        }}
                      >
                        {item.subject || "—"}
                      </div>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "#94a3b8",
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {item.message}
                      </div>
                      {item.adminResponse && (
                        <div
                          style={{
                            marginTop: 5,
                            fontSize: "0.73rem",
                            color: "#34d399",
                          }}
                        >
                          ↩️ Replied on {formatDateTime(item.repliedAt)}
                        </div>
                      )}
                    </td>

                    <td>
                      {renderStars(item.rating)}
                      <div
                        style={{
                          fontSize: "0.72rem",
                          color: "#94a3b8",
                          marginTop: 2,
                        }}
                      >
                        {item.rating} / 5
                      </div>
                    </td>

                    <td>{renderStatusBadge(item.status)}</td>

                    <td style={{ textAlign: "right" }}>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          type="button"
                          className="doctor-table-btn"
                          style={{
                            background: "#0369a1",
                            color: "#ffffff",
                            borderColor: "#38bdf8",
                          }}
                          onClick={() => handleOpenReviewModal(item)}
                        >
                          Review &amp; Reply
                        </button>
                        {statusKey(item.status) !== "resolved" && (
                          <button
                            type="button"
                            className="doctor-table-btn"
                            style={{
                              background: "rgba(16, 185, 129, 0.15)",
                              color: "#34d399",
                              borderColor: "rgba(16, 185, 129, 0.3)",
                            }}
                            onClick={() => handleQuickResolve(item.id)}
                            title="Quick mark as resolved"
                          >
                            ✓
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review modal — unchanged */}
      {selectedFeedback && (
        <div
          className="doctor-modal-overlay"
          onClick={() => setSelectedFeedback(null)}
        >
          <div
            className="doctor-modal-card"
            style={{
              maxWidth: 750,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                paddingBottom: 16,
                marginBottom: 20,
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span className="admin-id-pill">
                    {selectedFeedback.id.substring(0, 8)}
                  </span>
                  {selectedFeedback.userRole && (
                    <span
                      className={`admin-role-badge ${(selectedFeedback.userRole || "").toLowerCase()}`}
                    >
                      {selectedFeedback.userRole}
                    </span>
                  )}
                  <span className="admin-pill-badge blue">
                    {selectedFeedback.category}
                  </span>
                </div>
                <h2
                  style={{ margin: 0, fontSize: "1.25rem", color: "#ffffff" }}
                >
                  {selectedFeedback.subject || "Feedback"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                }}
              >
                <IconClose size={18} />
              </button>
            </div>

            <div
              style={{
                background: "#111a2e",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "#94a3b8",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    Submitter
                  </div>
                  <div
                    style={{ fontWeight: 700, color: "#ffffff", marginTop: 2 }}
                  >
                    {selectedFeedback.isAnonymous
                      ? "Anonymous"
                      : selectedFeedback.submitterName || "Verified User"}
                  </div>
                  {!selectedFeedback.isAnonymous &&
                    selectedFeedback.submitterEmail && (
                      <div style={{ fontSize: "0.8rem", color: "#38bdf8" }}>
                        {selectedFeedback.submitterEmail}
                      </div>
                    )}
                  {!selectedFeedback.isAnonymous &&
                    selectedFeedback.submitterPhone && (
                      <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                        {selectedFeedback.submitterPhone}
                      </div>
                    )}
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "#94a3b8",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    Hospital / Clinic
                  </div>
                  <div
                    style={{ fontWeight: 600, color: "#e2e8f0", marginTop: 2 }}
                  >
                    {selectedFeedback.hospitalName || "—"}
                  </div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#94a3b8",
                      marginTop: 4,
                    }}
                  >
                    Submitted on {formatDateTime(selectedFeedback.createdAt)}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "#94a3b8",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    User Rating
                  </div>
                  <div style={{ marginTop: 2 }}>
                    {renderStars(selectedFeedback.rating)}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#cbd5e1",
                      fontWeight: 600,
                      marginTop: 2,
                    }}
                  >
                    {selectedFeedback.rating} out of 5 Stars
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  Submitted Feedback
                </div>
                <div
                  style={{
                    background: "#0a0e1a",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 8,
                    padding: 14,
                    color: "#f8fafc",
                    fontSize: "0.9rem",
                    lineHeight: 1.5,
                  }}
                >
                  &quot;{selectedFeedback.message}&quot;
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveResolution}>
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <label
                    className="doctor-form-label"
                    style={{ margin: 0, fontWeight: 700, color: "#ffffff" }}
                  >
                    Official Admin Reply
                  </label>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 10,
                  }}
                >
                  <button
                    type="button"
                    className="admin-doc-link-btn"
                    style={{
                      fontSize: "0.72rem",
                      padding: "4px 10px",
                      borderRadius: 6,
                    }}
                    onClick={() =>
                      handleApplyTemplate(
                        `Dear ${selectedFeedback.submitterName || "Citizen"},\n\nThank you for reaching out to the National Vaxora Administration. We have reviewed your inquiry and are actively addressing it.\n\nBest regards,\nNational Immunization IT Directorate`,
                      )
                    }
                  >
                    + Acknowledgment
                  </button>
                  <button
                    type="button"
                    className="admin-doc-link-btn"
                    style={{
                      fontSize: "0.72rem",
                      padding: "4px 10px",
                      borderRadius: 6,
                    }}
                    onClick={() =>
                      handleApplyTemplate(
                        `Dear ${selectedFeedback.submitterName || "Citizen"},\n\nWe are pleased to inform you that your reported issue has been verified and fully resolved.\n\nThank you for supporting digital healthcare,\nVaxora Admin Team`,
                      )
                    }
                  >
                    + Resolved Notice
                  </button>
                  <button
                    type="button"
                    className="admin-doc-link-btn"
                    style={{
                      fontSize: "0.72rem",
                      padding: "4px 10px",
                      borderRadius: 6,
                    }}
                    onClick={() =>
                      handleApplyTemplate(
                        `Dear ${selectedFeedback.submitterName || "Citizen"},\n\nThank you for the kind words. Your appreciation has been conveyed to the relevant staff.\n\nWarm regards,\nVaxora National Operations`,
                      )
                    }
                  >
                    + Appreciation
                  </button>
                </div>

                <textarea
                  className="doctor-form-textarea"
                  rows="4"
                  placeholder="Type official response to submitter…"
                  value={adminReplyText}
                  onChange={(e) => setAdminReplyText(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: 14,
                  marginBottom: 20,
                }}
              >
                <div>
                  <label
                    className="doctor-form-label"
                    style={{ fontWeight: 700, color: "#ffffff" }}
                  >
                    Update Status
                  </label>
                  <select
                    className="doctor-form-select"
                    value={resolutionStatus}
                    onChange={(e) => setResolutionStatus(e.target.value)}
                  >
                    <option value="New">New / Unread</option>
                    <option value="In Review">In Review</option>
                    <option value="Resolved">Resolved</option>
                    <option value="Escalated">Escalated to Ministry</option>
                  </select>
                </div>

                <div>
                  <label
                    className="doctor-form-label"
                    style={{ fontWeight: 700, color: "#ffffff" }}
                  >
                    Internal Admin Notes (Private)
                  </label>
                  <input
                    type="text"
                    className="doctor-form-input"
                    placeholder="E.g. Escalated to developer sprint…"
                    value={adminInternalNotes}
                    onChange={(e) => setAdminInternalNotes(e.target.value)}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  paddingTop: 16,
                }}
              >
                <button
                  type="button"
                  className="doctor-btn-cancel"
                  onClick={() => setSelectedFeedback(null)}
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="doctor-hero-session-pill"
                  style={{
                    cursor: "pointer",
                    fontWeight: 700,
                    padding: "8px 20px",
                  }}
                >
                  Save &amp; Update Resolution
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
