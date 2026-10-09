import { useState, useEffect, useCallback } from "react";
import { IconChevronLeft, IconChevronRight } from "../../../shared/icons/AppIcons";
import { feedbackService } from "../../../shared/services/feedbackService";
import { deferEffectCallback } from "../../../shared/utils/deferEffectCallback.js";

const CARDS_PER_PAGE = 3;
const PLACEHOLDER_REVIEWS = [
  {
    id: "p1",
    name: "Verified Citizen",
    comment: "Seamless booking and verified digital vaccination records.",
    rating: 5,
  },
  {
    id: "p2",
    name: "Patient",
    comment: "Got my booster reminder on time. Highly recommended!",
    rating: 5,
  },
  {
    id: "p3",
    name: "Parent",
    comment: "Quick process with clear hospital directions.",
    rating: 5,
  },
];

const renderStars = (rating) => (
  <span style={{ color: "var(--color-rating)", fontSize: "0.9rem", letterSpacing: 1 }}>
    {"★".repeat(rating)}
    <span style={{ color: "var(--color-border-card)" }}>{"★".repeat(5 - rating)}</span>
  </span>
);

export default function ReviewsSection() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Fetch 6 reviews (2 pages of 3)
  useEffect(
    () =>
      deferEffectCallback(async () => {
        try {
          const data = await feedbackService.getPublicRandom(6);
          const list = Array.isArray(data) ? data : [];
          setReviews(list.length > 0 ? list : PLACEHOLDER_REVIEWS);
        } catch (err) {
          console.warn("Could not load public reviews:", err);
          setReviews(PLACEHOLDER_REVIEWS);
        } finally {
          setLoading(false);
        }
      }),
    [],
  );

  // Split into pages
  const pages = [];
  for (let i = 0; i < reviews.length; i += CARDS_PER_PAGE) {
    pages.push(reviews.slice(i, i + CARDS_PER_PAGE));
  }
  const maxPages = Math.max(pages.length, 1);

  const handleNextReview = useCallback(() => {
    setReviewIndex((prev) => (prev + 1) % maxPages);
  }, [maxPages]);

  const handlePrevReview = () => {
    setReviewIndex((prev) => (prev - 1 + maxPages) % maxPages);
  };

  // Auto-slide
  useEffect(() => {
    if (isPaused || maxPages <= 1) return undefined;
    const timer = setInterval(handleNextReview, 6000);
    return () => clearInterval(timer);
  }, [isPaused, handleNextReview, maxPages]);

  return (
    <section id="reviews" className="reviews-section">
      <h2 className="reviews-title">Watch our user reviews</h2>

      {loading ? (
        <p style={{ textAlign: "center", color: "var(--color-text-muted)", padding: 40 }}>
          Loading reviews…
        </p>
      ) : (
        <>
          <div
            className="carousel-wrapper"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
          >
            <button
              type="button"
              className="carousel-btn prev-btn"
              onClick={handlePrevReview}
              aria-label="Previous reviews"
            >
              <IconChevronLeft className="carousel-arrow" />
            </button>

            <div className="carousel-viewport">
              <div
                className="carousel-track"
                style={{ transform: `translateX(-${reviewIndex * 100}%)` }}
              >
                {pages.map((pageReviews, pageIdx) => (
                  <div
                    key={pageIdx}
                    className={`reviews-page ${reviewIndex === pageIdx ? "active-page" : ""}`}
                    aria-hidden={reviewIndex !== pageIdx}
                  >
                    {pageReviews.map((item) => (
                      <div key={item.id} className="review-card">
                        <div
                          className="review-header"
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span className="reviewer-name">{item.name}</span>
                          {renderStars(item.rating || 5)}
                        </div>
                        <div className="review-body">
                          <p className="review-comment">
                            {item.comment || item.message}
                          </p>
                        </div>
                        {item.category && (
                          <div
                            style={{
                              padding: "0 20px 14px",
                              fontSize: "0.72rem",
                              color: "var(--color-text-muted)",
                            }}
                          >
                            {item.category}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="carousel-btn next-btn"
              onClick={handleNextReview}
              aria-label="Next reviews"
            >
              <IconChevronRight className="carousel-arrow" />
            </button>
          </div>

          {maxPages > 1 && (
            <div
              className="carousel-dots"
              role="tablist"
              aria-label="Review page navigation"
            >
              {Array.from({ length: maxPages }).map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`dot ${reviewIndex === idx ? "active" : ""}`}
                  onClick={() => setReviewIndex(idx)}
                  aria-label={`Go to review slide ${idx + 1}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
