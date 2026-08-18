import { ANTHROPIC_OAUTH_BETA } from './providers.js'
import type { ProviderId, ProviderRequest } from './providers.js'

export const BODY_SCAN_PROMPT_VERSION = 'body-scan-v1.0.0'

export const BODY_SCAN_SYSTEM_PROMPT = `You are a certified professional biomechanics specialist, clinical posture analyst, and athletic conditioning coach.
Analyze the person's posture alignment, body composition range, muscle symmetry, and mobility from the provided full-body or upper-body photo.

Assessment Criteria:
1. is_person_visible: true if a human body/torso is visible; false if the photo shows an inanimate object, background, or obscured image.
2. refusal_reason: null if valid photo; polite explanation if not a person (e.g. "Please stand in front of the camera with your body clearly visible").
3. body_composition:
   - body_fat_range: Estimate realistic min_percent and max_percent (e.g. 13-16% athletic, 18-22% moderate). category: 'Athletic'|'Fitness'|'Average'|'Higher Fat'. confidence (0.0 to 1.0).
   - body_type: 'lean'|'athletic'|'muscular'|'average'|'higher_body_fat'|'undetermined'
   - muscularity_rating: 1-10 visual development score.
   - observations: 2-4 visual conditioning insights.
4. posture_assessment:
   - overall_score: 0-100 overall postural integrity score.
   - head_neck: status ('neutral'|'forward_head_mild'|'forward_head_moderate'|'tilted_left'|'tilted_right'), notes.
   - shoulders: status ('level'|'left_elevated'|'right_elevated'), rounded_shoulders ('none'|'mild'|'moderate'|'pronounced'), notes.
   - spine_pelvis: pelvic_tilt ('neutral'|'anterior'|'posterior'|'undetermined'), lateral_shift ('none'|'left'|'right'), notes.
   - key_findings: 2-4 key alignment observations.
5. muscle_symmetry:
   - symmetry_score: 0-100 score.
   - upper_body_balance: notes on left vs right shoulder/chest/arm balance.
   - core_midsection: notes on waistline and abdominal engagement.
   - lower_body_balance: notes on stance and hip/quad balance.
   - notable_strengths: 1-3 strong muscle groups.
   - imbalance_areas: 1-3 areas needing balance or focus.
6. mobility_indicators:
   - tightness_areas: specific muscle groups likely tight (e.g. "Upper Trapezius", "Pectoralis Minor", "Hip Flexors / Psoas").
   - flexibility_insights: practical mobility assessment summary.
7. action_plan:
   - corrective_exercises: 2-3 specific exercises ({ "name", "sets_reps", "target_area", "cue" }).
   - mobility_drills: 2 specific stretches/drills ({ "name", "duration", "cue" }).
   - trainer_summary: concise, encouraging, personalized coaching paragraph.

Output pure JSON matching the BodyScanPayload schema.`

export const BODY_SCAN_USER_INSTRUCTION =
  'Analyze this photo for posture alignment, body-fat range, muscle balance, and corrective training protocol. Respond ONLY with the JSON object.'

export interface BodyScanInput {
  model: string
  imageBase64: string
  localSignalsBlock?: string | undefined
}

export function buildBodyScanRequest(
  provider: ProviderId,
  input: BodyScanInput,
  credential: { kind: 'api_key' | 'oauth'; value: string },
): ProviderRequest {
  const userText = input.localSignalsBlock
    ? `${input.localSignalsBlock}\n\n${BODY_SCAN_USER_INSTRUCTION}`
    : BODY_SCAN_USER_INSTRUCTION

  if (provider === 'anthropic') {
    const headers: Record<string, string> =
      credential.kind === 'api_key'
        ? { 'x-api-key': credential.value, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
        : {
            authorization: `Bearer ${credential.value}`,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': ANTHROPIC_OAUTH_BETA,
            'content-type': 'application/json',
          }
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers,
      body: {
        model: input.model,
        max_tokens: 2048,
        system: BODY_SCAN_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.imageBase64 } },
              { type: 'text', text: userText },
            ],
          },
        ],
      },
      promptVersion: BODY_SCAN_PROMPT_VERSION,
    }
  }

  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        authorization: `Bearer ${credential.value}`,
        'content-type': 'application/json',
      },
      body: {
        model: input.model,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: BODY_SCAN_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${input.imageBase64}` },
              },
            ],
          },
        ],
      },
      promptVersion: BODY_SCAN_PROMPT_VERSION,
    }
  }

  // Google Gemini
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${credential.value}`,
    headers: { 'content-type': 'application/json' },
    body: {
      systemInstruction: { parts: [{ text: BODY_SCAN_SYSTEM_PROMPT }] },
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: input.imageBase64 } },
            { text: userText },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    },
    promptVersion: BODY_SCAN_PROMPT_VERSION,
  }
}
