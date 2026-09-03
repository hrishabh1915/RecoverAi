# RecoverAI Architecture

**AI recommends. Deterministic policy disposes. Humans remain in the loop for risky cases.**

## Pipeline

```
Inbound Event
    → Server Validation
    → DB State
    → AI Diagnosis
    → AI Validation
    → Recovery Score
    → Deterministic Policy Engine
    → PolicyDecision
    → Fresh DB ExecutionContext
    → Execution Guard
    → Action Executor
    → Audit Log
```

## Key Boundaries

- **AI boundary**: The AI produces an `AIResponse` (diagnosis, confidence,
  recommended action, reasoning factors). `.strict()` Zod validation ensures
  the AI can never inject policy or execution fields (amount, retryCount,
  transactionId, paymentStatus, etc.).
- **Policy engine**: Deterministic. Takes `PolicyInput` and emits a
  `PolicyDecision`. The engine may use the AI's recommendation but is never
  bound by it.
- **Execution context**: Built exclusively from a fresh, server-controlled DB
  read keyed by `transactionId`. No function signature may accept
  `AIResponse` alongside execution logic. `paymentStatusAtExecution` is
  checked by the action executor to guard against stale decisions.
- **No direct AI → executor path**: Structurally impossible. The AI's output
  flows through validation, scoring, and the deterministic policy engine
  before any execution is authorized.
