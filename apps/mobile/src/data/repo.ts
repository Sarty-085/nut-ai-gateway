import { migrate, type DbAdapter } from '@nutai/db-adapter'
import {
  computeCalorieTarget,
  computeMacros,
  computeTrend,
  isDayCompleteEnough,
  LB_PER_KG,
  trendSlopeLbPerWeek,
  updateAdaptiveTdee,
  type Goal,
  type MacroTargets,
  type WeightPoint,
} from '@nutai/goals'
import Storage from 'expo-sqlite/kv-store'
import { ONBOARDING_DONE_KEY } from '../onboarding/done-key'
import { EXPORT_TABLES, WIPE_ONLY_TABLES } from './backup-core'
import { localDate, slotFor } from './date-utils'
import { clearCredential } from '../inference/credentials'
import { openUserDb } from '../db/expo-adapter'

export { localDate, slotFor }

/**
 * The read/write layer over `user.db`.
 *
 * Every screen goes through here rather than holding its own SQL, so the
 * invariants live in one place: goals are append-only, day totals are always
 * derived from log_items rather than stored, and the adaptive loop can never run
 * on days it should not admit.
 */

let cached: DbAdapter | null = null

export async function db(): Promise<DbAdapter> {
  if (cached) return cached
  const handle = await openUserDb()
  await migrate(handle, Date.now())
  cached = handle
  return handle
}


/**
 * Wipe every local trace and send the app back to the first onboarding screen.
 *
 * Deletes user data, drops the stored API credentials out of the Keychain, and
 * clears the completion flag. The bundled nutrition corpus is left alone — it is
 * a read-only build artifact, not user data, and re-importing 4.7 MB to prove a
 * point would just make this slow.
 */
export async function resetEverything(): Promise<void> {
  const h = await db()
  // ONE source of truth for "what counts as user data": the backup lists.
  // Children before parents, so foreign keys never block the wipe.
  const tables: string[] = [...([...EXPORT_TABLES] as string[]).reverse(), ...WIPE_ONLY_TABLES]
  await h.transaction(async (tx) => {
    for (const t of tables) {
      // A missing table is not an error here — an interrupted migration should
      // still be resettable, which is exactly when someone reaches for this.
      try {
        await tx.run(`DELETE FROM ${t}`)
      } catch {
        /* table absent */
      }
    }
  })

  for (const p of ['anthropic', 'openai', 'google'] as const) {
    await clearCredential(p)
  }

  await Storage.removeItem(ONBOARDING_DONE_KEY)
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface CurrentGoal {
  goalType: Goal
  targetKcal: number
  targetRawKcal: number
  floorApplied: boolean
  protein_g: number
  fat_g: number
  carbs_g: number
  bmr: number
  tdee: number
  adaptive: boolean
  effectiveFrom: number
}

/**
 * The goal in force right now.
 *
 * `goals` is append-only, so "current" means the newest row — and a historical
 * day can still be read against whichever row was in force that day. Recomputing
 * March against August's target would silently rewrite whether someone hit their
 * goal three months ago.
 */
export async function currentGoal(): Promise<CurrentGoal | null> {
  const h = await db()
  const row = await h.get<{
    goal_type: string
    target_kcal: number
    target_raw_kcal: number
    floor_applied: number
    protein_g: number
    fat_g: number
    carbs_g: number
    bmr: number
    tdee: number
    adaptive: number
    effective_from: number
  }>('SELECT * FROM goals ORDER BY effective_from DESC, id DESC LIMIT 1')

  if (!row) return null
  return {
    goalType: row.goal_type as Goal,
    targetKcal: row.target_kcal,
    targetRawKcal: row.target_raw_kcal,
    floorApplied: row.floor_applied === 1,
    protein_g: row.protein_g,
    fat_g: row.fat_g,
    carbs_g: row.carbs_g,
    bmr: row.bmr,
    tdee: row.tdee,
    adaptive: row.adaptive === 1,
    effectiveFrom: row.effective_from,
  }
}

export async function setting(key: string, fallback = ''): Promise<string> {
  const h = await db()
  const row = await h.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  return row?.value ?? fallback
}

export async function putSetting(key: string, value: string): Promise<void> {
  const h = await db()
  await h.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, value])
}

