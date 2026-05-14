import { useState, useCallback } from 'react';
import { useTheme } from './lib/useTheme';
import { usePipelineStore } from './store/pipelineStore';
import type { PipelineStatus } from './store/pipelineStore';
import { runPipeline, getDefaultInput, getDefaultConfig } from './lib/pipeline';
import type { GAConfig } from './lib/pipeline';
import styles from './App.module.css';

const STATUS_LABEL: Record<PipelineStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
  infeasible: 'Infeasible',
};

const STATUS_CLASS: Record<PipelineStatus, string> = {
  idle: styles.statusIdle,
  running: styles.statusRunning,
  success: styles.statusSuccess,
  failed: styles.statusFailed,
  infeasible: styles.statusInfeasible,
};

const CROSSOVER_OPTIONS: GAConfig['crossoverType'][] = ['singlePoint', 'uniform', 'pmx'];

function App() {
  const { theme, toggleTheme } = useTheme();
  const { status, response, error, setRunning, setResult, setError } = usePipelineStore();

  // Task 7: Re-run config controls
  const defaults = getDefaultConfig();
  const [populationSize, setPopulationSize] = useState(defaults.populationSize);
  const [generations, setGenerations] = useState(defaults.generations);
  const [crossoverType, setCrossoverType] = useState<GAConfig['crossoverType']>(defaults.crossoverType);

  // Derive stats from store response
  const stats = response?.gaResult
    ? {
        bestFitness: response.gaResult.bestFitness,
        hardViolations: response.gaResult.hardViolations,
        softPenalty: response.gaResult.softPenalty,
        durationMs: response.durationMs,
      }
    : response
      ? { bestFitness: 0, hardViolations: 0, softPenalty: 0, durationMs: response.durationMs }
      : null;

  // Task 6: Wire the run
  const handleRun = useCallback(async () => {
    setRunning();
    try {
      const input = getDefaultInput({ populationSize, generations, crossoverType });
      const output = await runPipeline(input);
      setResult(output.response);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [populationSize, generations, crossoverType, setRunning, setResult, setError]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>UPJ Scheduler — POC</h1>
          <p className={styles.subtitle}>
            Proof-of-concept: run the GA pipeline in-browser against the seed dataset.
          </p>
        </div>
        <button
          className={styles.themeToggle}
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          type="button"
        >
          {theme === 'light' ? '☽' : '☀'}
        </button>
      </header>

      {/* Task 7: Re-run controls */}
      <div className={styles.configPanel}>
        <div className={styles.configField}>
          <label className={styles.configLabel} htmlFor="cfg-pop">
            Population Size
          </label>
          <input
            id="cfg-pop"
            className={styles.configInput}
            type="number"
            min={2}
            max={500}
            value={populationSize}
            onChange={(e) => setPopulationSize(Number(e.target.value))}
            disabled={status === 'running'}
          />
        </div>
        <div className={styles.configField}>
          <label className={styles.configLabel} htmlFor="cfg-gen">
            Generations
          </label>
          <input
            id="cfg-gen"
            className={styles.configInput}
            type="number"
            min={1}
            max={2000}
            value={generations}
            onChange={(e) => setGenerations(Number(e.target.value))}
            disabled={status === 'running'}
          />
        </div>
        <div className={styles.configField}>
          <label className={styles.configLabel} htmlFor="cfg-cross">
            Crossover
          </label>
          <select
            id="cfg-cross"
            className={styles.configSelect}
            value={crossoverType}
            onChange={(e) => setCrossoverType(e.target.value as GAConfig['crossoverType'])}
            disabled={status === 'running'}
          >
            {CROSSOVER_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className={styles.runButton}
          type="button"
          disabled={status === 'running'}
          onClick={handleRun}
        >
          {status === 'running' ? '⏳ Running…' : '▶ Run Pipeline'}
        </button>
        <span className={`${styles.statusPill} ${STATUS_CLASS[status]}`}>
          &#9679; {STATUS_LABEL[status]}
        </span>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Best Fitness</p>
          <p className={styles.statValue}>
            {stats ? stats.bestFitness.toFixed(4) : '—'}
          </p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Hard Violations</p>
          <p
            className={`${styles.statValue} ${
              stats
                ? stats.hardViolations === 0
                  ? styles.statValueSuccess
                  : styles.statValueError
                : ''
            }`}
          >
            {stats ? stats.hardViolations : '—'}
          </p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Soft Penalty</p>
          <p className={styles.statValue}>
            {stats ? stats.softPenalty.toFixed(2) : '—'}
          </p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>Duration</p>
          <p className={styles.statValue}>
            {stats ? `${stats.durationMs} ms` : '— ms'}
          </p>
        </div>
      </div>

      {/* Task 6: Explanation cards for non-success results */}
      {status === 'failed' && response?.status === 'NO_FEASIBLE_CANDIDATES' && (
        <div className={`${styles.explanationCard} ${styles.explanationError}`}>
          <h2 className={`${styles.explanationTitle} ${styles.explanationTitleError}`}>
            No Feasible Candidates
          </h2>
          <p className={styles.explanationBody}>
            All course offerings were rejected during Pre-GA validation.
            No schedule can be generated.
          </p>
          {response.preGASummary.infeasible.length > 0 && (
            <pre className={styles.explanationDetail}>
              {response.preGASummary.infeasible
                .map(
                  (entry) =>
                    `Offering ${entry.offeringId}: [${entry.code}] ${entry.message}`
                )
                .join('\n')}
            </pre>
          )}
        </div>
      )}

      {status === 'infeasible' && response?.ssaResult && (
        <div className={`${styles.explanationCard} ${styles.explanationWarning}`}>
          <h2 className={`${styles.explanationTitle} ${styles.explanationTitleWarning}`}>
            Schedule Infeasible
          </h2>
          <p className={styles.explanationBody}>
            The Slot Sufficiency Analysis determined that a valid schedule cannot be
            constructed with the current data.
          </p>
          <pre className={styles.explanationDetail}>
            {`Sessions required: ${response.ssaResult.totalSessionsRequired}\nMaximum achievable: ${response.ssaResult.maximumAchievableMatching}`}
            {response.ssaResult.deadlockReport &&
              `\n\n${response.ssaResult.deadlockReport.message}\nRecommendation: ${response.ssaResult.deadlockReport.recommendation}`}
          </pre>
        </div>
      )}

      {status === 'failed' && error && (
        <div className={`${styles.explanationCard} ${styles.explanationError}`}>
          <h2 className={`${styles.explanationTitle} ${styles.explanationTitleError}`}>
            Pipeline Error
          </h2>
          <p className={styles.explanationBody}>{error}</p>
        </div>
      )}
    </div>
  );
}

export default App;
