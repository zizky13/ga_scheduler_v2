import { create } from 'zustand';
import { get, post } from '../lib/api';
import type { ListResponse } from '../lib/api';

export interface SemesterItem {
  id: number;
  code: string;
  label: string;
  isActive: boolean;
}

interface SemesterState {
  semesters: SemesterItem[];
  activeSemester: SemesterItem | null;
  loading: boolean;
  version: number;

  fetchSemesters: () => Promise<void>;
  activateSemester: (id: number) => Promise<void>;
}

interface SemesterWire {
  id: number;
  code: string;
  label: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const useSemesterStore = create<SemesterState>((set, getState) => ({
  semesters: [],
  activeSemester: null,
  loading: false,
  version: 0,

  fetchSemesters: async () => {
    set({ loading: true });
    try {
      const res = await get<ListResponse<SemesterWire>>('/semesters', {
        page: 1,
        pageSize: 100,
        sort: '-startsOn',
      });
      const items: SemesterItem[] = res.data.map((s) => ({
        id: s.id,
        code: s.code,
        label: s.label,
        isActive: s.isActive,
      }));
      const active = items.find((s) => s.isActive) ?? null;
      set({ semesters: items, activeSemester: active, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  activateSemester: async (id: number) => {
    const { semesters } = getState();
    const target = semesters.find((s) => s.id === id);
    if (!target) return;

    await post(`/semesters/${id}/activate`, {});

    const updated = semesters.map((s) => ({
      ...s,
      isActive: s.id === id,
    }));
    set({
      semesters: updated,
      activeSemester: { ...target, isActive: true },
      version: getState().version + 1,
    });
  },
}));