/** Manual target override from the plan screen's pencil icons. */
export async function overrideTargets(
  next: { targetKcal: number; macros: MacroTargets },
  base: CurrentGoal,
  now: number,
): Promise<void> {
  const h = await db()
  await h.run(
    `INSERT INTO goals
       (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      now,
      base.goalType,
      null,
      next.targetKcal,
      next.targetKcal,
      0,
      next.macros.protein_g,
      next.macros.fat_g,
      next.macros.carbs_g,
      base.bmr,
      base.tdee,
      // A hand-set target turns the adaptive loop OFF. Silently overwriting a
      // number the user deliberately chose is the fastest way to lose their
      // trust in every other number.
      0,
    ],
  )
}

// ---------------------------------------------------------------------------
// Day totals
// ---------------------------------------------------------------------------

export interface DayTotals {
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  mealCount: number
  distinctSlots: number
  pendingCount: number
}

/**
 * Derived from log_items on every read, never stored.
 *
 * `day_summaries` exists as a cache for the widget, but it is droppable and
 * rebuildable — this query is the source of truth.
 */
export async function dayTotals(date: string): Promise<DayTotals> {
  const h = await db()

  const row = await h.get<{
    kcal: number | null
    p: number | null
    f: number | null
    c: number | null
    meals: number | null
    slots: number | null
  }>(
    `SELECT
       SUM(li.snap_energy_kcal * li.grams / 100.0 * m.portion_eaten_fraction) AS kcal,
       SUM(li.snap_protein_g   * li.grams / 100.0 * m.portion_eaten_fraction) AS p,
       SUM(li.snap_fat_g       * li.grams / 100.0 * m.portion_eaten_fraction) AS f,
       SUM(li.snap_carb_g      * li.grams / 100.0 * m.portion_eaten_fraction) AS c,
       COUNT(DISTINCT m.id)        AS meals,
       COUNT(DISTINCT m.meal_slot) AS slots
     FROM meals m
     JOIN log_items li ON li.meal_id = m.id
     WHERE m.local_date = ? AND m.analysis_status IN ('complete','manual')`,
    [date],
  )

  const pending = await h.get<{ c: number }>(
    `SELECT COUNT(*) c FROM meals
     WHERE local_date = ? AND analysis_status IN ('captured','queued','analyzing')`,
    [date],
  )

  return {
    kcal: row?.kcal ?? 0,
    protein_g: row?.p ?? 0,
    fat_g: row?.f ?? 0,
    carbs_g: row?.c ?? 0,
    mealCount: row?.meals ?? 0,
    distinctSlots: row?.slots ?? 0,
    // Pending scans contribute ZERO calories. A number that silently grows later
    // is worse than a number that is visibly incomplete.
    pendingCount: pending?.c ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------

/**
 * Persist a reviewed scan. One transaction: the meal row, every ingredient with
 * its per-100 g snapshot copied in (never re-looked-up live), and the cost
 * ledger entry with REAL token counts. analysis_status lands as 'complete',
 * which is what dayTotals reads — logging is what makes the Today ring move.
 */
export async function logMeal(
  result: import('@nutai/pipeline').ScanResult,
  meta: {
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    costUsd: number
  } | null,
  photoUri: string | null,
  now: number,
): Promise<number> {
  const h = await db()
  const date = localDate(now)

  return h.transaction(async (tx) => {
    const meal = await tx.run(
      `INSERT INTO meals (logged_at, local_date, meal_slot, photo_uri, portion_eaten_fraction,
                          analysis_status, engine_id, prompt_version, schema_version,
                          clamp_flags_json, created_at)
       VALUES (?,?,?,?,?,'complete',?,?,?,?,?)`,
      [
        now,
        date,
        slotFor(now),
        photoUri,
        result.meal.portionEatenFraction,
        result.meal.engineId,
        result.meal.promptVersion,
        result.meal.schemaVersion,
        JSON.stringify(result.clampFlags ?? []),
        now,
      ],
    )
    const mealId = Number(meal.lastInsertRowId)

    let sort = 0
    for (const row of result.meal.ingredients) {
      const foodId = row.sourceFoodId == null ? null : Number(row.sourceFoodId)
      await tx.run(
        `INSERT INTO log_items (meal_id, matched_food_id, matched_food_source, raw_model_label,
                                display_name, grams, gram_pathway, portion_source,
                                snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g,
                                snap_fiber_g, snap_sugar_g, snap_sodium_mg,
                                is_estimate, macros_user_edited, band_half_pct,
                                assumptions_json, sort_order, logged_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          mealId,
          Number.isFinite(foodId as number) ? foodId : null,
          row.origin === 'web_lookup' ? 'web' : row.sourceFoodId != null ? 'corpus' : 'estimate',
          row.sourceUrl ?? null,
          row.displayName,
          row.grams,
          row.gramPathway,
          row.origin,
          row.nutrientSnapshot.kcal,
          row.nutrientSnapshot.protein_g,
          row.nutrientSnapshot.fat_g,
          row.nutrientSnapshot.carbs_g,
          row.nutrientSnapshot.fiber_g ?? null,
          row.nutrientSnapshot.sugar_g ?? null,
          row.nutrientSnapshot.sodium_mg ?? null,
          row.isEstimate ? 1 : 0,
          row.macrosUserEdited ? 1 : 0,
          row.bandHalfPct,
          JSON.stringify(row.assumptions ?? []),
          sort++,
          now,
        ],
      )
    }

    if (meta) {
      await tx.run(
        `INSERT INTO scan_cost_ledger (meal_id, provider, model, input_tokens, output_tokens,
                                       cost_usd, local_month, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [mealId, meta.provider, meta.model, meta.inputTokens, meta.outputTokens, meta.costUsd, date.slice(0, 7), now],
      )
    }

    return mealId
  })
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export async function logWeight(kg: number, now: number): Promise<void> {
  const h = await db()
  const dateStr = localDate(now)
  await h.run(
    'INSERT OR REPLACE INTO weight_entries (local_date, weight_kg, logged_at) VALUES (?,?,?)',
    [dateStr, kg, now],
  )

  // Recompute calorie target and macros for new weight
  try {
    const [profile, desiredStr, currentG] = await Promise.all([
      h.get<{ sex: any; birth_year: number; height_cm: number; activity_level: any }>(
        'SELECT sex, birth_year, height_cm, activity_level FROM user_profile WHERE id = 1',
      ),
      setting('goal.desiredWeightKg', ''),
      currentGoal(),
    ])
    if (profile && currentG) {
      const birthYear = profile.birth_year || 1995
      const age = Math.max(16, new Date().getFullYear() - birthYear)
      const targetKg = desiredStr ? Number(desiredStr) : kg
      const goalType: Goal = targetKg < kg - 0.5 ? 'lose' : targetKg > kg + 0.5 ? 'gain' : 'maintain'
      const deltaLb = Math.abs((targetKg - kg) * LB_PER_KG)
      const rate = goalType === 'maintain' ? 0 : Math.min(1.5, Math.max(0.5, deltaLb / 12))

      const target = computeCalorieTarget({
        sex: profile.sex || 'unspecified',
        weightKg: kg,
        heightCm: profile.height_cm || 175,
        ageYears: age,
        activity: (profile.activity_level as any) || 'moderate',
        goal: goalType,
        rateLbPerWeek: rate,
      })
      const macros = computeMacros(target.target, kg, goalType)

      await h.run(
        `INSERT INTO goals
           (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
            floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          now,
          goalType,
          rate,
          target.target,
          target.targetRaw,
          target.floorApplied ? 1 : 0,
          macros.protein_g,
          macros.fat_g,
          macros.carbs_g,
          target.bmr,
          target.tdee,
          currentG.adaptive ? 1 : 0,
        ],
      )
    }
  } catch {
    // Keep weight logging successful even if goal recalculation fails
  }
}

