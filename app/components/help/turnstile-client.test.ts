import assert from "node:assert/strict";
import test from "node:test";
import {
  executeTurnstile,
  isTurnstileCancelled,
  TurnstileCancelledError,
} from "./turnstile-client";

type RenderCall = {
  el: FakeElement;
  options: Record<string, unknown>;
};

class FakeElement {
  isConnected = true;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  dataset: Record<string, string> = {};
  listeners = new Map<string, Array<() => void>>();
  appendChild(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  addEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  dispatch(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

function installBrowser(turnstile: Record<string, unknown> | undefined) {
  const previous = {
    turnstile: (globalThis as { turnstile?: unknown }).turnstile,
    document: globalThis.document,
  };
  const body = new FakeElement();
  const head = new FakeElement();
  const scripts: FakeElement[] = [];
  const doc = {
    head,
    body,
    querySelector(selector: string) {
      if (selector === "script[data-turnstile]") return scripts[0] ?? null;
      return null;
    },
    createElement() {
      const el = new FakeElement();
      scripts.push(el);
      return el;
    },
  };
  Object.assign(globalThis, { document: doc });
  if (turnstile) (globalThis as { turnstile?: unknown }).turnstile = turnstile;
  else delete (globalThis as { turnstile?: unknown }).turnstile;
  return {
    body,
    scripts,
    restore() {
      if (previous.turnstile === undefined) delete (globalThis as { turnstile?: unknown }).turnstile;
      else (globalThis as { turnstile?: unknown }).turnstile = previous.turnstile;
      Object.assign(globalThis, { document: previous.document });
    },
  };
}

test("Turnstile renders into the chat container, not document.body", async () => {
  const renders: RenderCall[] = [];
  const removed: string[] = [];
  const executed: string[] = [];
  const browser = installBrowser({
    render(el: FakeElement, options: Record<string, unknown>) {
      renders.push({ el, options });
      return "widget-1";
    },
    execute(id: string) {
      executed.push(id);
    },
    remove(id: string) {
      removed.push(id);
    },
  });
  const container = new FakeElement();
  try {
    const handle = executeTurnstile("site-key", "help_chat", container as unknown as HTMLElement);
    await Promise.resolve();
    assert.equal(renders.length, 1);
    assert.equal(renders[0]?.el, container);
    assert.equal(browser.body.children.length, 0);
    assert.equal(renders[0]?.options.appearance, "interaction-only");
    assert.equal(renders[0]?.options.execution, "execute");
    assert.equal(renders[0]?.options.size, "flexible");
    assert.equal(renders[0]?.options.action, "help_chat");
    assert.equal(renders[0]?.options.sitekey, "site-key");
    assert.deepEqual(executed, ["widget-1"]);
    (renders[0]?.options.callback as (token: string) => void)("token-1");
    assert.equal(await handle.token, "token-1");
    assert.deepEqual(removed, ["widget-1"]);
  } finally {
    browser.restore();
  }
});

test("closing the chat removes the widget so the next open can render again", async () => {
  const renders: RenderCall[] = [];
  const removed: string[] = [];
  let nextId = 0;
  const browser = installBrowser({
    render(el: FakeElement, options: Record<string, unknown>) {
      renders.push({ el, options });
      nextId += 1;
      return `widget-${nextId}`;
    },
    execute() {},
    remove(id: string) {
      removed.push(id);
    },
  });
  const first = new FakeElement();
  const second = new FakeElement();
  try {
    const initial = executeTurnstile("site-key", "help_chat", first as unknown as HTMLElement);
    await Promise.resolve();
    initial.dispose();
    await assert.rejects(initial.token, (error: unknown) => {
      assert.equal(isTurnstileCancelled(error), true);
      assert.ok(error instanceof TurnstileCancelledError);
      return true;
    });
    assert.deepEqual(removed, ["widget-1"]);

    first.isConnected = false;
    const reopened = executeTurnstile("site-key", "help_ticket", second as unknown as HTMLElement);
    await Promise.resolve();
    assert.equal(renders[1]?.el, second);
    assert.equal(renders[1]?.options.action, "help_ticket");
    (renders[1]?.options.callback as (token: string) => void)("token-2");
    assert.equal(await reopened.token, "token-2");
    assert.deepEqual(removed, ["widget-1", "widget-2"]);
  } finally {
    browser.restore();
  }
});

test("dispose before the script loads does not render into a detached container", async () => {
  const renders: unknown[] = [];
  const browser = installBrowser(undefined);
  const container = new FakeElement();
  try {
    const handle = executeTurnstile("site-key", "help_chat", container as unknown as HTMLElement);
    handle.dispose();
    const script = browser.scripts[0];
    assert.ok(script);
    (globalThis as { turnstile?: unknown }).turnstile = {
      render(el: unknown) {
        renders.push(el);
        return "late";
      },
      execute() {},
      remove() {},
    };
    script?.dispatch("load");
    await assert.rejects(handle.token, (error: unknown) => isTurnstileCancelled(error));
    await Promise.resolve();
    assert.equal(renders.length, 0);
    assert.equal(browser.body.children.length, 0);
  } finally {
    browser.restore();
  }
});
