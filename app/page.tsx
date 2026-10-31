"use client";

import { useCallback, useMemo, useState } from "react";
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
 * rather than by the scripted scenarios it ships with.
 */
export default function Page() {
  const [model, setModel] = useState(DEFAULT_MODEL);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ model }),
    }),
  });

  const { account } = useWallet();

  const send = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      void sendMessage({ text: text.trim() });
    },
    [sendMessage],
  );

  const live = useMemo(
    () => ({ messages, status, send, error: error?.message }),
    [messages, status, send, error],
  );

  return (
    <Harness
      live={live}
      footer={
        <div className="flex flex-col gap-1.5">
          <WalletButton />
          {account ? (
            <p className="truncate px-1 text-center font-mono text-[11px] text-ink-3">
              {account.address}
            </p>
          ) : null}
        </div>
      }
      models={MODELS}
      onModelChange={setModel}
    />
  );
}