export async function weightHistory(): Promise<WeightPoint[]> {
  const h = await db()
  const rows = await h.all<{ local_date: string; weight_kg: number }>(
    'SELECT local_date, weight_kg FROM weight_entries ORDER BY local_date ASC',
  )
  return rows.map((r) => ({
    day: Math.floor(Date.parse(`${r.local_date}T00:00:00Z`) / 86_400_000),
    weightKg: r.weight_kg,
  }))
}

// ---------------------------------------------------------------------------
// The adaptive loop
// ---------------------------------------------------------------------------

export interface AdaptiveOutcome {
  ran: boolean
  reason: string
  previousKcal?: number
  newKcal?: number
  surfaced?: boolean
  explanation?: string
}

/**
 * Run the adaptive-TDEE estimator and, if it moved enough to matter, write a new
 * goals row.
 *
 * Three gates before it is allowed to change anything, each guarding a real
 * failure:
 *
 *   1. ENOUGH WEIGH-INS. A slope from two points is noise wearing a trend's
 *      clothes.
 *   2. ONLY COMPLETE DAYS feed the intake average. Admitting half-logged days
 *      biases intake downward, which inflates observed TDEE, which RAISES the
 *      target — a silent feedback loop that rewards under-logging.
 *   3. A >= 75 kcal MOVE before anything is surfaced. A target that shifts daily
 *      teaches people to ignore it.
 */
