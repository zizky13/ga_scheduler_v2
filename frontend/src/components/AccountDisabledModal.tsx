import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { Modal } from './Modal';
import { Button } from './Button';
import styles from './Modal.module.css';

export function AccountDisabledModal() {
  const accountDisabled = useAuthStore((s) => s.accountDisabled);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();

  if (!accountDisabled) return null;

  function handleSignOut() {
    clearAuth();
    navigate('/login', { replace: true });
  }

  return (
    <Modal open onClose={() => {}} size="sm" dismissable={false} noPadding>
      <div className={styles.confirmBody}>
        <div className={`${styles.confirmIcon} ${styles.confirmIconDanger}`}>
          <AlertCircle size={24} />
        </div>
        <h2 className={styles.confirmTitle}>Account Disabled</h2>
        <p className={styles.confirmDescription}>
          Your account has been deactivated by an administrator. Contact your admin for assistance.
        </p>
      </div>
      <div className={styles.confirmActions} style={{ paddingTop: 0 }}>
        <Button variant="primary" onClick={handleSignOut} style={{ width: '100%' }}>
          Sign Out
        </Button>
      </div>
    </Modal>
  );
}
