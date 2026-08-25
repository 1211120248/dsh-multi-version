import type {
  ChatConversationViewNode,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

const COMMAND_NAME = 'multi-version'
const COMMAND_ID_PREFIX = `${COMMAND_NAME}:`

export interface MultiVersionRunChatData {
  readonly runId: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** One Host-admitted multi-version run in ordinary transcript flow. */
    'multi-version-run': MultiVersionRunChatData
  }
}

interface MultiVersionRunState {
  readonly runId: string
}

function runIdFromCommandId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith(COMMAND_ID_PREFIX)) return undefined
  const runId = value.slice(COMMAND_ID_PREFIX.length)
  return runId === '' ? undefined : runId
}

/** Project the known, persistence-safe command lifecycle into a non-command Chat business node. */
export const multiVersionRunDefinition: ConversationNodeDefinition<MultiVersionRunState> = {
  kind: 'multi-version-run',
  target: 'chat',
  match: (event) => {
    if (event.type === 'command/run' && event.data.name === COMMAND_NAME) {
      const runId = runIdFromCommandId(event.data.commandId)
      return runId === undefined ? null : { id: runId, role: 'start' }
    }
    if (event.type === 'command/done') {
      const runId = runIdFromCommandId(event.data.commandId)
      return runId === undefined ? null : { id: runId, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'command/run') throw new Error('multi-version run requires command/run')
    const runId = runIdFromCommandId(match.event.data.commandId)
    if (runId === undefined) throw new Error('multi-version command id is invalid')
    return { runId }
  },
  update: context => context.state,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined || context.state === undefined) return null
    return {
      key: context.key,
      kind: 'multi-version-run',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: { runId: context.state.runId },
    }
  },
}
