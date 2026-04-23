import { useRef, useCallback, useState } from 'preact/hooks'

export interface ImageAttachment {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  dataBase64: string
  objectUrl: string
}

const VALID_IMAGE_TYPES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024

function readFileAsBase64(file: File): Promise<{ mediaType: string; dataBase64: string; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_SIZE_BYTES) {
      reject(new Error(`Image too large (max 10MB): ${file.name}`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      if (comma === -1) {
        reject(new Error('Invalid data URL'))
        return
      }
      const dataBase64 = result.slice(comma + 1)
      const objectUrl = URL.createObjectURL(file)
      resolve({ mediaType: file.type, dataBase64, objectUrl })
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

export function useImageAttachments(disabled: boolean) {
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const pasteHandler = useCallback(
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

  const clear = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) URL.revokeObjectURL(a.objectUrl)
      return []
    })
  }, [])

  const paperclipButton = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        onChange={handleFileChange}
        data-testid="file-input"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach image"
        title="Attach image"
        class="shrink-0 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors border shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600"
        data-testid="attach-btn"
      >
        <PaperclipIcon />
      </button>
    </>
  )

  const attachmentsStrip =
    attachments.length > 0 ? (
      <div class="flex flex-wrap gap-2" data-testid="attachment-strip">
        {attachments.map((a, idx) => (
          <div
            key={a.objectUrl}
            class="relative w-16 h-16 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 flex-shrink-0"
          >
            <img src={a.objectUrl} alt={`attachment ${idx + 1}`} class="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removeAttachment(idx)}
              class="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-black/60 text-white text-[10px] rounded-bl"
              aria-label={`Remove attachment ${idx + 1}`}
              data-testid={`remove-attachment-${idx}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    ) : null

  return {
    attachments,
    paperclipButton,
    attachmentsStrip,
    pasteHandler,
    clear,
  }
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a1.5 1.5 0 0 0 2.122 2.122l6.5-6.5a.75.75 0 0 1 1.06 1.06l-6.5 6.5a3 3 0 0 1-4.242-4.243l7-7a4.5 4.5 0 0 1 6.364 6.364l-7 7a6 6 0 0 1-8.485-8.486l5.5-5.5a.75.75 0 0 1 1.06 1.061l-5.5 5.5a4.5 4.5 0 0 0 6.365 6.364l7-7a3 3 0 0 0 0-4.243Z"
        clipRule="evenodd"
      />
    </svg>
  )
}
