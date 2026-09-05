import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { OptionCard } from '../../src/components/onboarding/Controls'
import { putSetting, setting } from '../../src/data/repo'
import {
  checkGatewayHealth,
  getAppToken,
  getGatewayUrl,
  setAppToken,
  setGatewayUrl,
  setProviderMode,
} from '../../src/inference/gateway-config'
import { loadCredential, saveCredential } from '../../src/inference/credentials'
import { validateGoogleApiKey } from '../../src/inference/pathA/validate'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

type ProviderChoice = 'gateway' | 'google' | 'none'

export default function ProviderScreen() {
  const theme = useTheme()
  const a = useAnswers()

  const [choice, setChoice] = useState<ProviderChoice>('gateway')
  const [gatewayUrlInput, setGatewayUrlInput] = useState('')
  const [gatewayTokenInput, setGatewayTokenInput] = useState('')
  const [googleKeyInput, setGoogleKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [gatewayStatus, setGatewayStatus] = useState<string | null>(null)
  const [googleStatus, setGoogleStatus] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [savedUrl, savedToken, savedGoogle, savedProv] = await Promise.all([
        getGatewayUrl(),
        getAppToken(),
        loadCredential('google'),
        setting('provider', 'gateway'),
      ])
      if (!alive) return
      setGatewayUrlInput(savedUrl || '')
      setGatewayTokenInput(savedToken || '')
      setGoogleKeyInput(savedGoogle?.value || '')
      if (savedProv === 'google') {
        setChoice('google')
      } else if (savedProv === 'none') {
        setChoice('none')
      } else {
        setChoice('gateway')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function testGateway() {
    if (!gatewayUrlInput.trim()) {
      Alert.alert('Missing URL', 'Please enter your Gateway URL or Host IP address.')
      return
    }
    setBusy(true)
    const h = await checkGatewayHealth(gatewayUrlInput.trim())
    setBusy(false)
    if (h.ok) {
      setGatewayStatus('Online and ready')
      Alert.alert('Connected', `Private Gateway is online with ${h.activeResources ?? 0} active provider pool resources.`)
    } else {
      setGatewayStatus('Offline / Unreachable')
      Alert.alert('Connection Failed', h.error ?? 'Could not reach Gateway at this address.')
    }
  }

  async function testGoogleKey() {
    if (!googleKeyInput.trim()) {
      Alert.alert('Missing API Key', 'Please enter your Google Gemini API key.')
      return
    }
    setBusy(true)
    const v = await validateGoogleApiKey(googleKeyInput.trim())
    setBusy(false)
    if (v.ok) {
      setGoogleStatus('Valid API Key')
      Alert.alert('Success', 'Google Gemini API key verified successfully!')
    } else {
      setGoogleStatus('Invalid key')
      Alert.alert('Verification Failed', v.error.message || 'Google API key rejected.')
    }
  }

  async function handleContinue() {
    if (choice === 'gateway') {
      await setGatewayUrl(gatewayUrlInput.trim())
      await setAppToken(gatewayTokenInput.trim())
      await setProviderMode('gateway')
      await putSetting('provider', 'gateway')
      setAnswer('provider', 'gateway' as any)
    } else if (choice === 'google') {
      if (googleKeyInput.trim()) {
        await saveCredential('google', { kind: 'api_key', value: googleKeyInput.trim() })
      }
      await setProviderMode('google')
      await putSetting('provider', 'google')
      setAnswer('provider', 'google' as any)
    } else {
      await setProviderMode('none')
      await putSetting('provider', 'none')
      setAnswer('provider', 'none' as any)
    }
    router.push(nextRoute('provider') as never)
  }

  return (
    <OnboardingScreen
      step={stepIndex('provider')}
      total={TOTAL_STEPS}
      title="AI Food & Posture Perception"
      subtitle="WorkFit AI uses AI purely as an image perception sensor. Choose how your device processes camera scans:"
      cta="Continue"
      onCta={handleContinue}
      scroll
    >
      <View style={{ gap: space.md }}>
        {/* Option 1: Private AI Gateway */}
        <OptionCard
          label="Private AI Gateway"
          sublabel="Connect to a self-hosted or cloud-hosted AI gateway instance"
          glyph="scan"
          selected={choice === 'gateway'}
          onPress={() => setChoice('gateway')}
        />

        {choice === 'gateway' ? (
          <View style={[styles.inputBox, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
            <Text style={[type.caption, { color: theme.textMuted }]}>Gateway URL / Host IP</Text>
            <TextInput
              value={gatewayUrlInput}
              onChangeText={setGatewayUrlInput}
              placeholder="e.g. https://my-gateway.onrender.com or http://192.168.1.50:3000"
              placeholderTextColor={theme.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
            />

            <Text style={[type.caption, { color: theme.textMuted, marginTop: space.md }]}>App Access Token</Text>
            <TextInput
              value={gatewayTokenInput}
              onChangeText={setGatewayTokenInput}
              placeholder="e.g. nuttoken1"
              placeholderTextColor={theme.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md }}>
              <Pressable
                onPress={testGateway}
                disabled={busy}
                style={[styles.testBtn, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <Text style={[type.label, { color: theme.text }]}>Test Connection</Text>
                )}
              </Pressable>
              {gatewayStatus ? (
                <Text style={[type.caption, { color: gatewayStatus.includes('Online') ? theme.affirm : theme.safety }]}>
                  {gatewayStatus}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Option 2: Personal Google Gemini API Key */}
        <OptionCard
          label="Personal Google Gemini Key (BYOK)"
          sublabel="Use your own Google Gemini API key — encrypted locally on-device"
          glyph="scan"
          selected={choice === 'google'}
          onPress={() => setChoice('google')}
        />

        {choice === 'google' ? (
          <View style={[styles.inputBox, { backgroundColor: theme.bgSunken, borderColor: theme.border }]}>
            <Text style={[type.caption, { color: theme.textMuted }]}>Google Gemini API Key</Text>
            <TextInput
              value={googleKeyInput}
              onChangeText={setGoogleKeyInput}
              placeholder="AIzaSy..."
              placeholderTextColor={theme.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bgElevated }]}
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md }}>
              <Pressable
                onPress={testGoogleKey}
                disabled={busy}
                style={[styles.testBtn, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <Text style={[type.label, { color: theme.text }]}>Test API Key</Text>
                )}
              </Pressable>
              {googleStatus ? (
                <Text style={[type.caption, { color: googleStatus.includes('Valid') ? theme.affirm : theme.safety }]}>
                  {googleStatus}
                </Text>
              ) : null}
            </View>

            <Pressable
              onPress={() => void Linking.openURL('https://aistudio.google.com/app/apikey')}
              style={{ marginTop: space.md }}
            >
              <Text style={[type.caption, { color: theme.protein }]}>
                Get a free API key at Google AI Studio ↗
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Option 3: Offline / Manual */}
        <OptionCard
          label="Offline / Skip for now"
          sublabel="Barcode scanner, USDA & Indian databases, and manual logging only"
          glyph="minus"
          selected={choice === 'none'}
          onPress={() => setChoice('none')}
        />
      </View>

      <View style={[styles.note, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
          WorkFit AI never uploads your meal logs or personal data to external databases. All calorie formulas, macronutrient breakdowns, and health scores are 100% calculated on-device.
        </Text>
      </View>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  inputBox: {
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: -space.xs,
  },
  input: {
    marginTop: 6,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  testBtn: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
})

