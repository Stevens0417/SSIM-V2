"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UseSpeechToTextOptions {
  /** Called with each transcript update. isFinal=true when the phrase is committed. */
  onResult: (transcript: string, isFinal: boolean) => void;
  lang?: string;
}

interface UseSpeechToTextReturn {
  supported: boolean;
  listening: boolean;
  startListening: () => void;
  /** Graceful stop — finishes processing captured speech before ending. Use for the mic toggle button. */
  stopListening: () => void;
  /** Immediate abort — discards pending speech and fires no further onresult events. Use before sending a message. */
  abortListening: () => void;
  error: string | null;
}

// Minimal Web Speech API types (not included in all TypeScript DOM lib versions)
interface SpeechRecognitionAlternative { readonly transcript: string }
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

// Window augmented with the webkit-prefixed variant present in Safari/iOS
type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

function getSR(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechToText({
  onResult,
  lang = "en-US",
}: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable ref to the latest callback — avoids stale closures in recognition handlers
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  // Ref-tracked listening state so startListening/stopListening don't need it in deps
  const listeningRef = useRef(false);
  const setListeningSync = (val: boolean) => {
    listeningRef.current = val;
    setListening(val);
  };

  // Active recognition instance
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    setSupported(!!getSR());
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const startListening = useCallback(() => {
    if (listeningRef.current) return;
    const SR = getSR();
    if (!SR) return;

    // Always create a fresh instance — the spec doesn't support restarting ended sessions
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    // continuous: true keeps the session alive until stop() is called explicitly,
    // preventing the immediate auto-shutoff that occurs with continuous: false.
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionResultEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }
      if (final) {
        onResultRef.current(final, true);
      } else if (interim) {
        onResultRef.current(interim, false);
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "aborted" fires when stop/abort is called intentionally — not an error
      if (event.error === "aborted") return;
      if (event.error === "not-allowed") {
        setError("Microphone access denied.");
      } else if (event.error !== "no-speech") {
        setError("Speech recognition error.");
      }
      setListeningSync(false);
    };

    rec.onend = () => {
      setListeningSync(false);
    };

    recognitionRef.current = rec;
    setError(null);
    setListeningSync(true);

    try {
      rec.start();
    } catch {
      setListeningSync(false);
    }
  }, [lang]);

  const stopListening = useCallback(() => {
    // stop() asks recognition to finish the current phrase then fires onend
    recognitionRef.current?.stop();
  }, []);

  const abortListening = useCallback(() => {
    // abort() immediately discards any pending speech — no further onresult callbacks fire.
    // onerror fires with "aborted" which is already ignored in the onerror handler.
    recognitionRef.current?.abort();
  }, []);

  return { supported, listening, startListening, stopListening, abortListening, error };
}
