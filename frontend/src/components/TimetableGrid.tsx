import { Fragment } from 'react';
import styles from './TimetableGrid.module.css';

export type GridDensity = 'comfortable' | 'compact';

export const GRID_COL_OFFSET = 2;
export const GRID_ROW_OFFSET = 2;

const ROW_HEIGHT: Record<GridDensity, number> = {
  comfortable: 60,
  compact: 44,
};

const HEADER_HEIGHT = 48;

interface TimetableGridProps {
  days: string[];
  timeLabels: string[];
  density?: GridDensity;
  children?: React.ReactNode;
}

export function TimetableGrid({
  days,
  timeLabels,
  density = 'comfortable',
  children,
}: TimetableGridProps) {
  const rowHeight = ROW_HEIGHT[density];
  const gridTemplateColumns = `80px repeat(${days.length}, minmax(160px, 1fr))`;
  const gridTemplateRows = `${HEADER_HEIGHT}px repeat(${timeLabels.length}, ${rowHeight}px)`;

  return (
    <div className={styles.container}>
      <div className={styles.scrollWrapper}>
        <div
          className={`${styles.grid} ${styles[density]}`}
          style={{ gridTemplateColumns, gridTemplateRows }}
          role="grid"
          aria-label="Schedule timetable"
        >
          {/* Corner cell (top-left, sticky both axes) */}
          <div className={styles.corner} role="columnheader" />

          {/* Day header row */}
          {days.map((day, i) => (
            <div
              key={day}
              className={styles.dayHeader}
              style={{ gridColumn: i + GRID_COL_OFFSET, gridRow: 1 }}
              role="columnheader"
            >
              {day}
            </div>
          ))}

          {/* Time label column + empty body cells */}
          {timeLabels.map((time, rowIdx) => (
            <Fragment key={time}>
              <div
                className={styles.timeLabel}
                style={{ gridColumn: 1, gridRow: rowIdx + GRID_ROW_OFFSET }}
                role="rowheader"
              >
                {time}
              </div>
              {days.map((day, dayIdx) => (
                <div
                  key={`${day}-${time}`}
                  className={styles.cell}
                  style={{
                    gridColumn: dayIdx + GRID_COL_OFFSET,
                    gridRow: rowIdx + GRID_ROW_OFFSET,
                  }}
                  role="gridcell"
                />
              ))}
            </Fragment>
          ))}

          {/* Course blocks injected as children */}
          {children}
        </div>
      </div>
    </div>
  );
}
