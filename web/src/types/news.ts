/** 系统更新动态（News）类型定义 */

export interface NewsEntry {
  id: string
  en_title: string | null
  title: string
  description: string
  type: string
  date: string
  tags: string[]
  version: string
  pr_number: number
}

export interface ListNewsResponse {
  news: NewsEntry[]
}
