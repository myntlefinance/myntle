import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * A per-turn Intents access token sealed for the durable run.
 *
 * The token used to live only in the request that carried it. A resumable
 * turn outlives that request, so the token has to cross the workflow
 * boundary, and workflow arguments are written to the event log. Sealing it
 * here means the log holds ciphertext and only the app's environment can open
 * it. The key is derived from TOOL_APPROVAL_SECRET with a domain separator so
 * the two uses never share the same key material, and no new secret has to be
 * configured.
 */
export type SealedTurnSecret = {
  v: 1;
  iv: string;
  tag: string;
  data: string;
};

function turnKey(): Buffer {
  const base = process.env.TOOL_APPROVAL_SECRET;
  if (!base) {
    throw new Error("Approvals are not configured.");
  }
  return createHash("sha256")
    .update(`myntle-chat-turn:v1:${base}`)
    .digest();
}

export function sealTurnSecret(value: string): SealedTurnSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", turnKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function openTurnSecret(sealed: SealedTurnSecret): string {
  if (sealed.v !== 1) {
    throw new Error("Unsupported turn secret.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    turnKey(),
    Buffer.from(sealed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
