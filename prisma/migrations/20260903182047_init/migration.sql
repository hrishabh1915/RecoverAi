-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "automation_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchant_id" TEXT NOT NULL,
    "external_customer_id" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "customers_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "gateway_payment_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failure_reason" TEXT,
    "transaction_created_at" DATETIME NOT NULL,
    "recovered_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "processed_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchant_id" TEXT NOT NULL,
    "gateway_event_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "event_received_at" DATETIME NOT NULL,
    "raw_payload" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "processed_events_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "processed_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recovery_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payment_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recovery_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recovery_decisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payment_id" TEXT NOT NULL,
    "recovery_attempt_id" TEXT,
    "event_id" TEXT NOT NULL,
    "evaluation_time" DATETIME NOT NULL,
    "failure_reason_score" INTEGER,
    "retry_score" INTEGER,
    "recency_score" INTEGER,
    "history_score" INTEGER,
    "confidence_score" INTEGER,
    "recovery_score" INTEGER,
    "policy_rule_triggered" TEXT NOT NULL,
    "policy_decision" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ai_response" TEXT,
    "ai_valid" BOOLEAN NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recovery_decisions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "recovery_decisions_recovery_attempt_id_fkey" FOREIGN KEY ("recovery_attempt_id") REFERENCES "recovery_attempts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "recovery_decisions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "processed_events" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_merchant_id_external_customer_id_key" ON "customers"("merchant_id", "external_customer_id");

-- CreateIndex
CREATE INDEX "payments_merchant_id_customer_id_idx" ON "payments"("merchant_id", "customer_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "processed_events_merchant_id_gateway_event_id_key" ON "processed_events"("merchant_id", "gateway_event_id");

-- CreateIndex
CREATE INDEX "recovery_attempts_payment_id_status_idx" ON "recovery_attempts"("payment_id", "status");

-- CreateIndex
CREATE INDEX "recovery_decisions_payment_id_evaluation_time_idx" ON "recovery_decisions"("payment_id", "evaluation_time");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
