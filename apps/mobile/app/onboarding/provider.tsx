import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { OnboardingScreen } from '../../src/components/onboarding/Chrome'
import { OptionCard } from '../../src/components/onboarding/Controls'
import { putSetting } from '../../src/data/repo'
import { checkGatewayHealth } from '../../src/inference/gateway-config'
import { nextRoute, stepIndex, TOTAL_STEPS } from '../../src/onboarding/flow'
import { setAnswer, useAnswers } from '../../src/onboarding/store'
import { useTheme } from '../../src/theme/ThemeProvider'
import { radius, space, type } from '../../src/theme/tokens'

/**
 * AI Perception Service onboarding.
 *
 * In the private multi-provider architecture, users do NOT enter individual
 * Anthropic/Google/OpenAI keys. The app connects to the private AI gateway
 * with multi-credential provider pooling.
 */
export default function ProviderScreen() {
  const theme = useTheme()
  const a = useAnswers()
  const [gatewayStatus, setGatewayStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    let alive = true
    void (async () => {
      const health = await checkGatewayHealth()
      if (!alive) return
      setGatewayStatus(health.ok ? 'online' : 'offline')
      if (a.provider === undefined) {
        setAnswer('provider', 'cloud')
      }
    })()
    return () => {
      alive = false
    }
  }, [a.provider])

  return (
    <OnboardingScreen
      step={stepIndex('provider')}
      total={TOTAL_STEPS}
      title="AI Food Perception"
      subtitle="Nut AI connects to a private AI gateway for instant meal, barcode, and label recognition. No vendor accounts or API keys required."
      cta="Continue"
      onCta={() => {
        const choice = a.provider ?? 'cloud'
        void putSetting('provider', choice)
        router.push(nextRoute('provider') as never)
      }}
      scroll
    >
      <View>
        <OptionCard
          label="Private AI Gateway (Included)"
          sublabel={
            gatewayStatus === 'online'
              ? 'Multi-provider pool active · Google, Anthropic & OpenAI'
              : gatewayStatus === 'checking'
                ? 'Connecting to private gateway…'
                : 'Offline · Will connect automatically when online'
          }
          glyph="scan"
          selected={a.provider !== 'none'}
          onPress={() => setAnswer('provider', 'cloud')}
        />

        <OptionCard
          label="Offline / Manual only"
          sublabel="Barcode scanning, USDA corpus search, and manual logging only"
          glyph="minus"
          selected={a.provider === 'none'}
          onPress={() => setAnswer('provider', 'none')}
        />
      </View>

      <View style={[styles.note, { backgroundColor: theme.bgSunken }]}>
        <Text style={[type.caption, { color: theme.textMuted, lineHeight: 19 }]}>
          Nut AI uses AI strictly for image and text perception. All calorie math, macro breakdowns,
          confidence calculations, and database matches are 100% deterministic and verified on-device.
        </Text>
      </View>
    </OnboardingScreen>
  )
}

const styles = StyleSheet.create({
  note: { marginTop: space.lg, padding: space.lg, borderRadius: radius.lg },
})
