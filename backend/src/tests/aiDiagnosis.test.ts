import { describe, it, expect } from 'vitest';
import {
  buildDiagnosticPrompt,
  runSemanticDiagnosticEngine,
  processRawLLMOutput,
  diagnosePaymentFailure,
} from '../services/aiDiagnosisService.js';
import { evaluatePolicy } from '../services/policyEngine.js';
import type { PolicyInput } from '../types/policy.js';

describe('AI Diagnosis Service', () => {
  describe('Prompt Construction', () => {
    it('constructs a prompt containing required context and schema guidelines', () => {
      const prompt = buildDiagnosticPrompt({
        failureReason: 'NETWORK_ERROR',
        failureCode: 'GATEWAY_TIMEOUT_504',
        errorMessage: 'Connection to acquiring bank timed out after 30000ms',
        paymentMethod: 'upi',
        currency: 'INR',
        retryCount: 1,
        customerRiskFlag: false,
      });

      expect(prompt).toContain('NETWORK_ERROR');
      expect(prompt).toContain('GATEWAY_TIMEOUT_504');
      expect(prompt).toContain('upi');
      expect(prompt).toContain('SMART_RETRY');
      expect(prompt).toContain('Never invent or include fields like "amount"');
    });
  });

  describe('Semantic Diagnostic Engine (Fallback / Offline)', () => {
    it('diagnoses network errors with SMART_RETRY', () => {
      const res = runSemanticDiagnosticEngine({
        failureReason: 'NETWORK_ERROR',
        paymentMethod: 'upi',
      });

      expect(res.diagnosis).toBe('NETWORK_ERROR');
      expect(res.confidence).toBeGreaterThanOrEqual(0.8);
      expect(res.recommendedAction).toBe('SMART_RETRY');
      expect(res.reasoningFactors.length).toBeGreaterThanOrEqual(1);
    });

    it('diagnoses insufficient funds with CUSTOMER_RECOVERY', () => {
      const res = runSemanticDiagnosticEngine({
        failureReason: 'INSUFFICIENT_FUNDS',
        paymentMethod: 'card',
      });

      expect(res.diagnosis).toBe('INSUFFICIENT_FUNDS');
      expect(res.recommendedAction).toBe('CUSTOMER_RECOVERY');
    });

    it('diagnoses fraud risk with NO_ACTION and high confidence', () => {
      const res = runSemanticDiagnosticEngine({
        failureReason: 'FRAUD_SUSPECTED',
        paymentMethod: 'card',
        customerRiskFlag: true,
      });

      expect(res.diagnosis).toBe('FRAUD_SUSPECTED');
      expect(res.recommendedAction).toBe('NO_ACTION');
      expect(res.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('diagnoses unmapped failure reasons with HUMAN_REVIEW', () => {
      const res = runSemanticDiagnosticEngine({
        failureReason: 'UNKNOWN',
        paymentMethod: 'netbanking',
      });

      expect(res.diagnosis).toBe('UNKNOWN');
      expect(res.recommendedAction).toBe('HUMAN_REVIEW');
    });
  });

  describe('Raw LLM Output Processing & Schema Validation', () => {
    it('parses clean valid JSON from LLM', () => {
      const raw = JSON.stringify({
        diagnosis: 'BANK_DECLINED_GENERIC',
        confidence: 0.75,
        recommendedAction: 'SMART_RETRY',
        reasoningFactors: ['Issuer bank blip', 'Eligible for secondary route'],
      });

      const result = processRawLLMOutput(raw);
      expect(result.aiValid).toBe(true);
      expect(result.aiResponse.diagnosis).toBe('BANK_DECLINED_GENERIC');
      expect(result.aiResponse.recommendedAction).toBe('SMART_RETRY');
    });

    it('cleans markdown codeblock fences from LLM response', () => {
      const raw = '```json\n{\n  "diagnosis": "AUTH_FAILURE",\n  "confidence": 0.8,\n  "recommendedAction": "CUSTOMER_RECOVERY",\n  "reasoningFactors": ["3DS OTP session expired"]\n}\n```';

      const result = processRawLLMOutput(raw);
      expect(result.aiValid).toBe(true);
      expect(result.aiResponse.diagnosis).toBe('AUTH_FAILURE');
    });

    it('strictly rejects LLM output containing forbidden execution/financial fields (amount, retryCount)', () => {
      const rawWithForbiddenKeys = JSON.stringify({
        diagnosis: 'NETWORK_ERROR',
        confidence: 0.9,
        recommendedAction: 'SMART_RETRY',
        reasoningFactors: ['Network blip'],
        amount: 500000, // FORBIDDEN
        retryCount: 2,  // FORBIDDEN
      });

      const result = processRawLLMOutput(rawWithForbiddenKeys);
      expect(result.aiValid).toBe(false);
      expect(result.provider).toBe('safety_fallback');
      expect(result.aiResponse.recommendedAction).toBe('HUMAN_REVIEW');
      expect(result.aiResponse.diagnosis).toBe('UNKNOWN');
      expect(result.error).toContain('Schema validation rejected');
    });

    it('handles malformed / incomplete JSON safely', () => {
      const malformed = '{"diagnosis": "NETWORK_ERROR", confidence: broken json...';

      const result = processRawLLMOutput(malformed);
      expect(result.aiValid).toBe(false);
      expect(result.provider).toBe('safety_fallback');
      expect(result.aiResponse.recommendedAction).toBe('HUMAN_REVIEW');
      expect(result.error).toContain('Malformed JSON');
    });

    it('rejects invalid enum values from LLM', () => {
      const invalidEnum = JSON.stringify({
        diagnosis: 'RANDOM_HALLUCINATED_REASON',
        confidence: 0.9,
        recommendedAction: 'SMART_RETRY',
        reasoningFactors: ['Hallucination'],
      });

      const result = processRawLLMOutput(invalidEnum);
      expect(result.aiValid).toBe(false);
      expect(result.aiResponse.recommendedAction).toBe('HUMAN_REVIEW');
    });
  });

  describe('Integration with Deterministic Policy Engine (Rule 12)', () => {
    it('triggers Rule 12 (HUMAN_APPROVAL_REQUIRED) when AI output is invalid', async () => {
      // Simulate diagnosis failing schema validation
      const malformedDiag = await diagnosePaymentFailure(
        {
          failureReason: 'NETWORK_ERROR',
          paymentMethod: 'upi',
        },
        { rawMockOutput: '{"invalid": "json"' },
      );

      expect(malformedDiag.aiValid).toBe(false);

      const policyInput: PolicyInput = {
        transactionId: 'tx_malformed_test',
        customerId: 'cust_test',
        amount: 100000,
        currency: 'INR',
        paymentMethod: 'upi',
        failureReason: 'NETWORK_ERROR',
        transactionCreatedAt: '2026-09-01T10:00:00Z',
        eventReceivedAt: '2026-09-01T10:01:00Z',
        previousSuccessfulPayments: 5,
        previousFailedPayments: 0,
        customerStatus: 'active',
        customerRiskFlag: false,
        retryCount: 0,
        lastRetryAt: null,
        alreadyRecovered: false,
        aiDiagnosis: malformedDiag.aiResponse.diagnosis,
        aiConfidence: malformedDiag.aiResponse.confidence,
        aiRecommendedAction: malformedDiag.aiResponse.recommendedAction,
        aiReasoningFactors: malformedDiag.aiResponse.reasoningFactors,
        aiResponseValid: malformedDiag.aiValid, // false
        recoveryScore: 80,
        riskLevel: 'low',
        highValueFlag: false,
        suspiciousDataFlag: false,
        automationEnabledForMerchant: true,
        idempotencyKey: 'evt_test',
        eventAlreadyProcessed: false,
        inFlightLock: false,
      };

      const decision = evaluatePolicy(policyInput, {
        total: 80,
        failureReasonScore: 95,
        retryScore: 100,
        recencyScore: 100,
        historyScore: 100,
        confidenceScore: 0,
      });

      // Even with an 80 recovery score, Rule 12 must trigger and require human approval
      expect(decision.decision).toBe('HUMAN_APPROVAL_REQUIRED');
      expect(decision.reasonCode).toBe('AI_INVALID');
      expect(decision.ruleTriggered).toBe(12);
    });
  });
});
