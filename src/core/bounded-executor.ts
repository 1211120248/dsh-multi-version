export interface SettledItem<T> {
  readonly status: 'fulfilled' | 'rejected'
  readonly value?: T
  readonly reason?: unknown
}

/** Run items with a hard concurrency ceiling while preserving declaration order. */
export async function runBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal: AbortSignal,
): Promise<readonly SettledItem<R>[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer')
  const results: SettledItem<R>[] = new Array(items.length)
  let cursor = 0

  const runWorker = async (): Promise<void> => {
    while (true) {
      if (signal.aborted) return
      const index = cursor
      if (index >= items.length) return
      cursor += 1
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]!, index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  await Promise.all(workers)
  if (signal.aborted) {
    for (let index = cursor; index < items.length; index += 1) {
      results[index] = { status: 'rejected', reason: signal.reason ?? new Error('run cancelled') }
    }
  }
  return results
}
