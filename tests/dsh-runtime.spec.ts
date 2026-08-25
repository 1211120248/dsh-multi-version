import { describe, expect, it, vi } from 'vitest'
import { DshCandidateExecutor, DshVersionPlanner } from '../src/dsh-runtime.ts'
import type { CandidateExecutionRequest, VersionPlannerRequest } from '../src/core/types.ts'

type PreStepHandler = (
  input: { readonly agent: { readonly session: { append(type: string, data: unknown): unknown } } },
  next: () => Promise<{ readonly kind?: string }>,
) => Promise<unknown>

function runtime(finalText: string) {
  const followup = vi.fn()
  const cancel = vi.fn()
  const append = vi.fn()
  const dispose = vi.fn()
  const composeFrom = vi.fn()
  const composedPreset = vi.fn(() => 'preset-a')
  const promptContext = vi.fn()
  let preStep: PreStepHandler | undefined
  const parent = {
    id: 'parent-session',
    options: { provider: 'provider-a', model: 'model-a', maxTokens: 1234, subagentDepth: 2, ignored: true },
    ctx: {
      get: (name: string) => {
        if (name === 'sandboxPolicy') return { overrideOf: () => 'workspace-write' }
        if (name === 'approval') return {}
        return undefined
      },
    },
    session: {
      header: { cwd: '/source', delegationDepth: 2, agentPreset: 'stale-preset' },
      events: [],
      append: vi.fn(),
    },
    followup: vi.fn(),
    whenIdle: vi.fn(async () => {}),
    cancel: vi.fn(),
  }
  const child = {
    id: 'child-session',
    options: {},
    ctx: { get: () => undefined },
    session: {
      header: { cwd: '/candidate', delegationDepth: 3 },
      events: [{
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: finalText }] } },
      }, {
        type: 'turn/end',
        data: { reason: { kind: 'completed' } },
      }] as Array<{ type: string; data?: unknown }>,
      append,
    },
    followup,
    whenIdle: vi.fn(async () => {}),
    cancel,
  }
  const create = vi.fn(async (options: { setup?: (ctx: unknown) => void }) => {
    options.setup?.({
      systemPrompt: { context: promptContext },
      on: (_event: 'agent/pre-step', handler: PreStepHandler) => { preStep = handler },
    })
    return { agent: child, dispose }
  })
  const agents = { get: vi.fn((id: string) => id === 'parent-session' ? parent : undefined), create }
  const attachments = {
    saveImages: vi.fn(async (images: readonly unknown[]) => images.map((_image, index) => ({
      attachmentId: `image-${index + 1}`,
      mediaType: 'image/png', bytes: 3, width: 1, height: 1,
    }))),
  }
  const presets = { composeFrom, composedPreset }
  return {
    agents, attachments, presets, parent, child, create, followup, cancel, append, dispose, composeFrom, promptContext,
    invokePreStep: async () => {
      if (preStep === undefined) throw new Error('pre-step lifecycle was not registered')
      await preStep({ agent: child }, async () => ({ kind: 'enter' }))
    },
  }
}

function request(): CandidateExecutionRequest {
  return {
    runId: 'run-1', sessionId: 'parent-session', versionId: 'version-01', index: 1, cwd: '/candidate',
    submission: {
      preview: 'question',
      parts: [
        { type: 'image', mediaType: 'image/png', data: 'AQID', name: 'a.png' },
        { type: 'text', text: 'exact current question' },
      ],
    },
  }
}

