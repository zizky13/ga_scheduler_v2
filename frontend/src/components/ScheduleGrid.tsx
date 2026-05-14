import { Fragment, useMemo } from 'react'
import type { SchedulerResponse, CourseOffering, TimeSlot, Room, Lecturer } from '@pipeline/types'
import styles from './ScheduleGrid.module.css'

interface ScheduleGridProps {
  response: SchedulerResponse
  offerings: CourseOffering[]
  timeSlots: TimeSlot[]
  rooms: Room[]
  lecturers: Lecturer[]
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const

export function ScheduleGrid({ response, offerings, timeSlots, rooms }: ScheduleGridProps) {
  // Derive unique start times sorted chronologically
  const uniqueStartTimes = useMemo(() => {
    const times = new Set<string>()
    for (const slot of timeSlots) {
      times.add(slot.startTime)
    }
    return [...times].sort()
  }, [timeSlots])

  // Map from slot ID to its day/startTime/endTime
  const slotMap = useMemo(() => {
    const map = new Map<number, { day: string; startTime: string; endTime: string }>()
    for (const slot of timeSlots) {
      map.set(slot.id, { day: slot.day, startTime: slot.startTime, endTime: slot.endTime })
    }
    return map
  }, [timeSlots])

  // Map from startTime string to 0-based row index
  const startTimeToRow = useMemo(() => {
    const map = new Map<string, number>()
    for (let i = 0; i < uniqueStartTimes.length; i++) {
      map.set(uniqueStartTimes[i], i)
    }
    return map
  }, [uniqueStartTimes])

  const rowCount = uniqueStartTimes.length
  const gridTemplateRows = `48px repeat(${rowCount}, 60px)`

  return (
    <div className={styles.container}>
      <div className={styles.scrollWrapper}>
        <div
          className={styles.grid}
          style={{ gridTemplateRows }}
          role="grid"
          aria-label="Schedule grid"
        >
          {/* Corner cell */}
          <div className={styles.corner} />

          {/* Day header cells */}
          {DAYS.map((day, i) => (
            <div key={day} className={styles.dayHeader} style={{ gridColumn: i + 2, gridRow: 1 }}>
              {day}
            </div>
          ))}

          {/* Time label cells + empty body cells */}
          {uniqueStartTimes.map((time, rowIdx) => (
            <Fragment key={`row-${time}`}>
              {/* Time label */}
              <div className={styles.timeLabel} style={{ gridColumn: 1, gridRow: rowIdx + 2 }}>
                {time}
              </div>

              {/* Empty cells for each day column */}
              {DAYS.map((day, dayIdx) => (
                <div
                  key={`cell-${day}-${time}`}
                  className={styles.cell}
                  style={{ gridColumn: dayIdx + 2, gridRow: rowIdx + 2 }}
                />
              ))}
            </Fragment>
          ))}

          {/* Assignment blocks */}
          {response.gaResult?.bestChromosome.map((gene, geneIdx) => {
            const offering = offerings.find((o) => o.id === gene.offeringId)
            if (!offering) return null
            return gene.sessions.map((session, sessionIdx) => {
              const firstSlot = slotMap.get(session.timeSlotIds[0])
              if (!firstSlot) return null
              const dayIdx = DAYS.indexOf(firstSlot.day as (typeof DAYS)[number])
              const rowIdx = startTimeToRow.get(firstSlot.startTime)
              if (dayIdx === -1 || rowIdx === undefined) return null
              const room = rooms.find((r) => r.id === session.roomId)
              return (
                <div
                  key={`block-${geneIdx}-${sessionIdx}`}
                  className={styles.block}
                  style={{
                    gridColumn: dayIdx + 2,
                    gridRow: `${rowIdx + 2} / span ${session.timeSlotIds.length}`,
                  }}
                >
                  <span className={styles.blockCode}>{offering.course.code}</span>
                  <span className={styles.blockRoom}>{room?.name ?? `Room ${session.roomId}`}</span>
                  <span>{offering.lecturers.map((l) => l.name).join(', ')}</span>
                  <span>{offering.course.name}</span>
                </div>
              )
            })
          })}
        </div>
      </div>
    </div>
  )
}
