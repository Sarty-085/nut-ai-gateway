import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Line as SvgLine, Path, Rect, Text as SvgText } from 'react-native-svg'
import { bmi, computeTrend, trendSlopeLbPerWeek, type TrendPoint, type WeightPoint } from '@nutai/goals'
import { activeDays, currentGoal, db, getLatestBodyScan, setting, weightHistory, type CurrentGoal, type SavedBodyScanRow } from '../../src/data/repo'
import { Icon } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

const LB_PER_KG = 2.20462

const WINDOWS = [
  { key: '90D', days: 90 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
  { key: 'ALL', days: Number.POSITIVE_INFINITY },
] as const

const CHANGE_WINDOWS = [3, 7, 14, 30, 90] as const

export default function Progress() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [points, setPoints] = useState<WeightPoint[]>([])
  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [heightCm, setHeightCm] = useState<number>(175)
  const [goalKg, setGoalKg] = useState<number | null>(null)
  const [initialStartKg, setInitialStartKg] = useState<number | null>(null)
  const [streak, setStreak] = useState(0)
  const [window, setWindow] = useState<(typeof WINDOWS)[number]['key']>('90D')
  const [latestScan, setLatestScan] = useState<SavedBodyScanRow | null>(null)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        const h = await db()
        const [pts, g, target, startW, profile, allDays, scan] = await Promise.all([
          weightHistory(),
          currentGoal(),
          setting('goal.desiredWeightKg', ''),
          setting('goal.startWeightKg', ''),
          h.get<{ height_cm: number }>('SELECT height_cm FROM user_profile WHERE id = 1'),
          activeDays(),
          getLatestBodyScan(),
        ])
        if (!alive) return
        setPoints(pts)
        setGoal(g)
        setGoalKg(target ? Number(target) : null)
        setInitialStartKg(startW ? Number(startW) : null)
        setHeightCm(profile?.height_cm || 175)
        setStreak(countStreak(allDays))
        setLatestScan(scan)
      })()
      return () => {
        alive = false
      }
    }, []),
  )

  const trend = useMemo(() => computeTrend(points), [points])
  const raw = trend.filter((p) => p.rawKg != null)
  const slope = useMemo(() => trendSlopeLbPerWeek(trend), [trend])

  const currentKg = points[points.length - 1]?.weightKg ?? null
  const startKg = initialStartKg ?? (points[0]?.weightKg ?? null)

  const pctOfGoal =
    startKg != null && currentKg != null && goalKg != null && Math.abs(goalKg - startKg) > 0.01
      ? Math.max(0, Math.min(1, (currentKg - startKg) / (goalKg - startKg)))
      : 0

  const visible = useMemo(() => {
    const w = WINDOWS.find((x) => x.key === window)
    if (!w || !Number.isFinite(w.days)) return trend
    const last = trend[trend.length - 1]
    if (!last) return trend
    return trend.filter((p) => p.day > last.day - w.days)
  }, [trend, window])

  const bodyBmi = currentKg != null && heightCm != null ? bmi(currentKg, heightCm) : null

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[type.title, { color: theme.text }]}>Progress</Text>

      {/* Streak credits logging INTENT, so our own failures never break it. */}
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: theme.bgSunken }]}>
          <Icon name="flame" size={30} color={theme.text} />
          <Text style={[styles.tileNum, { color: theme.text }]}>{streak}</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>Day streak</Text>
        </View>
        <View style={[styles.tile, { backgroundColor: theme.bgSunken }]}>
          <Icon name="scale" size={30} color={theme.text} />
          <Text style={[styles.tileNum, { color: theme.text }]}>{raw.length}</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>Weigh-ins</Text>
        </View>
      </View>

      {/* WorkFit AI Body & Posture Section */}
      {latestScan ? (
        <View style={[styles.card, { backgroundColor: '#16161C', borderColor: '#22222B', borderWidth: 1 }]}>
          <View style={styles.spread}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Icon name="muscle" size={20} color={theme.protein} />
              <Text style={[type.heading, { color: '#F7F7FA', fontSize: 16 }]}>WorkFit Biomechanics</Text>
            </View>
            <Pressable onPress={() => router.push('/body-scan' as never)}>
              <Text style={{ color: theme.protein, fontSize: 12, fontWeight: '700' }}>Re-scan →</Text>
            </Pressable>
          </View>

          {/* Quick Metrics */}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <View style={{ flex: 1, backgroundColor: '#0B0B0F', padding: space.sm, borderRadius: 10, borderWidth: 1, borderColor: '#22222B' }}>
              <Text style={{ color: '#8A8A99', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 }}>POSTURE SCORE</Text>
              <Text style={{ color: '#F7F7FA', fontSize: 24, fontWeight: '900', marginTop: 2 }}>
                {latestScan.posture_score ?? '—'}
                <Text style={{ fontSize: 12, color: '#8A8A99', fontWeight: '500' }}> /100</Text>
              </Text>
              <Text style={{ color: theme.affirm, fontSize: 11, fontWeight: '600', marginTop: 2 }}>
                {latestScan.shoulders_status === 'level' ? '✓ Shoulders Level' : '⚡ Asymmetry'}
              </Text>
            </View>

            <View style={{ flex: 1, backgroundColor: '#0B0B0F', padding: space.sm, borderRadius: 10, borderWidth: 1, borderColor: '#22222B' }}>
              <Text style={{ color: '#8A8A99', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 }}>EST. BODY FAT</Text>
              <Text style={{ color: '#F7F7FA', fontSize: 20, fontWeight: '800', marginTop: 4 }}>
                {latestScan.body_fat_min != null ? `${latestScan.body_fat_min}% - ${latestScan.body_fat_max}%` : '—'}
              </Text>
              <Text style={{ color: theme.protein, fontSize: 11, fontWeight: '600', marginTop: 2 }}>
                {latestScan.body_fat_category || 'Athletic'}
              </Text>
            </View>
          </View>

          {/* Saved Corrective Protocol Summary */}
          {latestScan.corrective_exercises_json && (
            <View style={{ marginTop: space.md }}>
              <Text style={{ color: '#8A8A99', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>
                ASSIGNED CORRECTIVE ROUTINE
              </Text>
              {JSON.parse(latestScan.corrective_exercises_json).slice(0, 2).map((ex: any, idx: number) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 3, backgroundColor: '#0B0B0F', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#22222B' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#F7F7FA', fontSize: 13, fontWeight: '700' }}>{ex.name}</Text>
                    <Text style={{ color: '#8A8A99', fontSize: 11 }}>{ex.target_area}</Text>
                  </View>
                  <Text style={{ color: theme.protein, fontSize: 12, fontWeight: '600' }}>{ex.sets_reps}</Text>
                </View>
              ))}
            </View>
          )}

          <Pressable
            onPress={() => router.push('/body-scan?viewOnly=true' as never)}
            style={{ marginTop: space.sm, backgroundColor: '#22222B', paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}
          >
            <Text style={{ color: '#F7F7FA', fontSize: 12, fontWeight: '700' }}>Open Full Biomechanics Report</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => router.push('/body-scan' as never)}
          style={[styles.card, { backgroundColor: '#16161C', borderColor: '#22222B', borderWidth: 1 }]}
        >
          <View style={styles.spread}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Icon name="muscle" size={20} color={theme.protein} />
              <Text style={[type.heading, { color: '#F7F7FA', fontSize: 16 }]}>WorkFit Body & Posture Scan</Text>
            </View>
            <View style={{ backgroundColor: '#22222B', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
              <Text style={{ color: theme.protein, fontSize: 11, fontWeight: '700' }}>AI TRAINER</Text>
            </View>
          </View>
          <Text style={[type.caption, { color: '#B8B8C4', marginTop: space.xs }]}>
            Stand in front of your camera for an instant assessment of posture alignment, body-fat range, and personalized corrective drills.
          </Text>
          <View style={{ marginTop: space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
            <Text style={{ color: theme.protein, fontWeight: '700', fontSize: 13 }}>Launch Body Scan →</Text>
          </View>
        </Pressable>
      )}

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <View style={styles.spread}>
          <Text style={[type.caption, { color: theme.textMuted }]}>Current weight</Text>
          <Pressable onPress={() => router.push('/log-weight' as never)} hitSlop={space.sm}>
            <Text style={[type.label, { color: theme.protein }]}>Log weight</Text>
          </Pressable>
        </View>
        <Text style={[styles.big, { color: theme.text }]}>
          {currentKg != null ? `${(currentKg * LB_PER_KG).toFixed(1)} lbs` : '—'}
        </Text>

        <View style={[styles.bar, { backgroundColor: theme.ringTrack }]}>
          <View style={{ width: `${pctOfGoal * 100}%`, height: 6, borderRadius: 3, backgroundColor: theme.text }} />
        </View>
        <View style={styles.spread}>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Start: {startKg != null ? `${(startKg * LB_PER_KG).toFixed(1)} lbs` : '—'}
          </Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Goal: {goalKg != null ? `${(goalKg * LB_PER_KG).toFixed(1)} lbs` : '—'}
          </Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <View style={styles.spread}>
          <Text style={[type.heading, { color: theme.text }]}>Weight progress</Text>
          <View style={[styles.badge, { backgroundColor: theme.bgElevated }]}>
            <Text style={[type.caption, { color: theme.text }]}>{Math.round(pctOfGoal * 100)}% of goal</Text>
          </View>
        </View>

        {raw.length === 0 ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md }]}>
            No weigh-ins yet. Log your first weight to begin tracking progress.
          </Text>
        ) : (
          <WeightChart trend={visible.length > 0 ? visible : trend} />
        )}

        <View style={[styles.segment, { backgroundColor: theme.bgElevated }]}>
          {WINDOWS.map((w) => (
            <Pressable
              key={w.key}
              onPress={() => setWindow(w.key)}
              style={[styles.segItem, window === w.key && { backgroundColor: theme.bg }]}
            >
              <Text style={[type.label, { color: window === w.key ? theme.text : theme.textMuted }]}>
                {w.key}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: theme.textFaint }]} />
            <Text style={[type.caption, { color: theme.textMuted }]}>Each weigh-in</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.line, { backgroundColor: theme.text }]} />
            <Text style={[type.caption, { color: theme.textMuted }]}>Trend</Text>
          </View>
        </View>
      </View>

      {/* Tabular Column: Recorded Weigh-ins */}
      {points.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text, marginBottom: space.sm }]}>Recorded Weigh-ins</Text>
          <View style={{ backgroundColor: theme.bgElevated, borderRadius: 12, padding: space.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 6, borderBottomWidth: 1, borderColor: theme.border }}>
              <Text style={[type.caption, { color: theme.textMuted, fontWeight: '700' }]}>DATE</Text>
              <Text style={[type.caption, { color: theme.textMuted, fontWeight: '700' }]}>WEIGHT</Text>
              <Text style={[type.caption, { color: theme.textMuted, fontWeight: '700' }]}>FROM START</Text>
            </View>
            {[...points].reverse().map((pt, idx) => {
              const dateStr = new Date(pt.day * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              const lbs = pt.weightKg * LB_PER_KG
              const diffFromStart = startKg != null ? (pt.weightKg - startKg) * LB_PER_KG : 0
              return (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: idx < points.length - 1 ? 1 : 0, borderColor: theme.border }}>
                  <Text style={[type.body, { color: theme.text, fontSize: 13 }]}>{dateStr}</Text>
                  <Text style={[type.bodyStrong, { color: theme.text, fontSize: 13 }]}>{lbs.toFixed(1)} lbs</Text>
                  <Text style={[type.bodyStrong, { color: diffFromStart === 0 ? theme.textMuted : diffFromStart > 0 ? theme.fat : theme.affirm, fontSize: 13 }]}>
                    {diffFromStart > 0 ? `+${diffFromStart.toFixed(1)}` : diffFromStart.toFixed(1)} lbs
                  </Text>
                </View>
              )
            })}
          </View>
        </View>
      )}

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.heading, { color: theme.text }]}>Weight changes</Text>
        {CHANGE_WINDOWS.map((d) => (
          <ChangeRow
            key={d}
            label={`${d} day`}
            lbs={changeOver(trend, d) ?? (startKg != null && currentKg != null ? (currentKg - startKg) * LB_PER_KG : 0)}
          />
        ))}
        <ChangeRow
          label="All time"
          lbs={changeOver(trend, Number.POSITIVE_INFINITY) ?? (startKg != null && currentKg != null ? (currentKg - startKg) * LB_PER_KG : 0)}
        />
        <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
          Measured from your start baseline and rolling weight trend entries.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.heading, { color: theme.text }]}>Rate of change</Text>
        <Text style={[styles.big, { color: theme.text }]}>
          {slope == null
            ? (points.length >= 2 && startKg != null && currentKg != null
              ? `${((currentKg - startKg) * LB_PER_KG / Math.max(1, (points[points.length - 1].day - points[0].day) / 7)).toFixed(2)} lb/wk`
              : '0.00 lb/wk')
            : `${slope > 0 ? '+' : ''}${slope.toFixed(2)} lb/wk`}
        </Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>
          From {points.length} weigh-in{points.length !== 1 ? 's' : ''}.
        </Text>
      </View>

      {bodyBmi != null ? (
        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Your BMI</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
            <Text style={[styles.big, { color: theme.text }]}>{bodyBmi.toFixed(1)}</Text>
            <Text style={[type.caption, { color: theme.textMuted }]}>{bmiBand(bodyBmi)}</Text>
          </View>
          <BmiScale value={bodyBmi} />
          <Text style={[type.caption, { color: theme.textFaint, marginTop: space.md, lineHeight: 18 }]}>
            BMI cannot tell muscle from fat and says nothing about an individual's health. It is
            here because it is a common reference point, not because it is a verdict.
          </Text>
        </View>
      ) : null}

      {goal ? (
        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <Text style={[type.heading, { color: theme.text }]}>Daily target</Text>
          <Text style={[styles.big, { color: theme.text }]}>{Math.round(goal.targetKcal)} kcal</Text>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            {goal.adaptive ? 'Adapting from your own trend and intake.' : 'Fixed — you set this by hand.'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  )
}

/** Consecutive logged days ending today, or yesterday if today is still open. */
function countStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const set = new Set(dates)
  const day = 86_400_000
  let n = 0
  let cursor = Date.now()
  // A day still in progress must not break a streak that is otherwise intact.
  if (!set.has(iso(cursor))) cursor -= day
  while (set.has(iso(cursor))) {
    n++
    cursor -= day
  }
  return n
}

