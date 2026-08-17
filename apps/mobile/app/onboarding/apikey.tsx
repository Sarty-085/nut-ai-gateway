import { router } from 'expo-router'
import { useEffect } from 'react'
import { View } from 'react-native'
import { nextRoute } from '../../src/onboarding/flow'

/**
 * Legacy API Key step redirect.
 * In the private AI gateway architecture, user API keys are not required.
 */
export default function ApiKeyScreen() {
  useEffect(() => {
    router.replace(nextRoute('provider') as never)
  }, [])

  return <View style={{ flex: 1 }} />
}
