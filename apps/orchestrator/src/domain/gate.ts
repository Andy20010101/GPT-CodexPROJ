import type { GateType } from '../contracts/gate-result';

export function gateRequiresTask(gateType: GateType): boolean {
  return gateType === 'red_test_gate' || gateType === 'review_gate';
}

export function isAcceptanceGate(gateType: GateType): boolean {
  return gateType === 'acceptance_gate';
}
