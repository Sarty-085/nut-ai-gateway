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
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Line, Path, Rect, Text as SvgText, G } from 'react-native-svg'
import { Icon } from '../src/components/Icon'
import { saveBodyScan } from '../src/data/repo'
import { runBodyScan } from '../src/inference/pathA/client'
import { useTheme } from '../src/theme/ThemeProvider'
import { radius, space, type } from '../src/theme/tokens'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

type TimerOption = 0 | 3 | 5 | 10

interface SelectedExercisePreview {
  name: string
  target_area: string
  sets_reps?: string
  duration?: string
  cue: string
  type: 'corrective' | 'mobility'
}

type ExerciseCategory = 'neck' | 'shoulders' | 'spine' | 'core' | 'hips' | 'general'

function getExerciseCategory(name: string, targetArea: string): ExerciseCategory {
  const text = `${name} ${targetArea}`.toLowerCase()
  if (text.includes('chin') || text.includes('neck') || text.includes('cervical') || text.includes('trap')) {
    return 'neck'
  }
  if (text.includes('pull') || text.includes('shoulder') || text.includes('wall angel') || text.includes('scapula') || text.includes('chest') || text.includes('pec')) {
    return 'shoulders'
  }
  if (text.includes('cat') || text.includes('spine') || text.includes('thoracic') || text.includes('thread') || text.includes('cobra') || text.includes('back')) {
    return 'spine'
  }
  if (text.includes('deadbug') || text.includes('bird') || text.includes('core') || text.includes('plank') || text.includes('bridge') || text.includes('pelvi')) {
    return 'core'
  }
  if (text.includes('hip') || text.includes('pigeon') || text.includes('lunge') || text.includes('glute') || text.includes('hamstring') || text.includes('squat')) {
    return 'hips'
  }
  return 'general'
}

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
  const [saving, setSaving] = useState(false)
  const [selectedPreview, setSelectedPreview] = useState<SelectedExercisePreview | null>(null)
  const [movementPhase, setMovementPhase] = useState<'start' | 'peak'>('peak')
  const [drillTimerActive, setDrillTimerActive] = useState(false)
  const [drillSecondsLeft, setDrillSecondsLeft] = useState(30)

  // Countdown timer effect for camera photo capture
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

  // Drill practice countdown timer
  useEffect(() => {
    let interval: any
    if (drillTimerActive && drillSecondsLeft > 0) {
      interval = setInterval(() => {
        setDrillSecondsLeft((s) => s - 1)
      }, 1000)
    } else if (drillSecondsLeft === 0) {
      setDrillTimerActive(false)
    }
    return () => clearInterval(interval)
  }, [drillTimerActive, drillSecondsLeft])

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

  const handleSaveAndFinish = async () => {
    if (!scanResult) return
    try {
      setSaving(true)
      await saveBodyScan(scanResult, photoUri)
      Alert.alert(
        '✓ Body Scan Saved',
        'Your posture report and personalized corrective exercises have been saved to your WorkFit AI profile.',
        [
          {
            text: 'View in Progress',
            onPress: () => {
              router.replace('/(tabs)/progress' as never)
            },
          },
        ],
      )
    } catch (err: any) {
      Alert.alert('Save Error', err.message || 'Could not save body scan to database.')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setPhotoUri(null)
    setScanResult(null)
    setErrorMessage(null)
    setLoading(false)
    setCountdown(null)
  }

  const openExercisePreview = (
    item: { name: string; target_area?: string; sets_reps?: string; duration?: string; cue: string },
    type: 'corrective' | 'mobility',
  ) => {
    setSelectedPreview({
      name: item.name,
      target_area: item.target_area || 'Musculoskeletal Balance',
      sets_reps: item.sets_reps,
      duration: item.duration,
      cue: item.cue,
      type,
    })
    setMovementPhase('peak')
    setDrillSecondsLeft(30)
    setDrillTimerActive(false)
  }

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: '#0B0B0F' }} />
  }

  if (!permission.granted) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: '#0B0B0F', paddingTop: insets.top }]}>
        <Icon name="person" size={48} color={theme.protein} />
        <Text style={[type.heading, { color: '#F7F7FA', textAlign: 'center', marginTop: space.md }]}>
          Camera Access Required
        </Text>
        <Text style={[type.caption, { color: '#B8B8C4', textAlign: 'center', marginTop: space.sm, marginHorizontal: space.lg }]}>
          WorkFit AI uses your camera to evaluate posture alignment, body-fat range, and muscle symmetry. Photos are processed private in-memory.
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
    <View style={[styles.container, { backgroundColor: '#0B0B0F' }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} hitSlop={12}>
          <Text style={{ color: '#F7F7FA', fontSize: 24, fontWeight: '600' }}>‹</Text>
        </Pressable>
        <Text style={[type.heading, { color: '#F7F7FA', fontSize: 18 }]}>
          WorkFit AI • Body Scan
        </Text>
        <Pressable onPress={handlePickGallery} style={styles.iconButton} hitSlop={12}>
          <Icon name="nutritionLabel" size={22} color="#F7F7FA" />
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
              <View style={styles.headMarker} />
              <View style={styles.alignmentLine}>
                <Text style={styles.alignmentText}>SHOULDERS</Text>
              </View>
              <View style={styles.torsoGuide} />
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

            <View style={styles.shutterRow}>
              <Pressable
                onPress={() => setFacing(facing === 'front' ? 'back' : 'front')}
                style={styles.controlCircle}
              >
                <Icon name="person" size={24} color="#F7F7FA" />
              </Pressable>

              <Pressable
                onPress={handleStartCapture}
                disabled={countdown !== null}
                style={styles.shutterButton}
              >
                <View style={styles.shutterInner} />
              </Pressable>

              <Pressable onPress={handlePickGallery} style={styles.controlCircle}>
                <Icon name="scan" size={24} color="#F7F7FA" />
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
        <View style={[styles.centerContainer, { backgroundColor: '#0B0B0F', paddingTop: insets.top }]}>
          {photoUri && (
            <Image source={{ uri: photoUri }} style={styles.previewThumbnail} />
          )}
          <ActivityIndicator size="large" color={theme.protein} style={{ marginTop: space.lg }} />
          <Text style={[type.heading, { color: '#F7F7FA', fontSize: 18, marginTop: space.md }]}>
            Analyzing Biomechanics...
          </Text>

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
        <View style={[styles.centerContainer, { backgroundColor: '#0B0B0F', paddingTop: insets.top, paddingHorizontal: space.lg }]}>
          <Icon name="scaleBalance" size={48} color={theme.safety} />
          <Text style={[type.heading, { color: '#F7F7FA', marginTop: space.md, textAlign: 'center' }]}>
            Scan Incomplete
          </Text>
          <Text style={[type.body, { color: '#B8B8C4', textAlign: 'center', marginTop: space.xs }]}>
            {errorMessage}
          </Text>
          <Pressable onPress={handleReset} style={[styles.primaryButton, { backgroundColor: theme.protein, marginTop: space.xl }]}>
            <Text style={[type.body, { color: '#fff', fontWeight: '700' }]}>Try Again</Text>
          </Pressable>
        </View>
      )}

      {/* Detailed Scan Results View */}
      {scanResult && (
        <ScrollView
          style={[styles.resultsScroll, { backgroundColor: '#0B0B0F' }]}
          contentContainerStyle={{ paddingBottom: insets.bottom + 60, paddingHorizontal: space.md }}
        >
          {!scanResult.is_person_visible ? (
            <View style={[styles.card, { backgroundColor: '#16161C', borderColor: '#22222B' }]}>
              <Text style={[type.heading, { color: theme.safety }]}>Scan Unclear</Text>
              <Text style={[type.body, { color: '#B8B8C4', marginTop: space.xs }]}>
                {scanResult.refusal_reason || 'Please stand with your upper body clearly in frame and try again.'}
              </Text>
              <Pressable onPress={handleReset} style={[styles.primaryButton, { backgroundColor: theme.protein, marginTop: space.md }]}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Retake Photo</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Overall Posture Score Hero */}
              {scanResult.posture_assessment && (
                <View style={[styles.heroCard, { backgroundColor: '#16161C', borderColor: '#22222B' }]}>
                  <View style={styles.scoreRow}>
                    <View>
                      <Text style={[styles.heroLabel, { color: theme.protein }]}>POSTURE INTEGRITY</Text>
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
                      <View style={[styles.statusPill, { backgroundColor: '#22222B' }]}>
                        <Text style={[styles.statusPillText, { color: theme.affirm }]}>
                          {scanResult.posture_assessment.shoulders.status === 'level' ? '✓ Shoulders Level' : '⚡ Shoulder Asymmetry'}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: '#22222B' }]}>
                        <Text style={[styles.statusPillText, { color: theme.protein }]}>
                          {scanResult.posture_assessment.head_neck.status === 'neutral' ? '✓ Head Neutral' : '⚡ Forward Head Tilt'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={[styles.divider, { backgroundColor: '#22222B' }]} />
                  <Text style={styles.cardSectionTitle}>Key Biomechanical Observations</Text>
                  {scanResult.posture_assessment.key_findings.map((f, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={[styles.bulletDot, { color: theme.protein }]}>•</Text>
                      <Text style={styles.bulletText}>{f}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Body Composition Card */}
              {scanResult.body_composition && (
                <View style={[styles.card, { backgroundColor: '#16161C', borderColor: '#22222B' }]}>
                  <Text style={styles.cardTitle}>Estimated Body Composition</Text>
                  <View style={styles.metricGrid}>
                    <View style={[styles.metricBox, { backgroundColor: '#0B0B0F', borderColor: '#22222B', borderWidth: 1 }]}>
                      <Text style={styles.metricLabel}>BODY FAT RANGE</Text>
                      <Text style={styles.metricHighlight}>
                        {scanResult.body_composition.body_fat_range.min_percent}% - {scanResult.body_composition.body_fat_range.max_percent}%
                      </Text>
                      <Text style={[styles.metricSub, { color: theme.protein }]}>{scanResult.body_composition.body_fat_range.category}</Text>
                    </View>

                    <View style={[styles.metricBox, { backgroundColor: '#0B0B0F', borderColor: '#22222B', borderWidth: 1 }]}>
                      <Text style={styles.metricLabel}>BUILD TYPE</Text>
                      <Text style={styles.metricHighlight}>
                        {scanResult.body_composition.body_type.toUpperCase()}
                      </Text>
                      <Text style={[styles.metricSub, { color: theme.affirm }]}>
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
                <View style={[styles.card, { backgroundColor: '#16161C', borderColor: '#22222B' }]}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardTitle}>Muscle Symmetry & Balance</Text>
                    <Text style={[styles.symmetryBadge, { color: theme.affirm, backgroundColor: '#1C2922' }]}>
                      {scanResult.muscle_symmetry.symmetry_score}% Balanced
                    </Text>
                  </View>

                  <View style={styles.symmetryItem}>
                    <Text style={styles.symmetryLabel}>Upper Body (Chest / Shoulders / Lats):</Text>
                    <Text style={styles.symmetryDesc}>{scanResult.muscle_symmetry.upper_body_balance}</Text>
                  </View>
                  <View style={styles.symmetryItem}>
                    <Text style={styles.symmetryLabel}>Core & Waist Stability:</Text>
                    <Text style={styles.symmetryDesc}>{scanResult.muscle_symmetry.core_midsection}</Text>
                  </View>
                  <View style={styles.symmetryItem}>
                    <Text style={styles.symmetryLabel}>Lower Stance / Quad Balance:</Text>
                    <Text style={styles.symmetryDesc}>{scanResult.muscle_symmetry.lower_body_balance}</Text>
                  </View>
                </View>
              )}

              {/* Mobility & Tightness Areas */}
              {scanResult.mobility_indicators && (
                <View style={[styles.card, { backgroundColor: '#16161C', borderColor: '#22222B' }]}>
                  <Text style={styles.cardTitle}>Identified Tightness & Mobility Needs</Text>
                  <View style={styles.tagContainer}>
                    {scanResult.mobility_indicators.tightness_areas.map((area, i) => (
                      <View key={i} style={[styles.tag, { backgroundColor: '#2E1D22', borderColor: '#4A2A33', borderWidth: 1 }]}>
                        <Text style={[styles.tagText, { color: '#F0655B' }]}>{area}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={[type.caption, { color: '#B8B8C4', marginTop: space.sm }]}>
                    {scanResult.mobility_indicators.flexibility_insights}
                  </Text>
                </View>
              )}

              {/* Personalized Digital Coach Action Plan with Interactive Previews */}
              {scanResult.action_plan && (
                <View style={[styles.card, styles.coachCard, { backgroundColor: '#16161C', borderColor: '#33291A' }]}>
                  <View style={styles.coachHeader}>
                    <Icon name="muscle" size={24} color="#F5BC63" />
                    <Text style={styles.coachTitle}>WorkFit Corrective Protocol</Text>
                  </View>
                  <Text style={styles.coachSummary}>
                    {scanResult.action_plan.trainer_summary}
                  </Text>

                  {/* Corrective Exercises List */}
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.exerciseSectionHeader}>Corrective Exercises</Text>
                    <Text style={styles.previewHint}>Tap drill for visual guide 👁️</Text>
                  </View>

                  {scanResult.action_plan.corrective_exercises.map((ex, i) => (
                    <Pressable
                      key={i}
                      onPress={() => openExercisePreview(ex, 'corrective')}
                      style={({ pressed }) => [
                        styles.exerciseCard,
                        { backgroundColor: '#0B0B0F', borderColor: '#22222B', borderWidth: 1 },
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      <View style={styles.exerciseHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Icon name="dumbbell" size={16} color={theme.protein} />
                          <Text style={styles.exerciseName}>{ex.name}</Text>
                        </View>
                        <View style={styles.setsPill}>
                          <Text style={[styles.exerciseSets, { color: theme.protein }]}>{ex.sets_reps}</Text>
                        </View>
                      </View>
                      <Text style={styles.exerciseTarget}>Target: {ex.target_area}</Text>
                      <Text style={styles.exerciseCue}>💡 {ex.cue}</Text>
                      <View style={styles.previewActionRow}>
                        <Text style={[styles.previewActionText, { color: theme.protein }]}>
                          Preview Form & Routine →
                        </Text>
                      </View>
                    </Pressable>
                  ))}

                  {/* Mobility Drills List */}
                  <View style={[styles.sectionHeaderRow, { marginTop: space.md }]}>
                    <Text style={styles.exerciseSectionHeader}>Mobility & Stretching Drills</Text>
                    <Text style={styles.previewHint}>Tap drill for visual guide 👁️</Text>
                  </View>

                  {scanResult.action_plan.mobility_drills.map((drill, i) => (
                    <Pressable
                      key={i}
                      onPress={() => openExercisePreview(drill, 'mobility')}
                      style={({ pressed }) => [
                        styles.exerciseCard,
                        { backgroundColor: '#0B0B0F', borderColor: '#22222B', borderWidth: 1 },
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      <View style={styles.exerciseHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Icon name="lotus" size={16} color={theme.affirm} />
                          <Text style={styles.exerciseName}>{drill.name}</Text>
                        </View>
                        <View style={[styles.setsPill, { backgroundColor: '#1C2922' }]}>
                          <Text style={[styles.exerciseSets, { color: theme.affirm }]}>{drill.duration}</Text>
                        </View>
                      </View>
                      <Text style={styles.exerciseCue}>💡 {drill.cue}</Text>
                      <View style={styles.previewActionRow}>
                        <Text style={[styles.previewActionText, { color: theme.affirm }]}>
                          Preview Stretch Drill →
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Retake & Save Actions */}
              <View style={styles.actionRow}>
                <Pressable onPress={handleReset} style={[styles.secondaryButton, { backgroundColor: '#16161C', borderColor: '#22222B', borderWidth: 1 }]}>
                  <Text style={styles.secondaryButtonText}>Retake</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveAndFinish}
                  disabled={saving}
                  style={[styles.primaryActionButton, { backgroundColor: theme.protein }, saving && { opacity: 0.6 }]}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.primaryActionButtonText}>Done & Save Scan</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      )}

      {/* Exercise Preview & Practice Modal */}
      <Modal
        visible={selectedPreview !== null}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedPreview(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + space.lg }]}>
            {selectedPreview && (
              <>
                {/* Modal Header */}
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.modalBadgeRow}>
                      <Text style={[styles.modalBadge, { color: selectedPreview.type === 'corrective' ? theme.protein : theme.affirm }]}>
                        {selectedPreview.type === 'corrective' ? 'CORRECTIVE DRILL' : 'MOBILITY STRETCH'}
                      </Text>
                      <Text style={styles.modalBadgeSets}>
                        {selectedPreview.sets_reps || selectedPreview.duration}
                      </Text>
                    </View>
                    <Text style={styles.modalTitle}>{selectedPreview.name}</Text>
                  </View>
                  <Pressable onPress={() => setSelectedPreview(null)} style={styles.modalCloseBtn} hitSlop={12}>
                    <Text style={{ color: '#F7F7FA', fontSize: 22, fontWeight: '700' }}>×</Text>
                  </Pressable>
                </View>

                {/* Interactive Movement Phase Switcher */}
                <View style={styles.phaseSelector}>
                  <Pressable
                    onPress={() => setMovementPhase('start')}
                    style={[styles.phaseBtn, movementPhase === 'start' && styles.phaseBtnActive]}
                  >
                    <Text style={[styles.phaseBtnText, movementPhase === 'start' && styles.phaseBtnTextActive]}>
                      1. Starting Setup
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMovementPhase('peak')}
                    style={[styles.phaseBtn, movementPhase === 'peak' && styles.phaseBtnActive]}
                  >
                    <Text style={[styles.phaseBtnText, movementPhase === 'peak' && styles.phaseBtnTextActive]}>
                      2. Peak Contraction / Stretch
                    </Text>
                  </Pressable>
                </View>

                {/* Anatomical Biomechanical Visualizer */}
                <View style={styles.diagramContainer}>
                  <ExerciseVisualizer
                    category={getExerciseCategory(selectedPreview.name, selectedPreview.target_area)}
                    phase={movementPhase}
                    theme={theme}
                  />
                </View>

                {/* Step by Step Execution Instructions */}
                <ScrollView style={styles.modalInstructionScroll} showsVerticalScrollIndicator={false}>
                  <View style={styles.instructionStep}>
                    <Text style={styles.stepNum}>1</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepHeading}>Target Biomechanics & Focus</Text>
                      <Text style={styles.stepBody}>{selectedPreview.target_area}</Text>
                    </View>
                  </View>

                  <View style={styles.instructionStep}>
                    <Text style={styles.stepNum}>2</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepHeading}>Movement Execution</Text>
                      <Text style={styles.stepBody}>{selectedPreview.cue}</Text>
                    </View>
                  </View>

                  <View style={styles.instructionStep}>
                    <Text style={styles.stepNum}>3</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepHeading}>Cadence & Tempo</Text>
                      <Text style={styles.stepBody}>
                        Perform {selectedPreview.sets_reps || selectedPreview.duration} with 2s hold at peak position. Inhale on reset, exhale on contraction.
                      </Text>
                    </View>
                  </View>
                </ScrollView>

                {/* Follow Along Practice Timer */}
                <View style={styles.timerPracticeBox}>
                  <View>
                    <Text style={styles.timerLabel}>PRACTICE TIMER</Text>
                    <Text style={styles.timerClock}>00:{String(drillSecondsLeft).padStart(2, '0')}</Text>
                  </View>
                  <Pressable
                    onPress={() => setDrillTimerActive(!drillTimerActive)}
                    style={[styles.timerButton, { backgroundColor: drillTimerActive ? theme.safety : theme.protein }]}
                  >
                    <Text style={styles.timerButtonText}>{drillTimerActive ? 'Pause' : 'Start Drill'}</Text>
                  </Pressable>
                </View>

                {/* Close Button */}
                <Pressable onPress={() => setSelectedPreview(null)} style={[styles.modalDoneBtn, { backgroundColor: '#22222B' }]}>
                  <Text style={styles.modalDoneText}>Close Preview</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  )
}

/**
 * High-fidelity Anatomical & Biomechanical SVG Visualizer for exercises.
 */
function ExerciseVisualizer({
  category,
  phase,
  theme,
}: {
  category: ExerciseCategory
  phase: 'start' | 'peak'
  theme: any
}) {
  const isPeak = phase === 'peak'
  const W = 320
  const H = 150

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Rect width={W} height={H} fill="#0B0B0F" rx={14} stroke="#22222B" strokeWidth={1} />
      <Line x1="20" y1={H / 2} x2={W - 20} y2={H / 2} stroke="#16161C" strokeWidth={1} strokeDasharray="4 4" />
      <Line x1={W / 2} y1="15" x2={W / 2} y2={H - 15} stroke="#16161C" strokeWidth={1} strokeDasharray="4 4" />

      {category === 'neck' && (
        <G>
          {/* Head & Cervical Spine Vector */}
          <Circle cx={isPeak ? 150 : 165} cy={45} r={18} fill="#16161C" stroke={theme.protein} strokeWidth={2.5} />
          {/* Torso */}
          <Line x1="150" y1="65" x2="150" y2="120" stroke="#33333F" strokeWidth={5} strokeLinecap="round" />
          {/* Cervical Alignment Arrow */}
          <Path
            d={isPeak ? "M 175 45 L 155 45" : "M 155 45 L 175 45"}
            stroke={theme.affirm}
            strokeWidth={3}
            fill="none"
            markerEnd="arrow"
          />
          <SvgText x={W / 2} y={H - 14} fill={theme.protein} fontSize="11" fontWeight="700" textAnchor="middle">
            {isPeak ? "DEEP CERVICAL RETRACTION (DOUBLE CHIN)" : "STARTING RELAXED FORWARD ALIGNMENT"}
          </SvgText>
        </G>
      )}

      {category === 'shoulders' && (
        <G>
          {/* Torso & Arms for Face Pulls / Wall Angels */}
          <Circle cx={160} cy={35} r={14} fill="#16161C" stroke={theme.protein} strokeWidth={2.5} />
          <Line x1="160" y1="50" x2="160" y2="115" stroke="#33333F" strokeWidth={5} strokeLinecap="round" />
          {/* Left & Right Arms */}
          <Line
            x1="160"
            y1="60"
            x2={isPeak ? 115 : 140}
            y2={isPeak ? 45 : 85}
            stroke={theme.protein}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <Line
            x1="160"
            y1="60"
            x2={isPeak ? 205 : 180}
            y2={isPeak ? 45 : 85}
            stroke={theme.protein}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          {/* Scapular Retraction Target Highlight */}
          <Rect x={145} y={60} width={30} height={25} rx={4} fill={theme.protein} opacity={isPeak ? 0.35 : 0.1} />
          <SvgText x={W / 2} y={H - 14} fill={theme.protein} fontSize="11" fontWeight="700" textAnchor="middle">
            {isPeak ? "PEAK SCAPULAR RETRACTION & EXTERNAL ROTATION" : "STARTING EXTENSION AT EYE LEVEL"}
          </SvgText>
        </G>
      )}

      {category === 'spine' && (
        <G>
          {/* Cat-Cow / Thoracic Arc */}
          <Circle cx={isPeak ? 110 : 110} cy={isPeak ? 50 : 70} r={12} fill="#16161C" stroke={theme.protein} strokeWidth={2.5} />
          {/* Spinal Curve */}
          <Path
            d={isPeak ? "M 115 55 Q 160 30 210 65" : "M 115 70 Q 160 95 210 65"}
            stroke={theme.protein}
            strokeWidth={4}
            fill="none"
          />
          {/* Limbs on quadruped */}
          <Line x1="125" y1="75" x2="125" y2="115" stroke="#33333F" strokeWidth={4} strokeLinecap="round" />
          <Line x1="205" y1="75" x2="205" y2="115" stroke="#33333F" strokeWidth={4} strokeLinecap="round" />
          <SvgText x={W / 2} y={H - 14} fill={theme.protein} fontSize="11" fontWeight="700" textAnchor="middle">
            {isPeak ? "THORACIC EXTENSION & CHEST EXPANSION" : "VERTEBRAL FLEXION & ABDOMINAL ENGAGEMENT"}
          </SvgText>
        </G>
      )}

      {category === 'core' && (
        <G>
          {/* Deadbug / Glute Bridge / Plank */}
          <Line x1="100" y1="85" x2="220" y2="85" stroke="#33333F" strokeWidth={5} strokeLinecap="round" />
          <Circle cx={100} cy={75} r={12} fill="#16161C" stroke={theme.protein} strokeWidth={2.5} />
          {/* Hip Extension / Core Elevation */}
          <Path
            d={isPeak ? "M 100 85 Q 160 55 210 85" : "M 100 85 L 210 85"}
            stroke={theme.affirm}
            strokeWidth={4}
            fill="none"
          />
          <SvgText x={W / 2} y={H - 14} fill={theme.affirm} fontSize="11" fontWeight="700" textAnchor="middle">
            {isPeak ? "GLUTE ACTIVATION & PELVIC NEUTRAL LOCK" : "FLAT LUMBAR BASELINE & BRACED CORE"}
          </SvgText>
        </G>
      )}

      {category === 'hips' && (
        <G>
          {/* Hip Flexor Lunge / 90-90 */}
          <Circle cx={140} cy={35} r={13} fill="#16161C" stroke={theme.protein} strokeWidth={2.5} />
          <Line x1="140" y1="48" x2="145" y2="85" stroke="#33333F" strokeWidth={4.5} strokeLinecap="round" />
          {/* Forward Lunge Leg */}
          <Line x1="145" y1="85" x2="110" y2="90" stroke={theme.protein} strokeWidth={3.5} strokeLinecap="round" />
          <Line x1="110" y1="90" x2="110" y2="120" stroke={theme.protein} strokeWidth={3.5} strokeLinecap="round" />
          {/* Rear Stretched Leg */}
          <Line x1="145" y1="85" x2={isPeak ? 195 : 175} y2={120} stroke={theme.affirm} strokeWidth={3.5} strokeLinecap="round" />
          <SvgText x={W / 2} y={H - 14} fill={theme.affirm} fontSize="11" fontWeight="700" textAnchor="middle">
            {isPeak ? "DEEP PSOAS & HIP FLEXOR ELONGATION" : "UPRIGHT PELVIC STACK & SQUARED HIPS"}
          </SvgText>
        </G>
      )}

      {category === 'general' && (
        <G>
          <Circle cx={160} cy={40} r={14} fill="#16161C" stroke={theme.protein} strokeWidth={2.5} />
          <Line x1="160" y1="54" x2="160" y2="105" stroke={theme.protein} strokeWidth={3.5} strokeLinecap="round" />
          <Line x1="125" y1="65" x2="195" y2="65" stroke={theme.protein} strokeWidth={3.5} strokeLinecap="round" />
          <Line x1="160" y1="105" x2="135" y2="130" stroke={theme.protein} strokeWidth={3} strokeLinecap="round" />
          <Line x1="160" y1="105" x2="185" y2="130" stroke={theme.protein} strokeWidth={3} strokeLinecap="round" />
          <SvgText x={W / 2} y={H - 14} fill={theme.protein} fontSize="11" fontWeight="700" textAnchor="middle">
            {isPeak ? "ACTIVE RANGE OF MOTION CONTRACTION" : "CONTROLLED STARTING STANCE"}
          </SvgText>
        </G>
      )}
    </Svg>
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
    backgroundColor: '#0B0B0F',
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
    borderColor: 'rgba(110, 155, 255, 0.4)',
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
    borderColor: 'rgba(110, 155, 255, 0.6)',
  },
  alignmentLine: {
    width: '90%',
    height: 1,
    backgroundColor: 'rgba(110, 155, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alignmentText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(110, 155, 255, 0.8)',
    letterSpacing: 1.2,
    backgroundColor: '#0B0B0F',
    paddingHorizontal: space.xs,
  },
  torsoGuide: {
    width: '60%',
    height: '35%',
    borderWidth: 1,
    borderColor: 'rgba(110, 155, 255, 0.25)',
    borderRadius: 16,
  },
  countdownOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(11, 11, 15, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownNumber: {
    fontSize: 96,
    fontWeight: '900',
    color: '#6E9BFF',
  },
  countdownSub: {
    fontSize: 16,
    color: '#F7F7FA',
    marginTop: space.sm,
  },
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(11, 11, 15, 0.85)',
    paddingTop: space.sm,
  },
  timerSelector: {
    flexDirection: 'row',
    backgroundColor: '#16161C',
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
    backgroundColor: '#6E9BFF',
  },
  timerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A8A99',
  },
  timerTextActive: {
    color: '#0B0B0F',
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
    backgroundColor: '#16161C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#6E9BFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#6E9BFF',
  },
  instructionHint: {
    fontSize: 12,
    color: '#8A8A99',
    marginTop: space.sm,
  },
  previewThumbnail: {
    width: 140,
    height: 180,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#6E9BFF',
  },
  stepsContainer: {
    marginTop: space.lg,
    width: '85%',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    opacity: 0.35,
  },
  stepRowActive: {
    opacity: 1,
  },
  stepBullet: {
    fontSize: 16,
    color: '#5C5C6B',
  },
  stepBulletActive: {
    color: '#6E9BFF',
    fontWeight: '800',
  },
  stepText: {
    fontSize: 13,
    color: '#8A8A99',
    marginLeft: space.xs,
  },
  stepTextActive: {
    color: '#F7F7FA',
    fontWeight: '600',
  },
  resultsScroll: {
    flex: 1,
  },
  heroCard: {
    borderRadius: radius.lg,
    padding: space.lg,
    marginTop: space.sm,
    borderWidth: 1,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  scoreValue: {
    fontSize: 44,
    fontWeight: '900',
    color: '#F7F7FA',
    marginTop: 2,
  },
  scoreMax: {
    fontSize: 18,
    fontWeight: '500',
    color: '#8A8A99',
  },
  scoreTier: {
    fontSize: 13,
    color: '#B8B8C4',
    marginTop: 2,
  },
  badgeContainer: {
    alignItems: 'flex-end',
    gap: 6,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    marginVertical: space.md,
  },
  cardSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A8A99',
    letterSpacing: 1,
    marginBottom: space.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 2,
  },
  bulletDot: {
    marginRight: 6,
    fontSize: 14,
  },
  bulletText: {
    fontSize: 13,
    color: '#DCDCE4',
    flex: 1,
    lineHeight: 18,
  },
  card: {
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F7F7FA',
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
    borderRadius: 12,
    padding: space.sm,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8A8A99',
    letterSpacing: 1,
  },
  metricHighlight: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F7F7FA',
    marginTop: 2,
  },
  metricSub: {
    fontSize: 11,
    marginTop: 2,
  },
  observationText: {
    fontSize: 12,
    color: '#B8B8C4',
    marginVertical: 2,
  },
  symmetryItem: {
    marginVertical: 4,
  },
  symmetryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A8A99',
  },
  symmetryDesc: {
    fontSize: 13,
    color: '#DCDCE4',
    marginTop: 1,
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  coachCard: {
    borderRadius: radius.lg,
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
    color: '#F5BC63',
  },
  coachSummary: {
    fontSize: 13,
    color: '#DCDCE4',
    lineHeight: 19,
    marginBottom: space.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  exerciseSectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A8A99',
    letterSpacing: 1,
  },
  previewHint: {
    fontSize: 11,
    color: '#8A8A99',
  },
  exerciseCard: {
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
    color: '#F7F7FA',
  },
  setsPill: {
    backgroundColor: '#16161C',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  exerciseSets: {
    fontSize: 12,
    fontWeight: '600',
  },
  exerciseTarget: {
    fontSize: 11,
    color: '#8A8A99',
    marginTop: 2,
  },
  exerciseCue: {
    fontSize: 12,
    color: '#DCDCE4',
    marginTop: 4,
  },
  previewActionRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.lg,
    marginBottom: space.xl,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F7F7FA',
  },
  primaryActionButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  primaryButton: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#16161C',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: space.lg,
    borderWidth: 1,
    borderColor: '#22222B',
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: space.xs,
  },
  modalBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalBadge: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  modalBadgeSets: {
    fontSize: 11,
    color: '#8A8A99',
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F7F7FA',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: space.xs,
  },
  phaseSelector: {
    flexDirection: 'row',
    backgroundColor: '#0B0B0F',
    borderRadius: 10,
    padding: 3,
    marginVertical: space.xs,
    borderWidth: 1,
    borderColor: '#22222B',
  },
  phaseBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 8,
  },
  phaseBtnActive: {
    backgroundColor: '#22222B',
  },
  phaseBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A8A99',
  },
  phaseBtnTextActive: {
    color: '#F7F7FA',
    fontWeight: '700',
  },
  diagramContainer: {
    marginVertical: space.xs,
  },
  modalInstructionScroll: {
    maxHeight: 140,
    marginVertical: space.xs,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 4,
    gap: space.sm,
  },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#22222B',
    color: '#6E9BFF',
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 20,
  },
  stepHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F7F7FA',
  },
  stepBody: {
    fontSize: 12,
    color: '#B8B8C4',
    marginTop: 1,
    lineHeight: 16,
  },
  timerPracticeBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0B0B0F',
    borderRadius: 12,
    padding: space.md,
    marginTop: space.xs,
    borderWidth: 1,
    borderColor: '#22222B',
  },
  timerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8A8A99',
    letterSpacing: 1,
  },
  timerClock: {
    fontSize: 24,
    fontWeight: '900',
    color: '#F7F7FA',
    marginTop: 2,
  },
  timerButton: {
    paddingHorizontal: space.lg,
    paddingVertical: 8,
    borderRadius: 8,
  },
  timerButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  modalDoneBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: space.sm,
  },
  modalDoneText: {
    color: '#F7F7FA',
    fontWeight: '700',
    fontSize: 14,
  },
})
