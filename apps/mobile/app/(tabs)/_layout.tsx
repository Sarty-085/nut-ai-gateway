import { Tabs, router } from 'expo-router'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../../src/components/Icon'
import { useTheme } from '../../src/theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../../src/theme/tokens'

/**
 * Three tabs plus the detached FAB.
 *
 * GROUPS IS GONE. A social feed cannot be local-first without a server we
 * operate, it needs Apple 1.2 moderation machinery before it can ship at all,
 * and it is the highest eating-disorder-risk surface in this product category.
 * Cutting it is the decision, not a gap.
 *
 * The FAB is ALWAYS present and ALWAYS opens real logging. The reference
 * paywalls this button, which is the direct cause of its most-reported
 * complaint. No IAP is configured anywhere in this project, which is what leaves
 * App Store Guideline 3.1.1 nothing to attach to.
 */

const TABS: ReadonlyArray<{ name: string; label: string; icon: IconName }> = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'progress', label: 'Progress', icon: 'chart' },
  { name: 'profile', label: 'Profile', icon: 'person' },
]

interface Action {
  label: string
  subtitle: string
  icon: IconName
  route: string
}

const ACTIONS: Action[] = [
  { label: 'Scan Body & Posture', subtitle: 'Biomechanical alignment & corrective drills', icon: 'muscle', route: '/body-scan' },
  { label: 'Scan Food', subtitle: 'Instant AI meal photo analysis', icon: 'scan', route: '/camera' },
  { label: 'Log Weight', subtitle: 'Record weight & recalibrate targets', icon: 'scale', route: '/log-weight' },
  { label: 'Log Exercise', subtitle: 'Track workout minutes & calories burned', icon: 'dumbbell', route: '/log-exercise' },
  { label: 'Food Database', subtitle: 'Search USDA & Indian nutrition database', icon: 'search', route: '/food-search' },
]

export default function TabLayout() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.bg } }}
        tabBar={({ state, navigation }) => (
          <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
            <View style={[styles.pill, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
              {TABS.map((tab, i) => {
                const focused = state.index === i
                return (
                  <Pressable
                    key={tab.name}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: focused }}
                    accessibilityLabel={tab.label}
                    onPress={() => navigation.navigate(tab.name)}
                    style={[styles.tab, focused && { backgroundColor: theme.bgSunken }]}
                    hitSlop={space.sm}
                  >
                    <Icon name={tab.icon} size={21} color={focused ? theme.text : theme.textFaint} />
                    <Text style={[type.micro, { color: focused ? theme.text : theme.textFaint, marginTop: 1 }]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add"
              onPress={() => setSheetOpen(true)}
              style={[styles.fab, { backgroundColor: theme.text }]}
            >
              <Icon name="plus" size={26} color={theme.bg} weight={2.2} />
            </Pressable>
          </View>
        )}
      >
        {TABS.map((t) => (
          <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
        ))}
      </Tabs>

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheetOpen(false)} />

          <View
            style={[
              styles.bottomSheet,
              {
                backgroundColor: theme.isDark ? '#16161C' : theme.bgElevated,
                borderColor: theme.border,
                paddingBottom: Math.max(insets.bottom, 24),
              },
            ]}
          >
            {/* Drag handle */}
            <View style={styles.handle} />

            <View style={styles.sheetHeader}>
              <Text style={[type.heading, { color: theme.text, fontSize: 18 }]}>Quick Actions</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setSheetOpen(false)}
                hitSlop={space.sm}
                style={[styles.closeBtn, { backgroundColor: theme.bgSunken }]}
              >
                <Icon name="close" size={16} color={theme.textMuted} />
              </Pressable>
            </View>

            <View style={styles.sheetList}>
              {ACTIONS.map((a) => (
                <Pressable
                  key={a.label}
                  accessibilityRole="button"
                  onPress={() => {
                    setSheetOpen(false)
                    router.push(a.route as never)
                  }}
                  style={[styles.sheetItem, { backgroundColor: theme.isDark ? '#202028' : theme.bgSunken }]}
                >
                  <View style={[styles.itemIconWrap, { backgroundColor: theme.isDark ? '#16161C' : theme.bgElevated }]}>
                    <Icon name={a.icon} size={22} color={theme.protein} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyStrong, { color: theme.text, fontSize: 15 }]}>{a.label}</Text>
                    <Text style={[type.caption, { color: theme.textMuted, fontSize: 12 }]} numberOfLines={1}>
                      {a.subtitle}
                    </Text>
                  </View>
                  <Icon name="chevron" size={16} color={theme.textFaint} />
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  pill: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.pill,
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: space.md,
    paddingHorizontal: space.lg,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A3A48',
    alignSelf: 'center',
    marginBottom: space.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.md,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetList: {
    gap: space.sm,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    borderRadius: 16,
  },
  itemIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
