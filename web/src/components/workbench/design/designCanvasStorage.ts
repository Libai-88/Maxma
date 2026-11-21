/**
 * 设计画布持久化：项目与图片资源分开存。
 *
 * 项目只存元素元数据和 assetId，图片本体存 assets store；这样撤销快照
 * 不会把整张图复制几十份，刷新后也能恢复。IndexedDB 不可用时项目回退
 * localStorage，图片则只在当前内存里可用（会明确提示）。
 */
import type { DesignAsset, DesignProject } from '@/types/designCanvas'
import { normalizeDesignAsset, normalizeDesignProject } from './canvasModel'

const DB_NAME = 'maxma-design-canvas'
const DB_VERSION = 1
const PROJECT_STORE = 'projects'
const ASSET_STORE = 'assets'
const FALLBACK_PREFIX = 'maxmahere.design-canvas.v1:'

let databasePromise: Promise<IDBDatabase | null> | null = null

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null)
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PROJECT_STORE)) database.createObjectStore(PROJECT_STORE)
      if (!database.objectStoreNames.contains(ASSET_STORE)) database.createObjectStore(ASSET_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return databasePromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => resolve(null)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(true)
    transaction.onerror = () => resolve(false)
    transaction.onabort = () => resolve(false)
  })
}

function fallbackRead(key: string): DesignProject | null {
  try {
    const raw = localStorage.getItem(`${FALLBACK_PREFIX}${key}`)
    return raw ? normalizeDesignProject(JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function fallbackWrite(key: string, project: DesignProject): void {
  try {
    localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(project))
  } catch {
    // 配额满或隐私模式：本次会话仍保存在内存里。
  }
}

export async function loadDesignProject(key: string): Promise<DesignProject | null> {
  const database = await openDatabase()
  if (!database) return fallbackRead(key)
  try {
    const transaction = database.transaction(PROJECT_STORE, 'readonly')
    const request = transaction.objectStore(PROJECT_STORE).get(key)
    const value = await requestToPromise<unknown>(request)
    if (value) return normalizeDesignProject(value)
  } catch {
    // 继续尝试本地回退。
  }
  return fallbackRead(key)
}

export async function saveDesignProject(key: string, project: DesignProject): Promise<boolean> {
  fallbackWrite(key, project)
  const database = await openDatabase()
  if (!database) return false
  try {
    const transaction = database.transaction(PROJECT_STORE, 'readwrite')
    transaction.objectStore(PROJECT_STORE).put(project, key)
    return await transactionDone(transaction)
  } catch {
    return false
  }
}

export async function loadDesignAsset(id: string): Promise<DesignAsset | null> {
  const database = await openDatabase()
  if (!database) return null
  try {
    const transaction = database.transaction(ASSET_STORE, 'readonly')
    const request = transaction.objectStore(ASSET_STORE).get(id)
    const value = await requestToPromise<unknown>(request)
    return value ? normalizeDesignAsset(value) : null
  } catch {
    return null
  }
}

export async function saveDesignAsset(asset: DesignAsset): Promise<boolean> {
  const database = await openDatabase()
  if (!database) return false
  try {
    const transaction = database.transaction(ASSET_STORE, 'readwrite')
    transaction.objectStore(ASSET_STORE).put(asset, asset.id)
    return await transactionDone(transaction)
  } catch {
    return false
  }
}
