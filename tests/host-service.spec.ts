import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultiVersionHostService } from '../src/host-service.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function fakeRuntime(workspace: string) {
  const childCwds: string[] = []
  const parentEvents: { type: string; data: Record<string, unknown> }[] = []
  const parent = {
    id: 'session-1',
    options: { provider: 'p', model: 'm' },
    ctx: { get: () => undefined },
    session: {
      header: { cwd: workspace, delegationDepth: 0 },
      events: parentEvents,
      append: vi.fn((type: string, data: Record<string, unknown>) => { parentEvents.push({ type, data }) }),
    },
    followup: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn(),
  }
  const agents = {
    get: vi.fn((id: string) => id === 'session-1' ? parent : undefined),
    create: vi.fn(async (options: { meta: { cwd: string }; setup?: (ctx: unknown) => void }) => {
      childCwds.push(options.meta.cwd)
      options.setup?.({ systemPrompt: { context: vi.fn() }, on: () => {} })
      return {
        agent: {
          id: `child-${childCwds.length}`,
          options: {},
          ctx: { get: () => undefined },
          session: {
            header: { cwd: options.meta.cwd, delegationDepth: 1 },
            events: [{
              type: 'assistant/message',
              data: { message: { content: [{ type: 'text', text: `# Candidate ${childCwds.length}\n\nDone.` }] } },
            }, {
              type: 'turn/end',
              data: { reason: { kind: 'completed' } },
            }],
            append: vi.fn(),
          },
          followup: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn(),
        },
        dispose: vi.fn(),
      }
    }),
  }
  const attachments = { saveImages: vi.fn(async () => []) }
  return { agents, attachments, childCwds, parent }
}

describe('MultiVersionHostService', () => {
  it('deduplicates admission and settles one Host-authoritative run across isolated child cwds', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-multi-host-'))
    roots.push(workspace)
    await writeFile(join(workspace, 'source.txt'), 'base')
    const runtime = fakeRuntime(workspace)
    const service = new MultiVersionHostService(runtime.agents as never, runtime.attachments as never)
    const envelope = {
      requestId: 'request-1',
      action: {
        kind: 'start',
        request: {
          sessionId: 'session-1',
          submission: { preview: 'question', parts: [{ type: 'text', text: 'question' }] },
          options: { count: 2, usePlanner: false, concurrency: 2 },
        },
      },
    }

    const first = await service.action(envelope)
    const duplicate = await service.action(envelope)
    expect(first).toEqual(duplicate)
    expect(first.ok).toBe(true)
    const runId = (first as { value: { runId: string } }).value.runId
    await service.coordinator.wait(runId)

    const runs = await service.runs('session-1')
    expect(runs).toHaveLength(1)
    expect(runs[0]?.phase).toBe('completed')
    expect(runs[0]?.versions.map(version => version.phase)).toEqual(['completed', 'completed'])
    expect(runs[0]).not.toHaveProperty('sourceWorkspace')
    expect(runs[0]).not.toHaveProperty('runDirectory')
    expect(runs[0]?.versions[0]).not.toHaveProperty('relativeDirectory')
    expect(runtime.agents.create).toHaveBeenCalledTimes(2)
    expect(new Set(runtime.childCwds).size).toBe(2)
    const internal = service.coordinator.snapshot().find(run => run.id === runId)
    expect(internal).toBeDefined()
    expect(runtime.childCwds.every(cwd => cwd.startsWith(internal!.runDirectory))).toBe(true)
    expect(runtime.parent.session.append).toHaveBeenCalledTimes(2)
    expect(runtime.parent.session.append).toHaveBeenNthCalledWith(1, 'command/run', {
      commandId: `multi-version:${runId}`,
      name: 'multi-version',
      args: runId,
      source: { kind: 'user' },
    })
    expect(runtime.parent.session.append).toHaveBeenNthCalledWith(2, 'command/done', {
      commandId: `multi-version:${runId}`,
      kind: 'success',
      text: '2 versions completed.',
    })
  })

  it('fails malformed browser actions before creating work', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-multi-host-invalid-'))
    roots.push(workspace)
    const runtime = fakeRuntime(workspace)
    const service = new MultiVersionHostService(runtime.agents as never, runtime.attachments as never)
    await expect(service.action({ requestId: 'x', action: { kind: 'start', request: { cwd: '/tmp' } } }))
      .resolves.toEqual({ ok: false, error: 'invalid action envelope' })
    expect(runtime.agents.create).not.toHaveBeenCalled()
  })
})
