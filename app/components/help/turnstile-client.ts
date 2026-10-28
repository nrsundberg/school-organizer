type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  execute: (id: string) => void;
  remove: (id: string) => void;
};

/** Visitor closed the chat or the slot unmounted before a token was issued. */
export class TurnstileCancelledError extends Error {
  constructor() {
    super("turnstile-cancelled");
    this.name = "TurnstileCancelledError";
  }
}

export function isTurnstileCancelled(error: unknown): boolean {
  return error instanceof TurnstileCancelledError;
}

function turnstileApi(): TurnstileApi | null {
  const candidate = (globalThis as { turnstile?: TurnstileApi }).turnstile;
  return candidate ?? null;
}

function loadTurnstile(): Promise<void> {
  const ready = turnstileApi();
  if (ready) return Promise.resolve();
  const doc = globalThis.document;
  if (!doc) return Promise.reject(new Error("turnstile"));
  const selector = "script[data-turnstile]";
  let script = doc.querySelector(selector) as HTMLScriptElement | null;
  if (!script) {
    script = doc.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.dataset.turnstile = "1";
    doc.head.appendChild(script);
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

export type TurnstileHandle = {
  token: Promise<string>;
  dispose: () => void;
};

/**
 * Managed Turnstile (`appearance: interaction-only`), rendered into a
 * container the chat panel owns. The widget stays invisible unless
 * Cloudflare asks the visitor to interact, and that challenge grows
 * inside `container` — never on `document.body`, where it lands outside
 * the fixed panel. `dispose` removes it so a later open can render fresh.
 */
export function executeTurnstile(
  siteKey: string,
  action: string,
  container: HTMLElement,
): TurnstileHandle {
  let widgetId = "";
  let settled = false;
  let disposed = false;
  let resolveToken: (token: string) => void = () => {};
  let rejectToken: (error: Error) => void = () => {};
  const token = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });
  void token.catch(() => {});

  const schedule = globalThis.setTimeout.bind(globalThis);
  const cancelTimer = globalThis.clearTimeout.bind(globalThis);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const finish = (error?: Error, value?: string) => {
    if (settled) return;
    settled = true;
    cancelTimer(timeout);
    const api = turnstileApi();
    if (widgetId && api) {
      try {
        api.remove(widgetId);
      } catch {
        // Widget node already left the document.
      }
    }
    widgetId = "";
    if (error) rejectToken(error);
    else resolveToken(value ?? "");
  };

  timeout = schedule(() => finish(new Error("timeout")), 180_000);

  const dispose = () => {
    disposed = true;
    finish(new TurnstileCancelledError());
  };

  loadTurnstile()
    .then(() => {
      if (disposed || !container.isConnected) {
        finish(new TurnstileCancelledError());
        return;
      }
      const api = turnstileApi();
      if (!api) {
        finish(new Error("turnstile"));
        return;
      }
      widgetId = api.render(container, {
        sitekey: siteKey,
        action,
        theme: "dark",
        size: "flexible",
        appearance: "interaction-only",
        execution: "execute",
        callback: (next: string) => finish(undefined, next),
        "error-callback": () => finish(new Error("turnstile")),
        "expired-callback": () => finish(new Error("turnstile")),
        "timeout-callback": () => finish(new Error("timeout")),
      });
      if (disposed || !container.isConnected) {
        finish(new TurnstileCancelledError());
        return;
      }
      api.execute(widgetId);
    })
    .catch(() => finish(new Error("turnstile")));

  return { token, dispose };
}
