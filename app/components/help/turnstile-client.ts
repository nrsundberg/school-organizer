type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  execute: (id: string) => void;
  remove: (id: string) => void;
};

function turnstileApi(): TurnstileApi | null {
  const candidate = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  return candidate ?? null;
}

function loadTurnstile(): Promise<void> {
  const ready = turnstileApi();
  if (ready) return Promise.resolve();
  const selector = "script[data-turnstile]";
  let script = document.querySelector(selector) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.dataset.turnstile = "1";
    document.head.appendChild(script);
  }
  return new Promise((resolve, reject) => {
    if (turnstileApi()) {
      resolve();
      return;
    }
    script?.addEventListener("load", () => resolve(), { once: true });
    script?.addEventListener("error", () => reject(new Error("turnstile")), { once: true });
  });
}

/**
 * Managed Turnstile, run on demand. The widget stays invisible unless
 * Cloudflare asks the visitor to interact.
 */
export async function executeTurnstile(siteKey: string, action: string): Promise<string> {
  await loadTurnstile();
  const api = turnstileApi();
  if (!api) throw new Error("turnstile");
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Promise((resolve, reject) => {
    let widgetId = "";
    const timeout = window.setTimeout(() => {
      finish(new Error("timeout"));
    }, 20_000);
    const finish = (error?: Error, token?: string) => {
      window.clearTimeout(timeout);
      if (widgetId) api.remove(widgetId);
      el.remove();
      if (error) reject(error);
      else resolve(token ?? "");
    };
    widgetId = api.render(el, {
      sitekey: siteKey,
      action,
      theme: "dark",
      appearance: "interaction-only",
      execution: "execute",
      callback: (token: string) => finish(undefined, token),
      "error-callback": () => finish(new Error("turnstile")),
    });
    api.execute(widgetId);
  });
}