export async function runAdaptive(now: number): Promise<AdaptiveOutcome> {
  const goal = await currentGoal()
  if (!goal) return { ran: false, reason: 'No goal set yet.' }
  if (!goal.adaptive) return { ran: false, reason: 'Adaptive targets are off — you set this target by hand.' }

  const points = await weightHistory()
  if (points.length < 5) {
    return { ran: false, reason: `Needs about ${5 - points.length} more weigh-ins before the trend means anything.` }
  }

  const trend = computeTrend(points)
  const slope = trendSlopeLbPerWeek(trend)
  if (slope == null) return { ran: false, reason: 'Not enough spread in your weigh-ins yet.' }

  const h = await db()
  const days = await h.all<{ local_date: string }>(
    'SELECT DISTINCT local_date FROM meals ORDER BY local_date DESC LIMIT 21',
  )

  let sum = 0
  let admitted = 0
  for (const d of days) {
    const t = await dayTotals(d.local_date)
    const complete = isDayCompleteEnough({
      mealCount: t.mealCount,
      distinctSlotCount: t.distinctSlots,
      hasQueuedEntries: t.pendingCount > 0,
    })
    if (!complete) continue
    sum += t.kcal
    admitted++
  }

  if (admitted < 5) {
    return { ran: false, reason: `Needs about ${5 - admitted} more fully-logged days before adjusting your target.` }
  }

  const updateCount = Number(await setting('adaptive.updateCount', '0'))
  const result = updateAdaptiveTdee({
    currentTdee: goal.targetKcal,
    avgDailyIntakeKcal: sum / admitted,
    trendSlopeLbPerWeek: slope,
    updateCount,
  })

  await putSetting('adaptive.updateCount', String(updateCount + 1))
  await putSetting('adaptive.lastRunAt', String(now))

  if (!result.shouldSurface) {
    return {
      ran: true,
      reason: 'Your target is still right — no change worth showing.',
      previousKcal: goal.targetKcal,
      newKcal: result.newTdee,
      surfaced: false,
    }
  }

  // Macros re-derive from the new target so protein tracks the body, not the
  // budget, and carbs stay the single derived remainder.
  const profile = await h.get<{ height_cm: number }>('SELECT height_cm FROM user_profile WHERE id = 1')
  const latestKg = points[points.length - 1]?.weightKg ?? 80
  const macros = computeMacros(result.newTdee, latestKg, goal.goalType)

  await h.run(
    `INSERT INTO goals
       (effective_from, goal_type, rate_lb_per_week, target_kcal, target_raw_kcal,
        floor_applied, protein_g, fat_g, carbs_g, bmr, tdee, adaptive)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
    [
      now,
      goal.goalType,
      null,
      result.newTdee,
      result.newTdee,
      0,
      macros.protein_g,
      macros.fat_g,
      macros.carbs_g,
      goal.bmr,
      result.observedTdee,
    ],
  )
  void profile

  return {
    ran: true,
    reason: 'Target updated.',
    previousKcal: goal.targetKcal,
    newKcal: result.newTdee,
    surfaced: true,
    explanation: result.explanation,
  }
}

import type { BodyScanPayload } from '@nutai/core-schema'

export interface SavedBodyScanRow {
  id: number
  scanned_at: number
  local_date: string
  photo_uri: string | null
  posture_score: number | null
  head_neck_status: string | null
  shoulders_status: string | null
  pelvis_status: string | null
  body_fat_min: number | null
  body_fat_max: number | null
  body_fat_category: string | null
  body_type: string | null
  muscularity_rating: number | null
  symmetry_score: number | null
  upper_body_balance: string | null
  core_midsection: string | null
  lower_body_balance: string | null
  tightness_areas_json: string | null
  trainer_summary: string | null
  corrective_exercises_json: string | null
  mobility_drills_json: string | null
  raw_payload_json: string | null
  created_at: number
}

export async function saveBodyScan(scan: BodyScanPayload, photoUri?: string | null): Promise<number> {
  const h = await db()
  const now = Date.now()
  const date = localDate(now)

  const posture = scan.posture_assessment
  const comp = scan.body_composition
  const symmetry = scan.muscle_symmetry
  const mobility = scan.mobility_indicators
  const action = scan.action_plan

  const res = await h.run(
    `INSERT INTO body_scans
       (scanned_at, local_date, photo_uri, posture_score, head_neck_status, shoulders_status,
        pelvis_status, body_fat_min, body_fat_max, body_fat_category, body_type, muscularity_rating,
        symmetry_score, upper_body_balance, core_midsection, lower_body_balance, tightness_areas_json,
        trainer_summary, corrective_exercises_json, mobility_drills_json, raw_payload_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      now,
      date,
      photoUri ?? null,
      posture?.overall_score ?? null,
      posture?.head_neck?.status ?? null,
      posture?.shoulders?.status ?? null,
      posture?.spine_pelvis?.pelvic_tilt ?? null,
      comp?.body_fat_range?.min_percent ?? null,
      comp?.body_fat_range?.max_percent ?? null,
      comp?.body_fat_range?.category ?? null,
      comp?.body_type ?? null,
      comp?.muscularity_rating ?? null,
      symmetry?.symmetry_score ?? null,
      symmetry?.upper_body_balance ?? null,
      symmetry?.core_midsection ?? null,
      symmetry?.lower_body_balance ?? null,
      mobility?.tightness_areas ? JSON.stringify(mobility.tightness_areas) : null,
      action?.trainer_summary ?? null,
      action?.corrective_exercises ? JSON.stringify(action.corrective_exercises) : null,
      action?.mobility_drills ? JSON.stringify(action.mobility_drills) : null,
      JSON.stringify(scan),
      now,
    ],
  )
  return Number(res.lastInsertRowId ?? 0)
}

