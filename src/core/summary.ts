import type { RunRecord, VersionBrief, VersionRecord } from './types.ts'

const INTRODUCTION_LIMIT = 240

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Deterministically derive an introduction without another model call. */
export function deriveIntroduction(markdown: string, brief?: VersionBrief): { title: string; introduction: string } {
  if (brief !== undefined) return { title: compact(brief.title), introduction: compact(brief.description) }
  const lines = markdown.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const headingIndex = lines.findIndex(line => /^#{1,6}\s+/.test(line))
  const title = headingIndex >= 0 ? compact(lines[headingIndex]!.replace(/^#{1,6}\s+/, '')) : '独立生成结果'
  const body = lines.find((line, index) => index !== headingIndex && !line.startsWith('#') && !line.startsWith('```')) ?? '候选已完成，打开结果文件查看完整内容。'
  const normalized = compact(body)
  return {
    title: title === '' ? '独立生成结果' : title,
    introduction: normalized.length <= INTRODUCTION_LIMIT ? normalized : `${normalized.slice(0, INTRODUCTION_LIMIT - 1)}…`,
  }
}

function statusLabel(phase: VersionRecord['phase']): string {
  switch (phase) {
    case 'pending': return '等待中'
    case 'running': return '运行中'
    case 'completed': return '已完成'
    case 'cancelled': return '已取消'
    case 'failed': return '失败'
  }
}

function safeCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ')
}

/** Build a navigation summary only; it never ranks, judges, merges, or recommends candidates. */
export function renderSummary(run: RunRecord): string {
  const lines = [
    '# 多版本运行结果',
    '',
    `- 运行编号：${run.id}`,
    `- 原始任务：${run.promptPreview || '未提供文字预览'}`,
    `- 版本数量：${run.options.count}`,
    `- 使用规划器：${run.options.usePlanner ? '是' : '否'}`,
    `- 最终状态：${run.phase}`,
    '',
    '| 版本 | 状态 | 简介 | 结果目录 |',
    '| --- | --- | --- | --- |',
  ]
  for (const version of run.versions) {
    const title = version.title ?? `版本 ${version.index}`
    const introduction = version.introduction ?? version.error ?? '尚无结果'
    lines.push(`| ${safeCell(title)} | ${statusLabel(version.phase)} | ${safeCell(introduction)} | \`${version.relativeDirectory}\` |`)
  }
  lines.push('', '> 本文件由 Host 根据规划 brief、候选最终回复和运行元数据本地生成；未调用评审、排名或总结模型。', '')
  return lines.join('\n')
}
