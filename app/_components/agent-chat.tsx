"use client";

import { useRef, useState } from "react";
import type { EveMessage } from "eve/react";
import { AlertCircleIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { BrowserPanel } from "./browser-panel";

const AGENT_NAME = "browser-agent-template";
const BETA_TERMS_HREF = "https://vercel.com/docs/release-phases/public-beta-agreement";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://emptiness-daughter-faculty.ngrok-free.dev";

type ChatStatus = "ready" | "submitted" | "streaming" | "error";

/** True only for an https URL whose host is exactly the live-view host. A
 * startsWith/substring check is unsafe — it also passes
 * `https://live.browser-use.com.evil.com`. */
function isLiveUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "live.browser-use.com";
  } catch {
    return false;
  }
}

/** The latest cloud-browser liveUrl, taken from tool outputs or text responses. */
function extractLiveUrl(messages: readonly EveMessage[]): string | null {
  let found: string | null = null;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "dynamic-tool" && part.toolName === "open_cloud_browser") {
        const out = part.output;
        let url: unknown;
        if (out && typeof out === "object" && "liveUrl" in out) {
          url = (out as { liveUrl?: unknown }).liveUrl;
        } else if (typeof out === "string") {
          url = out.match(/https:\/\/live\.browser-use\.com[^\s"'\\]*/)?.[0];
        }
        if (isLiveUrl(url)) found = url;
      } else if (part.type === "text") {
        const url = part.text.match(/https:\/\/live\.browser-use\.com[^\s"'\\]*/)?.[0];
        if (isLiveUrl(url)) found = url;
      }
    }
  }
  return found;
}

export function AgentChat() {
  const [messages, setMessages] = useState<EveMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isBusy = status === "submitted" || status === "streaming";
  const isEmpty = messages.length === 0;
  const liveUrl = extractLiveUrl(messages);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus("ready");
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isBusy) return;

    const userMsgId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now());
    const userMessage: EveMessage = {
      id: userMsgId,
      role: "user",
      parts: [{ type: "text", text }],
    };

    setMessages((prev) => [...prev, userMessage]);
    setStatus("submitted");
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${BACKEND_URL}/run-task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ task: text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.detail || `Request failed with status ${response.status}`);
      }

      const data = await response.json();
      const resultText =
        typeof data.result === "string"
          ? data.result
          : data.result != null
            ? JSON.stringify(data.result, null, 2)
            : "Task completed successfully.";

      const assistantMsgId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now() + 1);
      const assistantMessage: EveMessage = {
        id: assistantMsgId,
        role: "assistant",
        parts: [{ type: "text", text: resultText }],
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setStatus("ready");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setStatus("ready");
        return;
      }
      const errorMsg = err instanceof Error ? err.message : "Failed to connect to backend";
      setError(new Error(errorMsg));
      setStatus("error");
    } finally {
      abortControllerRef.current = null;
    }
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder="Send a message…" />
      <PromptInputSubmit onStop={handleStop} status={status} />
    </PromptInput>
  );

  return (
    <div className="flex h-dvh">
      <main className="flex flex-1 flex-col overflow-hidden bg-background text-foreground">
        {isEmpty ? null : (
          <header className="flex h-14 shrink-0 items-center justify-center gap-3 pl-4 pr-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-muted-foreground text-sm">{AGENT_NAME}</span>
              <StatusDot status={status} />
            </span>
            <a
              className="rounded-full border border-amber-500/30 px-2 py-0.5 font-medium text-amber-700 text-xs transition-colors hover:bg-amber-500/10 dark:text-amber-300"
              href={BETA_TERMS_HREF}
              rel="noreferrer"
              target="_blank"
            >
              Public preview
            </a>
          </header>
        )}

        {error ? (
          <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">Request failed</p>
                <p className="mt-0.5 text-muted-foreground">{error.message}</p>
              </div>
            </div>
          </div>
        ) : null}

        {isEmpty ? null : (
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6">
              {messages.map((message, index) => (
                <AgentMessage
                  canRespond={!isBusy}
                  isStreaming={status === "streaming" && index === messages.length - 1}
                  key={message.id}
                  message={message}
                  onInputResponses={() => {}}
                />
              ))}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}

        <div
          className={cn(
            "mx-auto w-full px-4 sm:px-6",
            isEmpty
              ? "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]"
              : "max-w-3xl shrink-0 pb-6",
          )}
        >
          {isEmpty ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <h1 className="font-medium text-5xl tracking-tighter">{AGENT_NAME}</h1>
              <a
                className="rounded-full border border-amber-500/30 px-2 py-0.5 font-medium text-amber-700 text-xs transition-colors hover:bg-amber-500/10 dark:text-amber-300"
                href={BETA_TERMS_HREF}
                rel="noreferrer"
                target="_blank"
              >
                Public preview
              </a>
            </div>
          ) : null}
          <div className="w-full">{composer}</div>
        </div>
      </main>
      {liveUrl ? <BrowserPanel liveUrl={liveUrl} /> : null}
    </div>
  );
}

function StatusDot({ status }: { readonly status: ChatStatus }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone =
    status === "error"
      ? "bg-destructive"
      : isLive
        ? "bg-emerald-500"
        : status === "ready"
          ? "bg-muted-foreground"
          : "bg-muted-foreground/50";

  return (
    <span className="relative flex size-1">
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            tone,
          )}
        />
      ) : null}
      <span className={cn("relative inline-flex size-1 rounded-full transition-colors", tone)} />
    </span>
  );
}
