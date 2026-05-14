import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import styles from './Chart.module.css';

/* ══════════════════════════════════════════
   Shared tooltip
   ══════════════════════════════════════════ */

function ChartTooltip({ active, payload, label }: TooltipProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;

  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className={styles.tooltipItem}>
          <span className={styles.tooltipDot} style={{ background: entry.color }} />
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
        </div>
      ))}
    </div>
  );
}

const AXIS_STYLE = {
  fontSize: 'var(--text-caption)',
  fill: 'var(--color-secondary-400)',
};

/* ══════════════════════════════════════════
   FitnessChart — GA fitness curve
   ══════════════════════════════════════════ */

interface FitnessDataPoint {
  generation: number;
  bestFitness: number;
  avgFitness?: number;
  hardViolations?: number;
}

interface FitnessChartProps {
  data: FitnessDataPoint[];
  showAverage?: boolean;
  showViolations?: boolean;
}

export function FitnessChart({
  data,
  showAverage = true,
  showViolations = false,
}: FitnessChartProps) {
  return (
    <div className={styles.container}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: showViolations ? 48 : 16, bottom: 8, left: 8 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-secondary-200)"
            strokeOpacity={0.5}
          />
          <XAxis
            dataKey="generation"
            label={{ value: 'Generation', position: 'insideBottom', offset: -4, style: AXIS_STYLE }}
            tick={{ style: AXIS_STYLE }}
            stroke="var(--color-secondary-200)"
          />
          <YAxis
            yAxisId="left"
            label={{ value: 'Fitness', angle: -90, position: 'insideLeft', offset: 4, style: AXIS_STYLE }}
            tick={{ style: AXIS_STYLE }}
            stroke="var(--color-secondary-200)"
          />
          {showViolations && (
            <YAxis
              yAxisId="right"
              orientation="right"
              label={{ value: 'Violations', angle: 90, position: 'insideRight', offset: 4, style: AXIS_STYLE }}
              tick={{ style: AXIS_STYLE }}
              stroke="var(--color-secondary-200)"
            />
          )}
          <Tooltip content={<ChartTooltip />} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="bestFitness"
            name="Best Fitness"
            stroke="var(--color-primary-500)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive
          />
          {showAverage && (
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="avgFitness"
              name="Avg Fitness"
              stroke="var(--color-accent-400)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive
            />
          )}
          {showViolations && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="hardViolations"
              name="Hard Violations"
              stroke="var(--color-error-500)"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ══════════════════════════════════════════
   SimpleBarChart — dashboard bar chart
   ══════════════════════════════════════════ */

interface BarDataPoint {
  name: string;
  value: number;
}

interface SimpleBarChartProps {
  data: BarDataPoint[];
  xLabel?: string;
  yLabel?: string;
}

export function SimpleBarChart({ data, xLabel, yLabel }: SimpleBarChartProps) {
  return (
    <div className={styles.container}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }} barGap={4}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-secondary-200)"
            strokeOpacity={0.5}
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ style: AXIS_STYLE }}
            stroke="var(--color-secondary-200)"
            label={xLabel ? { value: xLabel, position: 'insideBottom', offset: -4, style: AXIS_STYLE } : undefined}
          />
          <YAxis
            tick={{ style: AXIS_STYLE }}
            stroke="var(--color-secondary-200)"
            label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', offset: 4, style: AXIS_STYLE } : undefined}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            dataKey="value"
            name="Value"
            fill="var(--color-primary-500)"
            radius={[4, 4, 0, 0]}
            isAnimationActive
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
