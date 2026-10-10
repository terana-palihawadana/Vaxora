import { createPortal } from 'react-dom';

/**
 * Theme-aware confirm dialog (parity with mobile confirmAction).
 * Light surface + primary CTA, or error styling when destructive.
 */
export default function ConfirmModal({
  isOpen,
  title,
  message,
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  destructive = false,
  onCancel,
  onConfirm,
}) {
  if (!isOpen) return null;

  const modal = (
    <div
      className="confirm-modal-backdrop"
      role="presentation"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel?.();
      }}
    >
      <div
        className={`confirm-modal-card${destructive ? ' is-destructive' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-modal-title" className="confirm-modal-title">
          {title}
        </h3>
        {message ? (
          <p id="confirm-modal-message" className="confirm-modal-message">
            {message}
          </p>
        ) : null}
        <div className="confirm-modal-actions">
          <button type="button" className="confirm-modal-btn cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-modal-btn confirm${destructive ? ' destructive' : ''}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
