import type { RunRecord, RunView, VersionRecord, VersionView } from './types.ts'

function versionView(record: VersionRecord): VersionView {
  const { relativeDirectory: _relativeDirectory, ...view } = record
  return view
}

/** Remove every Host-owned filesystem path before a run crosses into the browser. */
export function toRunView(record: RunRecord): RunView {
  const {
    sourceWorkspace: _sourceWorkspace,
    runDirectory: _runDirectory,
    versions,
    ...view
  } = record
  return { ...view, versions: versions.map(versionView) }
}
