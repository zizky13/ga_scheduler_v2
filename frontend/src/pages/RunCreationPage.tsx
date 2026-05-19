import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  BookOpen,
  Lock,
  DoorOpen,
  Clock,
  Layers,
} from 'lucide-react';
import { PageHeader } from '../components/ContentArea';
import { Button } from '../components/Button';
import { NumberInput, Select, FormSection, FormActions } from '../components/Form';
import { ConfirmDialog } from '../components/Modal';
import { useToastStore } from '../store/toastStore';
import { useSemesterStore } from '../store/semesterStore';
import type { SemesterItem } from '../store/semesterStore';
import { useRateLimitCountdown } from '../hooks/useRateLimitCountdown';
import { get, post } from '../lib/api';
import type { ApiRequestError } from '../lib/api';
import styles from './RunCreationPage.module.css';

type CrossoverType = 'singlePoint' | 'uniform' | 'pmx';

interface GAFormState {
  populationSize: number;
  maxGenerations: number;
  crossoverRate: number;
  mutationRate: number;
  crossoverType: CrossoverType;
  elitismCount: number;
}

interface FormErrors {
  populationSize?: string;
  maxGenerations?: string;
  crossoverRate?: string;
  mutationRate?: string;
  elitismCount?: string;
}

interface PreflightData {
  semester: SemesterItem | null;
  totalOfferings: number;
  fixedOfferings: number;
  roomsAvailable: number;
  timeslotsAvailable: number;
}

interface ListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

const CROSSOVER_OPTIONS = [
  { value: 'singlePoint', label: 'Single Point' },
  { value: 'uniform', label: 'Uniform' },
  { value: 'pmx', label: 'Partially Mapped (PMX)' },
];

const DEFAULTS: GAFormState = {
  populationSize: 100,
  maxGenerations: 200,
  crossoverRate: 0.85,
  mutationRate: 0.1,
  crossoverType: 'uniform',
  elitismCount: 2,
};

function validate(form: GAFormState): FormErrors {
  const errors: FormErrors = {};
  if (form.populationSize < 20 || form.populationSize > 500)
    errors.populationSize = 'Must be between 20 and 500';
  if (form.maxGenerations < 50 || form.maxGenerations > 2000)
    errors.maxGenerations = 'Must be between 50 and 2000';
  if (form.crossoverRate < 0 || form.crossoverRate > 1)
    errors.crossoverRate = 'Must be between 0.0 and 1.0';
  if (form.mutationRate < 0 || form.mutationRate > 1)
    errors.mutationRate = 'Must be between 0.0 and 1.0';
  if (form.elitismCount < 0 || form.elitismCount > 20)
    errors.elitismCount = 'Must be between 0 and 20';
  if (form.elitismCount >= form.populationSize)
    errors.elitismCount = 'Must be less than population size';
  return errors;
}

