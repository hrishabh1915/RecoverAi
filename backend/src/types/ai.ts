import { z } from 'zod';

// AIDiagnosis mirrors FailureReason exactly — the AI diagnoses within the
// same taxonomy the policy engine understands, not an invented parallel one.
export type AIDiagnosis =
  | 'NETWORK_ERROR'
  | 'BANK_DECLINED_GENERIC'
  | 'INSUFFICIENT_FUNDS'
  | 'EXPIRED_CARD'
  | 'AUTH_FAILURE'
  | 'FRAUD_SUSPECTED'
  | 'UNKNOWN';

export const AIDiagnosisEnum = z.enum([
  'NETWORK_ERROR',
  'BANK_DECLINED_GENERIC',
  'INSUFFICIENT_FUNDS',
  'EXPIRED_CARD',
  'AUTH_FAILURE',
  'FRAUD_SUSPECTED',
  'UNKNOWN',
]);

// AIResponse is defined as a Zod schema first, then derived via z.infer.
// .strict() rejects unknown keys — this enforces that AIResponse must NOT
// contain amount, retryCount, customerId, transactionId, paymentStatus, any
// policy decision field, or any execution authorization field. This is a
// schema-enforced guarantee, not just documentation.
export const AIResponseSchema = z
  .object({
    diagnosis: AIDiagnosisEnum,
    confidence: z.number().min(0).max(1),
    recommendedAction: z.enum(['SMART_RETRY', 'CUSTOMER_RECOVERY', 'HUMAN_REVIEW', 'NO_ACTION']),
    reasoningFactors: z.array(z.string()).max(5),
  })
  .strict();

// The AIResponse type is produced via z.infer, not a hand-written interface.
export type AIResponse = z.infer<typeof AIResponseSchema>;

// Placeholder validator — no downstream logic yet. safeParse's inferred type
// is already correct; never assert it with "as AIResponse".
export type ValidationResult =
  | { success: true; data: AIResponse }
  | { success: false; error: string };

export function validateAIResponse(raw: unknown): ValidationResult {
  const result = AIResponseSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // Not implemented beyond schema validation — stub for future integration.
  return { success: false, error: 'AI_RESPONSE_INVALID' };
}
