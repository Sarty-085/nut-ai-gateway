import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DbAdapter } from '@nutai/db-adapter'
import type { IngredientRow, WebLookupResult } from '@nutai/core-schema'
import { resolveByText, type ScoredCandidate } from '@nutai/resolver'
import { healthScore } from '@nutai/totals'
import { ConfidenceChip, ConfidenceReasons } from '../src/components/ConfidenceChip'
import { Icon, type IconName } from '../src/components/Icon'
import { logMeal } from '../src/data/repo'
import { resolveSelection } from '../src/data/food-search-select'
import { openNutritionDb } from '../src/db/expo-adapter'
import { fixScan, lookupOther, retryScan } from '../src/scan/orchestrator'
import {
  addRow,
  adjustGrams,
  answerQuestion,
  applyWebOption,
  createManualIngredientRow,
  editGrams,
  removeRow,
  reset,
  scaleIngredientGrams,
  setPortionEaten,
  updateRow,
  useScan,
  type WebLookupState,
} from '../src/scan/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

const PORTION_OPTIONS = [
  { label: '25%', fraction: 0.25, desc: '1/4 serving' },
  { label: '50%', fraction: 0.5, desc: 'Half serving' },
  { label: '75%', fraction: 0.75, desc: '3/4 serving' },
  { label: '100%', fraction: 1.0, desc: 'Full meal' },
  { label: '150%', fraction: 1.5, desc: '1.5x large' },
]

