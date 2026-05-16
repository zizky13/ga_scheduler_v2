import { create } from 'zustand';

interface RateLimitState {
  retryAt: number | null;
  setRetryAfter: (seconds: number) => void;
  clear: () => void;
}

export const useRateLimitStore = create<RateLimitState>((set) => ({
  retryAt: null,

  setRetryAfter: (seconds: number) => {
    set({ retryAt: Date.now() + seconds * 1000 });
  },

  clear: () => set({ retryAt: null }),
}));
