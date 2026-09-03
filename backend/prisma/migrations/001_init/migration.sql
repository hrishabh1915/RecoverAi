-- RecoverAI initial migration — 001_init
-- Full DDL for all tables, enums, indexes, and foreign keys.
-- The partial unique index on recovery_attempts is added manually at the
-- end because Prisma DSL cannot express WHERE-clause partial indexes.

-- Enums
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'RECOVERED');

CREATE TYPE "FailureReason" AS ENUM ('NETWORK_ERROR', 'BANK_DECLINED_GENERIC', 'INSUFFICIENT_FUNDS', 'EXPIRED_CARD', 'AUTH_FAILURE', 'FRAUD_SUSPECTED', 'UNKNOWN');

CREATE TYPE "RecoveryAttemptStatus" AS ENUM ('in_flight', 'completed', 'failed', 'cancelled');

CREATE TYPE "PolicyDecision" AS ENUM ('ALLOW', 'DENY', 'HUMAN_APPROVAL_REQUIRED');

CREATE TYPE "PolicyAction" AS ENUM ('SMART_RETRY', 'CUSTOMER_RECOVERY', 'HUMAN_REVIEW', 'NO_ACTION');

-- Tables
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "automation_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "external_customer_id" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "gateway_payment_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "failure_reason" "FailureReason",
    "transaction_created_at" TIMESTAMPTZ NOT NULL,
    "recovered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "processed_events" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "gateway_event_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "event_received_at" TIMESTAMPTZ NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recovery_attempts" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "status" "RecoveryAttemptStatus" NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recovery_decisions" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "recovery_attempt_id" TEXT,
    "event_id" TEXT NOT NULL,
    "evaluation_time" TIMESTAMPTZ NOT NULL,
    "failure_reason_score" INTEGER,
    "retry_score" INTEGER,
    "recency_score" INTEGER,
    "history_score" INTEGER,
    "confidence_score" INTEGER,
    "recovery_score" INTEGER,
    "policy_rule_triggered" TEXT NOT NULL,
    "policy_decision" "PolicyDecision" NOT NULL,
    "action" "PolicyAction" NOT NULL,
    "ai_response" JSONB,
    "ai_valid" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "customers"
    ADD CONSTRAINT "customers_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "processed_events"
    ADD CONSTRAINT "processed_events_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "processed_events"
    ADD CONSTRAINT "processed_events_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recovery_attempts"
    ADD CONSTRAINT "recovery_attempts_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recovery_decisions"
    ADD CONSTRAINT "recovery_decisions_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recovery_decisions"
    ADD CONSTRAINT "recovery_decisions_recovery_attempt_id_fkey"
    FOREIGN KEY ("recovery_attempt_id") REFERENCES "recovery_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recovery_decisions"
    ADD CONSTRAINT "recovery_decisions_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "processed_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique constraints
ALTER TABLE "customers"
    ADD CONSTRAINT "customers_merchant_id_external_customer_id_key"
    UNIQUE ("merchant_id", "external_customer_id");

ALTER TABLE "processed_events"
    ADD CONSTRAINT "processed_events_merchant_id_gateway_event_id_key"
    UNIQUE ("merchant_id", "gateway_event_id");

-- Indexes
CREATE INDEX "payments_merchant_id_customer_id_idx" ON "payments" ("merchant_id", "customer_id");
CREATE INDEX "payments_status_idx" ON "payments" ("status");
CREATE INDEX "recovery_attempts_payment_id_status_idx" ON "recovery_attempts" ("payment_id", "status");
CREATE INDEX "recovery_decisions_payment_id_evaluation_time_idx" ON "recovery_decisions" ("payment_id", "evaluation_time");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs" ("entity_type", "entity_id");

-- Partial unique index: only ONE in_flight recovery attempt per payment at a time.
-- Not expressible in Prisma DSL — added manually here.
CREATE UNIQUE INDEX "recovery_attempts_payment_id_in_flight_unique"
ON "recovery_attempts" ("payment_id")
WHERE "status" = 'in_flight';