describe('DSH runtime adapters', () => {
  it('creates a fresh policy-pinned child with explicit cwd and preserves planner-off content', async () => {
    const bench = runtime('# Candidate\n\nDone.')
    const executor = new DshCandidateExecutor(bench.agents as never, bench.attachments as never, bench.presets)
    await expect(executor.execute(request(), new AbortController().signal)).resolves.toEqual({
      markdown: '# Candidate\n\nDone.',
      raw: [{ type: 'text', text: '# Candidate\n\nDone.' }],
    })

    expect(bench.create).toHaveBeenCalledOnce()
    const options = bench.create.mock.calls[0]![0] as Record<string, unknown>
    expect(options).not.toHaveProperty('seed')
    expect(options.meta).toEqual({
      cwd: '/candidate', parentSession: 'parent-session', origin: 'subagent',
      delegationDepth: 3, seedLength: 0, agentPreset: 'preset-a',
    })
    expect(options.agentOptions).toEqual({ provider: 'provider-a', model: 'model-a', maxTokens: 1234, subagentDepth: 3 })
    expect(bench.composeFrom).toHaveBeenCalledOnce()
    expect(bench.promptContext).toHaveBeenCalledWith(expect.objectContaining({ name: 'subagent:delegation' }))
    expect(bench.append).toHaveBeenNthCalledWith(1, 'sandbox/mode', { mode: 'workspace-write', source: 'delegation' })
    expect(bench.append).toHaveBeenNthCalledWith(2, 'approval/policy', { policy: 'never', source: 'delegation' })
    await bench.invokePreStep()
    expect(bench.append).toHaveBeenNthCalledWith(3, 'subagent/descriptor', {
      version: 2,
      mode: 'one-shot',
      provider: 'multi-version',
      label: 'multi-version candidate version-01',
    })
    expect(bench.attachments.saveImages).toHaveBeenCalledWith([
      { data: Uint8Array.of(1, 2, 3), mediaType: 'image/png', name: 'a.png' },
    ])
    const message = bench.followup.mock.calls[0]![0] as { content: readonly unknown[] }
    expect(message.content).toEqual([
      { type: 'image', attachment: { attachmentId: 'image-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } },
      { type: 'text', text: 'exact current question' },
    ])
    expect(JSON.stringify(message.content)).not.toContain('version-01')
    expect(bench.dispose).toHaveBeenCalledOnce()
  })

  it('increments the effective runtime delegation depth instead of trusting stale header depth', async () => {
    const bench = runtime('Done.')
    bench.parent.options.subagentDepth = 5
    const executor = new DshCandidateExecutor(bench.agents as never, bench.attachments as never, bench.presets)

    await executor.execute(request(), new AbortController().signal)

    const options = bench.create.mock.calls[0]![0] as { meta: { delegationDepth: number }; agentOptions: { subagentDepth: number } }
    expect(options.meta.delegationDepth).toBe(6)
    expect(options.agentOptions.subagentDepth).toBe(6)
  })

  it('uses exactly one planner child and accepts only exact distinct JSON briefs', async () => {
    const bench = runtime(JSON.stringify({ briefs: [
      { title: 'A', description: 'Alpha', instruction: 'Build alpha' },
      { title: 'B', description: 'Beta', instruction: 'Build beta' },
    ] }))
    const planner = new DshVersionPlanner(bench.agents as never, bench.attachments as never, bench.presets)
    const plannerRequest: VersionPlannerRequest = {
      runId: 'run-1', sessionId: 'parent-session', cwd: '/planner', requestedCount: 2,
      submission: request().submission,
    }
    await expect(planner.plan(plannerRequest, new AbortController().signal)).resolves.toEqual([
      { title: 'A', description: 'Alpha', instruction: 'Build alpha' },
      { title: 'B', description: 'Beta', instruction: 'Build beta' },
    ])
    expect(bench.create).toHaveBeenCalledOnce()
    expect((bench.create.mock.calls[0]![0] as { meta: { cwd: string } }).meta.cwd).toBe('/planner')
  })

  it('surfaces a child turn failure when no assistant response exists', async () => {
    const bench = runtime('')
    bench.child.session.events = [{
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { message: 'Provider is not configured' } } },
    }]
    const executor = new DshCandidateExecutor(bench.agents as never, bench.attachments as never, bench.presets)
    await expect(executor.execute(request(), new AbortController().signal))
      .rejects.toThrow('child agent failed: Provider is not configured')
    expect(bench.dispose).toHaveBeenCalledOnce()
  })

  it('rejects partial assistant output from a non-completed terminal turn', async () => {
    const bench = runtime('partial output')
    bench.child.session.events = [{
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'partial output' }] } },
    }, {
      type: 'turn/end',
      data: { reason: { kind: 'cancelled' } },
    }]
    const executor = new DshCandidateExecutor(bench.agents as never, bench.attachments as never, bench.presets)
    await expect(executor.execute(request(), new AbortController().signal))
      .rejects.toThrow('child agent failed: child agent stopped with terminal reason "cancelled"')
    expect(bench.dispose).toHaveBeenCalledOnce()
  })

  it('cancels and disposes a child when the run signal aborts', async () => {
    const bench = runtime('unused')
    const idle = Promise.withResolvers<void>()
    ;(bench.create as ReturnType<typeof vi.fn>).mockImplementationOnce(async (options: { setup?: (ctx: unknown) => void }) => {
      options.setup?.({ systemPrompt: { context: bench.promptContext }, on: () => {} })
      const handle = await runtime('unused').create({})
      handle.agent.whenIdle = vi.fn(() => idle.promise)
      handle.agent.cancel = bench.cancel
      return { agent: handle.agent, dispose: bench.dispose }
    })
    const executor = new DshCandidateExecutor(bench.agents as never, bench.attachments as never, bench.presets)
    const controller = new AbortController()
    const pending = executor.execute(request(), controller.signal)
    await vi.waitFor(() => { expect(bench.create).toHaveBeenCalledOnce() })
    controller.abort(new Error('stop'))
    idle.resolve()
    await expect(pending).rejects.toThrow('stop')
    expect(bench.cancel).toHaveBeenCalled()
    expect(bench.dispose).toHaveBeenCalledOnce()
  })
})
