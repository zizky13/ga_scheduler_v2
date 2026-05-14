import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore } from '../store/toastStore';
import type { Toast as ToastData, ToastType } from '../store/toastStore';
import styles from './Toast.module.css';

const ICON_MAP: Record<ToastType, React.ElementType> = {
  success: Check,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const AUTO_DISMISS_MS: Record<ToastType, number | null> = {
  success: 5000,
  error: null,
  warning: 8000,
  info: 5000,
};

function ToastItem({ toast }: { toast: ToastData }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const Icon = ICON_MAP[toast.type];
  const duration = AUTO_DISMISS_MS[toast.type];

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => removeToast(toast.id), 200);
  }, [removeToast, toast.id]);

  useEffect(() => {
    if (duration == null) return;
    timerRef.current = setTimeout(dismiss, duration);
    return () => clearTimeout(timerRef.current);
  }, [duration, dismiss]);

  return (
    <div
      className={`${styles.toast} ${styles[toast.type]} ${exiting ? styles.exiting : ''}`}
      role="alert"
      style={duration ? { '--progress-duration': `${duration}ms` } as React.CSSProperties : undefined}
    >
      <Icon className={styles.icon} />
      <div className={styles.content}>
        <div className={styles.title}>{toast.title}</div>
        {toast.message && <div className={styles.message}>{toast.message}</div>}
      </div>
      <button
        type="button"
        className={styles.closeButton}
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
      {duration && <div className={styles.progressBar} />}
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className={styles.container} aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}
