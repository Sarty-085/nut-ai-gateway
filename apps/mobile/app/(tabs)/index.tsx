import { router, useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { healthScore } from '@nutai/totals'
import { Icon, type IconName } from '../../src/components/Icon'
import {
  activeDays,
  currentGoal,
  dayExerciseKcal,
  dayMeals,
  daySteps,
  dayTotals,
  dayWaterMl,
  deleteMeal,
  localDate,
  logSteps,
  logWater,
  runAdaptive,
  type AdaptiveOutcome,
  type CurrentGoal,
  type DayMealSummary,
  type DayTotals,
} from '../../src/data/repo'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function countStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const set = new Set(dates)
  const today = localDate(Date.now())
  const yesterday = localDate(Date.now() - 86_400_000)
  let cur = set.has(today) ? today : set.has(yesterday) ? yesterday : null
  if (!cur) return 0
  let count = 0
  while (set.has(cur)) {
    count++
    cur = localDate(Date.parse(`${cur}T12:00:00Z`) - 86_400_000)
  }
  return count
}

/**
 * Home.
 *
 * Three rules this screen will not break, all of them about not moralising:
 *
 *   A day with nothing logged reads "no entries logged" in a neutral colour.
 *   Never "missed", never red — red is reserved for safety warnings.
 *
 *   Over target is STATED, not scolded. The ring draws a second overflow arc
 *   rather than clamping at 100% and lying about it.
 *
 *   Pending scans contribute ZERO calories and show as a count. A number that
 *   silently grows later is worse than one that is visibly incomplete.
 */
