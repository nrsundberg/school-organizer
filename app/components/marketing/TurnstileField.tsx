import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: { sitekey: string; action: string; theme: "dark" },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

function turnstileApi(): TurnstileApi | null {
  const candidate = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  return candidate ?? null;
}

/**
 * Explicit Turnstile widget. The token is written into
 * `cf-turnstile-response` inside this container. Pass a new `resetKey`
 * after a failed submit so the single-use token is replaced.
 */
export function TurnstileField({
  siteKey,
  action,
  resetKey,
}: {
  siteKey: string | null;
  action: string;
  resetKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;
    const mount = () => {
      const api = turnstileApi();
      if (!api || !ref.current || cancelled) return;
      widgetId.current = api.render(ref.current, {
        sitekey: siteKey,
        action,
        theme: "dark",
      });
    };
    if (turnstileApi()) {
      mount();
    } else {
      const selector = "script[data-turnstile]";
      let script = document.querySelector(selector) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.dataset.turnstile = "1";
        document.head.appendChild(script);
      }
      script.addEventListener("load", mount);
    }
    return () => {
      cancelled = true;
      const api = turnstileApi();
      if (widgetId.current && api) api.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action, resetKey]);

  if (!siteKey) return null;
  return <div ref={ref} className="min-h-16" />;
}
