import { Fragment, useMemo } from 'react'
import { Lock } from 'lucide-react'
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

const CATEGORY_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const

const COMPETENCY_TO_CATEGORY: Record<string, typeof CATEGORY_LETTERS[number]> = {
  'algorithms': 'a',
  'databases': 'b',
  'networks': 'c',
  'software-engineering': 'd',
  'ai-ml': 'e',
  'visual-design': 'f',
  'os': 'g',
  'security': 'a',
  'cloud': 'b',
  'math': 'c',
}

function getCategoryLetter(competencies: string[]): typeof CATEGORY_LETTERS[number] {
  if (competencies.length === 0) return 'a'
  return COMPETENCY_TO_CATEGORY[competencies[0]] ?? CATEGORY_LETTERS[competencies[0].length % CATEGORY_LETTERS.length]
}

function blockColorVars(letter: string): React.CSSProperties {
  return {
    '--block-bg': `var(--block-${letter}-bg)`,
    '--block-text': `var(--block-${letter}-text)`,
    '--block-border': `var(--block-${letter}-border)`,
  } as React.CSSProperties
}

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

  // Conflict detection: find blocks that share (day, slot, room) or (day, slot, lecturer)
  const conflictingBlocks = useMemo(() => {
    const chromosome = response.gaResult?.bestChromosome
    if (!chromosome) return new Set<string>()

    // Track which block keys occupy each (slotId, roomId) and (slotId, lecturerId)
    const roomOccupancy = new Map<string, string[]>()
    const lecturerOccupancy = new Map<string, string[]>()

    for (let geneIdx = 0; geneIdx < chromosome.length; geneIdx++) {
      const gene = chromosome[geneIdx]
      const offering = offerings.find((o) => o.id === gene.offeringId)
      if (!offering) continue
      for (let sessionIdx = 0; sessionIdx < gene.sessions.length; sessionIdx++) {
        const session = gene.sessions[sessionIdx]
        const blockKey = `${geneIdx}-${sessionIdx}`
        for (const slotId of session.timeSlotIds) {
          const roomKey = `${slotId}:r${session.roomId}`
          const existing = roomOccupancy.get(roomKey)
          if (existing) existing.push(blockKey)
          else roomOccupancy.set(roomKey, [blockKey])

          for (const lecturerId of offering.lecturers.map((l) => l.id)) {
            const lecKey = `${slotId}:l${lecturerId}`
            const lexisting = lecturerOccupancy.get(lecKey)
            if (lexisting) lexisting.push(blockKey)
            else lecturerOccupancy.set(lecKey, [blockKey])
          }
        }
      }
    }

    const conflicts = new Set<string>()
    for (const keys of roomOccupancy.values()) {
      if (keys.length > 1) for (const k of keys) conflicts.add(k)
    }
    for (const keys of lecturerOccupancy.values()) {
      if (keys.length > 1) for (const k of keys) conflicts.add(k)
    }
    return conflicts
  }, [response.gaResult?.bestChromosome, offerings])

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
            const isParallel = gene.sessions.length > 1
            const isFixed = gene.kind === 'FIXED'
            const colorLetter = isFixed ? 'fixed' : getCategoryLetter(offering.course.requiredCompetencies)
            return gene.sessions.map((session, sessionIdx) => {
              const firstSlot = slotMap.get(session.timeSlotIds[0])
              if (!firstSlot) return null
              const dayIdx = DAYS.indexOf(firstSlot.day as (typeof DAYS)[number])
              const rowIdx = startTimeToRow.get(firstSlot.startTime)
              if (dayIdx === -1 || rowIdx === undefined) return null
              const room = rooms.find((r) => r.id === session.roomId)
              const roomName = room?.name ?? `Room ${session.roomId}`
              const lecturerNames = offering.lecturers.map((l) => l.name).join(', ')
              const isSingleSlot = session.timeSlotIds.length === 1
              const hasConflict = conflictingBlocks.has(`${geneIdx}-${sessionIdx}`)
              const blockClass = [
                styles.block,
                isSingleSlot && styles.blockCompact,
                isFixed && styles.blockFixed,
                hasConflict && styles.blockConflict,
              ].filter(Boolean).join(' ')
              const lastSlot = slotMap.get(session.timeSlotIds[session.timeSlotIds.length - 1])
              const timeRange = `${firstSlot.startTime} – ${lastSlot?.endTime ?? firstSlot.endTime}`
              return (
                <div
                  key={`block-${geneIdx}-${sessionIdx}`}
                  className={blockClass}
                  style={{
                    gridColumn: dayIdx + 2,
                    gridRow: `${rowIdx + 2} / span ${session.timeSlotIds.length}`,
                    ...blockColorVars(colorLetter),
                  }}
                >
                  {isFixed && <Lock size={10} className={styles.lockIcon} />}
                  {isSingleSlot ? (
                    <span className={styles.blockCodeInline}>
                      {offering.course.code}
                      <span className={styles.blockRoomInline}>{roomName}</span>
                    </span>
                  ) : (
                    <>
                      <span className={styles.blockCode}>{offering.course.code}</span>
                      <span className={styles.blockName}>{offering.course.name}</span>
                      <span className={styles.blockMeta}>{roomName} · {lecturerNames}</span>
                      {isParallel && (
                        <span className={styles.blockSession}>
                          Sesi {String.fromCharCode(65 + sessionIdx)}
                        </span>
                      )}
                    </>
                  )}
                  <div className={styles.tooltip}>
                    <p className={styles.tooltipCode}>{offering.course.code}</p>
                    <p className={styles.tooltipName}>{offering.course.name}</p>
                    <p className={styles.tooltipRow}>
                      <span className={styles.tooltipLabel}>Lecturer: </span>
                      {offering.lecturers.map((l) => l.name).join(', ')}
                    </p>
                    <p className={styles.tooltipRow}>
                      <span className={styles.tooltipLabel}>Room: </span>
                      {roomName}{room ? ` (cap. ${room.capacity})` : ''}
                    </p>
                    <p className={styles.tooltipRow}>
                      <span className={styles.tooltipLabel}>Time: </span>
                      {timeRange}
                    </p>
                    {isParallel && (
                      <p className={styles.tooltipRow}>
                        <span className={styles.tooltipLabel}>Session: </span>
                        {String.fromCharCode(65 + sessionIdx)}
                      </p>
                    )}
                    {isFixed && <span className={styles.tooltipFixed}>Fixed</span>}
                  </div>
                </div>
              )
            })
          })}
        </div>
      </div>
    </div>
  )
}