export function RunCreationPage() {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeSemester = useSemesterStore((s) => s.activeSemester);

  const [form, setForm] = useState<GAFormState>(DEFAULTS);
  const [errors, setErrors] = useState<FormErrors>({});
  const [preflight, setPreflight] = useState<PreflightData>({
    semester: null,
    totalOfferings: 0,
    fixedOfferings: 0,
    roomsAvailable: 0,
    timeslotsAvailable: 0,
  });
  const [preflightLoading, setPreflightLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { blocked: rateLimited, remaining: rateLimitRemaining } = useRateLimitCountdown();

  const updateField = useCallback(<K extends keyof GAFormState>(key: K, value: GAFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key as keyof FormErrors];
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPreflight() {
      setPreflightLoading(true);
      try {
        if (!activeSemester || cancelled) {
          if (!cancelled) setPreflight((p) => ({ ...p, semester: null }));
          setPreflightLoading(false);
          return;
        }

        const sid = activeSemester.id;
        const [offeringsRes, roomsRes, timeslotsRes] = await Promise.all([
          get<ListResponse<{ id: number; isFixed: boolean }>>('/course-offerings', { semesterId: sid, page: 1, pageSize: 200 }),
          get<ListResponse<{ id: number }>>('/rooms', { semesterId: sid, page: 1, pageSize: 1 }),
          get<ListResponse<{ id: number }>>('/timeslots', { semesterId: sid, page: 1, pageSize: 1 }),
        ]);

        if (cancelled) return;

        const fixedCount = offeringsRes.data.filter((o) => o.isFixed).length;

        setPreflight({
          semester: activeSemester,
          totalOfferings: offeringsRes.meta.total,
          fixedOfferings: fixedCount,
          roomsAvailable: roomsRes.meta.total,
          timeslotsAvailable: timeslotsRes.meta.total,
        });
      } catch {
        if (!cancelled) {
          addToast({ type: 'warning', title: 'Preflight data unavailable', message: 'Could not load semester summary.' });
        }
      } finally {
        if (!cancelled) setPreflightLoading(false);
      }
    }

    loadPreflight();
    return () => { cancelled = true; };
  }, [addToast, activeSemester]);

  function handleStartClick() {
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setShowConfirm(true);
  }

  async function handleConfirm() {
    if (!preflight.semester) return;
    setSubmitting(true);
    try {
      const res = await post<{ id: string }>('/schedule-runs', {
        semesterId: preflight.semester.id,
        config: {
          populationSize: form.populationSize,
          generations: form.maxGenerations,
          mutationRate: form.mutationRate,
          elitismCount: form.elitismCount,
          tournamentSize: Math.min(5, form.populationSize),
          crossoverType: form.crossoverType,
          noiseRate: 0.1,
          hardPenaltyWeight: 100,
          softPenaltyWeight: 1,
        },
      });
      setShowConfirm(false);
      addToast({ type: 'success', title: 'Run started', message: 'Your schedule run has been queued.' });
      navigate(`/runs/${res.id}`);
    } catch (err) {
      setShowConfirm(false);
      const e = err as ApiRequestError;
      if (e.code === 'NO_ACTIVE_SEMESTER') {
        addToast({
          type: 'error',
          title: 'No offerings to schedule',
          message: 'The active semester has no course offerings. Create offerings before starting a run.',
        });
      } else if (e.code === 'RATE_LIMITED') {
        addToast({ type: 'error', title: 'Rate limited', message: e.message });
      } else {
        addToast({ type: 'error', title: 'Failed to start run', message: e.message });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const hasErrors = Object.keys(errors).length > 0;
  const estimatedCombinations =
    preflight.totalOfferings > 0 && preflight.roomsAvailable > 0 && preflight.timeslotsAvailable > 0
      ? preflight.totalOfferings * preflight.roomsAvailable * preflight.timeslotsAvailable
      : null;

  return (
    <>
      <PageHeader
        title="New Schedule Run"
        description="Schedule Runs › New Run"
      />

      <div className={styles.formCard}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>GA Configuration</h2>
          <p className={styles.sectionDescription}>
            Configure the genetic algorithm parameters for this run.
          </p>

          <FormSection>
            <div className={styles.fieldGrid}>
              <NumberInput
                label="Population Size"
                helperText="Number of chromosomes in each generation"
                error={errors.populationSize}
                value={form.populationSize}
                onChange={(v) => updateField('populationSize', v)}
                min={20}
                max={500}
                step={10}
                required
              />
              <NumberInput
                label="Max Generations"
                helperText="Maximum generations before stopping"
                error={errors.maxGenerations}
                value={form.maxGenerations}
                onChange={(v) => updateField('maxGenerations', v)}
                min={50}
                max={2000}
                step={50}
                required
              />
            </div>
            <div className={styles.fieldGrid}>
              <NumberInput
                label="Crossover Rate"
                helperText="Probability of crossover between parents"
                error={errors.crossoverRate}
                value={form.crossoverRate}
                onChange={(v) => updateField('crossoverRate', v)}
                min={0}
                max={1}
                step={0.01}
                required
              />
              <NumberInput
                label="Mutation Rate"
                helperText="Probability of mutation per gene"
                error={errors.mutationRate}
                value={form.mutationRate}
                onChange={(v) => updateField('mutationRate', v)}
                min={0}
                max={1}
                step={0.01}
                required
              />
            </div>
            <div className={styles.fieldGrid}>
              <Select
                label="Crossover Strategy"
                helperText="Strategy for combining parent chromosomes"
                options={CROSSOVER_OPTIONS}
                value={form.crossoverType}
                onChange={(v) => updateField('crossoverType', v as CrossoverType)}
                required
              />
              <NumberInput
                label="Elitism Count"
                helperText="Number of best individuals preserved each generation"
                error={errors.elitismCount}
                value={form.elitismCount}
                onChange={(v) => updateField('elitismCount', v)}
                min={0}
                max={20}
                step={1}
                required
              />
            </div>
          </FormSection>
        </section>

        <hr className={styles.divider} />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pre-flight Info</h2>
          <p className={styles.sectionDescription}>
            Summary of the current semester data that will be used for this run.
          </p>

          {preflightLoading ? (
            <div className={styles.preflightGrid}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={styles.preflightSkeleton} />
              ))}
            </div>
          ) : !preflight.semester ? (
            <div className={styles.noSemester}>
              No active semester found. Please activate a semester before creating a run.
            </div>
          ) : preflight.totalOfferings === 0 ? (
            <div className={styles.noSemester}>
              Semester {preflight.semester.code} has no course offerings. Create offerings on
              the Course Offerings page before starting a run.
            </div>
          ) : (
            <div className={styles.preflightGrid}>
              <PreflightItem
                icon={<Calendar size={16} />}
                label="Active Semester"
                value={preflight.semester.code}
              />
              <PreflightItem
                icon={<BookOpen size={16} />}
                label="Total Offerings"
                value={String(preflight.totalOfferings)}
              />
              <PreflightItem
                icon={<Lock size={16} />}
                label="Fixed Offerings"
                value={String(preflight.fixedOfferings)}
              />
              <PreflightItem
                icon={<DoorOpen size={16} />}
                label="Rooms Available"
                value={String(preflight.roomsAvailable)}
              />
              <PreflightItem
                icon={<Clock size={16} />}
                label="Timeslots Available"
                value={String(preflight.timeslotsAvailable)}
              />
              {estimatedCombinations !== null && (
                <PreflightItem
                  icon={<Layers size={16} />}
                  label="Estimated Combinations"
                  value={estimatedCombinations.toLocaleString()}
                />
              )}
            </div>
          )}
        </section>

        <hr className={styles.divider} />

        <FormActions>
          <Button variant="secondary" onClick={() => navigate('/runs')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={handleStartClick}
            disabled={
              !preflight.semester ||
              preflightLoading ||
              hasErrors ||
              submitting ||
              rateLimited ||
              preflight.totalOfferings === 0
            }
            icon={rateLimited ? <Clock size={16} /> : undefined}
          >
            {rateLimited ? `Retry in ${rateLimitRemaining}s` : 'Start Run'}
          </Button>
        </FormActions>
      </div>

      <ConfirmDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirm}
        variant="warning"
        title="Start Schedule Run?"
        description={`This will start a new GA run with ${form.populationSize} population and ${form.maxGenerations} max generations. Continue?`}
        confirmLabel="Start Run"
        cancelLabel="Go Back"
        loading={submitting}
      />
    </>
  );
}

function PreflightItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={styles.preflightItem}>
      <div className={styles.preflightIcon}>{icon}</div>
      <div className={styles.preflightContent}>
        <span className={styles.preflightLabel}>{label}</span>
        <span className={styles.preflightValue}>{value}</span>
      </div>
    </div>
  );
}
