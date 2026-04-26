import { useSignal } from '@preact/signals'
import { useEffect, useRef, useCallback } from 'preact/hooks'
import { Html5Qrcode } from 'html5-qrcode'
import { Html5QrcodeScannerState } from 'html5-qrcode/esm/state-manager'
import { useTheme } from '../hooks/useTheme'

interface QRData {
  baseUrl: string
  token: string
  label?: string
}

interface QRScannerProps {
  onScan: (data: QRData) => void
  onClose: () => void
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const theme = useTheme()
  const isDark = theme.value === 'dark'
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const state = useSignal<'idle' | 'requesting' | 'scanning' | 'denied' | 'error'>('idle')
  const error = useSignal<string | null>(null)
  const manualMode = useSignal(false)
  const manualInput = useSignal('')
  const qrRegionId = 'qr-reader-region'

  const parseQRData = useCallback((text: string): QRData | null => {
    try {
      const data = JSON.parse(text) as unknown
      if (
        data !== null &&
        typeof data === 'object' &&
        'baseUrl' in data &&
        'token' in data &&
        typeof data.baseUrl === 'string' &&
        typeof data.token === 'string'
      ) {
        return {
          baseUrl: data.baseUrl,
          token: data.token,
          label: 'label' in data && typeof data.label === 'string' ? data.label : undefined,
        }
      }
      return null
    } catch {
      return null
    }
  }, [])

  const handleScanSuccess = useCallback(
    (decodedText: string) => {
      const data = parseQRData(decodedText)
      if (data) {
        void scannerRef.current?.stop()
        scannerRef.current = null
        onScan(data)
      } else {
        error.value = 'Invalid QR code format. Expected JSON with baseUrl and token.'
      }
    },
    [parseQRData, onScan, error],
  )

  const startScanner = useCallback(async () => {
    if (scannerRef.current) return
    state.value = 'requesting'
    error.value = null

    try {
      const scanner = new Html5Qrcode(qrRegionId)
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        handleScanSuccess,
        () => {
          // silent scan error handling
        },
      )

      state.value = 'scanning'
      if (navigator.vibrate) {
        navigator.vibrate(10)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start camera'
      if (message.includes('NotAllowedError') || message.includes('Permission denied')) {
        state.value = 'denied'
        error.value = 'Camera permission denied. Please allow camera access or use manual entry.'
      } else if (message.includes('NotFoundError')) {
        state.value = 'error'
        error.value = 'No camera found. Use manual entry instead.'
      } else {
        state.value = 'error'
        error.value = message
      }
      scannerRef.current = null
    }
  }, [state, error, handleScanSuccess])

  const stopScanner = useCallback(async () => {
    if (!scannerRef.current) return
    try {
      const scannerState = scannerRef.current.getState()
      if (scannerState === Html5QrcodeScannerState.SCANNING) {
        await scannerRef.current.stop()
      }
    } catch {
      // best effort
    }
    scannerRef.current = null
  }, [])

  const handleManualSubmit = useCallback(() => {
    const data = parseQRData(manualInput.value)
    if (data) {
      onScan(data)
    } else {
      error.value = 'Invalid format. Paste JSON with baseUrl and token.'
    }
  }, [manualInput, parseQRData, onScan, error])

  const handleSwitchToManual = useCallback(() => {
    void stopScanner()
    manualMode.value = true
    state.value = 'idle'
    error.value = null
  }, [stopScanner, manualMode, state, error])

  const handleSwitchToCamera = useCallback(() => {
    manualMode.value = false
    error.value = null
  }, [manualMode, error])

  useEffect(() => {
    if (!manualMode.value && state.value === 'idle') {
      void startScanner()
    }
    return () => {
      void stopScanner()
    }
  }, [manualMode.value, state.value, startScanner, stopScanner])

  const bgColor = isDark ? 'bg-gray-800' : 'bg-white'
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200'
  const textColor = isDark ? 'text-white' : 'text-slate-900'
  const mutedColor = isDark ? 'text-gray-400' : 'text-slate-500'

  return (
    <div class={`fixed inset-0 z-50 flex items-center justify-center`} data-testid="qr-scanner">
      <div class="absolute inset-0 bg-black/80" onClick={onClose} />
      <div
        class={`relative w-full max-w-md m-4 rounded-2xl shadow-2xl border ${borderColor} ${bgColor} overflow-hidden flex flex-col max-h-[90dvh]`}
      >
        <header class={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${borderColor}`}>
          <span class={`font-semibold text-sm ${textColor}`}>
            {manualMode.value ? 'Paste connection data' : 'Scan QR code'}
          </span>
          <button
            onClick={onClose}
            class={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-slate-500'}`}
            aria-label="Close scanner"
            data-testid="scanner-close-btn"
          >
            <span class="text-lg leading-none">&times;</span>
          </button>
        </header>

        <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {manualMode.value ? (
            <div class="flex flex-col gap-3">
              <p class={`text-sm ${mutedColor}`}>
                Paste the connection data from your QR code (JSON format):
              </p>
              <textarea
                data-testid="manual-input"
                value={manualInput.value}
                onInput={(e) => {
                  manualInput.value = (e.target as HTMLTextAreaElement).value
                }}
                placeholder='{"baseUrl":"https://...","token":"..."}'
                rows={6}
                class={`rounded-lg border ${isDark ? 'border-slate-600 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900'} px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500`}
              />
              <button
                onClick={handleManualSubmit}
                data-testid="manual-submit-btn"
                class="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                Add connection
              </button>
              <button
                onClick={handleSwitchToCamera}
                data-testid="switch-to-camera-btn"
                class={`text-sm ${isDark ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
              >
                ← Back to camera
              </button>
            </div>
          ) : (
            <>
              <div class="relative rounded-lg overflow-hidden bg-black min-h-[300px]">
                {state.value === 'idle' && (
                  <div class="absolute inset-0 flex items-center justify-center">
                    <div class="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
                  </div>
                )}
                {state.value === 'requesting' && (
                  <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
                    <div class="animate-spin h-8 w-8 border-4 border-white border-t-transparent rounded-full" />
                    <p class="text-sm">Requesting camera access...</p>
                  </div>
                )}
                <div id={qrRegionId} />
              </div>

              {state.value === 'scanning' && (
                <p class={`text-sm text-center ${mutedColor}`}>
                  Point your camera at a minion QR code
                </p>
              )}

              {(state.value === 'denied' || state.value === 'error') && error.value && (
                <div class="rounded-lg bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  {error.value}
                </div>
              )}

              {error.value && state.value === 'scanning' && (
                <div class="rounded-lg bg-yellow-50 dark:bg-yellow-900/30 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-300">
                  {error.value}
                </div>
              )}

              <button
                onClick={handleSwitchToManual}
                data-testid="switch-to-manual-btn"
                class={`text-sm ${isDark ? 'text-gray-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
              >
                Can't scan? Enter manually
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
