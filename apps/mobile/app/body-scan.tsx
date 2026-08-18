import { BodyScanPayload, BodyScanPayloadZ } from '@nutai/core-schema'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../src/components/Icon'
import { runBodyScan } from '../src/inference/pathA/client'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

type TimerOption = 0 | 3 | 5 | 10

export default function BodyScanScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)

  const [facing, setFacing] = useState<'front' | 'back'>('front')
  const [timerSeconds, setTimerSeconds] = useState<TimerOption>(5)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [scanResult, setScanResult] = useState<BodyScanPayload | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [analysisStep, setAnalysisStep] = useState(0)

  // Countdown timer effect
  useEffect(() => {
    if (countdown === null) return
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(t)
    }
    if (countdown === 0) {
      setCountdown(null)
      void executeCapture()
    }
  }, [countdown])

  const handleStartCapture = () => {
    if (timerSeconds === 0) {
      void executeCapture()
    } else {
      setCountdown(timerSeconds)
    }
  }

  const executeCapture = async () => {
    if (!cameraRef.current) return
    try {
      setLoading(true)
      setErrorMessage(null)
      setAnalysisStep(1)

      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.85,
        skipProcessing: true,
      })

      if (!photo?.base64) {
        throw new Error('Camera capture failed to produce image data')
      }

      setPhotoUri(photo.uri)
      await performAnalysis(photo.base64)
    } catch (err: any) {
      setLoading(false)
      setErrorMessage(err.message || 'Failed to capture photo')
    }
  }

  const handlePickGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.85,
      })

      if (res.canceled || !res.assets || !res.assets[0]?.base64) return

      const asset = res.assets[0]
      const base64Data = asset.base64
      if (!base64Data) return

      setPhotoUri(asset.uri)
      setLoading(true)
      setErrorMessage(null)
      setAnalysisStep(1)
      await performAnalysis(base64Data)
    } catch (err: any) {
      Alert.alert('Gallery Error', err.message || 'Could not load image')
    }
  }

  const performAnalysis = async (base64: string) => {
    try {
      // Animated analysis stages
      setAnalysisStep(1)
      const stepTimer1 = setTimeout(() => setAnalysisStep(2), 1200)
      const stepTimer2 = setTimeout(() => setAnalysisStep(3), 2600)
      const stepTimer3 = setTimeout(() => setAnalysisStep(4), 4000)

      const outcome = await runBodyScan({
        imageBase64: base64,
        localSignalsBlock: 'Front or side stance body scan for posture, body-fat range, and symmetry',
      })

      clearTimeout(stepTimer1)
      clearTimeout(stepTimer2)
      clearTimeout(stepTimer3)

      if (!outcome.ok || !outcome.raw) {
        throw new Error(outcome.error?.message || 'Gateway analysis failed. Ensure gateway is online.')
      }

      const parsed = BodyScanPayloadZ.safeParse(outcome.raw)
      if (!parsed.success) {
        throw new Error('Invalid response structure from scan engine')
      }

      setScanResult(parsed.data)
      setLoading(false)
    } catch (err: any) {
      setLoading(false)
      setErrorMessage(err.message || 'Analysis could not be completed')
    }
  }

  const handleReset = () => {
    setPhotoUri(null)
    setScanResult(null)
    setErrorMessage(null)
    setLoading(false)
    setCountdown(null)
  }

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: '#000' }} />
  }

  if (!permission.granted) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <Icon name="person" size={48} color={theme.protein} />
        <Text style={[type.heading, { color: theme.text, textAlign: 'center', marginTop: space.md }]}>
          Camera Access Required
        </Text>
        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center', marginTop: space.sm, marginHorizontal: space.lg }]}>
          Nut AI uses the camera to evaluate posture alignment, body-fat range, and muscle symmetry. Photos are processed private in-memory.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={[styles.primaryButton, { backgroundColor: theme.protein, marginTop: space.xl }]}
        >
          <Text style={[type.body, { color: '#fff', fontWeight: '700' }]}>Enable Camera</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={[styles.container, { backgroundColor: '#05070a' }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} hitSlop={12}>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '600' }}>‹</Text>
        </Pressable>
        <Text style={[type.heading, { color: '#fff', fontSize: 18 }]}>
          AI Body & Posture Scan
        </Text>
        <Pressable onPress={handlePickGallery} style={styles.iconButton} hitSlop={12}>
          <Icon name="nutritionLabel" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Main Content Area */}
      {!scanResult && !loading && (
        <View style={styles.cameraWrapper}>
          <CameraView
            ref={cameraRef}
            facing={facing}
            style={StyleSheet.absoluteFill}
          />

          {/* Biomechanical Silhouette Overlay */}
          <View style={styles.silhouetteOverlay} pointerEvents="none">
            <View style={styles.silhouetteFrame}>
              {/* Head Landmark */}
              <View style={styles.headMarker} />
              {/* Shoulder Alignment Line */}
              <View style={styles.alignmentLine}>
                <Text style={styles.alignmentText}>SHOULDERS</Text>
              </View>
              {/* Torso / Core Area */}
              <View style={styles.torsoGuide} />
              {/* Hip / Pelvis Alignment Line */}
              <View style={styles.alignmentLine}>
                <Text style={styles.alignmentText}>PELVIS & HIPS</Text>
              </View>
            </View>
          </View>

          {/* Countdown Indicator */}
          {countdown !== null && (
            <View style={styles.countdownOverlay}>
              <Text style={styles.countdownNumber}>{countdown}</Text>
              <Text style={styles.countdownSub}>Get into position...</Text>
            </View>
          )}

          {/* Camera Controls */}
          <View style={[styles.bottomControls, { paddingBottom: insets.bottom + space.md }]}>
            {/* Timer Options Selector */}
            <View style={styles.timerSelector}>
              {([0, 3, 5, 10] as TimerOption[]).map((sec) => (
                <Pressable
                  key={sec}
                  onPress={() => setTimerSeconds(sec)}
                  style={[
                    styles.timerPill,
                    timerSeconds === sec && styles.timerPillActive,
                  ]}
                >
                  <Text style={[styles.timerText, timerSeconds === sec && styles.timerTextActive]}>
                    {sec === 0 ? 'Instant' : `${sec}s`}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Shutter Bar */}
            <View style={styles.shutterRow}>
              <Pressable
                onPress={() => setFacing(facing === 'front' ? 'back' : 'front')}
                style={styles.controlCircle}
              >
                <Icon name="person" size={24} color="#fff" />
              </Pressable>

              <Pressable
                onPress={handleStartCapture}
                disabled={countdown !== null}
                style={styles.shutterButton}
              >
                <View style={styles.shutterInner} />
              </Pressable>

              <Pressable onPress={handlePickGallery} style={styles.controlCircle}>
                <Icon name="scan" size={24} color="#fff" />
              </Pressable>
            </View>

            <Text style={styles.instructionHint}>
              Stand 5-7 ft away with full torso and shoulders visible
            </Text>
          </View>
        </View>
      )}

      {/* Loading / Analyzing State */}
      {loading && (
        <View style={[styles.centerContainer, { paddingTop: insets.top }]}>
          {photoUri && (
            <Image source={{ uri: photoUri }} style={styles.previewThumbnail} />
          )}
          <ActivityIndicator size="large" color="#38bdf8" style={{ marginTop: space.lg }} />
          <Text style={[type.heading, { color: '#fff', fontSize: 18, marginTop: space.md }]}>
            Analyzing Biomechanics...
          </Text>

          {/* Progress Step Highlights */}
          <View style={styles.stepsContainer}>
            <View style={[styles.stepRow, analysisStep >= 1 && styles.stepRowActive]}>
              <Text style={[styles.stepBullet, analysisStep >= 1 && styles.stepBulletActive]}>›</Text>
              <Text style={[styles.stepText, analysisStep >= 1 && styles.stepTextActive]}>
                Mapping skeletal landmarks & posture angles
              </Text>
            </View>
            <View style={[styles.stepRow, analysisStep >= 2 && styles.stepRowActive]}>
              <Text style={[styles.stepBullet, analysisStep >= 2 && styles.stepBulletActive]}>›</Text>
              <Text style={[styles.stepText, analysisStep >= 2 && styles.stepTextActive]}>
                Estimating body composition & symmetry
              </Text>
            </View>
            <View style={[styles.stepRow, analysisStep >= 3 && styles.stepRowActive]}>
              <Text style={[styles.stepBullet, analysisStep >= 3 && styles.stepBulletActive]}>›</Text>
              <Text style={[styles.stepText, analysisStep >= 3 && styles.stepTextActive]}>
                Synthesizing personalized corrective protocol
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Error View */}
      {errorMessage && (
        <View style={[styles.centerContainer, { paddingTop: insets.top, paddingHorizontal: space.lg }]}>
          <Icon name="scaleBalance" size={48} color="#ef4444" />
          <Text style={[type.heading, { color: '#fff', marginTop: space.md, textAlign: 'center' }]}>
            Scan Incomplete
          </Text>
          <Text style={[type.body, { color: '#94a3b8', textAlign: 'center', marginTop: space.xs }]}>
            {errorMessage}
          </Text>
          <Pressable onPress={handleReset} style={[styles.primaryButton, { backgroundColor: '#38bdf8', marginTop: space.xl }]}>
            <Text style={[type.body, { color: '#000', fontWeight: '700' }]}>Try Again</Text>
          </Pressable>
        </View>
      )}

      {/* Detailed Scan Results View */}
      {scanResult && (
        <ScrollView
          style={styles.resultsScroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.md }}
        >
          {/* Refusal Notice if person not recognized */}
          {!scanResult.is_person_visible ? (
            <View style={styles.card}>
              <Text style={[type.heading, { color: '#ef4444' }]}>Scan Unclear</Text>
              <Text style={[type.body, { color: '#cbd5e1', marginTop: space.xs }]}>
                {scanResult.refusal_reason || 'Please stand with your upper body clearly in frame and try again.'}
              </Text>
              <Pressable onPress={handleReset} style={[styles.primaryButton, { backgroundColor: '#38bdf8', marginTop: space.md }]}>
                <Text style={{ color: '#000', fontWeight: '700' }}>Retake Photo</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Overall Posture Score Hero */}
              {scanResult.posture_assessment && (
                <View style={styles.heroCard}>
                  <View style={styles.scoreRow}>
                    <View>
                      <Text style={styles.heroLabel}>POSTURE INTEGRITY</Text>
                      <Text style={styles.scoreValue}>
                        {scanResult.posture_assessment.overall_score}
                        <Text style={styles.scoreMax}> /100</Text>
                      </Text>
                      <Text style={styles.scoreTier}>
                        {scanResult.posture_assessment.overall_score >= 85
                          ? 'Optimal Alignment'
                          : scanResult.posture_assessment.overall_score >= 70
                          ? 'Good (Mild Imbalances)'
                          : 'Needs Corrective Focus'}
                      </Text>
                    </View>

                    <View style={styles.badgeContainer}>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>
                          {scanResult.posture_assessment.shoulders.status === 'level' ? '✓ Shoulders Level' : '⚡ Asymmetry'}
                        </Text>
                      </View>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>
                          {scanResult.posture_assessment.head_neck.status === 'neutral' ? '✓ Head Neutral' : '⚡ Forward Tilt'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Key Posture Findings */}
                  <View style={styles.divider} />
                  <Text style={styles.cardSectionTitle}>Key Findings</Text>
                  {scanResult.posture_assessment.key_findings.map((f, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{f}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Body Composition Card */}
              {scanResult.body_composition && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Estimated Body Composition</Text>
                  <View style={styles.metricGrid}>
                    <View style={styles.metricBox}>
                      <Text style={styles.metricLabel}>BODY FAT RANGE</Text>
                      <Text style={styles.metricHighlight}>
                        {scanResult.body_composition.body_fat_range.min_percent}% - {scanResult.body_composition.body_fat_range.max_percent}%
                      </Text>
                      <Text style={styles.metricSub}>{scanResult.body_composition.body_fat_range.category}</Text>
                    </View>

                    <View style={styles.metricBox}>
                      <Text style={styles.metricLabel}>BUILD TYPE</Text>
                      <Text style={styles.metricHighlight}>
                        {scanResult.body_composition.body_type.toUpperCase()}
                      </Text>
                      <Text style={styles.metricSub}>
                        Muscularity: {scanResult.body_composition.muscularity_rating}/10
                      </Text>
                    </View>
                  </View>

                  {scanResult.body_composition.observations.map((obs, idx) => (
                    <Text key={idx} style={styles.observationText}>
                      • {obs}
                    </Text>
                  ))}
                </View>
              )}

              {/* Muscle Symmetry Card */}
              {scanResult.muscle_symmetry && (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardTitle}>Muscle Symmetry & Balance</Text>
                    <Text style={styles.symmetryBadge}>
                      {scanResult.muscle_symmetry.symmetry_score}% Balanced
                    </Text>
                  </View>

                  <View style={styles.symmetryItem}>
                    <Text style={styles.symmetryLabel}>Upper Body:</Text>
                    <Text style={styles.symmetryDesc}>{scanResult.muscle_symmetry.upper_body_balance}</Text>
                  </View>
                  <View style={styles.symmetryItem}>
                    <Text style={styles.symmetryLabel}>Core & Waist:</Text>
                    <Text style={styles.symmetryDesc}>{scanResult.muscle_symmetry.core_midsection}</Text>
                  </View>
                  <View style={styles.symmetryItem}>
                    <Text style={styles.symmetryLabel}>Lower Body / Stance:</Text>
                    <Text style={styles.symmetryDesc}>{scanResult.muscle_symmetry.lower_body_balance}</Text>
                  </View>
                </View>
              )}

              {/* Mobility & Tightness Areas */}
              {scanResult.mobility_indicators && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Identified Tightness & Mobility</Text>
                  <View style={styles.tagContainer}>
                    {scanResult.mobility_indicators.tightness_areas.map((area, i) => (
                      <View key={i} style={styles.tag}>
                        <Text style={styles.tagText}>{area}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={[type.caption, { color: '#94a3b8', marginTop: space.sm }]}>
                    {scanResult.mobility_indicators.flexibility_insights}
                  </Text>
                </View>
              )}

              {/* Personalized Digital Coach Action Plan */}
              {scanResult.action_plan && (
                <View style={[styles.card, styles.coachCard]}>
                  <View style={styles.coachHeader}>
                    <Icon name="muscle" size={24} color="#f59e0b" />
                    <Text style={styles.coachTitle}>Personalized Corrective Protocol</Text>
                  </View>
                  <Text style={styles.coachSummary}>
                    {scanResult.action_plan.trainer_summary}
                  </Text>

                  <Text style={styles.exerciseSectionHeader}>Corrective Exercises</Text>
                  {scanResult.action_plan.corrective_exercises.map((ex, i) => (
                    <View key={i} style={styles.exerciseCard}>
                      <View style={styles.exerciseHeader}>
                        <Text style={styles.exerciseName}>{ex.name}</Text>
                        <Text style={styles.exerciseSets}>{ex.sets_reps}</Text>
                      </View>
                      <Text style={styles.exerciseTarget}>Target: {ex.target_area}</Text>
                      <Text style={styles.exerciseCue}>💡 Cue: {ex.cue}</Text>
                    </View>
                  ))}

                  <Text style={[styles.exerciseSectionHeader, { marginTop: space.md }]}>Mobility Drills</Text>
                  {scanResult.action_plan.mobility_drills.map((drill, i) => (
                    <View key={i} style={styles.exerciseCard}>
                      <View style={styles.exerciseHeader}>
                        <Text style={styles.exerciseName}>{drill.name}</Text>
                        <Text style={styles.exerciseSets}>{drill.duration}</Text>
                      </View>
                      <Text style={styles.exerciseCue}>💡 Cue: {drill.cue}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Retake & Save Actions */}
              <View style={styles.actionRow}>
                <Pressable onPress={handleReset} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Retake</Text>
                </Pressable>
                <Pressable onPress={() => router.back()} style={styles.primaryActionButton}>
                  <Text style={styles.primaryActionButtonText}>Done & Save</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: '#05070a',
    zIndex: 10,
  },
  iconButton: {
    padding: space.xs,
  },
  cameraWrapper: {
    flex: 1,
    position: 'relative',
  },
  silhouetteOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  silhouetteFrame: {
    width: SCREEN_WIDTH * 0.78,
    height: '74%',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    borderRadius: 32,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
  },
  headMarker: {
    width: 68,
    height: 84,
    borderRadius: 42,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.6)',
  },
  alignmentLine: {
    width: '90%',
    height: 1,
    backgroundColor: 'rgba(56, 189, 248, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alignmentText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(56, 189, 248, 0.7)',
    letterSpacing: 1.2,
    backgroundColor: '#05070a',
    paddingHorizontal: space.xs,
  },
  torsoGuide: {
    width: '60%',
    height: '35%',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderRadius: 16,
  },
  countdownOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownNumber: {
    fontSize: 96,
    fontWeight: '900',
    color: '#38bdf8',
  },
  countdownSub: {
    fontSize: 16,
    color: '#cbd5e1',
    marginTop: space.sm,
  },
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(5, 7, 10, 0.75)',
    paddingTop: space.sm,
  },
  timerSelector: {
    flexDirection: 'row',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 20,
    padding: 3,
    marginBottom: space.md,
  },
  timerPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  timerPillActive: {
    backgroundColor: '#38bdf8',
  },
  timerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  timerTextActive: {
    color: '#000',
    fontWeight: '700',
  },
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: space.xl,
  },
  controlCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#38bdf8',
  },
  instructionHint: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: space.sm,
  },
  previewThumbnail: {
    width: 140,
    height: 180,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#38bdf8',
  },
  stepsContainer: {
    marginTop: space.lg,
    width: '85%',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    opacity: 0.4,
  },
  stepRowActive: {
    opacity: 1,
  },
  stepBullet: {
    fontSize: 16,
    color: '#475569',
  },
  stepBulletActive: {
    color: '#38bdf8',
    fontWeight: '800',
  },
  stepText: {
    fontSize: 13,
    color: '#94a3b8',
    marginLeft: space.xs,
  },
  stepTextActive: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  resultsScroll: {
    flex: 1,
  },
  heroCard: {
    backgroundColor: '#0f172a',
    borderRadius: radius.lg,
    padding: space.lg,
    marginTop: space.sm,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38bdf8',
    letterSpacing: 1.2,
  },
  scoreValue: {
    fontSize: 42,
    fontWeight: '900',
    color: '#fff',
    marginTop: 2,
  },
  scoreMax: {
    fontSize: 18,
    fontWeight: '500',
    color: '#64748b',
  },
  scoreTier: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  badgeContainer: {
    alignItems: 'flex-end',
    gap: 6,
  },
  statusPill: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#38bdf8',
  },
  divider: {
    height: 1,
    backgroundColor: '#1e293b',
    marginVertical: space.md,
  },
  cardSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 1,
    marginBottom: space.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 2,
  },
  bulletDot: {
    color: '#38bdf8',
    marginRight: 6,
    fontSize: 14,
  },
  bulletText: {
    fontSize: 13,
    color: '#cbd5e1',
    flex: 1,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    marginBottom: space.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  symmetryBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.sm,
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: space.sm,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
  },
  metricHighlight: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginTop: 2,
  },
  metricSub: {
    fontSize: 11,
    color: '#38bdf8',
    marginTop: 2,
  },
  observationText: {
    fontSize: 12,
    color: '#94a3b8',
    marginVertical: 2,
  },
  symmetryItem: {
    marginVertical: 4,
  },
  symmetryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  symmetryDesc: {
    fontSize: 13,
    color: '#cbd5e1',
    marginTop: 1,
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f87171',
  },
  coachCard: {
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: '#131b2e',
  },
  coachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginBottom: space.xs,
  },
  coachTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#f59e0b',
  },
  coachSummary: {
    fontSize: 13,
    color: '#cbd5e1',
    lineHeight: 19,
    marginBottom: space.md,
  },
  exerciseSectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: space.xs,
  },
  exerciseCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: space.sm,
    marginVertical: 4,
  },
  exerciseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exerciseName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  exerciseSets: {
    fontSize: 12,
    fontWeight: '600',
    color: '#38bdf8',
  },
  exerciseTarget: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  exerciseCue: {
    fontSize: 12,
    color: '#e2e8f0',
    marginTop: 4,
  },
  actionRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.lg,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  primaryActionButton: {
    flex: 2,
    backgroundColor: '#38bdf8',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryActionButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#000',
  },
  primaryButton: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: 12,
  },
})
