import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";
import { MessageCircle, X } from "lucide-react";
import { executeTurnstile } from "./turnstile-client";

type Turn = { role: "user" | "assistant"; content: string };

type Props = {
  signedInEmail: string | null;
  signedInName: string | null;
  turnstileSiteKey: string | null;
  chatEnabled: boolean;
};

const SESSION_KEY = "pickuproster.helpSession";
const GRANT_KEY = "pickuproster.helpGrant";
const LINK_RE = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

function helpGrant(): string {
  try {
    return sessionStorage.getItem(GRANT_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeHelpGrant(grant: string | null | undefined) {
  try {
    if (grant) sessionStorage.setItem(GRANT_KEY, grant);
    else sessionStorage.removeItem(GRANT_KEY);
  } catch {
    // private mode
  }
}

function helpSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function hiddenOnPath(pathname: string): boolean {
  return (
    pathname.startsWith("/admin/print") ||
    pathname === "/drills/live" ||
    pathname.startsWith("/platform")
  );
}

function renderInline(text: string) {
  const nodes: Array<string | { href: string; label: string; key: number }> = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    nodes.push({ href: match[2] ?? "/", label: match[1] ?? "link", key: index });
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.map((node, index) =>
    typeof node === "string" ? (
      <span key={index}>{node}</span>
    ) : (
      <a key={node.key} href={node.href} className="underline">
        {node.label}
      </a>
    ),
  );
}

function MessageBody({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => (
        <p key={index} className="whitespace-pre-wrap">
          {renderInline(block)}
        </p>
      ))}
    </div>
  );
}

export function HelpChatWidget({
  signedInEmail,
  signedInName,
  turnstileSiteKey,
  chatEnabled,
}: Props) {
  const { pathname } = useLocation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!chatEnabled);
  const [ticketSent, setTicketSent] = useState(false);
  const [name, setName] = useState(signedInName ?? "");
  const [email, setEmail] = useState(signedInEmail ?? "");
  const [ticketMessage, setTicketMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (hiddenOnPath(pathname)) return null;

  async function sendChat(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const nextTurns: Turn[] = [...turns, { role: "user", content }];
    setTurns(nextTurns);
    setDraft("");
    setPending(true);
    setError(null);
    try {
      const payload = await postChat(nextTurns, false);
      if (!payload) return;
      storeHelpGrant(payload.sessionGrant);
      setTurns([...nextTurns, { role: "assistant", content: payload.reply ?? "" }]);
      if (payload.suggestEscalation) {
        setShowForm(true);
        setTicketMessage((current) => current || content);
      }
    } catch {
      setError("The help assistant is unavailable right now.");
    } finally {
      setPending(false);
    }
  }

  async function challengeToken(action: string): Promise<string | undefined> {
    if (!turnstileSiteKey) return undefined;
    return executeTurnstile(turnstileSiteKey, action);
  }

  async function postChat(nextTurns: Turn[], challenged: boolean) {
    let turnstileToken: string | undefined;
    if (!helpGrant()) {
      try {
        turnstileToken = await challengeToken("help_chat");
      } catch {
        setError("Confirm you're a person, then send your message again.");
        return null;
      }
    }
    const response = await fetch("/api/help/chat", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        messages: nextTurns,
        pagePath: pathname,
        sessionId: helpSessionId(),
        sessionGrant: helpGrant(),
        turnstileToken,
      }),
    });
    const payload = (await response.json()) as {
      reply?: string;
      suggestEscalation?: boolean;
      error?: string;
      code?: string;
      sessionGrant?: string | null;
    };
    if (response.status === 403 && payload.code === "challenge" && !challenged) {
      storeHelpGrant(null);
      return postChat(nextTurns, true);
    }
    if (!response.ok || !payload.reply) {
      setError(payload.error || "The help assistant is unavailable right now.");
      if (payload.code === "unconfigured" || payload.code === "disabled" || payload.code === "quota") {
        setShowForm(true);
      }
      return null;
    }
    return payload;
  }

  async function sendTicket() {
    setPending(true);
    setError(null);
    try {
      let turnstileToken: string | undefined;
      try {
        turnstileToken = await challengeToken("help_ticket");
      } catch {
        setError("Confirm you're a person, then try again.");
        return;
      }
      const response = await fetch("/api/help/ticket", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          name,
          email,
          message: ticketMessage,
          source: "chat",
          pagePath: pathname,
          transcript: turns,
          company_website: honeypot,
          turnstileToken,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error || "We couldn't send that.");
        return;
      }
      setTicketSent(true);
    } catch {
      setError("We couldn't send that.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="print:hidden">
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="fixed bottom-20 right-4 z-[70] flex max-h-[min(32rem,calc(100vh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#151a1a] text-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <h2 id={titleId} className="text-sm font-semibold">
                PickupRoster help
              </h2>
              <p className="text-xs text-white/50">Signup, pricing, and where to click</p>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"
              aria-label="Close help chat"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            <div className="rounded-xl bg-white/5 px-3 py-2 text-white/80">
              <MessageBody text="Hi — I can help with signup, the 30-day free trial, pricing, and finding pages like homerooms, the car line board, viewer access, and billing." />
            </div>
            {turns.map((turn, index) => (
              <div
                key={index}
                className={
                  turn.role === "user"
                    ? "ml-6 rounded-xl bg-[#E9D500] px-3 py-2 text-[#193B4B]"
                    : "mr-6 rounded-xl bg-white/5 px-3 py-2 text-white/85"
                }
              >
                <MessageBody text={turn.content} />
              </div>
            ))}
            {pending && !showForm ? <p className="text-xs text-white/50">Thinking…</p> : null}
            {error ? (
              <p className="text-sm text-red-200" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          {showForm ? (
            <form
              className="space-y-2 border-t border-white/10 px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                void sendTicket();
              }}
            >
              {ticketSent ? (
                <p className="text-sm text-[#E9D500]" role="status">
                  Thanks — we'll reply to {email || "you"}.
                </p>
              ) : (
                <>
                  <p className="text-xs text-white/60">Send this conversation to the PickupRoster team.</p>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={120}
                    placeholder="Name"
                    aria-label="Name"
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm"
                  />
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    type="email"
                    maxLength={254}
                    placeholder="Email"
                    aria-label="Email"
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm"
                  />
                  <textarea
                    value={ticketMessage}
                    onChange={(event) => setTicketMessage(event.target.value)}
                    required
                    maxLength={5000}
                    rows={3}
                    placeholder="How can we help?"
                    aria-label="Message"
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm"
                  />
                  <div className="absolute -left-[9999px] h-0 overflow-hidden" aria-hidden="true">
                    <input
                      value={honeypot}
                      onChange={(event) => setHoneypot(event.target.value)}
                      tabIndex={-1}
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-sm font-semibold text-[#193B4B] disabled:opacity-60"
                  >
                    Send to support
                  </button>
                </>
              )}
            </form>
          ) : (
            <form
              className="border-t border-white/10 px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                void sendChat(draft);
              }}
            >
              <label className="sr-only" htmlFor="help-chat-input">
                Message
              </label>
              <textarea
                id="help-chat-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendChat(draft);
                  }
                }}
                maxLength={2000}
                rows={2}
                placeholder="Ask about signup, pricing, or a page"
                className="w-full resize-none rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-xs text-white/60 underline hover:text-white"
                  onClick={() => {
                    setShowForm(true);
                    setTicketMessage(
                      (current) =>
                        current ||
                        turns.filter((turn) => turn.role === "user").at(-1)?.content ||
                        "",
                    );
                  }}
                >
                  Contact support
                </button>
                <button
                  type="submit"
                  disabled={pending || !draft.trim()}
                  className="rounded-lg bg-[#E9D500] px-3 py-1.5 text-sm font-semibold text-[#193B4B] disabled:opacity-60"
                >
                  Send
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}

      <button
        type="button"
        className="fixed bottom-4 right-4 z-[70] inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#E9D500] text-[#193B4B] shadow-lg hover:bg-[#f5e047]"
        aria-label={open ? "Close help chat" : "Open help chat"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X className="h-6 w-6" aria-hidden="true" /> : <MessageCircle className="h-6 w-6" aria-hidden="true" />}
      </button>
    </div>
  );
}
