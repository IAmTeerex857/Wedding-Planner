import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice input for the composer.
 *
 * Two things run together: the browser's SpeechRecognition produces the text,
 * and a Web Audio analyser reads the microphone so the on-screen waveform
 * reflects what is actually being said. The bars are written straight to CSS
 * custom properties on `waveRef` rather than through React state, so a 60fps
 * meter costs no re-renders.
 *
 * Note that Chrome's SpeechRecognition is a cloud service: audio leaves the
 * device. For a workspace holding a couple's private documents that is a real
 * trade-off, and the alternative is Whisper running locally via transformers.js.
 * Both engines are isolated here so that swap is a change to this file only.
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

const BARS = 4
/** Below this the meter rests, so room tone does not look like speech. */
const NOISE_FLOOR = 0.04

function getConstructor(): Constructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

export function useDictation(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const waveRef = useRef<HTMLSpanElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const frameRef = useRef(0)
  const latest = useRef(onTranscript)
  const supported = Boolean(getConstructor())

  useEffect(() => { latest.current = onTranscript })

  const resetBars = useCallback(() => {
    const node = waveRef.current
    if (!node) return
    for (let index = 0; index < BARS; index += 1) node.style.setProperty(`--l${index + 1}`, '0')
  }, [])

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    void contextRef.current?.close()
    contextRef.current = null
    resetBars()
  }, [resetBars])

  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const context = new AudioContext()
      contextRef.current = context
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.75
      context.createMediaStreamSource(stream).connect(analyser)

      const bins = new Uint8Array(analyser.frequencyBinCount)
      // Speech sits low in the spectrum, so only the lower half is metered.
      const usable = Math.floor(bins.length / 2)
      const perBar = Math.floor(usable / BARS)

      const tick = () => {
        analyser.getByteFrequencyData(bins)
        const node = waveRef.current
        if (node) {
          for (let bar = 0; bar < BARS; bar += 1) {
            let total = 0
            for (let index = bar * perBar; index < (bar + 1) * perBar; index += 1) total += bins[index]
            const average = total / perBar / 255
            const level = average < NOISE_FLOOR ? 0 : Math.min(1, (average - NOISE_FLOOR) * 3.2)
            node.style.setProperty(`--l${bar + 1}`, level.toFixed(3))
          }
        }
        frameRef.current = requestAnimationFrame(tick)
      }
      frameRef.current = requestAnimationFrame(tick)
    } catch {
      // The meter is decorative; dictation still works without it.
      resetBars()
    }
  }, [resetBars])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    stopMeter()
    setListening(false)
  }, [stopMeter])

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
      stopMeter()
      setListening(false)
    }

    recognition.onend = () => {
      stopMeter()
      setListening(false)
    }

    recognitionRef.current = recognition
    setError('')
    setListening(true)
    recognition.start()
    void startMeter()
  }, [startMeter, stopMeter])

  useEffect(() => () => {
    recognitionRef.current?.abort()
    cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    void contextRef.current?.close()
  }, [])

  return { supported, listening, error, waveRef, start, stop, toggle: () => (listening ? stop() : start()) }
}
