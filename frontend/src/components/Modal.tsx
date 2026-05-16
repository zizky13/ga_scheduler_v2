import { useEffect, useRef, useId } from 'react';
import type { ReactNode, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import styles from './Modal.module.css';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: ModalSize;
  dismissable?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  noPadding?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  dismissable = true,
  children,
  footer,
  noPadding,
}: ModalProps) {
  const titleId = useId();
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissableRef = useRef(dismissable);
  onCloseRef.current = onClose;
  dismissableRef.current = dismissable;

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => containerRef.current?.focus());

    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissableRef.current) {
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab' && containerRef.current) {
        const focusable = containerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = original;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleBackdropClick(e: MouseEvent) {
    if (dismissable && e.target === e.currentTarget) {
      onClose();
    }
  }

  return createPortal(
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div
        ref={containerRef}
        className={`${styles.container} ${styles[size]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        {title && (
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            {dismissable && (
              <button
                type="button"
                className={styles.closeButton}
                onClick={onClose}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        <div className={noPadding ? undefined : styles.body}>{children}</div>

        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ══════════════════════════════════════════
   ConfirmDialog — danger / warning variant
   ══════════════════════════════════════════ */

type ConfirmVariant = 'danger' | 'warning';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  variant?: ConfirmVariant;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  children?: ReactNode;
}

const VARIANT_ICON_CLASS: Record<ConfirmVariant, string> = {
  danger: styles.confirmIconDanger,
  warning: styles.confirmIconWarning,
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  variant = 'danger',
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  loading,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} size="sm" dismissable={false} noPadding>
      <div className={styles.confirmBody}>
        <div className={`${styles.confirmIcon} ${VARIANT_ICON_CLASS[variant]}`}>
          <AlertTriangle size={24} />
        </div>
        <h2 className={styles.confirmTitle}>{title}</h2>
        {description && <p className={styles.confirmDescription}>{description}</p>}
        {children}
      </div>
      <div className={styles.confirmActions}>
        {cancelLabel && (
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
        )}
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={loading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
