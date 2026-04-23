import { useState, useCallback } from 'preact/hooks'

export interface ImageAttachment {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  dataBase64: string
  objectUrl: string
}

const VALID_IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function readFileAsBase64(file: File): Promise<{ mediaType: string; dataBase64: string; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      if (comma === -1) { reject(new Error('Invalid data URL')); return }
      const dataBase64 = result.slice(comma + 1)
      const objectUrl = URL.createObjectURL(file)
      resolve({ mediaType: file.type, dataBase64, objectUrl })
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

export function useImageAttachments() {
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])

  const addFiles = useCallback(async (files: File[]) => {
    const valid = files.filter((f) => VALID_IMAGE_TYPES.has(f.type))
    if (valid.length === 0) return
    const results = await Promise.all(valid.map(readFileAsBase64))
    setAttachments((prev) => [
      ...prev,
      ...results.map((r) => ({
        mediaType: r.mediaType as ImageAttachment['mediaType'],
        dataBase64: r.dataBase64,
        objectUrl: r.objectUrl,
      })),
    ])
  }, [])

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageItems: File[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item) continue
        if (item.kind === 'file' && VALID_IMAGE_TYPES.has(item.type)) {
          const file = item.getAsFile()
          if (file) imageItems.push(file)
        }
      }
      if (imageItems.length > 0) {
        e.preventDefault()
        void addFiles(imageItems)
      }
    },
    [addFiles],
  )

  const handleFileChange = useCallback(
    (e: Event) => {
      const input = e.target as HTMLInputElement
      if (!input.files) return
      void addFiles(Array.from(input.files))
      input.value = ''
    },
    [addFiles],
  )

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => {
      const next = [...prev]
      const removed = next.splice(idx, 1)
      for (const r of removed) URL.revokeObjectURL(r.objectUrl)
      return next
    })
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) URL.revokeObjectURL(a.objectUrl)
      return []
    })
  }, [])

  return {
    attachments,
    addFiles,
    handlePaste,
    handleFileChange,
    removeAttachment,
    clearAttachments,
  }
}
