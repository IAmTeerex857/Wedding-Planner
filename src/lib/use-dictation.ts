import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice input for the composer.
 *
 * This uses the browser's own SpeechRecognition engine, which needs no model
 * download and starts instantly. Note that in Chrome it is a *cloud* service:
 * audio leaves the device. For a workspace that stores a couple's private
 * documents that is a real trade-off, and the alternative is running Whisper
 * locally through transformers.js — genuinely private, at the cost of a model
 * download on first use. The recogniser is isolated here so that swap is a
 * change to this file only.
 */

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type Constructor = new () => SpeechRecognitionLike

function getConstructor(): Constructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

export function useDictation(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const latest = useRef(onTranscript)
  const supported = Boolean(getConstructor())

  useEffect(() => { latest.current = onTranscript })

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Recognition = getConstructor()
    if (!Recognition) {
      setError('This browser cannot listen. Type your message instead.')
      return
    }

    const recognition = new Recognition()
    recognition.lang = 'en-NG'
    recognition.continuous = true
    recognition.interimResults = false

    recognition.onresult = (event) => {
      let text = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) text += result[0].transcript
      }
      if (text.trim()) latest.current(text.trim())
    }

    recognition.onerror = (event) => {
      setError(event.error === 'not-allowed' ? 'Microphone access was blocked.' : 'Could not hear that. Try again.')
      setListening(false)
    }

    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    setError('')
    setListening(true)
    recognition.start()
  }, [])

  useEffect(() => () => { recognitionRef.current?.abort() }, [])

  return { supported, listening, error, start, stop, toggle: () => (listening ? stop() : start()) }
}
