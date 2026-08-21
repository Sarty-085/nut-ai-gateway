/**
 * Exercise energy — deterministic MET arithmetic, not a model guess.
 *
 * kcal = MET x 3.5 x kg / 200 x minutes (the standard ACSM formula). MET
 * values are from the Compendium of Physical Activities, matched to the same
 * three intensity anchors the incumbent shows the user. D16 applies to
 * exercise exactly as it does to food: Run and Weight lifting never touch a
 * model — only the free-text Describe path does, and it is labeled as such.
 */

export type ExerciseKind = 'run' | 'weights' | 'walk' | 'cycle' | 'swim' | 'hiit' | 'yoga'
export type Intensity = 'low' | 'medium' | 'high'

export interface IntensityAnchor {
  level: Intensity
  title: string
  desc: string
  met: number
}

export const INTENSITY_ANCHORS: Record<ExerciseKind, readonly IntensityAnchor[]> = {
  run: [
    { level: 'high', title: 'High', desc: 'Fast run / sprints — 8+ mph', met: 12.5 },
    { level: 'medium', title: 'Medium', desc: 'Jogging — 6 mph (10 minute miles)', met: 9.8 },
    { level: 'low', title: 'Low', desc: 'Light jog — 4 mph recovery', met: 6.0 },
  ],
  weights: [
    { level: 'high', title: 'High', desc: 'Heavy strength / training to failure', met: 6.0 },
    { level: 'medium', title: 'Medium', desc: 'Hypertrophy / circuit resistance', met: 4.5 },
    { level: 'low', title: 'Low', desc: 'Light machines / isolation movements', met: 3.0 },
  ],
  walk: [
    { level: 'high', title: 'High', desc: 'Power walk / incline hike — 4+ mph', met: 5.0 },
    { level: 'medium', title: 'Medium', desc: 'Brisk walk — 3.5 mph', met: 3.8 },
    { level: 'low', title: 'Low', desc: 'Casual stroll — 2.5 mph', met: 2.8 },
  ],
  cycle: [
    { level: 'high', title: 'High', desc: 'Vigorous spin / 14+ mph outdoor', met: 10.0 },
    { level: 'medium', title: 'Medium', desc: 'Moderate pace / 10-12 mph', met: 7.0 },
    { level: 'low', title: 'Low', desc: 'Leisure cycling / light stationary', met: 4.0 },
  ],
  swim: [
    { level: 'high', title: 'High', desc: 'Fast laps / freestyle vigorous', met: 9.8 },
    { level: 'medium', title: 'Medium', desc: 'Moderate breaststroke / backstroke', met: 6.0 },
    { level: 'low', title: 'Low', desc: 'Light leisure swimming / treading water', met: 4.0 },
  ],
  hiit: [
    { level: 'high', title: 'High', desc: 'Tabata / all-out interval sprints', met: 11.0 },
    { level: 'medium', title: 'Medium', desc: 'Standard functional circuit training', met: 8.0 },
    { level: 'low', title: 'Low', desc: 'Low-impact interval bodyweight', met: 5.5 },
  ],
  yoga: [
    { level: 'high', title: 'High', desc: 'Power / Vinyasa flow / Ashtanga', met: 4.0 },
    { level: 'medium', title: 'Medium', desc: 'Hatha yoga / dynamic mobility', met: 3.0 },
    { level: 'low', title: 'Low', desc: 'Restorative stretching / Yin yoga', met: 2.0 },
  ],
}

export function metFor(kind: ExerciseKind, level: Intensity): number {
  return INTENSITY_ANCHORS[kind].find((a) => a.level === level)!.met
}

/** Standard formula; weight matters — 30 hard minutes differ ~40% between 60 and 100 kg. */
export function exerciseKcal(kind: ExerciseKind, level: Intensity, weightKg: number, minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(weightKg) || weightKg <= 0) return 0
  return Math.round((metFor(kind, level) * 3.5 * weightKg * minutes) / 200)
}
