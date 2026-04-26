import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import QrScannerLib from 'qr-scanner'
import type { Connection } from './types'

interface QrScannerProps {
  onScan: (data: Partial<Pick<Connection, 'baseUrl' | 'token' | 'label'>>) => void
  onError: (error: string) => void
  onClose: () => void
}

export function QrScanner({ onScan, onError, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScannerLib | null>(null)
  const hasScanned = useSignal(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const scanner = new QrScannerLib(
      video,
      (result) => {
        if (hasScanned.value) return
        hasScanned.value = true

        try {
          const data = JSON.parse(result.data)
          if (!data.baseUrl || typeof data.baseUrl !== 'string') {
            onError('Invalid QR code: missing baseUrl')
            hasScanned.value = false
            return
          }
          if (!data.token || typeof data.token !== 'string') {
            onError('Invalid QR code: missing token')
            hasScanned.value = false
            return
          }
          const parsed: Partial<Pick<Connection, 'baseUrl' | 'token' | 'label'>> = {
            baseUrl: data.baseUrl,
            token: data.token,
          }
          if (data.label && typeof data.label === 'string') {
            parsed.label = data.label
          }
          onScan(parsed)
          onClose()
        } catch (e) {
          onError(e instanceof Error ? e.message : 'Invalid QR code format')
          hasScanned.value = false
        }
      },
      {
        returnDetailedScanResult: true,
        highlightScanRegion: true,
        highlightCodeOutline: true,
      }
    )

    scannerRef.current = scanner

    scanner.start().catch((e) => {
      onError(e instanceof Error ? e.message : 'Failed to start camera')
    })

    return () => {
      scanner.stop()
      scanner.destroy()
    }
  }, [onScan, onError, onClose])

  return (
    <div class="relative w-full aspect-square max-w-md mx-auto rounded-lg overflow-hidden bg-black">
      <video
        ref={videoRef}
        class="w-full h-full object-cover"
        data-testid="qr-video"
      />
      <div class="absolute inset-0 pointer-events-none">
        <div class="absolute inset-0 border-4 border-white/20 rounded-lg" />
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-white rounded-lg" />
      </div>
      <button
        onClick={onClose}
        class="absolute top-3 right-3 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        aria-label="Close scanner"
        data-testid="qr-close-btn"
      >
        <span class="text-xl leading-none">&times;</span>
      </button>
      <div class="absolute bottom-4 left-0 right-0 text-center">
        <p class="text-sm text-white bg-black/50 px-4 py-2 rounded-full inline-block">
          Point camera at QR code
        </p>
      </div>
    </div>
  )
}
