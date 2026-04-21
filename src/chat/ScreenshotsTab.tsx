import { useEffect, useRef, useState } from 'preact/hooks'
import type { ApiClient } from '../api/client'
import type { ScreenshotEntry, ScreenshotList } from '../api/types'
import { Skeleton } from '../components/Skeleton'

interface ScreenshotsTabProps {
  sessionId: string
  sessionUpdatedAt: string
  client: ApiClient
}

export function ScreenshotsTab({ sessionId, sessionUpdatedAt, client }: ScreenshotsTabProps) {
  const [list, setList] = useState<ScreenshotList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map())
  const [lightbox, setLightbox] = useState<number | null>(null)
  const urlsRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url)
      urlsRef.current = new Map()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    client
      .listScreenshots(sessionId)
      .then((l) => {
        if (cancelled) return
        setList(l)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, sessionUpdatedAt, client])

  useEffect(() => {
    if (!list) return
    const wanted = new Set(list.screenshots.map((s) => s.file))
    const currentMap = urlsRef.current
    let dirty = false

    for (const [file, url] of currentMap.entries()) {
      if (!wanted.has(file)) {
        URL.revokeObjectURL(url)
        currentMap.delete(file)
        dirty = true
      }
    }

    const missing = list.screenshots.filter((s) => !currentMap.has(s.file))
    let cancelled = false
    for (const s of missing) {
      void client
        .fetchScreenshotBlob(s.url)
        .then((blob) => {
          if (cancelled) return
          const existing = currentMap.get(s.file)
          if (existing) URL.revokeObjectURL(existing)
          const url = URL.createObjectURL(blob)
          currentMap.set(s.file, url)
          setBlobUrls(new Map(currentMap))
        })
        .catch(() => {
          // per-file fetch error is non-fatal; surface overall error if all fail
        })
    }
    if (dirty) setBlobUrls(new Map(currentMap))

    return () => {
      cancelled = true
    }
  }, [list, client])

  useEffect(() => {
    if (lightbox === null) return
    const handler = (e: KeyboardEvent) => {
      if (!list) return
      const n = list.screenshots.length
      if (e.key === 'Escape') setLightbox(null)
      else if (e.key === 'ArrowRight') setLightbox((i) => (i === null ? 0 : (i + 1) % n))
      else if (e.key === 'ArrowLeft') setLightbox((i) => (i === null ? 0 : (i - 1 + n) % n))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox, list])

  if (loading && !list) {
    return (
      <div class="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2 p-3" data-testid="screenshots-loading">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={96} rounded="md" />
        ))}
      </div>
    )
  }
  if (error && !list) {
    return (
      <div class="flex-1 flex items-center justify-center text-xs text-red-600 dark:text-red-400" data-testid="screenshots-error">
        {error}
      </div>
    )
  }
  if (!list) return null

  const screenshots = list.screenshots
  if (screenshots.length === 0) {
    return (
      <div class="flex-1 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400 italic" data-testid="screenshots-empty">
        No screenshots yet.
      </div>
    )
  }

  return (
    <div class="flex flex-col flex-1 min-h-0 bg-slate-50 dark:bg-slate-900" data-testid="screenshots-tab">
      <div class="flex-1 overflow-auto p-4">
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {screenshots.map((s, idx) => (
            <ScreenshotThumb
              key={s.file}
              entry={s}
              blobUrl={blobUrls.get(s.file) ?? null}
              onOpen={() => setLightbox(idx)}
            />
          ))}
        </div>
      </div>
      {lightbox !== null && screenshots[lightbox] && (
        <Lightbox
          entry={screenshots[lightbox]}
          blobUrl={blobUrls.get(screenshots[lightbox].file) ?? null}
          onClose={() => setLightbox(null)}
          onPrev={() => setLightbox((i) => (i === null ? 0 : (i - 1 + screenshots.length) % screenshots.length))}
          onNext={() => setLightbox((i) => (i === null ? 0 : (i + 1) % screenshots.length))}
          canNavigate={screenshots.length > 1}
        />
      )}
    </div>
  )
}

function ScreenshotThumb({
  entry,
  blobUrl,
  onOpen,
}: {
  entry: ScreenshotEntry
  blobUrl: string | null
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      class="group flex flex-col gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden hover:border-indigo-400 dark:hover:border-indigo-600"
      data-testid="screenshot-thumb"
    >
      <div class="aspect-video bg-slate-100 dark:bg-slate-900 flex items-center justify-center overflow-hidden">
        {blobUrl ? (
          <img src={blobUrl} alt={entry.caption ?? entry.file} class="w-full h-full object-cover" />
        ) : (
          <span class="text-[10px] text-slate-400 dark:text-slate-500">Loading…</span>
        )}
      </div>
      <div class="px-2 py-1 text-left">
        <div class="text-[11px] font-mono text-slate-700 dark:text-slate-200 truncate">
          {entry.caption ?? entry.file}
        </div>
        <div class="text-[10px] text-slate-500 dark:text-slate-400">
          {new Date(entry.capturedAt).toLocaleString()}
        </div>
      </div>
    </button>
  )
}

function Lightbox({
  entry,
  blobUrl,
  onClose,
  onPrev,
  onNext,
  canNavigate,
}: {
  entry: ScreenshotEntry
  blobUrl: string | null
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  canNavigate: boolean
}) {
  return (
    <div
      class="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="screenshot-lightbox"
    >
      <div
        class="relative max-w-full max-h-full flex flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {blobUrl ? (
          <img
            src={blobUrl}
            alt={entry.caption ?? entry.file}
            class="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl"
          />
        ) : (
          <div class="text-xs text-slate-200">Loading…</div>
        )}
        <div class="flex items-center gap-3 text-xs text-slate-200">
          <span class="font-mono truncate max-w-[60vw]">{entry.caption ?? entry.file}</span>
          <span class="text-slate-400">{new Date(entry.capturedAt).toLocaleString()}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          class="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-white text-slate-900 text-sm font-bold shadow hover:bg-slate-100"
          aria-label="Close"
          data-testid="screenshot-lightbox-close"
        >
          ×
        </button>
        {canNavigate && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPrev() }}
              class="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-slate-900 text-lg font-bold shadow hover:bg-white"
              aria-label="Previous"
              data-testid="screenshot-lightbox-prev"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onNext() }}
              class="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-slate-900 text-lg font-bold shadow hover:bg-white"
              aria-label="Next"
              data-testid="screenshot-lightbox-next"
            >
              ›
            </button>
          </>
        )}
      </div>
    </div>
  )
}
