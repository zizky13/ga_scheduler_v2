import { useNavigate, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { Modal } from './Modal';
import { Button } from './Button';
import styles from './Modal.module.css';

export function SessionExpiredModal() {
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const location = useLocation();

  if (!sessionExpired) return null;

  function handleSignIn() {
    clearAuth();
    navigate('/login', { state: { from: location }, replace: true });
  }

  return (
    <Modal open onClose={() => {}} size="sm" dismissable={false} noPadding>
      <div className={styles.confirmBody}>
        <div className={`${styles.confirmIcon} ${styles.confirmIconWarning}`}>
          <Lock size={24} />
        </div>
        <h2 className={styles.confirmTitle}>Session Expired</h2>
        <p className={styles.confirmDescription}>
          Your session has expired. Please sign in again to continue.
        </p>
      </div>
      <div className={styles.confirmActions} style={{ paddingTop: 0 }}>
        <Button variant="primary" onClick={handleSignIn} style={{ width: '100%' }}>
          Sign In
        </Button>
      </div>
    </Modal>
  );
}
