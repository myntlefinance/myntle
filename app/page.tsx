"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Harness from "@/components/site/Harness";
import { WalletButton } from "@/components/app/WalletButton";
import { MODELS, DEFAULT_MODEL } from "@/lib/ai/provider";
import { useWallet } from "@/lib/wallet/registry";

/**
 * The application.
 *
 * The whole interface is BeautifulUI's harness, driven by the real assistant
 * rather than by the scripted scenarios it ships with. Visitors without a
 * wallet can type and send, but the send is simulated: each attempt renders
 * the wallet gate, and only the latest prompt is replayed once they connect.
 */

export type GatedExchange = { id: number; prompt: string };

function truncateTitle(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  return collapsed.length > 84
    ? `${collapsed.slice(0, 84).trimEnd()}…`
    : collapsed;
}

export default function Page() {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const { connected } = useWallet();

  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ model }),
    }),
  });

  const [gated, setGated] = useState<GatedExchange[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const gatedIdRef = useRef(0);
  const titleReqRef = useRef(0);

  const requestTitle = useCallback((prompt: string) => {
    const id = (titleReqRef.current += 1);
    void fetch("/api/title", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { title?: string } | null) => {
        if (id !== titleReqRef.current) return;
        setTitle(body?.title?.trim() ? body.title : truncateTitle(prompt));
      })
      .catch(() => {
        if (id !== titleReqRef.current) return;
        setTitle(truncateTitle(prompt));
      });
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!connected) {
        gatedIdRef.current += 1;
        setGated((current) => [
          ...current,
          { id: gatedIdRef.current, prompt: trimmed },
        ]);
        pendingRef.current = trimmed;
        return;
      }
      if (!title) requestTitle(trimmed);
      void sendMessage({ text: trimmed });
    },
    [connected, sendMessage, title, requestTitle],
  );

  // Once the wallet lands, the gated turns clear and the latest prompt starts
  // the real conversation, so the thread reads as a fresh chat.
  useEffect(() => {
    if (!connected || !pendingRef.current) return;
    const next = pendingRef.current;
    pendingRef.current = null;
    setGated([]);
    if (!title) requestTitle(next);
    void sendMessage({ text: next });
  }, [connected, sendMessage, title, requestTitle]);

  const newChat = useCallback(() => {
    titleReqRef.current += 1;
    pendingRef.current = null;
    setGated([]);
    setTitle(null);
    setMessages([]);
  }, [setMessages]);

  const rename = useCallback((next: string) => {
    const cleaned = next.replace(/\s+/g, " ").trim().slice(0, 84);
    if (!cleaned) return;
    // A manual rename wins over an in-flight generated title.
    titleReqRef.current += 1;
    setTitle(cleaned);
  }, []);

  const live = useMemo(
    () => ({ messages, status, send, error: error?.message }),
    [messages, status, send, error],
  );

  return (
    <Harness
      live={live}
      gated={gated}
      title={title}
      onNewChat={newChat}
      onRename={rename}
      footer={<WalletButton />}
      models={MODELS}
      onModelChange={setModel}
    />
  );
}
