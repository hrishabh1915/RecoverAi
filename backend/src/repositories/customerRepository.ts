// Customer repository — DB access layer stub.
// All functions throw "not implemented" — no fake/simulated DB calls.

import type { CustomerStatus } from '../types/domain.js';

export interface CustomerRecord {
  id: string;
  merchantId: string;
  externalCustomerId: string;
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerState {
  id: string;
  status: CustomerStatus;
  riskFlag: boolean;
  previousSuccessfulPayments: number;
  previousFailedPayments: number;
}

export function getCustomerById(_id: string): Promise<CustomerRecord | null> {
  throw new Error('not implemented');
}

export function getCustomerByExternalId(
  _merchantId: string,
  _externalCustomerId: string,
): Promise<CustomerRecord | null> {
  throw new Error('not implemented');
}

export function getCustomerState(_customerId: string): Promise<CustomerState> {
  throw new Error('not implemented');
}

export function setCustomerBlocked(_id: string, _blocked: boolean): Promise<CustomerRecord> {
  throw new Error('not implemented');
}