export default function Home() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()

  const [goal, setGoal] = useState<CurrentGoal | null>(null)
  const [totals, setTotals] = useState<DayTotals | null>(null)
  const [adaptive, setAdaptive] = useState<AdaptiveOutcome | null>(null)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState(0)
  const [waterMl, setWaterMl] = useState(0)
  const [stepsCount, setStepsCount] = useState(0)
  const [customWaterOpen, setCustomWaterOpen] = useState(false)
  const [customWaterText, setCustomWaterText] = useState('')
  const [customStepsOpen, setCustomStepsOpen] = useState(false)
  const [customStepsText, setCustomStepsText] = useState('')
  const [exerciseKcalBurned, setExerciseKcalBurned] = useState(0)
  const [streakCount, setStreakCount] = useState(0)
  const [meals, setMeals] = useState<DayMealSummary[]>([])

  const selected = useMemo(() => Date.now() + offset * 86_400_000, [offset])

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void (async () => {
        // The adaptive loop runs BEFORE reading the goal, so a target it just
        // changed is the one rendered. Its own gates decide whether it may act.
        const outcome = await runAdaptive(Date.now())
        const dateStr = localDate(selected)
        const [g, t, w, st, exKcal, allDays, mList] = await Promise.all([
          currentGoal(),
          dayTotals(dateStr),
          dayWaterMl(dateStr),
          daySteps(dateStr),
          dayExerciseKcal(dateStr),
          activeDays(),
          dayMeals(dateStr),
        ])
        if (!alive) return
        setAdaptive(outcome)
        setGoal(g)
        setTotals(t)
        setWaterMl(w)
        setStepsCount(st)
        setExerciseKcalBurned(exKcal)
        setStreakCount(countStreak(allDays))
        setMeals(mList)
      })()
      return () => {
        alive = false
      }
    }, [selected]),
  )

  const handleDeleteMeal = async (mealId: number) => {
    Alert.alert('Delete Meal', 'Remove this meal from your daily log?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteMeal(mealId)
          const dateStr = localDate(selected)
          const [t, mList] = await Promise.all([dayTotals(dateStr), dayMeals(dateStr)])
          setTotals(t)
          setMeals(mList)
        },
      },
    ])
  }

  const handleAddWater = async (amount: number) => {
    if (amount <= 0) return
    await logWater(amount, selected)
    const dateStr = localDate(selected)
    const updated = await dayWaterMl(dateStr)
    setWaterMl(updated)
    const allDays = await activeDays()
    setStreakCount(countStreak(allDays))
  }

  const handleAddSteps = async (amount: number) => {
    if (amount <= 0) return
    await logSteps(amount, selected)
    const dateStr = localDate(selected)
    const updated = await daySteps(dateStr)
    setStepsCount(updated)
    const allDays = await activeDays()
    setStreakCount(countStreak(allDays))
  }

  if (!goal || !totals) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.body, { color: theme.textMuted }]}>Loading your day…</Text>
      </View>
    )
  }

  const remaining = goal.targetKcal - totals.kcal
  const over = remaining < 0
  const pct = goal.targetKcal > 0 ? totals.kcal / goal.targetKcal : 0
  const empty = totals.mealCount === 0 && totals.pendingCount === 0
  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: 150 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.wordmark, { color: theme.text }]}>WorkFit AI</Text>
        <View style={[styles.streakPill, { backgroundColor: theme.bgSunken }]}>
          <Icon name="flame" size={16} color={theme.text} />
          <Text style={[type.bodyStrong, { color: theme.text }]}>{streakCount}</Text>
        </View>
      </View>

      {/* Day strip */}
      <DayStrip selected={offset} onSelect={setOffset} />

      {/* Paged carousel */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) =>
          setPage(Math.round(e.nativeEvent.contentOffset.x / width))
        }
      >
        {/* Page 1 — main calories and macros */}
        <View style={{ width, paddingHorizontal: space.lg }}>
          <View style={[styles.heroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.hero, { color: theme.text }]}>
                {Math.abs(Math.round(remaining))}
              </Text>
              <Text style={[type.body, { color: theme.textMuted }]}>
                {over ? 'Calories over' : 'Calories left'}
              </Text>
            </View>
            <Ring pct={pct} over={over} size={128} stroke={12}>
              <Icon name="flame" size={26} color={theme.text} />
            </Ring>
          </View>

          <View style={styles.macroRow}>
            <MacroCard label="Protein" icon="protein" eaten={totals.protein_g} target={goal.protein_g} color={theme.protein} />
            <MacroCard label="Carbs" icon="carbs" eaten={totals.carbs_g} target={goal.carbs_g} color={theme.carbs} />
            <MacroCard label="Fat" icon="fat" eaten={totals.fat_g} target={goal.fat_g} color={theme.fat} />
          </View>
        </View>

        {/* Page 2 — health score */}
        <View style={{ width, paddingHorizontal: space.lg }}>
          {(() => {
            const hs = totals.kcal >= 30 ? healthScore({
              kcal: totals.kcal,
              protein_g: totals.protein_g,
              fat_g: totals.fat_g,
              carbs_g: totals.carbs_g,
              fiber_g: totals.fiber_g,
              sugar_g: totals.sugar_g,
              sodium_mg: totals.sodium_mg,
            }, totals.totalGrams) : null

            const score = hs?.score ?? null
            const pctScore = score != null ? score / 10 : 0
            const scoreColor = score != null ? (score >= 7 ? theme.affirm : score >= 4 ? theme.carbs : theme.safety) : theme.textMuted

            return (
              <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
                <View style={styles.spread}>
                  <View>
                    <Text style={[type.heading, { color: theme.text }]}>Health Score</Text>
                    <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                      Dietary density & macronutrient quality
                    </Text>
                  </View>
                  <Text style={[type.heading, { color: scoreColor, fontSize: 24 }]}>
                    {score != null ? `${score}/10` : 'N/A'}
                  </Text>
                </View>

                <View style={[styles.scoreTrack, { backgroundColor: theme.ringTrack, marginTop: space.md, height: 8, borderRadius: 4 }]}>
                  <View
                    style={{
                      width: `${pctScore * 100}%`,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: scoreColor,
                    }}
                  />
                </View>

                {hs && hs.reasons.length > 0 ? (
                  <View style={{ marginTop: space.md, gap: 6 }}>
                    {hs.reasons.map((r, idx) => (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: scoreColor, fontSize: 13 }}>✓</Text>
                        <Text style={[type.caption, { color: theme.text, flex: 1 }]}>{r}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md, lineHeight: 19 }]}>
                    Log your meals today to generate your nutritional quality score. Derived deterministically from protein density, fiber, free sugar, and sodium.
                  </Text>
                )}
              </View>
            )
          })()}
        </View>

        {/* Page 3 — activity and water */}
        <View style={{ width, paddingHorizontal: space.lg }}>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Pressable
              onPress={() => setCustomStepsOpen(true)}
              style={[styles.card, { flex: 1, backgroundColor: theme.bgElevated, borderColor: theme.border }]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[type.caption, { color: theme.textMuted }]}>Steps</Text>
                <Text style={[type.micro, { color: theme.protein, fontWeight: '700' }]}>+ Log</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text style={[styles.mid, { color: theme.text }]}>
                  {stepsCount > 0 ? stepsCount.toLocaleString() : '0'}
                </Text>
                <Text style={[type.caption, { color: theme.textFaint }]}>/10k</Text>
              </View>
              <View style={{ alignItems: 'center', marginTop: space.md }}>
                <Ring pct={Math.min(1, stepsCount / 10000)} over={stepsCount > 10000} size={92} stroke={9}>
                  <Icon name="steps" size={22} color={theme.protein} />
                </Ring>
              </View>
              <Text style={[type.micro, { color: theme.protein, textAlign: 'center', marginTop: space.sm }]}>
                {Math.round((stepsCount / 10000) * 100)}% daily goal
              </Text>
            </Pressable>

            <View style={[styles.card, { flex: 1, backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
              <Text style={[type.caption, { color: theme.textMuted }]}>Calories burned</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text style={[styles.mid, { color: theme.text }]}>
                  {exerciseKcalBurned > 0 ? exerciseKcalBurned : '0'}
                </Text>
                <Text style={[type.caption, { color: theme.textFaint }]}>kcal</Text>
              </View>
              <Pressable
                onPress={() => router.push('/log-exercise' as never)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.lg }}
              >
                <Icon name="dumbbell" size={18} color={theme.protein} />
                <Text style={[type.label, { color: theme.protein }]}>Log exercise</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.bgElevated, borderColor: theme.border, marginTop: space.md }]}>
            <View style={styles.spread}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Icon name="water" size={24} color={theme.protein} />
                <View>
                  <Text style={[type.caption, { color: theme.textMuted }]}>Daily Hydration</Text>
                  <Text style={[type.bodyStrong, { color: theme.text, fontSize: 16 }]}>
                    {waterMl} ml <Text style={{ color: theme.textFaint, fontSize: 13 }}>({Math.round(waterMl / 29.5735)} fl oz)</Text>
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Pressable
                  onPress={() => handleAddWater(250)}
                  style={[styles.ghost, { borderColor: theme.border, paddingHorizontal: 8, paddingVertical: 4 }]}
                >
                  <Text style={[type.label, { color: theme.protein, fontSize: 12 }]}>+250ml</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleAddWater(500)}
                  style={[styles.ghost, { borderColor: theme.border, paddingHorizontal: 8, paddingVertical: 4 }]}
                >
                  <Text style={[type.label, { color: theme.protein, fontSize: 12 }]}>+500ml</Text>
                </Pressable>
                <Pressable
                  onPress={() => setCustomWaterOpen(true)}
                  style={[styles.ghost, { borderColor: theme.protein, paddingHorizontal: 8, paddingVertical: 4 }]}
                >
                  <Text style={[type.label, { color: theme.protein, fontSize: 12, fontWeight: '700' }]}>+Custom</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Page dots */}
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: i === page ? theme.text : theme.border }]}
          />
        ))}
      </View>

      {/* Adaptive target status — always legible, never a silent change. */}
      <View style={{ paddingHorizontal: space.lg }}>
        <View style={[styles.card, { backgroundColor: theme.bgSunken, borderColor: 'transparent' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="target" size={18} color={theme.text} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Your target</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
            {adaptive?.surfaced
              ? `Updated to ${Math.round(adaptive.newKcal ?? 0)} kcal. ${adaptive.explanation}`
              : goal.adaptive
                ? (adaptive?.reason ?? 'Adapting from your own trend and intake.')
                : 'Fixed — you set this by hand, so we leave it alone.'}
          </Text>
          <Pressable
            onPress={() => router.push('/log-weight' as never)}
            hitSlop={space.sm}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.md }}
          >
            <Icon name="scale" size={16} color={theme.protein} />
            <Text style={[type.label, { color: theme.protein }]}>Log today's weight</Text>
          </Pressable>
        </View>
      </View>

      {/* Recently uploaded */}
      <View style={{ paddingHorizontal: space.lg, marginTop: space.xl, paddingBottom: 40 }}>
        <Text style={[type.title, { color: theme.text, fontSize: 24 }]}>Recently uploaded</Text>

        {empty || meals.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.bgSunken }]}>
            <View style={[styles.ghostRow, { backgroundColor: theme.bgElevated }]}>
              <Icon name="bowl" size={26} color={theme.textFaint} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={[styles.skeleton, { backgroundColor: theme.ringTrack, width: '70%' }]} />
                <View style={[styles.skeleton, { backgroundColor: theme.ringTrack, width: '45%' }]} />
              </View>
            </View>
            <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: space.lg }]}>
              Tap + to add your first meal of the day
            </Text>
          </View>
        ) : (
          <View style={{ gap: space.md, marginTop: space.sm }}>
            {meals.map((m) => (
              <View
                key={m.id}
                style={[
                  styles.card,
                  { backgroundColor: theme.bgSunken, borderColor: 'transparent', padding: space.md },
                ]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <View style={{ backgroundColor: theme.bgElevated, padding: 8, borderRadius: 10 }}>
                      <Icon name="bowl" size={20} color={theme.protein} />
                    </View>
                    <View>
                      <Text style={[type.heading, { color: theme.text, textTransform: 'capitalize' }]}>
                        {m.mealSlot}
                      </Text>
                      <Text style={[type.caption, { color: theme.textMuted }]}>
                        {new Date(m.loggedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[type.bodyStrong, { color: theme.text }]}>{m.totalKcal} kcal</Text>
                      <Text style={[type.caption, { color: theme.textMuted }]}>
                        P: {m.totalProtein}g · C: {m.totalCarbs}g · F: {m.totalFat}g
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Delete meal"
                      onPress={() => handleDeleteMeal(m.id)}
                      hitSlop={space.sm}
                      style={{ padding: 6, backgroundColor: theme.bgElevated, borderRadius: 8 }}
                    >
                      <Icon name="close" size={16} color={theme.textMuted} />
                    </Pressable>
                  </View>
                </View>

                {m.items.length > 0 && (
                  <View style={{ marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderColor: theme.border, gap: 4 }}>
                    {m.items.map((it) => (
                      <View key={it.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={[type.caption, { color: theme.text, flex: 1 }]} numberOfLines={1}>
                          • {it.displayName} ({it.grams}g)
                        </Text>
                        <Text style={[type.caption, { color: theme.textMuted }]}>{it.snapKcal} kcal</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}

            {totals.pendingCount > 0 ? (
              <Text style={[type.caption, { color: theme.uncertain, marginTop: space.xs }]}>
                +{totals.pendingCount} still analyzing — not counted yet
              </Text>
            ) : null}
          </View>
        )}
      </View>

      {/* Custom Water Dialog */}
      <Modal visible={customWaterOpen} transparent animationType="fade" onRequestClose={() => setCustomWaterOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
            <Text style={[type.heading, { color: theme.text }]}>Log Water Intake</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 4 }]}>
              Enter amount of water in milliliters (ml)
            </Text>
            <TextInput
              keyboardType="number-pad"
              placeholder="e.g. 750"
              placeholderTextColor={theme.textFaint}
              value={customWaterText}
              onChangeText={setCustomWaterText}
              autoFocus
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
            />
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
              <Pressable
                onPress={() => { setCustomWaterOpen(false); setCustomWaterText('') }}
                style={[styles.modalBtn, { flex: 1, backgroundColor: theme.bgSunken }]}
              >
                <Text style={[type.label, { color: theme.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const val = Number.parseInt(customWaterText, 10)
                  if (Number.isFinite(val) && val > 0) {
                    void handleAddWater(val)
                  }
                  setCustomWaterOpen(false)
                  setCustomWaterText('')
                }}
                style={[styles.modalBtn, { flex: 1, backgroundColor: theme.protein }]}
              >
                <Text style={[type.label, { color: '#000', fontWeight: '700' }]}>Add Water</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom Steps Dialog */}
      <Modal visible={customStepsOpen} transparent animationType="fade" onRequestClose={() => setCustomStepsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
            <Text style={[type.heading, { color: theme.text }]}>Log Step Count</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 4 }]}>
              Add steps walked or run today
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, marginVertical: space.md, flexWrap: 'wrap' }}>
              <Pressable
                onPress={() => setCustomStepsText('1000')}
                style={[styles.ghost, { borderColor: theme.border, paddingHorizontal: 10, paddingVertical: 4 }]}
              >
                <Text style={[type.label, { color: theme.protein, fontSize: 12 }]}>+1,000</Text>
              </Pressable>
              <Pressable
                onPress={() => setCustomStepsText('2500')}
                style={[styles.ghost, { borderColor: theme.border, paddingHorizontal: 10, paddingVertical: 4 }]}
              >
                <Text style={[type.label, { color: theme.protein, fontSize: 12 }]}>+2,500</Text>
              </Pressable>
              <Pressable
                onPress={() => setCustomStepsText('5000')}
                style={[styles.ghost, { borderColor: theme.border, paddingHorizontal: 10, paddingVertical: 4 }]}
              >
                <Text style={[type.label, { color: theme.protein, fontSize: 12 }]}>+5,000</Text>
              </Pressable>
            </View>
            <TextInput
              keyboardType="number-pad"
              placeholder="e.g. 2000"
              placeholderTextColor={theme.textFaint}
              value={customStepsText}
              onChangeText={setCustomStepsText}
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
            />
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
              <Pressable
                onPress={() => { setCustomStepsOpen(false); setCustomStepsText('') }}
                style={[styles.modalBtn, { flex: 1, backgroundColor: theme.bgSunken }]}
              >
                <Text style={[type.label, { color: theme.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const val = Number.parseInt(customStepsText, 10)
                  if (Number.isFinite(val) && val > 0) {
                    void handleAddSteps(val)
                  }
                  setCustomStepsOpen(false)
                  setCustomStepsText('')
                }}
                style={[styles.modalBtn, { flex: 1, backgroundColor: theme.protein }]}
              >
                <Text style={[type.label, { color: '#000', fontWeight: '700' }]}>Add Steps</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}

function DayStrip({ selected, onSelect }: { selected: number; onSelect: (o: number) => void }) {
  const theme = useTheme()
  const now = new Date()
  // Monday-first week containing today.
  const dow = (now.getDay() + 6) % 7
  const days = Array.from({ length: 7 }, (_, i) => i - dow)

  return (
    <View style={styles.strip}>
      {days.map((off) => {
        const d = new Date(Date.now() + off * 86_400_000)
        const isSel = off === selected
        const future = off > 0
        return (
          <Pressable
            key={off}
            disabled={future}
            onPress={() => onSelect(off)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSel, disabled: future }}
            style={[styles.dayCol, isSel && { backgroundColor: theme.bgElevated }]}
          >
            <Text style={[type.caption, { color: future ? theme.textFaint : theme.textMuted }]}>
              {DAY_LABELS[d.getDay()]}
            </Text>
            <View
              style={[
                styles.dayCircle,
                {
                  borderColor: isSel ? theme.text : theme.border,
                  borderStyle: off < 0 ? 'dashed' : 'solid',
                  opacity: future ? 0.4 : 1,
                },
              ]}
            >
              <Text style={[type.bodyStrong, { color: future ? theme.textFaint : theme.text }]}>
                {d.getDate()}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

function Ring({
  pct, over, size, stroke, children,
}: {
  pct: number
  over: boolean
  size: number
  stroke: number
  children?: React.ReactNode
}) {
  const theme = useTheme()
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  const primary = Math.min(1, pct)
  const overflow = over ? Math.min(1, pct - 1) : 0
  const innerR = r - stroke - 3
  const innerC = 2 * Math.PI * innerR

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.ringTrack} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={theme.ring} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c * primary} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {overflow > 0 ? (
          <Circle
            cx={size / 2} cy={size / 2} r={innerR}
            stroke={theme.uncertain} strokeWidth={stroke * 0.6} fill="none"
            strokeDasharray={`${innerC * overflow} ${innerC}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  )
}

function MacroCard({
  label, icon, eaten, target, color, unit = 'g',
}: {
  label: string
  icon: IconName
  eaten: number
  target: number
  color: string
  unit?: string
}) {
  const theme = useTheme()
  const left = Math.max(0, target - eaten)
  const pct = target > 0 ? Math.min(1, eaten / target) : 0
  const size = 74
  const r = size / 2 - 5
  const c = 2 * Math.PI * r

  return (
    <View style={[styles.macroCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
      {/* "2300mg" must shrink, never wrap — a two-line number reads broken. */}
      <Text style={[styles.macroNum, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {Math.round(left)}
        {unit}
      </Text>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label} left</Text>

      <View style={{ alignItems: 'center', marginTop: space.md }}>
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.ringTrack} strokeWidth={5} fill="none" />
            <Circle
              cx={size / 2} cy={size / 2} r={r}
              stroke={color} strokeWidth={5} fill="none"
              strokeDasharray={`${c * pct} ${c}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </Svg>
          <Icon name={icon} size={22} color={color} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  wordmark: { fontSize: 30, fontWeight: '800', letterSpacing: -1.2 },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  strip: { flexDirection: 'row', paddingHorizontal: space.md, marginTop: space.lg },
  dayCol: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.lg, gap: space.sm },
  dayCircle: {
    width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.xl,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hero: { fontSize: 46, fontWeight: '800', letterSpacing: -1.8 },
  mid: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8 },
  macroRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  macroCard: {
    flex: 1,
    padding: space.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  macroNum: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6 },
  card: { padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreTrack: { height: 8, borderRadius: 4, marginTop: space.md },
  ghost: {
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, marginTop: space.lg },
  dot: { width: 7, height: 7, borderRadius: 4 },
  emptyCard: { marginTop: space.md, padding: space.lg, borderRadius: radius.xl },
  ghostRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg,
  },
  skeleton: { height: 8, borderRadius: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radius.xl,
    padding: space.xl,
    borderWidth: 1,
  },
  modalInput: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    fontSize: 18,
    fontWeight: '700',
    marginTop: space.md,
  },
  modalBtn: {
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