export async function listBodyScans(): Promise<SavedBodyScanRow[]> {
  const h = await db()
  return h.all<SavedBodyScanRow>('SELECT * FROM body_scans ORDER BY scanned_at DESC')
}

export async function getLatestBodyScan(): Promise<SavedBodyScanRow | null> {
  const h = await db()
  const row = await h.get<SavedBodyScanRow>('SELECT * FROM body_scans ORDER BY scanned_at DESC LIMIT 1')
  return row ?? null
}

export async function deleteBodyScan(id: number): Promise<void> {
  const h = await db()
  await h.run('DELETE FROM body_scans WHERE id = ?', [id])
}

// ---------------------------------------------------------------------------
// Water, Exercise & Activity Tracking
// ---------------------------------------------------------------------------

export async function logWater(amountMl: number, now: number = Date.now()): Promise<void> {
  const h = await db()
  const date = localDate(now)
  await h.run('INSERT INTO water_entries (local_date, ml, logged_at) VALUES (?,?,?)', [
    date,
    amountMl,
    now,
  ])
}

export async function dayWaterMl(date: string): Promise<number> {
  const h = await db()
  const row = await h.get<{ total: number }>(
    'SELECT COALESCE(SUM(ml), 0) as total FROM water_entries WHERE local_date = ?',
    [date],
  )
  return row?.total ?? 0
}

