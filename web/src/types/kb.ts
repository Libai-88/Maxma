/** 知识库（Knowledge Base）类型定义 */

export interface KbDocument {
  doc_id: string
  filename: string
  source: string
  file_type: string
  size: number
  chunk_count: number
  indexed_chunk_count: number
  chunk_ids: string[]
  created_at: string
  metadata: Record<string, any>
}

export interface KbSearchResult {
  chunk_id: string
  text: string
  source_doc_id: string
  source_filename: string
  source_path: string
  similarity: number
  score_percent: number
}
