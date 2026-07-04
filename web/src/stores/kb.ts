import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import type { KbDocument, KbSearchResult } from '@/types'

export const useKbStore = defineStore('kb', () => {
  const documents = ref<KbDocument[]>([])
  const searchResults = ref<KbSearchResult[]>([])
  const searchQuery = ref('')

  const loadingDocs = ref(false)
  const uploading = ref(false)
  const searching = ref(false)
  const error = ref('')

  async function fetchDocuments() {
    loadingDocs.value = true
    error.value = ''
    try {
      const res = await api.listKbDocuments()
      documents.value = res.items ?? []
    } catch (e: any) {
      error.value = e?.message || String(e)
      documents.value = []
    } finally {
      loadingDocs.value = false
    }
  }

  async function deleteDocument(docId: string) {
    error.value = ''
    try {
      await api.deleteKbDocument(docId)
      documents.value = documents.value.filter(d => d.doc_id !== docId)
    } catch (e: any) {
      error.value = e?.message || String(e)
      throw e
    }
  }

  async function uploadDocument(file: File, docId?: string) {
    uploading.value = true
    error.value = ''
    try {
      await api.uploadKbDocument(file, docId)
      await fetchDocuments()
    } catch (e: any) {
      error.value = e?.message || String(e)
      throw e
    } finally {
      uploading.value = false
    }
  }

  async function indexText(body: { content: string; doc_id: string; filename?: string; source?: string }) {
    uploading.value = true
    error.value = ''
    try {
      await api.indexKbText(body)
      await fetchDocuments()
    } catch (e: any) {
      error.value = e?.message || String(e)
      throw e
    } finally {
      uploading.value = false
    }
  }

  async function importUrl(body: { url: string; doc_id?: string }) {
    uploading.value = true
    error.value = ''
    try {
      await api.importKbUrl(body)
      await fetchDocuments()
    } catch (e: any) {
      error.value = e?.message || String(e)
      throw e
    } finally {
      uploading.value = false
    }
  }

  async function searchKb(query: string, topK: number = 5, threshold: number = 0.3) {
    if (!query.trim()) {
      searchResults.value = []
      searchQuery.value = ''
      return
    }
    searching.value = true
    error.value = ''
    searchQuery.value = query
    try {
      const res = await api.searchKb({ query, top_k: topK, threshold })
      searchResults.value = res.items ?? []
    } catch (e: any) {
      error.value = e?.message || String(e)
      searchResults.value = []
      throw e
    } finally {
      searching.value = false
    }
  }

  function clearSearch() {
    searchResults.value = []
    searchQuery.value = ''
  }

  return {
    documents,
    searchResults,
    searchQuery,
    loadingDocs,
    uploading,
    searching,
    error,
    fetchDocuments,
    deleteDocument,
    uploadDocument,
    indexText,
    importUrl,
    searchKb,
    clearSearch,
  }
})