export default function Result() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const phase = useScan()
  const [expandedBand, setExpandedBand] = useState(false)
  const [logging, setLogging] = useState(false)

  // AI Correction Modal
  const [fixOpen, setFixOpen] = useState(false)
  const [fixText, setFixText] = useState('')

  // Custom Portion Modal
  const [customPortionOpen, setCustomPortionOpen] = useState(false)
  const [customPortionText, setCustomPortionText] = useState('')

  // Nutrition DB for search & swap
  const [nutritionDb, setNutritionDb] = useState<DbAdapter | null>(null)

  // Add Ingredient Modal
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addTab, setAddTab] = useState<'search' | 'manual'>('search')
  const [addQuery, setAddQuery] = useState('')
  const [addResults, setAddResults] = useState<ScoredCandidate[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualGrams, setManualGrams] = useState('100')
  const [manualKcal, setManualKcal] = useState('150')
  const [manualProtein, setManualProtein] = useState('10')
  const [manualFat, setManualFat] = useState('5')
  const [manualCarbs, setManualCarbs] = useState('15')

  // Edit / Swap Ingredient Modal
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<IngredientRow | null>(null)
  const [editTab, setEditTab] = useState<'adjust' | 'swap'>('adjust')
  const [editName, setEditName] = useState('')
  const [editGramsVal, setEditGramsVal] = useState('')
  const [editKcal, setEditKcal] = useState('')
  const [editProtein, setEditProtein] = useState('')
  const [editFat, setEditFat] = useState('')
  const [editCarbs, setEditCarbs] = useState('')
  const [swapQuery, setSwapQuery] = useState('')
  const [swapResults, setSwapResults] = useState<ScoredCandidate[]>([])
  const [swapSearching, setSwapSearching] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const handle = await openNutritionDb()
        if (alive) setNutritionDb(handle)
      } catch {
        // ignore
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Auto-search for Add modal
  useEffect(() => {
    if (!nutritionDb || addQuery.trim().length < 2 || addTab !== 'search') {
      setAddResults([])
      return
    }
    let alive = true
    setAddSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await resolveByText(nutritionDb, {
          canonicalFoodKey: addQuery.trim(),
          observedBrand: null,
          prepFacet: null,
          modelCategory: null,
          estimatedGrams: 150,
        })
        if (!alive) return
        if (r.outcome.kind === 'auto_accept') {
          setAddResults([r.outcome.match])
        } else if (r.outcome.kind === 'disambiguate') {
          setAddResults(r.outcome.candidates)
        } else {
          setAddResults([])
        }
      } catch {
        if (alive) setAddResults([])
      } finally {
        if (alive) setAddSearching(false)
      }
    }, 180)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [nutritionDb, addQuery, addTab])

  // Auto-search for Swap modal
  useEffect(() => {
    if (!nutritionDb || swapQuery.trim().length < 2 || editTab !== 'swap') {
      setSwapResults([])
      return
    }
    let alive = true
    setSwapSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await resolveByText(nutritionDb, {
          canonicalFoodKey: swapQuery.trim(),
          observedBrand: null,
          prepFacet: null,
          modelCategory: null,
          estimatedGrams: 150,
        })
        if (!alive) return
        if (r.outcome.kind === 'auto_accept') {
          setSwapResults([r.outcome.match])
        } else if (r.outcome.kind === 'disambiguate') {
          setSwapResults(r.outcome.candidates)
        } else {
          setSwapResults([])
        }
      } catch {
        if (alive) setSwapResults([])
      } finally {
        if (alive) setSwapSearching(false)
      }
    }, 180)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [nutritionDb, swapQuery, editTab])

  if (phase.kind === 'analyzing' || phase.kind === 'captured') {
    const stage = phase.kind === 'analyzing' ? phase.stage : 'preparing'
    const copy =
      stage === 'preparing'
        ? 'Preparing the photo…'
        : stage === 'identifying'
          ? 'Identifying ingredients & recalculating…'
          : 'Matching the nutrition database…'
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Image source={{ uri: phase.photoUri }} style={styles.photo} />
        <ActivityIndicator color={theme.protein} size="large" style={{ marginTop: space.xl }} />
        <Text style={[type.heading, { color: theme.text, marginTop: space.md }]}>{copy}</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, textAlign: 'center' }]}>
          Your photo is saved — nothing is lost if this fails.
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.xl }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
    )
  }

  if (phase.kind === 'failed') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Image source={{ uri: phase.photoUri }} style={[styles.photo, { opacity: 0.5 }]} />
        <Text style={[type.heading, { color: theme.text, marginTop: space.xl, textAlign: 'center' }]}>
          Could not read this meal
        </Text>
        <Text
          style={[
            type.caption,
            { color: theme.textMuted, marginTop: space.sm, textAlign: 'center', lineHeight: 19 },
          ]}
        >
          {phase.message}
        </Text>
        {phase.canRetry ? (
          <Pressable
            onPress={() => void retryScan()}
            style={[styles.primary, { backgroundColor: theme.text, marginTop: space.xl, paddingHorizontal: space.xl }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg }]}>Try again</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            reset()
            router.back()
          }}
          hitSlop={space.md}
          style={{ marginTop: space.lg }}
        >
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
    )
  }

  if (phase.kind !== 'ready') {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[type.heading, { color: theme.text }]}>Nothing to show yet</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md} style={{ marginTop: space.xl }}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
    )
  }

  const { result } = phase
  const currentFraction = result.meal.portionEatenFraction ?? 1.0
  const currentPct = Math.round(currentFraction * 100)
  const isCustomFraction = !PORTION_OPTIONS.some((p) => Math.abs(p.fraction - currentFraction) < 0.01)

  const highlighted = result.questions.filter((q) => q.state === 'highlighted')
  const preAnswered = result.questions.filter((q) => q.state === 'pre_answered')

  const handleSelectCandidateForAdd = async (candidate: ScoredCandidate) => {
    if (!nutritionDb) return
    try {
      const selection = await resolveSelection(nutritionDb, candidate)
      const newRow: IngredientRow = {
        id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        displayName: selection.displayName,
        grams: selection.grams,
        gramPathway: 'user_edited',
        origin: 'db_search',
        sourceFoodId: String(selection.foodId),
        sourceUrl: null,
        isEstimate: false,
        macrosUserEdited: false,
        bandHalfPct: 0.08,
        nutrientSnapshot: selection.nutrientSnapshot,
        assumptions: [],
      }
      addRow(newRow)
      setAddModalOpen(false)
      setAddQuery('')
    } catch {
      Alert.alert('Error', 'Could not add selected ingredient.')
    }
  }

  const handleAddManualIngredient = () => {
    const name = manualName.trim()
    const grams = Number.parseFloat(manualGrams) || 100
    const kcal = Number.parseFloat(manualKcal) || 0
    const protein = Number.parseFloat(manualProtein) || 0
    const fat = Number.parseFloat(manualFat) || 0
    const carbs = Number.parseFloat(manualCarbs) || 0

    if (!name) {
      Alert.alert('Missing Name', 'Please enter an ingredient name.')
      return
    }

    const row = createManualIngredientRow({
      displayName: name,
      grams,
      kcal,
      protein_g: protein,
      fat_g: fat,
      carbs_g: carbs,
    })
    addRow(row)
    setAddModalOpen(false)
    setManualName('')
  }

  const handleOpenEditModal = (row: IngredientRow) => {
    setEditingRow(row)
    setEditName(row.displayName)
    setEditGramsVal(String(Math.round(row.grams)))
    const factor = row.grams / 100
    setEditKcal(String(Math.round(row.nutrientSnapshot.kcal * factor)))
    setEditProtein(String(Math.round(row.nutrientSnapshot.protein_g * factor)))
    setEditFat(String(Math.round(row.nutrientSnapshot.fat_g * factor)))
    setEditCarbs(String(Math.round(row.nutrientSnapshot.carbs_g * factor)))
    setSwapQuery('')
    setSwapResults([])
    setEditTab('adjust')
    setEditModalOpen(true)
  }

  const handleSaveIngredientEdits = () => {
    if (!editingRow) return
    const name = editName.trim() || editingRow.displayName
    const grams = Number.parseFloat(editGramsVal) || editingRow.grams
    const kcal = Number.parseFloat(editKcal) || 0
    const protein = Number.parseFloat(editProtein) || 0
    const fat = Number.parseFloat(editFat) || 0
    const carbs = Number.parseFloat(editCarbs) || 0

    updateRow(editingRow.id, (old) => {
      const per100 = grams > 0 ? 100 / grams : 0
      return {
        ...old,
        displayName: name,
        grams,
        macrosUserEdited: true,
        nutrientSnapshot: {
          kcal: kcal * per100,
          protein_g: protein * per100,
          fat_g: fat * per100,
          carbs_g: carbs * per100,
          fiber_g: old.nutrientSnapshot.fiber_g,
          sugar_g: old.nutrientSnapshot.sugar_g,
          sodium_mg: old.nutrientSnapshot.sodium_mg,
        },
      }
    })
    setEditModalOpen(false)
    setEditingRow(null)
  }

  const handleSwapCandidate = async (candidate: ScoredCandidate) => {
    if (!nutritionDb || !editingRow) return
    try {
      const selection = await resolveSelection(nutritionDb, candidate)
      updateRow(editingRow.id, (old) => ({
        ...old,
        displayName: selection.displayName,
        sourceFoodId: String(selection.foodId),
        origin: 'db_search',
        isEstimate: false,
        nutrientSnapshot: selection.nutrientSnapshot,
      }))
      setEditModalOpen(false)
      setEditingRow(null)
    } catch {
      Alert.alert('Error', 'Could not swap ingredient.')
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: 140 }}>
        {/* Title Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { color: theme.text }]}>
              {result.items[0]?.row.displayName ?? 'Your meal'}
            </Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
              {result.meal.ingredients.length} items identified · Live recalculation
            </Text>
          </View>
          <Pressable
            onPress={() => setFixOpen(true)}
            style={[styles.aiFixBadge, { backgroundColor: theme.bgElevated, borderColor: theme.protein }]}
          >
            <Icon name="pencil" size={14} color={theme.protein} />
            <Text style={[type.micro, { color: theme.protein, fontWeight: '700' }]}>Correct AI</Text>
          </Pressable>
        </View>

        {/* Hero Kcal & Confidence */}
        <View style={{ marginTop: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={[type.hero, { color: theme.text, fontSize: 52 }]}>{result.totals.kcal}</Text>
            <Text style={[type.heading, { color: theme.textMuted }]}>kcal</Text>
          </View>

          <View style={{ marginTop: space.sm }}>
            <ConfidenceChip
              value={result.totals.kcal}
              band={result.mealBand}
              expanded={expandedBand}
              onPress={() => setExpandedBand((v) => !v)}
            />
            {expandedBand && <ConfidenceReasons band={result.mealBand} />}
          </View>
        </View>

        {/* ========================================================================= */}
        {/* INTERACTIVE MEAL PORTION CONTROLLER */}
        {/* ========================================================================= */}
        <View style={[styles.portionSection, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Icon name="bowl" size={18} color={theme.protein} />
              <Text style={[type.bodyStrong, { color: theme.text }]}>Meal Portion Eaten</Text>
            </View>
            <Text style={[type.caption, { color: theme.protein, fontWeight: '700' }]}>
              {currentPct}% ({result.totals.kcal} kcal)
            </Text>
          </View>

          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2, fontSize: 12 }]}>
            Tap a portion below to instantly scale calories and all macros.
          </Text>

          <View style={styles.portionPillsRow}>
            {PORTION_OPTIONS.map((opt) => {
              const active = Math.abs(opt.fraction - currentFraction) < 0.01
              return (
                <Pressable
                  key={opt.label}
                  accessibilityRole="button"
                  accessibilityLabel={`Set portion to ${opt.label}`}
                  onPress={() => setPortionEaten(opt.fraction)}
                  style={[
                    styles.portionPill,
                    {
                      backgroundColor: active ? theme.protein : theme.bgElevated,
                      borderColor: active ? theme.protein : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      type.label,
                      {
                        color: active ? '#000' : theme.text,
                        fontWeight: active ? '800' : '600',
                        fontSize: 13,
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              )
            })}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Custom portion percentage"
              onPress={() => {
                setCustomPortionText(String(currentPct))
                setCustomPortionOpen(true)
              }}
              style={[
                styles.portionPill,
                {
                  backgroundColor: isCustomFraction ? theme.protein : theme.bgElevated,
                  borderColor: isCustomFraction ? theme.protein : theme.border,
                },
              ]}
            >
              <Text
                style={[
                  type.label,
                  {
                    color: isCustomFraction ? '#000' : theme.text,
                    fontWeight: isCustomFraction ? '800' : '600',
                    fontSize: 13,
                  },
                ]}
              >
                {isCustomFraction ? `${currentPct}%` : 'Custom'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Stats Pager (Macros & Micronutrients & Health Score) */}
        <StatsPager
          totals={result.totals}
          grams={result.meal.ingredients.reduce((a, r) => a + r.grams, 0) * currentFraction}
        />

        {/* Clarifying Questions */}
        {highlighted.map((q) => (
          <View key={q.question.id} style={[styles.qCard, { borderColor: theme.uncertain, backgroundColor: theme.uncertainBg }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>{q.text}</Text>
            <View style={styles.chipRow}>
              {q.question.options.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => answerQuestion(q, opt.value)}
                  hitSlop={space.sm}
                  style={[styles.chip, { borderColor: theme.uncertain }]}
                >
                  <Text style={[type.label, { color: theme.text }]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {preAnswered.length > 0 && (
          <View style={{ marginTop: space.lg, gap: space.xs }}>
            {preAnswered.map((q) => (
              <Pressable key={q.question.id} onPress={() => answerQuestion(q, q.appliedDefault ?? '')} hitSlop={space.xs}>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  {q.disclosure} · <Text style={{ color: theme.uncertain }}>change</Text>
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* ========================================================================= */}
        {/* INGREDIENTS SECTION WITH LIVE CONTROLS */}
        {/* ========================================================================= */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xxl }}>
          <Text style={[type.heading, { color: theme.text, fontSize: 18 }]}>Ingredients & Portions</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setAddTab('search')
              setAddQuery('')
              setAddResults([])
              setAddModalOpen(true)
            }}
            style={[styles.addBtn, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
          >
            <Icon name="plus" size={14} color={theme.protein} weight={2.4} />
            <Text style={[type.label, { color: theme.protein, fontSize: 13, fontWeight: '700' }]}>Add Food</Text>
          </Pressable>
        </View>

        <View style={{ gap: space.sm, marginTop: space.sm }}>
          {result.meal.ingredients.map((row) => {
            const item = result.items.find((i) => i.row.id === row.id)
            const lookup = phase.webLookups[row.id]
            const factor = row.grams / 100
            const rowKcal = Math.round(row.nutrientSnapshot.kcal * factor * currentFraction)
            const rowP = Math.round(row.nutrientSnapshot.protein_g * factor * currentFraction)
            const rowC = Math.round(row.nutrientSnapshot.carbs_g * factor * currentFraction)
            const rowF = Math.round(row.nutrientSnapshot.fat_g * factor * currentFraction)

            return (
              <View
                key={row.id}
                style={[
                  styles.ingredientCard,
                  { backgroundColor: theme.bgSunken, borderColor: theme.border },
                ]}
              >
                {/* Header row with Name, Kcal, and Edit/Delete */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Pressable
                    onPress={() => handleOpenEditModal(row)}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs }}
                  >
                    <Text style={[type.bodyStrong, { color: theme.text, fontSize: 16 }]} numberOfLines={1}>
                      {row.displayName}
                    </Text>
                    <Icon name="pencil" size={12} color={theme.textFaint} />
                  </Pressable>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Text style={[type.bodyStrong, { color: theme.protein, fontSize: 15 }]}>{rowKcal} kcal</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${row.displayName}`}
                      onPress={() => removeRow(row.id)}
                      hitSlop={space.sm}
                      style={[styles.delBtn, { backgroundColor: theme.bgElevated }]}
                    >
                      <Icon name="close" size={14} color={theme.textMuted} />
                    </Pressable>
                  </View>
                </View>

                {/* Sub details: Macros & badges */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                  <Text style={[type.caption, { color: theme.textMuted, fontSize: 12 }]}>
                    P: {rowP}g · C: {rowC}g · F: {rowF}g
                  </Text>
                  {row.origin === 'web_lookup' && row.sourceUrl ? (
                    <Text style={[type.micro, { color: theme.textMuted }]}>From {domainOf(row.sourceUrl)}</Text>
                  ) : row.isEstimate ? (
                    <Text style={[type.micro, { color: theme.uncertain }]}>AI ESTIMATE</Text>
                  ) : (
                    <Text style={[type.micro, { color: theme.affirm }]}>✓ DB MATCH</Text>
                  )}
                </View>

                {/* Gram Adjustment Controls */}
                <View style={styles.gramControlsRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <TextInput
                      accessibilityLabel={`Grams of ${row.displayName}`}
                      keyboardType="numeric"
                      value={String(Math.round(row.grams))}
                      onChangeText={(t) => {
                        const val = Number.parseFloat(t)
                        if (Number.isFinite(val)) editGrams(row.id, val)
                      }}
                      style={[
                        styles.gramInput,
                        { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated },
                      ]}
                    />
                    <Text style={[type.caption, { color: theme.textMuted, fontWeight: '600' }]}>g</Text>
                  </View>

                  <View style={styles.quickStepRow}>
                    <Pressable
                      onPress={() => adjustGrams(row.id, -25)}
                      style={[styles.stepPill, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
                    >
                      <Text style={[type.micro, { color: theme.text, fontWeight: '700' }]}>−25g</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => adjustGrams(row.id, 25)}
                      style={[styles.stepPill, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
                    >
                      <Text style={[type.micro, { color: theme.text, fontWeight: '700' }]}>+25g</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => scaleIngredientGrams(row.id, 0.5)}
                      style={[styles.stepPill, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
                    >
                      <Text style={[type.micro, { color: theme.text, fontWeight: '700' }]}>0.5×</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => scaleIngredientGrams(row.id, 2.0)}
                      style={[styles.stepPill, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
                    >
                      <Text style={[type.micro, { color: theme.text, fontWeight: '700' }]}>2×</Text>
                    </Pressable>
                  </View>
                </View>

                {lookup ? <WebLookupCard rowId={row.id} state={lookup} /> : null}
              </View>
            )
          })}
        </View>

        {/* Re-analyze Helper Banner */}
        <Pressable
          onPress={() => setFixOpen(true)}
          style={[styles.fixBanner, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}
        >
          <Icon name="pencil" size={18} color={theme.protein} />
          <View style={{ flex: 1 }}>
            <Text style={[type.bodyStrong, { color: theme.text, fontSize: 14 }]}>Did the AI guess wrong?</Text>
            <Text style={[type.caption, { color: theme.textMuted, fontSize: 12 }]}>
              Tap to describe your actual dish and recalculate with AI.
            </Text>
          </View>
          <Text style={{ color: theme.protein, fontSize: 13, fontWeight: '700' }}>Fix →</Text>
        </Pressable>
      </ScrollView>

      {/* Footer Bottom Bar */}
      <View
        style={[
          styles.actions,
          {
            paddingBottom: Math.max(insets.bottom, space.lg),
            backgroundColor: theme.bg,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFixOpen(true)}
            style={[styles.secondary, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}
          >
            <Icon name="pencil" size={16} color={theme.text} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>Correct AI</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={logging}
            onPress={() => {
              if (logging) return
              setLogging(true)
              void (async () => {
                try {
                  await logMeal(result, phase.meta, phase.photoUri, Date.now())
                  reset()
                  if (router.canDismiss()) {
                    router.dismissAll()
                  } else {
                    router.replace('/(tabs)' as never)
                  }
                } catch {
                  setLogging(false)
                }
              })()
            }}
            style={[styles.primary, { flex: 1, backgroundColor: theme.text }, logging && { opacity: 0.6 }]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 16 }]}>
              {logging ? 'Logging…' : `Log it · ${result.totals.kcal} kcal`}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ========================================================================= */}
      {/* MODAL 1: CUSTOM MEAL PORTION % */}
      {/* ========================================================================= */}
      <Modal visible={customPortionOpen} transparent animationType="fade" onRequestClose={() => setCustomPortionOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
            <Text style={[type.heading, { color: theme.text }]}>Custom Portion Percentage</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 4 }]}>
              Enter percentage of the scanned meal you consumed (e.g. 50% for half, 120% for large).
            </Text>
            <TextInput
              keyboardType="number-pad"
              placeholder="e.g. 80"
              placeholderTextColor={theme.textFaint}
              value={customPortionText}
              onChangeText={setCustomPortionText}
              autoFocus
              style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
            />
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
              <Pressable
                onPress={() => setCustomPortionOpen(false)}
                style={[styles.modalBtn, { flex: 1, backgroundColor: theme.bgSunken }]}
              >
                <Text style={[type.label, { color: theme.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const val = Number.parseFloat(customPortionText)
                  if (Number.isFinite(val) && val > 0) {
                    setPortionEaten(val / 100)
                  }
                  setCustomPortionOpen(false)
                }}
                style={[styles.modalBtn, { flex: 1, backgroundColor: theme.protein }]}
              >
                <Text style={[type.label, { color: '#000', fontWeight: '700' }]}>Apply Portion</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: ADD INGREDIENT / FOOD (OFFLINE DB SEARCH & MANUAL) */}
      {/* ========================================================================= */}
      <Modal visible={addModalOpen} transparent animationType="slide" onRequestClose={() => setAddModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCardLarge,
              { backgroundColor: theme.isDark ? '#16161C' : theme.bgElevated, borderColor: theme.border },
            ]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[type.heading, { color: theme.text, fontSize: 18 }]}>Add Food to Meal</Text>
              <Pressable onPress={() => setAddModalOpen(false)} hitSlop={space.sm}>
                <Icon name="close" size={18} color={theme.textMuted} />
              </Pressable>
            </View>

            {/* Tab switch */}
            <View style={[styles.tabBar, { backgroundColor: theme.bgSunken, marginTop: space.md }]}>
              <Pressable
                onPress={() => setAddTab('search')}
                style={[styles.tabItem, addTab === 'search' && { backgroundColor: theme.bgElevated }]}
              >
                <Text style={[type.label, { color: addTab === 'search' ? theme.text : theme.textMuted }]}>
                  Database Search (USDA / Indian)
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAddTab('manual')}
                style={[styles.tabItem, addTab === 'manual' && { backgroundColor: theme.bgElevated }]}
              >
                <Text style={[type.label, { color: addTab === 'manual' ? theme.text : theme.textMuted }]}>
                  Manual Entry
                </Text>
              </Pressable>
            </View>

            {addTab === 'search' ? (
              <View style={{ flex: 1, marginTop: space.md }}>
                <TextInput
                  placeholder="Search food — e.g. Roti, Paneer, Rice, Egg"
                  placeholderTextColor={theme.textFaint}
                  value={addQuery}
                  onChangeText={setAddQuery}
                  autoFocus
                  style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                />
                {addSearching && <ActivityIndicator size="small" color={theme.protein} style={{ marginTop: space.md }} />}

                <ScrollView style={{ flex: 1, marginTop: space.sm }}>
                  {addResults.map((cand) => (
                    <Pressable
                      key={cand.foodId}
                      onPress={() => handleSelectCandidateForAdd(cand)}
                      style={[styles.candRow, { borderBottomColor: theme.border }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[type.bodyStrong, { color: theme.text, fontSize: 15 }]}>{cand.name}</Text>
                        <Text style={[type.caption, { color: theme.textMuted }]}>
                          {Math.round(cand.energyKcal ?? 0)} kcal / 100g
                        </Text>
                      </View>
                      <Text style={[type.label, { color: theme.protein, fontWeight: '700' }]}>+ Add</Text>
                    </Pressable>
                  ))}
                  {addQuery.trim().length >= 2 && !addSearching && addResults.length === 0 && (
                    <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.xl }]}>
                      No matches found. Switch to Manual Entry to add custom macros.
                    </Text>
                  )}
                </ScrollView>
              </View>
            ) : (
              <ScrollView style={{ flex: 1, marginTop: space.md }}>
                <Text style={[type.label, { color: theme.textMuted, marginTop: space.xs }]}>Food Name</Text>
                <TextInput
                  placeholder="e.g. Masala Omelette"
                  placeholderTextColor={theme.textFaint}
                  value={manualName}
                  onChangeText={setManualName}
                  style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                />

                <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.textMuted }]}>Grams (g)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={manualGrams}
                      onChangeText={setManualGrams}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.textMuted }]}>Calories (kcal)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={manualKcal}
                      onChangeText={setManualKcal}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.protein }]}>Protein (g)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={manualProtein}
                      onChangeText={setManualProtein}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.carbs }]}>Carbs (g)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={manualCarbs}
                      onChangeText={setManualCarbs}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.fat }]}>Fat (g)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={manualFat}
                      onChangeText={setManualFat}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                </View>

                <Pressable
                  onPress={handleAddManualIngredient}
                  style={[styles.modalBtn, { backgroundColor: theme.protein, marginTop: space.xl }]}
                >
                  <Text style={[type.label, { color: '#000', fontWeight: '700' }]}>Add Ingredient</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 3: EDIT / SWAP INGREDIENT */}
      {/* ========================================================================= */}
      <Modal visible={editModalOpen} transparent animationType="slide" onRequestClose={() => setEditModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCardLarge,
              { backgroundColor: theme.isDark ? '#16161C' : theme.bgElevated, borderColor: theme.border },
            ]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[type.heading, { color: theme.text, fontSize: 18 }]}>Edit Ingredient</Text>
              <Pressable onPress={() => setEditModalOpen(false)} hitSlop={space.sm}>
                <Icon name="close" size={18} color={theme.textMuted} />
              </Pressable>
            </View>

            <View style={[styles.tabBar, { backgroundColor: theme.bgSunken, marginTop: space.md }]}>
              <Pressable
                onPress={() => setEditTab('adjust')}
                style={[styles.tabItem, editTab === 'adjust' && { backgroundColor: theme.bgElevated }]}
              >
                <Text style={[type.label, { color: editTab === 'adjust' ? theme.text : theme.textMuted }]}>
                  Adjust Portion & Values
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setEditTab('swap')}
                style={[styles.tabItem, editTab === 'swap' && { backgroundColor: theme.bgElevated }]}
              >
                <Text style={[type.label, { color: editTab === 'swap' ? theme.text : theme.textMuted }]}>
                  Swap with DB Food
                </Text>
              </Pressable>
            </View>

            {editTab === 'adjust' ? (
              <ScrollView style={{ flex: 1, marginTop: space.md }}>
                <Text style={[type.label, { color: theme.textMuted }]}>Name</Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                />

                <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.textMuted }]}>Portion Grams (g)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={editGramsVal}
                      onChangeText={setEditGramsVal}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.textMuted }]}>Calories (kcal)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={editKcal}
                      onChangeText={setEditKcal}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.protein }]}>Protein (g)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={editProtein}
                      onChangeText={setEditProtein}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.carbs }]}>Carbs (g)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={editCarbs}
                      onChangeText={setEditCarbs}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, { color: theme.fat }]}>Fat (g)</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={editFat}
                      onChangeText={setEditFat}
                      style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                    />
                  </View>
                </View>

                <Pressable
                  onPress={handleSaveIngredientEdits}
                  style={[styles.modalBtn, { backgroundColor: theme.protein, marginTop: space.xl }]}
                >
                  <Text style={[type.label, { color: '#000', fontWeight: '700' }]}>Save Changes</Text>
                </Pressable>
              </ScrollView>
            ) : (
              <View style={{ flex: 1, marginTop: space.md }}>
                <TextInput
                  placeholder="Search replacement food in database"
                  placeholderTextColor={theme.textFaint}
                  value={swapQuery}
                  onChangeText={setSwapQuery}
                  autoFocus
                  style={[styles.modalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgSunken }]}
                />
                {swapSearching && <ActivityIndicator size="small" color={theme.protein} style={{ marginTop: space.md }} />}

                <ScrollView style={{ flex: 1, marginTop: space.sm }}>
                  {swapResults.map((cand) => (
                    <Pressable
                      key={cand.foodId}
                      onPress={() => handleSwapCandidate(cand)}
                      style={[styles.candRow, { borderBottomColor: theme.border }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[type.bodyStrong, { color: theme.text, fontSize: 15 }]}>{cand.name}</Text>
                        <Text style={[type.caption, { color: theme.textMuted }]}>
                          {Math.round(cand.energyKcal ?? 0)} kcal / 100g
                        </Text>
                      </View>
                      <Text style={[type.label, { color: theme.protein, fontWeight: '700' }]}>Swap →</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 4: AI CORRECTION / RE-ANALYSIS MODAL */}
      {/* ========================================================================= */}
      {fixOpen ? (
        <View style={[styles.fixOverlay, { backgroundColor: theme.bg, paddingTop: insets.top + space.xl }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="pencil" size={20} color={theme.text} />
            <Text style={[type.title, { color: theme.text }]}>Correct AI & Re-analyze</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 18 }]}>
            If the AI misidentified your food (e.g. thought your curry was soup, or missed a side dish), describe what is on the plate and the AI will re-analyze and recalculate everything.
          </Text>

          <TextInput
            autoFocus
            multiline
            placeholder="e.g. This is 2 stuffed paneer parathas with a bowl of curd and pickle, not pancakes."
            placeholderTextColor={theme.textFaint}
            value={fixText}
            onChangeText={setFixText}
            style={[styles.fixInput, { color: theme.text, borderColor: theme.border }]}
          />

          <View style={[styles.fixExample, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
              <Text style={{ fontWeight: '700', color: theme.text }}>Tip:</Text> You can state the exact food items, cooking style, or extra ingredients. The AI will completely recalibrate your macro estimates.
            </Text>
          </View>

          <View style={{ flex: 1 }} />

          <Pressable
            accessibilityRole="button"
            disabled={!fixText.trim()}
            onPress={() => {
              const note = fixText.trim()
              setFixOpen(false)
              setFixText('')
              if (note) void fixScan(note)
            }}
            style={[
              styles.primary,
              { backgroundColor: theme.text, marginBottom: space.sm },
              !fixText.trim() && { opacity: 0.4 },
            ]}
          >
            <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 16 }]}>Recalculate with AI</Text>
          </Pressable>

          <Pressable
            onPress={() => setFixOpen(false)}
            hitSlop={space.md}
            style={{ alignSelf: 'center', marginBottom: Math.max(insets.bottom, space.lg), padding: space.sm }}
          >
            <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function domainOf(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)
  return m?.[1] ?? url
}

function WebLookupCard({ rowId, state }: { rowId: string; state: WebLookupState }) {
  const theme = useTheme()
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')

  if (state.status === 'running') {
    return (
      <View style={[styles.lookupQuiet, { backgroundColor: theme.bgElevated }]}>
        <ActivityIndicator size="small" color={theme.textFaint} />
        <Text style={[type.caption, { color: theme.textMuted }]}>
          Checking web for published nutrition…
        </Text>
      </View>
    )
  }
  if (state.status === 'failed') return null

  const result: WebLookupResult = state.result
  if (result.options.length <= 1 && !result.question) return null

  return (
    <View style={[styles.qCard, { borderColor: theme.uncertain, backgroundColor: theme.uncertainBg, marginTop: space.sm }]}>
      <Text style={[type.bodyStrong, { color: theme.text }]}>
        {result.question ?? 'Which one was it?'}
      </Text>
      {result.source_url ? (
        <Text style={[type.micro, { color: theme.textMuted, marginTop: 2 }]}>
          Menu data from {domainOf(result.source_url)}
        </Text>
      ) : null}

      <View style={{ marginTop: space.md, gap: space.sm }}>
        {result.options.map((opt) => (
          <Pressable
            key={opt.label}
            onPress={() => applyWebOption(rowId, opt, result.source_url)}
            style={[styles.optionRow, { borderColor: theme.uncertain, backgroundColor: theme.bg }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: theme.text }]}>{opt.label}</Text>
              {opt.serving_desc ? (
                <Text style={[type.micro, { color: theme.textMuted, marginTop: 1 }]}>{opt.serving_desc}</Text>
              ) : null}
            </View>
            <Text style={[type.label, { color: theme.textMuted }]}>{Math.round(opt.calories_kcal)} kcal</Text>
          </Pressable>
        ))}

        {otherOpen ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput
              autoFocus
              placeholder="Type what it was"
              placeholderTextColor={theme.textFaint}
              value={otherText}
              onChangeText={setOtherText}
              onSubmitEditing={() => {
                if (otherText.trim()) void lookupOther(rowId, otherText.trim())
                setOtherOpen(false)
              }}
              returnKeyType="search"
              style={[styles.otherInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]}
            />
            <Pressable
              onPress={() => {
                if (otherText.trim()) void lookupOther(rowId, otherText.trim())
                setOtherOpen(false)
              }}
              hitSlop={space.sm}
            >
              <Icon name="search" size={18} color={theme.text} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setOtherOpen(true)} style={[styles.optionRow, { borderColor: theme.border, backgroundColor: theme.bg }]}>
            <Text style={[type.body, { color: theme.textMuted }]}>Other…</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

function Macro({
  label,
  value,
  unit = 'g',
  color,
  icon,
}: {
  label: string
  value: number
  unit?: string
  color: string
  icon: IconName
}) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text style={[type.heading, { color: theme.text }]}>{Math.round(value)}</Text>
        <Text style={[type.caption, { color: theme.textFaint }]}>{unit}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 }}>
        <Icon name={icon} size={14} color={color} />
        <Text style={[type.caption, { color: theme.textMuted }]}>{label}</Text>
      </View>
    </View>
  )
}

function StatsPager({ totals, grams }: { totals: Parameters<typeof healthScore>[0]; grams: number }) {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const pageW = width - space.lg * 2
  const [page, setPage] = useState(0)
  const [showWhy, setShowWhy] = useState(false)
  const hs = healthScore(totals, grams > 0 ? grams : undefined)

  return (
    <View style={{ marginTop: space.lg }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / pageW))}
      >
        <View style={[styles.statsPage, { width: pageW }]}>
          <Macro label="Protein" value={totals.protein_g} color={theme.protein} icon="protein" />
          <Macro label="Carbs" value={totals.carbs_g} color={theme.carbs} icon="carbs" />
          <Macro label="Fat" value={totals.fat_g} color={theme.fat} icon="fat" />
        </View>

        <View style={{ width: pageW }}>
          <View style={styles.statsPage}>
            <Macro label="Fiber" value={totals.fiber_g} color={theme.carbs} icon="fiber" />
            <Macro label="Sugar" value={totals.sugar_g} color={theme.uncertain} icon="sugar" />
            <Macro label="Sodium" value={totals.sodium_mg} unit="mg" color={theme.fat} icon="sodium" />
          </View>

          {hs ? (
            <Pressable
              onPress={() => setShowWhy((v) => !v)}
              style={[styles.healthCard, { backgroundColor: theme.bgSunken }]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Icon name="heart" size={18} color={theme.protein} />
                <Text style={[type.bodyStrong, { color: theme.text, flex: 1 }]}>Health score</Text>
                <Text style={[type.bodyStrong, { color: theme.text }]}>{hs.score}/10</Text>
              </View>
              <View style={[styles.healthTrack, { backgroundColor: theme.bgElevated }]}>
                <View
                  style={[
                    styles.healthFill,
                    { width: `${hs.score * 10}%` as const, backgroundColor: theme.affirm },
                  ]}
                />
              </View>
              {showWhy &&
                hs.reasons.map((r) => (
                  <Text key={r} style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
                    · {r}
                  </Text>
                ))}
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.dots}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: i === page ? theme.text : theme.border }]}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  statsPage: { flexDirection: 'row', gap: space.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.md },
  dot: { width: 6, height: 6, borderRadius: 3 },
  healthCard: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
  healthTrack: { height: 6, borderRadius: 3, marginTop: space.md, overflow: 'hidden' },
  healthFill: { height: 6, borderRadius: 3 },
  aiFixBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  portionSection: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  portionPillsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: space.md,
    flexWrap: 'wrap',
  },
  portionPill: {
    flex: 1,
    minWidth: 52,
    paddingVertical: 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  ingredientCard: {
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  delBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gramControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150,150,150,0.15)',
  },
  gramInput: {
    width: 60,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  quickStepRow: {
    flexDirection: 'row',
    gap: 5,
  },
  stepPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xl,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
  },
  fixOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    zIndex: 100,
  },
  fixInput: {
    marginTop: space.lg,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 100,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  fixExample: { marginTop: space.md, padding: space.md, borderRadius: radius.lg },
  qCard: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  photo: { width: 160, height: 160, borderRadius: radius.lg },
  lookupQuiet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    marginTop: space.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: MIN_TAP_TARGET,
  },
  otherInput: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TAP_TARGET,
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: {
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    padding: space.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  modalCardLarge: {
    width: '100%',
    maxWidth: 440,
    height: '75%',
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginTop: space.xs,
    fontSize: 15,
  },
  modalBtn: {
    paddingVertical: 12,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.md,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  candRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
