import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { reconcileFromMacros } from '@nutai/totals'
import { currentGoal, overrideTargets, putSetting, setting, type CurrentGoal } from '../src/data/repo'
import { LB_PER_KG, lbToKg } from '../src/onboarding/store'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

/**
 * Edit nutrition and body weight goals.
 */
export default function EditGoals() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [base, setBase] = useState<CurrentGoal | null>(null)
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [fat, setFat] = useState('')
  const [isImperial, setIsImperial] = useState(true)
  const [startWeightInput, setStartWeightInput] = useState('')
  const [goalWeightInput, setGoalWeightInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [g, startW, desiredW, units] = await Promise.all([
        currentGoal(),
        setting('goal.startWeightKg', ''),
        setting('goal.desiredWeightKg', ''),
        setting('units', 'imperial'),
      ])
      if (!alive) return
      const imperial = units !== 'metric'
      setIsImperial(imperial)
      if (g) {
        setBase(g)
        setKcal(String(Math.round(g.targetKcal)))
        setProtein(String(Math.round(g.protein_g)))
        setFat(String(Math.round(g.fat_g)))
      }
      if (startW) {
        const kgVal = Number(startW)
        setStartWeightInput(imperial ? (kgVal * LB_PER_KG).toFixed(1) : kgVal.toFixed(1))
      }
      if (desiredW) {
        const kgVal = Number(desiredW)
        setGoalWeightInput(imperial ? (kgVal * LB_PER_KG).toFixed(1) : kgVal.toFixed(1))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const n = (s: string) => {
    const v = Number.parseFloat(s)
    return Number.isFinite(v) && v >= 0 ? v : 0
  }

  const kcalV = n(kcal)
  const proteinV = n(protein)
  const fatV = n(fat)
  // The single derived value.
  const carbsV = Math.max(0, (kcalV - 4 * proteinV - 9 * fatV) / 4)
  const impossible = kcalV > 0 && 4 * proteinV + 9 * fatV > kcalV

  async function save() {
    if (!base || saving || kcalV <= 0 || impossible) return
    setSaving(true)

    if (startWeightInput && Number(startWeightInput) > 0) {
      const kg = isImperial ? lbToKg(Number(startWeightInput)) : Number(startWeightInput)
      await putSetting('goal.startWeightKg', String(kg))
    }
    if (goalWeightInput && Number(goalWeightInput) > 0) {
      const kg = isImperial ? lbToKg(Number(goalWeightInput)) : Number(goalWeightInput)
      await putSetting('goal.desiredWeightKg', String(kg))
    }

    await overrideTargets(
      {
        targetKcal: kcalV,
        macros: { protein_g: proteinV, fat_g: fatV, carbs_g: carbsV, carbsFloored: carbsV === 0 },
      },
      base,
      Date.now(),
    )
    router.back()
  }

  const weightUnit = isImperial ? 'lbs' : 'kg'

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Goals & Targets</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        <Text style={[type.heading, { color: theme.text, fontSize: 17, marginBottom: space.md }]}>Weight Targets</Text>
        <Field label="Start Baseline Weight" unit={weightUnit} value={startWeightInput} onChange={setStartWeightInput} />
        <Field label="Target Goal Weight" unit={weightUnit} value={goalWeightInput} onChange={setGoalWeightInput} />

        <Text style={[type.heading, { color: theme.text, fontSize: 17, marginTop: space.md, marginBottom: space.md }]}>Nutrition Daily Targets</Text>
        <Field label="Daily Calorie Target" unit="kcal" value={kcal} onChange={setKcal} />
        <Field label="Protein" unit="g" value={protein} onChange={setProtein} />
        <Field label="Fat" unit="g" value={fat} onChange={setFat} />

        <View style={[styles.derived, { backgroundColor: theme.bgSunken }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={[type.body, { color: theme.textMuted }]}>Carbs</Text>
            <Text style={[styles.big, { color: theme.text }]}>{Math.round(carbsV)} g</Text>
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 18 }]}>
            Carbs are automatically calculated as the remainder from calories, protein, and fat.
          </Text>
        </View>

        {impossible ? (
          <View style={[styles.warn, { backgroundColor: theme.safetyBg }]}>
            <Text style={[type.caption, { color: theme.safety }]}>
              Protein and fat alone already exceed {Math.round(kcalV)} kcal
              ({Math.round(reconcileFromMacros(proteinV, 0, fatV))} kcal). Raise calories or lower one
              of them.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.lg), backgroundColor: theme.bg }]}>
        <Pressable
          onPress={save}
          disabled={kcalV <= 0 || impossible || saving}
          style={[styles.cta, { backgroundColor: kcalV > 0 && !impossible ? theme.text : theme.border }]}
        >
          <Text style={[type.bodyStrong, { color: theme.bg, fontSize: 18 }]}>Save Goals</Text>
        </Pressable>
      </View>
    </View>
  )
}

function Field({
  label, unit, value, onChange,
}: {
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
}) {
  const theme = useTheme()
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[type.label, { color: theme.textMuted, marginBottom: space.xs }]}>{label}</Text>
      <View style={[styles.field, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
        <TextInput
          keyboardType="number-pad"
          value={value}
          onChangeText={onChange}
          accessibilityLabel={`${label} in ${unit}`}
          style={[styles.input, { color: theme.text }]}
        />
        <Text style={[type.body, { color: theme.textMuted }]}>{unit}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, minHeight: 56,
  },
  input: { flex: 1, fontSize: 22, fontWeight: '700', paddingVertical: space.md },
  derived: { padding: space.lg, borderRadius: radius.lg },
  big: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6 },
  warn: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  note: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg },
  cta: { height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
