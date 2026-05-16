import { useState, useEffect } from 'react';
import { useRateLimitStore } from '../store/rateLimitStore';

export function useRateLimitCountdown() {
  const retryAt = useRateLimitStore((s) => s.retryAt);
  const clear = useRateLimitStore((s) => s.clear);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!retryAt) {
      setRemaining(0);
      return;
    }

    function tick() {
      const left = Math.ceil((retryAt! - Date.now()) / 1000);
      if (left <= 0) {
        setRemaining(0);
        clear();
      } else {
        setRemaining(left);
      }
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [retryAt, clear]);

  return { blocked: remaining > 0, remaining };
}
