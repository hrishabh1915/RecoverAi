// Repository barrel export

export {
  createPayment,
  getPaymentById,
  getPaymentsByMerchantAndCustomer,
  getAllPayments,
  updatePayment,
  getPaymentForExecution,
  type PaymentRecord,
  type PaymentUpdate,
  type PaymentInsert,
} from './paymentRepository.js';

export {
  createCustomer,
  getCustomerById,
  getCustomerByExternalId,
  getCustomerState,
  setCustomerBlocked,
  type CustomerRecord,
  type CustomerState,
  type CustomerInsert,
} from './customerRepository.js';

export {
  isEventProcessed,
  insertProcessedEvent,
  getProcessedEventById,
  type ProcessedEventRecord,
} from './processedEventRepository.js';

export {
  getActiveAttemptForPayment,
  getAttemptsForPayment,
  createRecoveryAttempt,
  updateAttemptStatus,
  type RecoveryAttemptRecord,
} from './recoveryAttemptRepository.js';

export {
  insertRecoveryDecision,
  getDecisionsForPayment,
  type RecoveryDecisionRecord,
  type RecoveryDecisionInsert,
} from './recoveryDecisionRepository.js';

export {
  insertAuditLog,
  getAuditLogsForEntity,
  getAllAuditLogs,
  type AuditLogRecord,
  type AuditLogInsert,
} from './auditLogRepository.js';

export { buildExecutionContext } from './executionContextBuilder.js';