export async function dayExerciseKcal(date: string): Promise<number> {
  const h = await db()
  const row = await h.get<{ total: number }>(
    'SELECT COALESCE(SUM(kcal), 0) as total FROM exercise_entries WHERE local_date = ?',
    [date],
  )
  return Math.round(row?.total ?? 0)
}

export async function activeDays(): Promise<string[]> {
  const h = await db()
  const rows = await h.all<{ local_date: string }>(
    `SELECT DISTINCT local_date FROM (
       SELECT local_date FROM meals
       UNION
       SELECT local_date FROM weight_entries
       UNION
       SELECT local_date FROM water_entries
       UNION
       SELECT local_date FROM exercise_entries
       UNION
       SELECT local_date FROM body_scans
     ) ORDER BY local_date DESC`,
  )
  return rows.map((r) => r.local_date)
}

export interface LoggedMealItem {
  id: number
  mealId: number
  displayName: string
  grams: number
  snapKcal: number
  snapProtein: number
  snapFat: number
  snapCarb: number
  loggedAt: number
}

export interface DayMealSummary {
  id: number
  mealSlot: string
  photoUri: string | null
  loggedAt: number
  totalKcal: number
  totalProtein: number
  totalFat: number
  totalCarbs: number
  items: LoggedMealItem[]
}

export async function dayMeals(date: string): Promise<DayMealSummary[]> {
  const h = await db()
  const meals = await h.all<{ id: number; meal_slot: string; photo_uri: string | null; logged_at: number; portion_eaten_fraction: number }>(
    `SELECT id, meal_slot, photo_uri, logged_at, portion_eaten_fraction
     FROM meals WHERE local_date = ? AND analysis_status IN ('complete', 'manual')
     ORDER BY logged_at DESC`,
    [date],
  )
  if (meals.length === 0) return []

  const mealIds = meals.map((m) => m.id)
  const items = await h.all<{
    id: number
    meal_id: number
    display_name: string
    grams: number
    snap_energy_kcal: number
    snap_protein_g: number
    snap_fat_g: number
    snap_carb_g: number
    logged_at: number
  }>(
    `SELECT id, meal_id, display_name, grams, snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, logged_at
     FROM log_items WHERE meal_id IN (${mealIds.join(',')})
     ORDER BY sort_order ASC, id ASC`,
  )

  const itemsByMeal = new Map<number, LoggedMealItem[]>()
  for (const it of items) {
    const arr = itemsByMeal.get(it.meal_id) ?? []
    arr.push({
      id: it.id,
      mealId: it.meal_id,
      displayName: it.display_name,
      grams: it.grams,
      snapKcal: Math.round((it.snap_energy_kcal * it.grams) / 100),
      snapProtein: Math.round((it.snap_protein_g * it.grams) / 100),
      snapFat: Math.round((it.snap_fat_g * it.grams) / 100),
      snapCarb: Math.round((it.snap_carb_g * it.grams) / 100),
      loggedAt: it.logged_at,
    })
    itemsByMeal.set(it.meal_id, arr)
  }

  return meals.map((m) => {
    const mealItems = itemsByMeal.get(m.id) ?? []
    const frac = m.portion_eaten_fraction ?? 1
    const totalKcal = Math.round(mealItems.reduce((acc, i) => acc + i.snapKcal, 0) * frac)
    const totalProtein = Math.round(mealItems.reduce((acc, i) => acc + i.snapProtein, 0) * frac)
    const totalFat = Math.round(mealItems.reduce((acc, i) => acc + i.snapFat, 0) * frac)
    const totalCarbs = Math.round(mealItems.reduce((acc, i) => acc + i.snapCarb, 0) * frac)

    return {
      id: m.id,
      mealSlot: m.meal_slot,
      photoUri: m.photo_uri,
      loggedAt: m.logged_at,
      totalKcal,
      totalProtein,
      totalFat,
      totalCarbs,
      items: mealItems,
    }
  })
}

export async function deleteMeal(mealId: number): Promise<void> {
  const h = await db()
  await h.transaction(async (tx) => {
    await tx.run('DELETE FROM log_items WHERE meal_id = ?', [mealId])
    await tx.run('DELETE FROM meals WHERE id = ?', [mealId])
  })
}