function iso(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Change over N days, measured on the TREND rather than raw entries. */
function changeOver(trend: TrendPoint[], days: number): number | null {
  const last = trend[trend.length - 1]
  const first = trend[0]
  if (!last || !first) return null
  const target = Number.isFinite(days) ? last.day - days : first.day
  const start = [...trend].reverse().find((p) => p.day <= target) ?? first
  return (last.trendKg - start.trendKg) * LB_PER_KG
}

function ChangeRow({ label, lbs }: { label: string; lbs: number | null }) {
  const theme = useTheme()
  const none = lbs == null || Math.abs(lbs) < 0.05
  const up = (lbs ?? 0) > 0
  return (
    <View style={styles.changeRow}>
      <Text style={[type.body, { color: theme.textMuted, width: 78 }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: theme.text, flex: 1 }]}>
        {lbs == null ? '—' : `${lbs > 0 ? '+' : ''}${lbs.toFixed(1)} lbs`}
      </Text>
      <Text style={[type.caption, { color: none ? theme.textMuted : theme.protein }]}>
        {none ? 'No change' : up ? 'Increase' : 'Decrease'}
      </Text>
    </View>
  )
}

function WeightChart({ trend }: { trend: TrendPoint[] }) {
  const theme = useTheme()
  const W = 300
  const H = 170

  if (trend.length === 0) return null

  const values = trend.flatMap((p) => [p.trendKg, ...(p.rawKg != null ? [p.rawKg] : [])])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min < 0.5 ? 1 : max - min
  const pad = span * 0.2

  const x = (i: number) => (trend.length <= 1 ? W / 2 : (i / (trend.length - 1)) * (W - 50) + 40)
  const y = (kg: number) => H - 24 - ((kg - min + pad) / (span + pad * 2)) * (H - 48)

  const gridVals = [min + span, min + span / 2, min]
  let d = ''
  trend.forEach((p, i) => {
    d += `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.trendKg)} `
  })

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: space.md }}>
      {gridVals.map((v, i) => (
        <SvgLine key={i} x1={40} y1={y(v)} x2={W - 10} y2={y(v)} stroke={theme.border} strokeWidth="1" />
      ))}
      {gridVals.map((v, i) => (
        <SvgText key={`t${i}`} x={2} y={y(v) + 4} fontSize="10" fill={theme.textFaint}>
          {(v * LB_PER_KG).toFixed(0)}
        </SvgText>
      ))}
      {trend.map((p, i) =>
        p.rawKg != null ? <Circle key={i} cx={x(i)} cy={y(p.rawKg)} r="3" fill={theme.textFaint} /> : null,
      )}
      <Path d={d} stroke={theme.text} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

