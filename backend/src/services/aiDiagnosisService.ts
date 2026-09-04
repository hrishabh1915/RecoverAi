// AI Diagnosis Service.
// Diagnoses failed payment events using structured LLM reasoning.
// Strictly validates outputs with Zod AIResponseSchema.
// Fails closed to deterministic fallback / human review on malformed output or API errors.

import { validateAIResponse, type AIResponse } from '../types/ai.js';
import type { FailureReason, PaymentMethod } from '../types/domain.js';

export interface PaymentDiagnosticContext {
  failureReason: FailureReason;
  failureCode?: string;
  errorMessage?: string;
  paymentMethod: PaymentMethod;
  amountMinor?: bigint | number;
  currency?: string;
  customerRiskFlag?: boolean;
  retryCount?: number;
  rawPayload?: unknown;
}

export interface DiagnosisResult {
  aiResponse: AIResponse;
  aiValid: boolean;
  provider: 'gemini_api' | 'semantic_engine' | 'safety_fallback';
  rawOutput?: string;
  error?: string;
}

/**
 * Builds the strict diagnostic system prompt for the LLM.
 * Directs the AI to only return valid JSON matching the AIResponse schema.
 */
export function buildDiagnosticPrompt(ctx: PaymentDiagnosticContext): string {
  return `You are RecoverAI's Diagnostic Specialist. Your role is to analyze a failed payment transaction and classify the failure to assist the automated recovery pipeline.

TRANSACTION CONTEXT:
- Failure Reason: ${ctx.failureReason}
- Error Code: ${ctx.failureCode ?? 'N/A'}
- Error Description: ${ctx.errorMessage ?? 'Standard gateway decline'}
- Payment Method: ${ctx.paymentMethod}
- Currency: ${ctx.currency ?? 'INR'}
- Retry Count to date: ${ctx.retryCount ?? 0}
- Customer Risk Flag: ${ctx.customerRiskFlag ? 'FLAGGED' : 'CLEAN'}

REQUIRED OUTPUT FORMAT:
You MUST respond with a single, valid JSON object and NOTHING else. Do not include markdown code blocks, preamble, or commentary.
Schema constraints:
{
  "diagnosis": "NETWORK_ERROR" | "BANK_DECLINED_GENERIC" | "INSUFFICIENT_FUNDS" | "EXPIRED_CARD" | "AUTH_FAILURE" | "FRAUD_SUSPECTED" | "UNKNOWN",
  "confidence": <number between 0.0 and 1.0>,
  "recommendedAction": "SMART_RETRY" | "CUSTOMER_RECOVERY" | "HUMAN_REVIEW" | "NO_ACTION",
  "reasoningFactors": [<array of 1 to 5 short string diagnostic points>]
}

CRITICAL RULES:
1. Never invent or include fields like "amount", "retryCount", "transactionId", or "paymentStatus". Any extra field will cause strict schema rejection.
2. If fraud or suspicious activity is indicated, recommend "NO_ACTION" with diagnosis "FRAUD_SUSPECTED".
3. For transient technical blips, recommend "SMART_RETRY".
4. For balance, card, or OTP issues needing customer intervention, recommend "CUSTOMER_RECOVERY".
5. For ambiguous errors, recommend "HUMAN_REVIEW".`;
}

/**
 * High-fidelity deterministic semantic diagnostic engine.
 * Used when offline, when no API key is provided, or for fast unit testing.
 * Provides realistic, context-aware reasoning matching real payment gateway error profiles.
 */
