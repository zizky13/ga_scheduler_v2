import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shaking, setShaking] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';

  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  if (isAuthenticated) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await new Promise((r) => setTimeout(r, 300));

      if (email === 'admin@upj.ac.id' && password === 'admin') {
        login({ id: '1', name: 'Admin User', email, role: 'ADMIN' });
        navigate(from, { replace: true });
      } else if (email === 'user@upj.ac.id' && password === 'user') {
        login({ id: '2', name: 'Regular User', email, role: 'USER' });
        navigate(from, { replace: true });
      } else {
        setError('Invalid email or password.');
        setPassword('');
        setShaking(true);
        setTimeout(() => setShaking(false), 400);
        emailRef.current?.focus();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div
        ref={cardRef}
        className={`${styles.card} ${shaking ? styles.shake : ''}`}
      >
        <h1 className={styles.logo}>GA Scheduler</h1>
        <p className={styles.institution}>Universitas Pembangunan Jaya</p>

        <h2 className={styles.heading}>Sign in to your account</h2>
        <p className={styles.description}>Enter your credentials below.</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-email">
              Email address
            </label>
            <input
              ref={emailRef}
              id="login-email"
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@upj.ac.id"
              required
              disabled={loading}
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-password">
              Password
            </label>
            <div className={styles.passwordWrapper}>
              <input
                id="login-password"
                className={styles.input}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((p) => !p)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              <AlertCircle className={styles.errorIcon} />
              {error}
            </div>
          )}

          <button
            className={styles.submitButton}
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className={styles.spinner} />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