function bmiBand(v: number): string {
  if (v < 18.5) return 'Underweight'
  if (v < 25) return 'Healthy'
  if (v < 30) return 'Overweight'
  return 'Obese'
}

function BmiScale({ value }: { value: number }) {
  const theme = useTheme()
  const W = 300
  const pos = Math.max(0, Math.min(1, (value - 15) / 20))
  const segs = [
    { w: (18.5 - 15) / 20, c: '#6E9BFF' },
    { w: (25 - 18.5) / 20, c: '#2E9E6B' },
    { w: (30 - 25) / 20, c: '#F2A93B' },
    { w: (35 - 30) / 20, c: '#D5453B' },
  ]
  let cursor = 0
  return (
    <Svg width="100%" height={26} viewBox={`0 0 ${W} 26`} style={{ marginTop: space.md }}>
      {segs.map((s, i) => {
        const x = cursor * W
        cursor += s.w
        return <Rect key={i} x={x} y={9} width={s.w * W - 3} height={8} rx={4} fill={s.c} />
      })}
      <Rect x={pos * W - 1.5} y={3} width={3} height={20} rx={1.5} fill={theme.text} />
    </Svg>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  tile: { flex: 1, padding: space.lg, borderRadius: radius.xl, alignItems: 'center' },
  tileNum: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, marginTop: space.xs },
  card: { marginTop: space.md, padding: space.lg, borderRadius: radius.xl },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  big: { fontSize: 30, fontWeight: '800', letterSpacing: -1, marginTop: space.xs },
  bar: { height: 6, borderRadius: 3, marginTop: space.md, marginBottom: space.sm, overflow: 'hidden' },
  badge: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill },
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, marginTop: space.md },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.pill },
  legend: { flexDirection: 'row', gap: space.lg, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  line: { width: 18, height: 3, borderRadius: 2 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
})
