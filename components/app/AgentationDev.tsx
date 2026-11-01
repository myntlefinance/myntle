"use client";

import dynamic from "next/dynamic";

const Agentation =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("agentation").then((m) => m.Agentation), { ssr: false })
    : () => null;

export function AgentationDev() {
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <Agentation
      endpoint={process.env.NEXT_PUBLIC_AGENTATION_ENDPOINT}
      appName="Myntle"
    />
  );
}