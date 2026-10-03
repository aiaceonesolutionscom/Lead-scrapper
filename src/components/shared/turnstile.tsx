"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

interface TurnstileProps {
  onToken: (token: string) => void;
  onExpired?: () => void;
  onTimeout?: () => void;
  // React 19 ref-as-prop: filled with a function the owner can call to force
  // a fresh challenge. Turnstile tokens are single-use — after a submit the
  // consumed token must never be sent again, so the login page resets here.
  resetRef?: React.MutableRefObject<(() => void) | null>;
  className?: string;
}

export function Turnstile({ onToken, onExpired, onTimeout, resetRef, className }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>("");
  const tokenCbRef = useRef(onToken);
  const expiredCbRef = useRef(onExpired);
  const timeoutCbRef = useRef(onTimeout);
  const timedOutRef = useRef(false);
  const receivedTokenRef = useRef(false);

  useEffect(() => {
    tokenCbRef.current = (token: string) => {
      receivedTokenRef.current = true;
      onToken(token);
    };
  }, [onToken]);

  useEffect(() => {
    expiredCbRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    timeoutCbRef.current = onTimeout;
  }, [onTimeout]);

  // If Turnstile doesn't produce a token within 15s the challenge endpoint is
  // likely unreachable (CGNAT / DNS / network issue). Fire onTimeout so the
  // caller can fall back to rate-limited submission without a CAPTCHA token.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const timer = setTimeout(() => {
      if (!timedOutRef.current && !receivedTokenRef.current) {
        timedOutRef.current = true;
        timeoutCbRef.current?.();
      }
    }, 15_000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;

    if (resetRef) {
      resetRef.current = () => {
        timedOutRef.current = false;
        receivedTokenRef.current = false;
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.reset(widgetIdRef.current);
          } catch {
            // widget already gone
          }
        }
      };
    }

    function attach() {
      const el = containerRef.current;
      if (!el || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t: string) => tokenCbRef.current(t),
        "expired-callback": () => expiredCbRef.current?.(),
      });
    }

    if (window.turnstile) {
      attach();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="challenges.cloudflare.com/turnstile"]'
    );
    if (existing) {
      existing.addEventListener("load", attach);
      return () => existing.removeEventListener("load", attach);
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = attach;
    document.body.appendChild(script);

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // already removed
        }
      }
    };
  }, [resetRef]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={containerRef} className={className} />;
}