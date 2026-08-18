import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../src/components/Icon'
import {
  checkGatewayHealth,
  fetchAdminStatus,
  getAdminToken,
  getAppToken,
  getGatewayUrl,
  setAdminToken,
  setAppToken,
  setGatewayUrl,
  type GatewayHealthStatus,
} from '../src/inference/gateway-config'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

export default function ProviderSettings() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [adminKey, setAdminKey] = useState('')
  const [health, setHealth] = useState<GatewayHealthStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [adminTelemetry, setAdminTelemetry] = useState<any[] | null>(null)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(() => {
    void (async () => {
      setBusy(true)
      const [currUrl, currToken, currAdmin] = await Promise.all([
        getGatewayUrl(),
        getAppToken(),
        getAdminToken(),
      ])
      setUrl(currUrl)
      setToken(currToken)
      setAdminKey(currAdmin ?? '')

      const h = await checkGatewayHealth(currUrl)
      setHealth(h)

      if (currAdmin) {
        const adminRes = await fetchAdminStatus(currUrl, currAdmin)
        if (adminRes.ok && adminRes.data?.telemetry) {
          setAdminTelemetry(adminRes.data.telemetry)
        }
      }
      setBusy(false)
    })()
  }, [])

  useFocusEffect(refresh)

  async function testAndSave() {
    setBusy(true)
    await setGatewayUrl(url.trim())
    await setAppToken(token.trim())
    const h = await checkGatewayHealth(url.trim())
    setHealth(h)
    setBusy(false)
    if (h.ok) {
      Alert.alert('Connected', `Gateway is online (${h.activeResources} active provider resources).`)
    } else {
      Alert.alert('Connection Failed', h.error ?? 'Could not connect to gateway.')
    }
  }

  async function unlockAdmin() {
    if (!adminKey.trim()) return
    setBusy(true)
    await setAdminToken(adminKey.trim())
    const res = await fetchAdminStatus(url.trim(), adminKey.trim())
    setBusy(false)
    if (res.ok && res.data?.telemetry) {
      setAdminTelemetry(res.data.telemetry)
      Alert.alert('Admin Unlocked', `Loaded telemetry for ${res.data.telemetry.length} pool resources.`)
    } else {
      Alert.alert('Admin Access Denied', res.error ?? 'Invalid admin token.')
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.head, { paddingTop: insets.top + space.sm }]}>
        <Text style={[type.title, { color: theme.text }]}>AI Gateway & Pool</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Icon name="close" size={22} color={theme.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        {/* Status Card */}
        <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      health?.status === 'online'
                        ? theme.affirm
                        : health?.status === 'degraded'
                          ? theme.uncertain
                          : theme.safety,
                  },
                ]}
              />
              <Text style={[type.bodyStrong, { color: theme.text }]}>
                {health?.status === 'online'
                  ? 'Private AI Gateway · Online'
                  : health?.status === 'degraded'
                    ? 'AI Gateway · Degraded'
                    : 'AI Gateway · Offline'}
              </Text>
            </View>
            {health?.latencyMs !== undefined ? (
              <Text style={[type.caption, { color: theme.textMuted }]}>{health.latencyMs}ms</Text>
            ) : null}
          </View>

          <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, lineHeight: 18 }]}>
            {health?.status === 'online'
              ? `Connected to private gateway with ${health.activeResources ?? 0} active provider pool resources. Food perception is managed outside the mobile device.`
              : health?.error ?? 'Checking connection…'}
          </Text>

          <Pressable
            onPress={refresh}
            disabled={busy}
            style={[styles.btn, { backgroundColor: theme.bgElevated, marginTop: space.md }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.text} />
            ) : (
              <Text style={[type.label, { color: theme.text }]}>Check status</Text>
            )}
          </Pressable>
        </View>

        {/* Administrator Telemetry View (when unlocked) */}
        {adminTelemetry ? (
          <View style={{ marginTop: space.xl }}>
            <Text style={[type.label, { color: theme.textMuted, marginBottom: space.sm }]}>
              Admin: Provider Resource Pool Telemetry
            </Text>
            <View style={{ gap: space.sm }}>
              {adminTelemetry.map((r: any) => (
                <View key={r.id} style={[styles.resourceCard, { backgroundColor: theme.bgSunken }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[type.bodyStrong, { color: theme.text }]}>{r.id}</Text>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor:
                            r.healthState === 'healthy'
                              ? theme.uncertainBg
                              : r.healthState === 'cooldown'
                                ? theme.uncertainBg
                                : theme.safetyBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          type.micro,
                          {
                            color:
                              r.healthState === 'healthy'
                                ? theme.affirm
                                : r.healthState === 'cooldown'
                                  ? theme.uncertain
                                  : theme.safety,
                            textTransform: 'uppercase',
                          },
                        ]}
                      >
                        {r.healthState}
                      </Text>
                    </View>
                  </View>
                  <Text style={[type.caption, { color: theme.textMuted, marginTop: 4 }]}>
                    Provider: {r.provider} · Priority: {r.priority} · Total Requests: {r.totalRequests}
                  </Text>
                  <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                    Successes: {r.totalSuccesses} · Failures: {r.totalFailures} · Failovers: {r.totalFailovers}
                  </Text>
                  {r.lastErrorReason ? (
                    <Text style={[type.caption, { color: theme.safety, marginTop: 4, fontSize: 11 }]}>
                      Last error: {r.lastErrorReason}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Gateway Connection Settings Toggle */}
        <Pressable
          onPress={() => setShowConfig(!showConfig)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl }}
        >
          <Text style={[type.label, { color: theme.protein }]}>
            {showConfig ? 'Hide connection settings' : 'Configure gateway connection'}
          </Text>
          <Icon name={showConfig ? 'close' : 'chevron'} size={14} color={theme.protein} />
        </Pressable>

        {showConfig ? (
          <View style={[styles.card, { backgroundColor: theme.bgSunken, marginTop: space.md }]}>
            <Text style={[type.caption, { color: theme.textMuted }]}>Gateway URL</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="http://localhost:3000"
              placeholderTextColor={theme.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
            />

            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md }]}>Application Access Token</Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="nutai-app-default-token"
              placeholderTextColor={theme.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
            />

            <Pressable
              onPress={testAndSave}
              disabled={busy}
              style={[styles.primaryBtn, { backgroundColor: theme.text, marginTop: space.lg }]}
            >
              <Text style={[type.bodyStrong, { color: theme.bg }]}>Save & Test Connection</Text>
            </Pressable>

            {/* Admin Key input */}
            <View style={{ marginTop: space.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: space.lg }}>
              <Text style={[type.caption, { color: theme.textMuted }]}>Admin Key (for telemetry and pool inspection)</Text>
              <TextInput
                value={adminKey}
                onChangeText={setAdminKey}
                placeholder="Admin Secret"
                placeholderTextColor={theme.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
              />
              <Pressable
                onPress={unlockAdmin}
                style={[styles.btn, { backgroundColor: theme.bgElevated, marginTop: space.md }]}
              >
                <Text style={[type.label, { color: theme.text }]}>Inspect Pool Telemetry</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  card: { padding: space.lg, borderRadius: radius.lg },
  resourceCard: { padding: space.md, borderRadius: radius.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  input: {
    marginTop: 6,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  btn: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    paddingVertical: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
