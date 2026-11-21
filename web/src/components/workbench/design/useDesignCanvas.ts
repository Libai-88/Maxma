/**
 * 单个设计画布的 React 状态所有者：加载、撤销栈、按会话投影与防抖落盘。
 * 图片资源由 CanvasPane 通过 designCanvasStorage 单独管理。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ArtboardPreset, DesignAsset, DesignElement, DesignProject } from '@/types/designCanvas'
import { createDefaultProject, createImageElement, createShapeElement, createTextElement, normalizeDesignProject, reorderElements } from './canvasModel'
import { presetProjectArtboard } from './canvasModel'
import { loadDesignProject, saveDesignProject } from './designCanvasStorage'

const MAX_HISTORY = 30
const projectCache = new Map<string, DesignProject>()

export type DesignElementPatch = Partial<DesignElement>

interface HistoryState {
  undo: DesignProject[]
  redo: DesignProject[]
}

export interface DesignCanvasController {
  project: DesignProject | null
  loading: boolean
  selectedId: string | null
  canUndo: boolean
  canRedo: boolean
  select: (id: string | null) => void
  setProjectName: (name: string, options?: { history?: boolean }) => void
  applyPreset: (preset: ArtboardPreset) => void
  setArtboardSize: (width: number, height: number) => void
  setArtboardBackground: (color: string) => void
  addTextAt: (x: number, y: number) => DesignElement | null
  addShape: (type: 'rect' | 'ellipse' | 'line', x: number, y: number, width: number, height: number) => DesignElement | null
  addImage: (asset: DesignAsset) => DesignElement | null
  addCardText: (text: string, title: string) => DesignElement | null
  updateElement: (id: string, patch: DesignElementPatch, options?: { history?: boolean }) => void
  replaceElementImage: (id: string, asset: DesignAsset) => void
  removeElement: (id: string) => void
  duplicateElement: (id: string) => void
  reorder: (id: string, direction: 'up' | 'down') => void
  beginHistory: () => void
  undo: () => void
  redo: () => void
  reset: () => void
}

export function useDesignCanvas(sessionId: string | undefined): DesignCanvasController {
  const key = sessionId ?? 'global'
  const [project, setProject] = useState<DesignProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryState>({ undo: [], redo: [] })
  const projectRef = useRef<DesignProject | null>(null)
  const keyRef = useRef<string>('')
  const selectedRef = useRef<string | null>(null)

  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])

  const publish = useCallback((next: DesignProject) => {
    projectRef.current = next
    projectCache.set(keyRef.current, next)
    setProject(next)
  }, [])

  useEffect(() => {
    const previousKey = keyRef.current
    const previousProject = projectRef.current
    if (previousKey && previousKey !== key && previousProject) {
      void saveDesignProject(previousKey, previousProject)
    }
    keyRef.current = key

    let cancelled = false
    setLoading(true)
    setSelectedId(null)
    setHistory({ undo: [], redo: [] })

    const cached = projectCache.get(key)
    if (cached) {
      projectRef.current = cached
      setProject(cached)
      setLoading(false)
      return () => { cancelled = true }
    }

    void loadDesignProject(key).then((stored) => {
      if (cancelled) return
      const next = stored ? normalizeDesignProject(stored) : createDefaultProject()
      projectCache.set(key, next)
      projectRef.current = next
      setProject(next)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [key])

  useEffect(() => {
    if (!project || loading) return
    const timer = window.setTimeout(() => {
      void saveDesignProject(key, project)
    }, 420)
    return () => window.clearTimeout(timer)
  }, [project, loading, key])

  useEffect(() => {
    return () => {
      const latest = projectRef.current
      const latestKey = keyRef.current
      if (latest && latestKey) void saveDesignProject(latestKey, latest)
    }
  }, [])

  const mutate = useCallback((
    recipe: (current: DesignProject) => DesignProject | null,
    pushHistory: boolean,
  ): DesignProject | null => {
    const current = projectRef.current
    if (!current) return null
    const produced = recipe(current)
    if (!produced || produced === current) return null
    const next = { ...produced, updatedAt: Date.now() }
    if (pushHistory) {
      setHistory((state) => ({
        undo: [...state.undo.slice(-(MAX_HISTORY - 1)), current],
        redo: [],
      }))
    }
    publish(next)
    return next
  }, [publish])

  const beginHistory = useCallback(() => {
    const current = projectRef.current
    if (!current) return
    setHistory((state) => ({
      undo: [...state.undo.slice(-(MAX_HISTORY - 1)), current],
      redo: [],
    }))
  }, [])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
  }, [])

  const setProjectName = useCallback((name: string, options?: { history?: boolean }) => {
    const trimmed = name.trim().slice(0, 80) || '未命名设计'
    mutate((current) => (
      current.name === trimmed ? current : { ...current, name: trimmed }
    ), options?.history ?? false)
  }, [mutate])

  const applyPreset = useCallback((preset: ArtboardPreset) => {
    mutate((current) => presetProjectArtboard(current, preset), true)
  }, [mutate])

  const setArtboardSize = useCallback((width: number, height: number) => {
    mutate((current) => ({
      ...current,
      artboard: {
        ...current.artboard,
        width: Math.min(4096, Math.max(64, Math.round(width))),
        height: Math.min(4096, Math.max(64, Math.round(height))),
      },
    }), true)
  }, [mutate])

  const setArtboardBackground = useCallback((color: string) => {
    mutate((current) => ({ ...current, artboard: { ...current.artboard, background: color } }), true)
  }, [mutate])

  const addTextAt = useCallback((x: number, y: number) => {
    const current = projectRef.current
    if (!current) return null
    const element = createTextElement(x, y, current.elements)
    element.x = Math.round(Math.min(Math.max(0, element.x), Math.max(0, current.artboard.width - element.width)))
    element.y = Math.round(Math.min(Math.max(0, element.y), Math.max(0, current.artboard.height - element.height)))
    const next = mutate((state) => ({ ...state, elements: [...state.elements, element] }), true)
    if (next) setSelectedId(element.id)
    return next ? element : null
  }, [mutate])

  const addShape = useCallback((type: 'rect' | 'ellipse' | 'line', x: number, y: number, width: number, height: number) => {
    const current = projectRef.current
    if (!current) return null
    const element = { ...createShapeElement(type, x, y, width, height, current.elements) }
    const next = mutate((state) => ({ ...state, elements: [...state.elements, element] }), true)
    if (next) setSelectedId(element.id)
    return next ? element : null
  }, [mutate])

  const addImage = useCallback((asset: DesignAsset) => {
    const current = projectRef.current
    if (!current) return null
    const element = createImageElement(asset, current.artboard, current.elements)
    const next = mutate((state) => ({ ...state, elements: [...state.elements, element] }), true)
    if (next) setSelectedId(element.id)
    return next ? element : null
  }, [mutate])

  const addCardText = useCallback((text: string, title: string) => {
    const current = projectRef.current
    if (!current) return null
    const base = createTextElement(
      Math.round(current.artboard.width * 0.1),
      Math.round(current.artboard.height * 0.1),
      current.elements,
    )
    const element: DesignElement = {
      ...base,
      name: title.slice(0, 80) || base.name,
      width: Math.round(current.artboard.width * 0.8),
      height: Math.round(current.artboard.height * 0.72),
      fontSize: 36,
      fontWeight: 400,
      lineHeight: 1.6,
      text: text.slice(0, 20_000),
    }
    const next = mutate((state) => ({ ...state, elements: [...state.elements, element] }), true)
    if (next) setSelectedId(element.id)
    return next ? element : null
  }, [mutate])

  const updateElement = useCallback((id: string, patch: DesignElementPatch, options?: { history?: boolean }) => {
    mutate((current) => ({
      ...current,
      elements: current.elements.map((element) => (
        element.id === id ? ({ ...element, ...patch } as DesignElement) : element
      )),
    }), options?.history !== false)
  }, [mutate])

  const replaceElementImage = useCallback((id: string, asset: DesignAsset) => {
    mutate((current) => ({
      ...current,
      elements: current.elements.map((element) => (
        element.id === id && element.type === 'image'
          ? { ...element, assetId: asset.id, alt: asset.name.replace(/\.[^.]+$/, '') }
          : element
      )),
    }), true)
  }, [mutate])

  const removeElement = useCallback((id: string) => {
    mutate((current) => ({ ...current, elements: current.elements.filter((element) => element.id !== id) }), true)
    setSelectedId((current) => (current === id ? null : current))
  }, [mutate])

  const duplicateElement = useCallback((id: string) => {
    const current = projectRef.current
    if (!current) return
    const source = current.elements.find((element) => element.id === id)
    if (!source) return
    const copy: DesignElement = {
      ...source,
      id: `${source.id}-copy-${Date.now().toString(36)}`,
      name: `${source.name} 副本`,
      x: source.x + 24,
      y: source.y + 24,
    }
    const next = mutate((state) => ({ ...state, elements: [...state.elements, copy] }), true)
    if (next) setSelectedId(copy.id)
  }, [mutate])

  const reorder = useCallback((id: string, direction: 'up' | 'down') => {
    mutate((current) => ({ ...current, elements: reorderElements(current.elements, id, direction) }), true)
  }, [mutate])

  const undo = useCallback(() => {
    setHistory((state) => {
      const previous = state.undo[state.undo.length - 1]
      const current = projectRef.current
      if (!previous || !current) return state
      publish(previous)
      if (selectedRef.current && !previous.elements.some((element) => element.id === selectedRef.current)) {
        setSelectedId(null)
      }
      return { undo: state.undo.slice(0, -1), redo: [...state.redo.slice(-(MAX_HISTORY - 1)), current] }
    })
  }, [publish])

  const redo = useCallback(() => {
    setHistory((state) => {
      const nextProject = state.redo[state.redo.length - 1]
      const current = projectRef.current
      if (!nextProject || !current) return state
      publish(nextProject)
      if (selectedRef.current && !nextProject.elements.some((element) => element.id === selectedRef.current)) {
        setSelectedId(null)
      }
      return { undo: [...state.undo.slice(-(MAX_HISTORY - 1)), current], redo: state.redo.slice(0, -1) }
    })
  }, [publish])

  const reset = useCallback(() => {
    mutate(() => createDefaultProject(), true)
    setSelectedId(null)
  }, [mutate])

  return {
    project,
    loading,
    selectedId,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    select,
    setProjectName,
    applyPreset,
    setArtboardSize,
    setArtboardBackground,
    addTextAt,
    addShape,
    addImage,
    addCardText,
    updateElement,
    replaceElementImage,
    removeElement,
    duplicateElement,
    reorder,
    beginHistory,
    undo,
    redo,
    reset,
  }
}
