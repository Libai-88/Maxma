/**
 * 任务详情里的产物与备份区块。
 *
 * 从 TaskDetailPane 拆出，保持文件在体量棘轮上限内；交互与后端契约不变。
 */
import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileText,
  HardDrive,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { baseName, formatBytes, SectionCard } from './taskUi'
import type { CoworkArtifact, CoworkFileBackup } from '@/types/cowork'

export function ArtifactsList({ artifacts, onDownload, onPreview, onExport, onDelete }: {
  artifacts: CoworkArtifact[]
  onDownload: (artifact: CoworkArtifact) => void
  onPreview: (artifact: CoworkArtifact) => void
  onExport: (artifact: CoworkArtifact) => void
  onDelete: (artifact: CoworkArtifact) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  if (artifacts.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">还没有交付物。产物只会落在任务 staging 目录。</p>
  }
  const groups = new Map<string, CoworkArtifact[]>()
  for (const artifact of artifacts) {
    const list = groups.get(artifact.path) ?? []
    list.push(artifact)
    groups.set(artifact.path, list)
  }
  const ordered = [...groups.values()]
    .map((list) => list.sort((a, b) => b.version - a.version))
    .sort((a, b) => (b[0]?.created_at ?? '').localeCompare(a[0]?.created_at ?? ''))

  return (
    <ul className="divide-y divide-border">
      {ordered.map((versions) => {
        const current = versions[0]!
        const older = versions.slice(1)
        const open = Boolean(expanded[current.path])
        return (
          <li key={current.path} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-panel">
                <FileText className="size-4 text-muted-foreground" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{baseName(current.path)}</p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  v{current.version} <span aria-hidden>·</span> {formatBytes(current.size_bytes)}
                  <span className="mx-1.5" aria-hidden>·</span>
                  <code className="font-mono">{current.sha256.slice(0, 10)}</code>
                  {older.length > 0 && <span className="ml-1.5">· {older.length} 个历史版本</span>}
                </p>
              </div>
              {['docx', 'xlsx', 'pptx'].includes(current.kind) && (
                <Button variant="ghost" size="sm" onClick={() => onPreview(current)}>
                  <PencilLine className="size-3.5" aria-hidden />
                  预览 / 选改
                </Button>
              )}
              {older.length > 0 && (
                <Button variant="ghost" size="icon-sm" aria-label="历史版本" onClick={() => setExpanded((state) => ({ ...state, [current.path]: !open }))}>
                  {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => onDownload(current)}>
                <Download className="size-3.5" aria-hidden />
                下载
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onExport(current)} title="复制到源工作区，必须审批">
                <ShieldCheck className="size-3.5" aria-hidden />
                导出
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`删除 ${baseName(current.path)}`} onClick={() => onDelete(current)}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
            {open && older.length > 0 && (
              <ul className="mt-2 ml-12 divide-y divide-border rounded-md border border-border bg-muted/25">
                {older.map((version) => (
                  <li key={version.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="shrink-0 rounded-sm border border-border bg-card px-2 py-1.5 font-mono text-caption text-muted-foreground">v{version.version}</span>
                    <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                      {formatBytes(version.size_bytes)} <span aria-hidden>·</span> {new Date(version.created_at).toLocaleString('zh-CN')}
                    </span>
                    <Button variant="ghost" size="icon-xs" aria-label={`预览 v${version.version}`} onClick={() => onPreview(version)}>
                      <Eye className="size-3.5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={`下载 v${version.version}`} onClick={() => onDownload(version)}>
                      <Download className="size-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function FileBackupsSection({ backups, busy, onRestore }: {
  backups: CoworkFileBackup[]
  busy: boolean
  onRestore: (backup: CoworkFileBackup) => void
}) {
  if (backups.length === 0) return null
  return (
    <SectionCard title="写入备份与恢复" extra={<span className="text-caption text-muted-foreground">{backups.length} 份</span>}>
      <ul className="divide-y divide-border">
        {backups.slice(0, 12).map((backup) => (
          <li key={backup.id} className="flex items-start gap-3 px-4 py-3">
            <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground" title={backup.original_path}>{baseName(backup.original_path)}</p>
              <p className="mt-0.5 break-all font-mono text-caption text-muted-foreground">{backup.original_path}</p>
              <p className="mt-1 text-caption text-muted-foreground">
                {backup.reason === 'pre_restore' ? '恢复前自动备份' : '导出前备份'}
                <span className="mx-1.5" aria-hidden>·</span>
                {new Date(backup.created_at).toLocaleString('zh-CN')}
                {backup.restored_at && <><span className="mx-1.5" aria-hidden>·</span>已恢复</>}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onRestore(backup)}>
              <RotateCcw className="size-3.5" aria-hidden />
              恢复
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
