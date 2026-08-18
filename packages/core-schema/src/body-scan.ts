import { z } from 'zod'

/**
 * Biomechanical Body & Posture Scan Payload Schema.
 *
 * Defines structured output for full-body and upper-body posture,
 * body composition range, muscle balance, and mobility assessment.
 */
export const BodyCompositionZ = z.object({
  body_fat_range: z.object({
    min_percent: z.number().min(3).max(65),
    max_percent: z.number().min(3).max(65),
    category: z.string().min(1).max(50),
    confidence: z.number().min(0).max(1),
  }),
  body_type: z.enum(['lean', 'athletic', 'muscular', 'average', 'higher_body_fat', 'undetermined']),
  muscularity_rating: z.number().min(1).max(10), // 1-10 visual muscular development
  observations: z.array(z.string()).max(6),
})

export const PostureAssessmentZ = z.object({
  overall_score: z.number().min(0).max(100),
  head_neck: z.object({
    status: z.enum(['neutral', 'forward_head_mild', 'forward_head_moderate', 'tilted_left', 'tilted_right']),
    notes: z.string().max(200),
  }),
  shoulders: z.object({
    status: z.enum(['level', 'left_elevated', 'right_elevated']),
    rounded_shoulders: z.enum(['none', 'mild', 'moderate', 'pronounced']),
    notes: z.string().max(200),
  }),
  spine_pelvis: z.object({
    pelvic_tilt: z.enum(['neutral', 'anterior', 'posterior', 'undetermined']),
    lateral_shift: z.enum(['none', 'left', 'right']),
    notes: z.string().max(200),
  }),
  key_findings: z.array(z.string()).max(6),
})

export const MuscleSymmetryZ = z.object({
  symmetry_score: z.number().min(0).max(100),
  upper_body_balance: z.string().max(200),
  core_midsection: z.string().max(200),
  lower_body_balance: z.string().max(200),
  notable_strengths: z.array(z.string()).max(6),
  imbalance_areas: z.array(z.string()).max(6),
})

export const MobilityIndicatorsZ = z.object({
  tightness_areas: z.array(z.string()).max(6),
  flexibility_insights: z.string().max(300),
})

export const CorrectiveExerciseZ = z.object({
  name: z.string().min(1).max(80),
  sets_reps: z.string().min(1).max(40),
  target_area: z.string().min(1).max(60),
  cue: z.string().min(1).max(250),
})

export const MobilityDrillZ = z.object({
  name: z.string().min(1).max(80),
  duration: z.string().min(1).max(40),
  cue: z.string().min(1).max(250),
})

export const ActionPlanZ = z.object({
  corrective_exercises: z.array(CorrectiveExerciseZ).max(5),
  mobility_drills: z.array(MobilityDrillZ).max(5),
  trainer_summary: z.string().min(1).max(500),
})

export const BodyScanPayloadZ = z.object({
  schema_version: z.literal('1.0.0').default('1.0.0'),
  is_person_visible: z.boolean(),
  refusal_reason: z.string().nullable().default(null),
  body_composition: BodyCompositionZ.nullable().default(null),
  posture_assessment: PostureAssessmentZ.nullable().default(null),
  muscle_symmetry: MuscleSymmetryZ.nullable().default(null),
  mobility_indicators: MobilityIndicatorsZ.nullable().default(null),
  action_plan: ActionPlanZ.nullable().default(null),
})

export type BodyComposition = z.infer<typeof BodyCompositionZ>
export type PostureAssessment = z.infer<typeof PostureAssessmentZ>
export type MuscleSymmetry = z.infer<typeof MuscleSymmetryZ>
export type MobilityIndicators = z.infer<typeof MobilityIndicatorsZ>
export type CorrectiveExercise = z.infer<typeof CorrectiveExerciseZ>
export type MobilityDrill = z.infer<typeof MobilityDrillZ>
export type ActionPlan = z.infer<typeof ActionPlanZ>
export type BodyScanPayload = z.infer<typeof BodyScanPayloadZ>