export function runSemanticDiagnosticEngine(ctx: PaymentDiagnosticContext): AIResponse {
  let diagnosis: AIResponse['diagnosis'] = ctx.failureReason;
  let confidence = 0.85;
  let recommendedAction: AIResponse['recommendedAction'] = 'SMART_RETRY';
  const reasoningFactors: string[] = [];

  const errMsg = (ctx.errorMessage ?? '').toLowerCase();
  const errCode = (ctx.failureCode ?? '').toUpperCase();

  // Fine-grained failure analysis
  if (ctx.failureReason === 'FRAUD_SUSPECTED' || ctx.customerRiskFlag || errMsg.includes('fraud') || errCode.includes('RISK')) {
    diagnosis = 'FRAUD_SUSPECTED';
    confidence = 0.96;
    recommendedAction = 'NO_ACTION';
    reasoningFactors.push('High-risk velocity or security block signaled by acquiring bank');
    reasoningFactors.push('Strict policy blocks automated retry on suspected fraud');
  } else if (ctx.failureReason === 'NETWORK_ERROR' || errMsg.includes('timeout') || errCode.includes('GATEWAY')) {
    diagnosis = 'NETWORK_ERROR';
    confidence = 0.92;
    recommendedAction = 'SMART_RETRY';
    reasoningFactors.push(`Network timeout observed on ${ctx.paymentMethod.toUpperCase()} rail`);
    reasoningFactors.push('Bank switch indicates temporary communication disruption');
    reasoningFactors.push('Safe to retry on alternate routing channel');
  } else if (ctx.failureReason === 'INSUFFICIENT_FUNDS' || errMsg.includes('balance') || errCode.includes('INSUFFICIENT')) {
    diagnosis = 'INSUFFICIENT_FUNDS';
    confidence = 0.82;
    recommendedAction = 'CUSTOMER_RECOVERY';
    reasoningFactors.push('Account balance insufficient for immediate debit');
    reasoningFactors.push('Send customer automated payment link with alternative payment options');
  } else if (ctx.failureReason === 'AUTH_FAILURE' || errMsg.includes('otp') || errMsg.includes('3ds')) {
    diagnosis = 'AUTH_FAILURE';
    confidence = 0.88;
    recommendedAction = 'CUSTOMER_RECOVERY';
    reasoningFactors.push('3D Secure / OTP authentication window expired or failed');
    reasoningFactors.push('Customer interaction required to re-authenticate session');
  } else if (ctx.failureReason === 'EXPIRED_CARD' || errMsg.includes('expired')) {
    diagnosis = 'EXPIRED_CARD';
    confidence = 0.94;
    recommendedAction = 'CUSTOMER_RECOVERY';
    reasoningFactors.push('Payment instrument expired or invalid expiry date provided');
    reasoningFactors.push('Customer notification dispatched to update card details');
  } else if (ctx.failureReason === 'BANK_DECLINED_GENERIC') {
    diagnosis = 'BANK_DECLINED_GENERIC';
    confidence = 0.72;
    recommendedAction = 'SMART_RETRY';
    reasoningFactors.push('Generic bank decline (Do Not Honor)');
    reasoningFactors.push('Secondary acquiring channel eligible after short cooldown');
  } else {
    diagnosis = 'UNKNOWN';
    confidence = 0.35;
    recommendedAction = 'HUMAN_REVIEW';
    reasoningFactors.push('Gateway returned unmapped decline status');
    reasoningFactors.push('Requires manual support operations inspection');
  }

  return {
    diagnosis,
    confidence,
    recommendedAction,
    reasoningFactors,
  };
}

/**
 * Calls live Google Gemini API if a valid AI_API_KEY is configured.
 */
async function callGeminiApi(prompt: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API HTTP ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned an empty response candidate');
  }

  return text;
}

/**
 * Main diagnosis function.
 * Diagnoses a payment failure with full schema validation and safety fallback.
 */
export async function diagnosePaymentFailure(
  ctx: PaymentDiagnosticContext,
  options?: { forceLive?: boolean; rawMockOutput?: string },
): Promise<DiagnosisResult> {
  const apiKey = process.env.AI_API_KEY;
  const isKeyConfigured = apiKey && apiKey !== 'placeholder-replace-with-real-key' && !apiKey.startsWith('placeholder');

  // 1. Mock output testing override (useful for testing malformed responses)
  if (options?.rawMockOutput !== undefined) {
    return processRawLLMOutput(options.rawMockOutput, 'gemini_api');
  }

  // 2. Call live LLM if key is available
  if (isKeyConfigured || options?.forceLive) {
    try {
      const prompt = buildDiagnosticPrompt(ctx);
      const rawText = await callGeminiApi(prompt, apiKey!);
      return processRawLLMOutput(rawText, 'gemini_api');
    } catch (err) {
      console.warn('Live LLM API call failed or unavailable, using semantic diagnostic engine:', err);
      // Fall through to semantic diagnostic engine
    }
  }

  // 3. High-fidelity Semantic Engine
  const semanticResponse = runSemanticDiagnosticEngine(ctx);
  const validation = validateAIResponse(semanticResponse);

  if (validation.success) {
    return {
      aiResponse: validation.data,
      aiValid: true,
      provider: 'semantic_engine',
    };
  }

  // 4. Ultimate safety fallback if validation fails
  return createSafetyFallback('Semantic engine output failed schema validation');
}

/**
 * Parses and validates raw LLM output text with strict safety boundaries.
 */
export function processRawLLMOutput(
  rawText: string,
  provider: DiagnosisResult['provider'] = 'gemini_api',
): DiagnosisResult {
  try {
    // Clean potential markdown wrap if LLM still returned ```json ... ```
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(cleaned);
    const validation = validateAIResponse(parsed);

    if (validation.success) {
      return {
        aiResponse: validation.data,
        aiValid: true,
        provider,
        rawOutput: rawText,
      };
    }

    // Schema validation failed (e.g. invalid diagnosis enum, extra keys like amount, etc.)
    return createSafetyFallback(`Schema validation rejected LLM output: ${validation.error}`, rawText);
  } catch (err) {
    // Malformed JSON
    return createSafetyFallback(`Malformed JSON from LLM: ${err instanceof Error ? err.message : String(err)}`, rawText);
  }
}

/**
 * Creates the deterministic safety fallback response for failed or malformed AI output.
 * Forces diagnosis to UNKNOWN and recommends HUMAN_REVIEW with aiValid = false.
 */
function createSafetyFallback(reason: string, rawOutput?: string): DiagnosisResult {
  return {
    aiResponse: {
      diagnosis: 'UNKNOWN',
      confidence: 0,
      recommendedAction: 'HUMAN_REVIEW',
      reasoningFactors: [reason],
    },
    aiValid: false,
    provider: 'safety_fallback',
    rawOutput,
    error: reason,
  };
}
