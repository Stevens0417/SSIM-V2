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
  stopListening: () => void;
  error: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWindow = Window & { SpeechRecognition?: any; webkitSpeechRecognition?: any };

function getSpeechRecognitionClass() {
  if (typeof window === "undefined") return null;
  const w = window as AnyWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechToText({
  onResult,
  lang = "en-US",
}: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a stable ref to the latest callback so recognition handlers don't go stale
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  // Active recognition instance — recreated on each startListening() call
  const recognitionRef = useRef<InstanceType<NonNullable<ReturnType<typeof getSpeechRecognitionClass>>> | null>(null);

  useEffect(() => {
    setSupported(!!getSpeechRecognitionClass());
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const startListening = useCallback(() => {
    const SR = getSpeechRecognitionClass();
    if (!SR || listening) return;

    // Always create a fresh instance — the spec doesn't allow restarting ended sessions
    const recognition = new SR();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text: string = event.results[i][0].transcript;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      if (event.error === "aborted") return; // intentional stop, not an error
      if (event.error === "not-allowed") {
        setError("Microphone access denied.");
      } else if (event.error === "no-speech") {
        // Benign — user didn't say anything
      } else {
        setError("Speech recognition error.");
      }
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    setError(null);
    setListening(true);

    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  }, [lang, listening]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    // onend will fire and setListening(false)
  }, []);

  return { supported, listening, startListening, stopListening, error };
}
