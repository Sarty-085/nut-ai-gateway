import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import { clearCredential, loadCredential, saveCredential } from '../src/inference/credentials'
import { validateGoogleApiKey } from '../src/inference/pathA/validate'
import { putSetting, setting } from '../src/data/repo'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

type ProviderMode = 'gateway' | 'google' | 'none'

export default function ProviderSettings() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const [mode, setMode] = useState<ProviderMode>('gateway')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [googleKey, setGoogleKey] = useState('')
  const [showGoogleKey, setShowGoogleKey] = useState(false)
  const [adminKey, setAdminKey] = useState('')
  const [health, setHealth] = useState<GatewayHealthStatus | null>(null)
  const [googleStatus, setGoogleStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adminTelemetry, setAdminTelemetry] = useState<any[] | null>(null)
  const [showAdminConfig, setShowAdminConfig] = useState(false)

  const refresh = useCallback(() => {
    void (async () => {
      setBusy(true)
      const [currUrl, currToken, currAdmin, currProvider, googleCred] = await Promise.all([
        getGatewayUrl(),
        getAppToken(),
        getAdminToken(),
        setting('provider', 'gateway'),
        loadCredential('google'),
      ])
      setUrl(currUrl || '')
      setToken(currToken || '')
      setAdminKey(currAdmin || '')
      setGoogleKey(googleCred?.value || '')

      if (currProvider === 'google') {
        setMode('google')
      } else if (currProvider === 'none') {
        setMode('none')
      } else {
        setMode('gateway')
      }

      if (currUrl) {
        const h = await checkGatewayHealth(currUrl)
        setHealth(h)
        if (currAdmin) {
          const adminRes = await fetchAdminStatus(currUrl, currAdmin)
          if (adminRes.ok && adminRes.data?.telemetry) {
            setAdminTelemetry(adminRes.data.telemetry)
          }
        }
      } else {
        setHealth(null)
      }

      setBusy(false)
    })()
  }, [])

  useFocusEffect(refresh)

  async function handleSelectMode(newMode: ProviderMode) {
    setMode(newMode)
    await putSetting('provider', newMode)
    if (newMode === 'none') {
      Alert.alert('Offline Mode Enabled', 'AI camera scanning is disabled. Manual logging, barcode scanning, and offline databases remain fully available.')
    }
  }

  async function testAndSaveGateway() {
    setBusy(true)
    await setGatewayUrl(url.trim())
    await setAppToken(token.trim())
    await putSetting('provider', 'gateway')
    const h = await checkGatewayHealth(url.trim())
    setHealth(h)
    setBusy(false)
    if (h.ok) {
      Alert.alert('Connected', `Private Gateway is online (${h.activeResources ?? 0} active provider pool resources).`)
    } else {
      Alert.alert('Connection Failed', h.error ?? 'Could not connect to gateway.')
    }
  }

  async function testAndSaveGoogleKey() {
    if (!googleKey.trim()) {
      Alert.alert('Missing Key', 'Please enter a valid Google Gemini API key.')
      return
    }
    setBusy(true)
    const val = await validateGoogleApiKey(googleKey.trim())
    setBusy(false)
    if (val.ok) {
      await saveCredential('google', { kind: 'api_key', value: googleKey.trim() })
      await putSetting('provider', 'google')
      setGoogleStatus('Verified and active')
      Alert.alert('API Key Verified', 'Google Gemini API key verified successfully! WorkFit AI will analyze meal photos and scans directly.')
    } else {
      setGoogleStatus('Verification failed')
      Alert.alert('Verification Failed', val.error.message || 'Invalid Google API Key.')
    }
  }

  async function handleClearGoogleKey() {
    await clearCredential('google')
    setGoogleKey('')
    setGoogleStatus(null)
    Alert.alert('Key Removed', 'Personal Google Gemini API key cleared.')
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
        <Text style={[type.title, { color: theme.text }]}>AI Perception</Text>
        <Pressable onPress={() => router.back()} hitSlop={space.md}>
          <Icon name="close" size={22} color={theme.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        {/* Mode Selector Tabs */}
        <Text style={[type.label, { color: theme.textMuted, marginBottom: space.sm }]}>Choose Perception Engine</Text>
        <View style={styles.modeTabs}>
          <Pressable
            onPress={() => handleSelectMode('gateway')}
            style={[styles.modeTab, mode === 'gateway' && { backgroundColor: theme.bgElevated, borderColor: theme.protein }]}
          >
            <Text style={[type.bodyStrong, { color: mode === 'gateway' ? theme.protein : theme.textMuted, fontSize: 13 }]}>
              Private Gateway
            </Text>
          </Pressable>

          <Pressable
            onPress={() => handleSelectMode('google')}
            style={[styles.modeTab, mode === 'google' && { backgroundColor: theme.bgElevated, borderColor: theme.protein }]}
          >
            <Text style={[type.bodyStrong, { color: mode === 'google' ? theme.protein : theme.textMuted, fontSize: 13 }]}>
              Google Gemini (BYOK)
            </Text>
          </Pressable>

          <Pressable
            onPress={() => handleSelectMode('none')}
            style={[styles.modeTab, mode === 'none' && { backgroundColor: theme.bgElevated, borderColor: theme.protein }]}
          >
            <Text style={[type.bodyStrong, { color: mode === 'none' ? theme.protein : theme.textMuted, fontSize: 13 }]}>
              Offline
            </Text>
          </Pressable>
        </View>

        {/* Mode 1: Private AI Gateway */}
        {mode === 'gateway' ? (
          <View style={{ marginTop: space.lg }}>
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
                      ? 'Private Gateway · Online'
                      : health?.status === 'degraded'
                        ? 'Private Gateway · Degraded'
                        : 'Private Gateway · Offline / Unconfigured'}
                  </Text>
                </View>
                {health?.latencyMs !== undefined ? (
                  <Text style={[type.caption, { color: theme.textMuted }]}>{health.latencyMs}ms</Text>
                ) : null}
              </View>

              <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, lineHeight: 18 }]}>
                {health?.status === 'online'
                  ? `Connected to private gateway with ${health.activeResources ?? 0} active provider pool resources.`
                  : health?.error ?? 'Enter your Gateway URL/IP and application token below.'}
              </Text>
            </View>

            <View style={[styles.card, { backgroundColor: theme.bgSunken, marginTop: space.md }]}>
              <Text style={[type.caption, { color: theme.textMuted }]}>Gateway URL / Host IP</Text>
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="e.g. https://my-gateway.onrender.com or http://192.168.1.50:3000"
                placeholderTextColor={theme.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
              />

              <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md }]}>Application Access Token</Text>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholder="e.g. nuttoken1"
                placeholderTextColor={theme.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
              />

              <Pressable
                onPress={testAndSaveGateway}
                disabled={busy}
                style={[styles.primaryBtn, { backgroundColor: theme.text, marginTop: space.lg }]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.bg} />
                ) : (
                  <Text style={[type.bodyStrong, { color: theme.bg }]}>Save & Test Gateway</Text>
                )}
              </Pressable>

              {/* Admin toggle */}
              <Pressable
                onPress={() => setShowAdminConfig(!showAdminConfig)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg }}
              >
                <Text style={[type.caption, { color: theme.protein }]}>
                  {showAdminConfig ? 'Hide admin controls' : 'Admin telemetry controls'}
                </Text>
                <Icon name={showAdminConfig ? 'close' : 'chevron'} size={12} color={theme.protein} />
              </Pressable>

              {showAdminConfig ? (
                <View style={{ marginTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: space.md }}>
                  <Text style={[type.caption, { color: theme.textMuted }]}>Admin Key (for server-side pool telemetry)</Text>
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
              ) : null}
            </View>

            {/* Admin Telemetry Results */}
            {adminTelemetry ? (
              <View style={{ marginTop: space.xl }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: space.sm }]}>
                  Provider Resource Pool Telemetry
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
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Mode 2: Google Gemini (Direct BYOK) */}
        {mode === 'google' ? (
          <View style={{ marginTop: space.lg }}>
            <View style={[styles.card, { backgroundColor: theme.bgSunken }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={[styles.dot, { backgroundColor: googleKey ? theme.affirm : theme.safety }]} />
                <Text style={[type.bodyStrong, { color: theme.text }]}>
                  {googleKey ? 'Google Gemini API Key Configured' : 'No API Key Entered'}
                </Text>
              </View>
              <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, lineHeight: 19 }]}>
                Calls Google Gemini directly from your device. Your API key is encrypted in your device Keychain and never sent to any intermediary server.
              </Text>
              {googleStatus ? (
                <Text style={[type.caption, { color: googleStatus.includes('Verified') ? theme.affirm : theme.safety, marginTop: space.xs }]}>
                  Status: {googleStatus}
                </Text>
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: theme.bgSunken, marginTop: space.md }]}>
              <Text style={[type.caption, { color: theme.textMuted }]}>Google Gemini API Key</Text>
              <View style={{ position: 'relative' }}>
                <TextInput
                  value={googleKey}
                  onChangeText={setGoogleKey}
                  placeholder="AIzaSy..."
                  placeholderTextColor={theme.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showGoogleKey}
                  style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated, paddingRight: 40 }]}
                />
                <Pressable
                  onPress={() => setShowGoogleKey(!showGoogleKey)}
                  hitSlop={space.sm}
                  style={{ position: 'absolute', right: 12, top: 18 }}
                >
                  <Icon name={showGoogleKey ? 'close' : 'scan'} size={18} color={theme.textMuted} />
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
                <Pressable
                  onPress={testAndSaveGoogleKey}
                  disabled={busy}
                  style={[styles.primaryBtn, { flex: 1, backgroundColor: theme.text }]}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.bg} />
                  ) : (
                    <Text style={[type.bodyStrong, { color: theme.bg }]}>Save & Test Key</Text>
                  )}
                </Pressable>

                {googleKey ? (
                  <Pressable
                    onPress={handleClearGoogleKey}
                    style={[styles.btn, { backgroundColor: theme.safetyBg, borderColor: theme.safety, borderWidth: 1 }]}
                  >
                    <Text style={[type.label, { color: theme.safety }]}>Clear</Text>
                  </Pressable>
                ) : null}
              </View>

              <Pressable
                onPress={() => void Linking.openURL('https://aistudio.google.com/app/apikey')}
                style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Text style={[type.caption, { color: theme.protein }]}>
                  Get a free Google Gemini API Key from Google AI Studio ↗
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Mode 3: Offline / Manual */}
        {mode === 'none' ? (
          <View style={[styles.card, { backgroundColor: theme.bgSunken, marginTop: space.lg }]}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>Offline Mode Active</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.sm, lineHeight: 19 }]}>
              All AI camera scan capabilities are disabled. You can still search the USDA & Indian Nutrition databases, scan barcodes offline, track weight, log exercises, and manually record meals.
            </Text>
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
  modeTabs: {
    flexDirection: 'row',
    gap: space.xs,
    backgroundColor: 'transparent',
  },
  modeTab: {
    flex: 1,
    paddingVertical: space.sm,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
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
