import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

export interface UseSpeechRecognitionOptions {
  lang?: string
  onFinal: (text: string) => void
  onInterim?: (text: string) => void
  onError?: (message: string) => void
}

export interface UseSpeechRecognitionResult {
  supported: boolean
  recording: boolean
  start: () => void
  stop: () => void
}

function getConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined
  return window.SpeechRecognition ?? window.webkitSpeechRecognition
}

function friendlyError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission denied'
    case 'no-speech':
      return 'No speech detected'
    case 'audio-capture':
      return 'No microphone available'
    case 'network':
      return 'Network error during transcription'
    case 'language-not-supported':
      return 'Language not supported'
    case 'aborted':
      return ''
    default:
      return `Voice input error: ${code}`
  }
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions,
): UseSpeechRecognitionResult {
  const { lang, onFinal, onInterim, onError } = options
  const Ctor = getConstructor()
  const supported = Boolean(Ctor)
  const [recording, setRecording] = useState(false)
  const recRef = useRef<SpeechRecognition | null>(null)
  const onFinalRef = useRef(onFinal)
  const onInterimRef = useRef(onInterim)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onFinalRef.current = onFinal
    onInterimRef.current = onInterim
    onErrorRef.current = onError
  }, [onFinal, onInterim, onError])

  const stop = useCallback(() => {
    const rec = recRef.current
    if (!rec) return
    try {
      rec.stop()
    } catch {
      /* noop */
    }
  }, [])

  const start = useCallback(() => {
    if (!Ctor || recRef.current) return
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.lang = lang ?? navigator.language ?? 'en-US'

    rec.onstart = () => {
      setRecording(true)
    }
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          if (transcript) onFinalRef.current(transcript)
        } else {
          interim += transcript
        }
      }
      if (interim) onInterimRef.current?.(interim)
    }
    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      const message = friendlyError(event.error)
      if (message) onErrorRef.current?.(message)
    }
    rec.onend = () => {
      recRef.current = null
      setRecording(false)
    }

    recRef.current = rec
    try {
      rec.start()
    } catch (err) {
      recRef.current = null
      setRecording(false)
      onErrorRef.current?.(err instanceof Error ? err.message : 'Could not start voice input')
    }
  }, [Ctor, lang])

  useEffect(() => {
    return () => {
      const rec = recRef.current
      if (!rec) return
      try {
        rec.abort()
      } catch {
        /* noop */
      }
      recRef.current = null
    }
  }, [])

  return { supported, recording, start, stop }
}
