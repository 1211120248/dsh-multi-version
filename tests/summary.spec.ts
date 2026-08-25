import { describe, expect, it } from 'vitest'
import { deriveIntroduction, renderSummary } from '../src/core/summary.ts'
import type { RunRecord } from '../src/core/types.ts'

const run: RunRecord = {
  schemaVersion: 1,
  revision: 4,
  id: 'run-1',
  sessionId: 'session-1',
  sourceWorkspace: '/workspace',
  runDirectory: '/workspace/.multi-version/run-1',
  phase: 'completed',
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:01:00.000Z',
  options: { count: 2, usePlanner: true, concurrency: 2 },
  promptPreview: '实现登录功能',
  warnings: [],
  versions: [
    {
      id: 'version-01',
      index: 1,
      phase: 'completed',
      relativeDirectory: 'versions/version-01',
      title: '账号密码登录',
      introduction: '使用本地用户表。',
    },
    {
      id: 'version-02',
      index: 2,
      phase: 'failed',
      relativeDirectory: 'versions/version-02',
      error: 'network timeout',
    },
  ],
}

describe('local summary', () => {
  it('is byte-stable and contains no ranking or recommendation', () => {
    expect(renderSummary(run)).toMatchInlineSnapshot(`
      "# 多版本运行结果

      - 运行编号：run-1
      - 原始任务：实现登录功能
      - 版本数量：2
      - 使用规划器：是
      - 最终状态：completed

      | 版本 | 状态 | 简介 | 结果目录 |
      | --- | --- | --- | --- |
      | 账号密码登录 | 已完成 | 使用本地用户表。 | \`versions/version-01\` |
      | 版本 2 | 失败 | network timeout | \`versions/version-02\` |

      > 本文件由 Host 根据规划 brief、候选最终回复和运行元数据本地生成；未调用评审、排名或总结模型。
      "
    `)
    expect(renderSummary(run)).not.toContain('最佳版本')
    expect(renderSummary(run)).not.toContain('推荐采用')
  })

  it('uses planner text when present and otherwise extracts a heading and paragraph', () => {
    expect(deriveIntroduction('# Ignored\nbody', {
      title: ' OAuth 登录 ',
      description: ' 第三方授权 ',
      instruction: 'implement',
    })).toEqual({ title: 'OAuth 登录', introduction: '第三方授权' })
    expect(deriveIntroduction('# 本地登录\n\n使用账号密码实现。')).toEqual({
      title: '本地登录',
      introduction: '使用账号密码实现。',
    })
  })
})
