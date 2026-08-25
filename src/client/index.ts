import { createElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { MultiVersionControl, textFromDictionary, type MultiVersionText } from './MultiVersionControl.tsx'
import { MultiVersionRunNode, type MultiVersionRunNodeInjected } from './MultiVersionRunNode.tsx'
import { MultiVersionInputController } from './input-adapter.ts'
import {
  DshConversationInputAdapter,
  DshMultiVersionTransport,
  type InputTriggersLike,
  type SessionsLike,
} from './dsh-client.ts'
import { MultiVersionRunController } from './run-controller.ts'
import { multiVersionRunDefinition } from './run-definition.ts'
import { en, type MultiVersionLocaleKey, NS, zh } from './locales.ts'

export type { MultiVersionText } from './MultiVersionControl.tsx'
export { MultiVersionControl, textFromDictionary } from './MultiVersionControl.tsx'
export { ResultDialog } from './ResultDialog.tsx'
export { RunSummaryPanel } from './RunSummaryPanel.tsx'
export type * from './input-adapter.ts'

interface MultiVersionInjected {
  readonly sessionId: string
  readonly controller?: MultiVersionInputController
  readonly text: MultiVersionText
  readonly onStarted: (runId: string) => void
}

type MultiVersionInputEntryProps = PropsRuntime<'conversation.input.right'>
  & PropsLocale<'multiVersion'>
  & MultiVersionInjected

function dictionaryFrom(t: (key: MultiVersionLocaleKey) => string): Record<MultiVersionLocaleKey, string> {
  return Object.fromEntries((Object.keys(zh) as MultiVersionLocaleKey[]).map(key => [key, t(key)])) as Record<MultiVersionLocaleKey, string>
}

function MultiVersionInputEntry({ sessionId, controller, onStarted, t, useInput }: MultiVersionInputEntryProps): JSX.Element {
  const hasSubmission = useInput(input => input.draft.trim() !== '' || input.imageIds.length > 0)
  return createElement(MultiVersionControl, {
    sessionId,
    controller,
    hasSubmission,
    text: textFromDictionary(dictionaryFrom(t)),
    onStarted,
  })
}

function SuppressedMultiVersionCommand(): null {
  return null
}

export const inject = ['locale', 'sessions', 'conversation', 'conversationEvents', 'inputTriggers', 'slots']

/** Register the input control and durable transcript renderer through official slots only. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-multi-version: locales')
  ctx.conversationEvents.register(multiVersionRunDefinition)
  const transport = new DshMultiVersionTransport()
  const adapter = new DshConversationInputAdapter(
    ctx.sessions as unknown as SessionsLike,
    ctx.inputTriggers as unknown as InputTriggersLike,
  )
  const inputs = new Map<SessionId, MultiVersionInputController>()
  const runs = new Map<SessionId, MultiVersionRunController>()

  const runControllerFor = (sessionId: SessionId): MultiVersionRunController => {
    let controller = runs.get(sessionId)
    if (controller === undefined) {
      controller = new MultiVersionRunController(transport, sessionId)
      runs.set(sessionId, controller)
    }
    return controller
  }

  const inputControllerFor = (sessionId: SessionId): MultiVersionInputController => {
    let controller = inputs.get(sessionId)
    if (controller === undefined) {
      controller = new MultiVersionInputController(adapter, transport)
      inputs.set(sessionId, controller)
    }
    return controller
  }

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'multi-version',
    order: 100,
    locale: NS,
    inject: (sessionId): MultiVersionInjected => {
      const supported = adapter.supports(sessionId)
      return {
        sessionId,
        ...(supported ? { controller: inputControllerFor(sessionId) } : {}),
        text: textFromDictionary(zh),
        onStarted: () => { void runControllerFor(sessionId).refresh() },
      }
    },
  }, MultiVersionInputEntry))

  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'multi-version',
  }, SuppressedMultiVersionCommand))

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'multi-version-run',
    locale: NS,
    inject: (sessionId): MultiVersionRunNodeInjected => {
      const controller = runControllerFor(sessionId)
      return {
        hooks: { runs: controller },
        ensure: () => controller.ensure(),
        cancel: runId => controller.cancel(runId),
        result: (runId, versionId) => controller.result(runId, versionId),
      }
    },
  }, MultiVersionRunNode))

  ctx.effect(() => () => {
    for (const controller of runs.values()) controller.dispose()
    runs.clear()
    inputs.clear()
  }, 'dsh-multi-version: controller cleanup')
}
