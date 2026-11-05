"use client";

import { useMemo } from "react";
import encodeQR from "@paulmillr/qr";

/**
 * The deposit QR code, generated locally.
 *
 * A QR service would see every deposit address and amount, so the pattern is
 * built in the browser from the same figures the card already renders. The
 * SVG is one path of merged module runs instead of one rect per module, which
 * keeps the DOM small enough for a 380px card.
 */

/**
 * What a scanner should do with this address.
 *
 * The QR carries the plain deposit address. Some wallets put an EIP-681 URI
 * into the address field instead of parsing it, so the token, contract,
 * network, and amount are shown as rows beside the code rather than encoded.
 */
export function depositQrValue(input: {
  address: string;
  amountInRaw?: string | null;
  tokenContract?: string | null;
  chainId?: number | null;
}): string {
  // The QR carries the address only. EIP-681 strings are not understood by
  // every scanner and can put the whole URI in the wallet's address field;
  // the token, contract, network, and amount live in the rows below instead.
  return input.address.trim();
}

/** Merged horizontal runs as one SVG path, one `M…h…v1h-…z` per run. */
export function qrPath(matrix: boolean[][]): string {
  let path = "";
  for (let y = 0; y < matrix.length; y += 1) {
    const row = matrix[y];
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run]) run += 1;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return path;
}

export function DepositQr({
  value,
  label,
  size = 168,
}: {
  /** The exact string encoded; usually `depositQrValue(...)`. */
  value: string;
  /** The amount and network, printed under the pattern. */
  label?: string | null;
  /** Rendered edge length in pixels. */
  size?: number;
}) {
  const { path, modules } = useMemo(() => {
    if (!value) return { path: "", modules: 0 };
    const matrix = encodeQR(value, "raw", { border: 2, ecc: "medium" });
    return { path: qrPath(matrix), modules: matrix.length };
  }, [value]);
  if (!path) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-lg bg-white p-2">
        <svg
          role="img"
          aria-label="Deposit address QR code"
          width={size}
          height={size}
          viewBox={`0 0 ${modules} ${modules}`}
          shapeRendering="crispEdges"
          className="block"
        >
          <rect width={modules} height={modules} fill="#ffffff" />
          <path d={path} fill="#000000" />
        </svg>
      </div>
      {label ? (
        <p className="text-center text-xs text-ink-2">{label}</p>
      ) : null}
    </div>
  );
}

export default DepositQr;
