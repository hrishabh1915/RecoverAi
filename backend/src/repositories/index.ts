// Repository barrel export — typed stubs only, no implementations.

export type {
  PaymentRecord,
  PaymentUpdate,
} from './paymentRepository.js';
export type {
  CustomerRecord,
  CustomerState,
} from './customerRepository.js';
export type { ProcessedEventRecord } from './processedEventRepository.js';
export type { RecoveryAttemptRecord } from './recoveryAttemptRepository.js';
export type {
  RecoveryDecisionRecord,
  RecoveryDecisionInsert,
} from './recoveryDecisionRepository.js';
export type {
  AuditLogRecord,
  AuditLogInsert,
} from './auditLogRepository.js';
