import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { db, logSavedMeal } from '../src/data/repo'
import { Icon } from '../src/components/Icon'
import { useTheme } from '../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * Saved meals.
 *
 * A saved meal stores the CORRECTED ingredient array, not a food name to
 * re-analyze. That is what makes relogging free: zero network requests, zero
 * clarifying questions, and identical numbers to the day you fixed them.
 */
interface SavedMeal {
  id: number
  name: string
  use_count: number
  items_json: string
}

export default function SavedFoods() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [meals, setMeals] = useState<SavedMeal[]>([])
  const [loggingId, setLoggingId] = useState<number | null>(null)

  const refresh = useCallback(() => {
    let alive = true
    void (async () => {
      const h = await db()
      const rows = await h.all<SavedMeal>(
        'SELECT id, name, use_count, items_json FROM saved_meals ORDER BY use_count DESC, last_used_at DESC',
      )
      if (alive) setMeals(rows)
    })()
    return () => {
      alive = false
    }
  }, [])

  useFocusEffect(refresh)

  const handleLogAgain = async (meal: SavedMeal) => {
    if (loggingId !== null) return
    setLoggingId(meal.id)
    try {
      await logSavedMeal(meal.id, Date.now())
      Alert.alert('Meal Logged', `Logged "${meal.name}" into today's diary.`, [
        {
          text: 'View Diary',
          onPress: () => router.replace('/(tabs)' as never),
        },
      ])
      refresh()
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not log saved meal.')
    } finally {
      setLoggingId(null)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + space.lg }}>
      <View style={styles.head}>
        <Text style={[type.title, { color: theme.text }]}>Saved Foods & Meals</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 140 }}>
        {meals.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.bgSunken }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>Nothing saved yet</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.xs, lineHeight: 19 }]}>
              After you log or correct a meal in WorkFit AI, save it to your library. Relogging it later costs nothing — no scan, no network request, and instant local macro resolution.
            </Text>
          </View>
        ) : (
          meals.map((m) => {
            let parsedItems: any[] = []
            try {
              parsedItems = JSON.parse(m.items_json)
            } catch {}
            const totalKcal = parsedItems.reduce((acc, it) => acc + (it.snap_energy_kcal ? (it.snap_energy_kcal * it.grams) / 100 : 0), 0)

            return (
              <View key={m.id} style={[styles.row, { backgroundColor: theme.bgSunken, borderColor: theme.border, borderWidth: 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodyStrong, { color: theme.text, fontSize: 16 }]}>{m.name}</Text>
                  <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                    {Math.round(totalKcal)} kcal · {parsedItems.length} ingredients · Logged {m.use_count} {m.use_count === 1 ? 'time' : 'times'}
                  </Text>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Log ${m.name} again`}
                  disabled={loggingId !== null}
                  onPress={() => handleLogAgain(m)}
                  style={[styles.logBtn, { backgroundColor: theme.protein }]}
                >
                  <Text style={[type.label, { color: '#000', fontWeight: '700' }]}>
                    {loggingId === m.id ? 'Logging…' : 'Log again'}
                  </Text>
                </Pressable>
              </View>
            )
          })
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  empty: { padding: space.lg, borderRadius: radius.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, borderRadius: radius.lg, marginBottom: space.sm,
  },
  logBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
})
