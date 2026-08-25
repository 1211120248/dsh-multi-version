import type { Context } from '@deepseek-ai/cordis'
import { installHostRoutes } from './host-service.ts'

export const name = 'dsh-multi-version'
export const inject = ['agents', 'attachments', 'webServer']

/** Mount the Host-owned coordinator and its loopback-only Web transport. */
export function apply(ctx: Context): void {
  installHostRoutes(ctx)
}

export type * from './core/types.ts'
export { RunCoordinator } from './run-coordinator.ts'
export { RunLedger } from './run-ledger.ts'
export { materializeWorkspace } from './workspace-snapshot.ts'
