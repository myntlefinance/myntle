#!/bin/bash
# Directory dump for the myntle project.
# Run from anywhere:  bash scripts/dump.sh
cd "$(dirname "$0")/.." || exit 1

describe() {
  case "$1" in
    AGENTS.md) echo "the working agreement, incl. the two design rules" ;;
    package.json) echo "pinned dependencies, Bun scripts" ;;
    bunfig.toml) echo "Bun configuration" ;;
    .bun-version) echo "the Bun version, pinned" ;;
    next.config.ts) echo "wrapped so workflows compile" ;;
    proxy.ts) echo "the door; excludes the workflow callback path" ;;
    tsconfig.json) echo "" ;;
    .env.example) echo "every key, with what it is and whether it is secret" ;;
    app/layout.tsx) echo "the frame" ;;
    app/page.tsx) echo "the chat screen, driving the harness" ;;
    app/globals.css) echo "the design foundation" ;;
    app/providers.tsx) echo "the wallet providers" ;;
    app/providers-loader.tsx) echo "loads them without server rendering" ;;
    app/api/chat/route.ts) echo "the assistant, its tools, the approval rules" ;;
    app/api/approve/route.ts) echo "starts the background trade job" ;;
    workflows/swap-lifecycle.ts) echo "the clerk: submit, wait, check, repeat" ;;
    lib/ai/provider.ts) echo "NEAR AI Cloud, and the model list" ;;
    lib/ai/prompts.ts) echo "system instructions" ;;
    lib/ai/tools.ts) echo "the tool registry" ;;
    lib/intents/service.ts) echo "quotes, status, the asset catalogue" ;;
    lib/wallet/registry.ts) echo "picks the right adapter" ;;
    lib/wallet/evm.ts) echo "MetaMask and friends" ;;
    lib/wallet/solana.ts) echo "Phantom and friends" ;;
    lib/wallet/near.ts) echo "MyNearWallet and friends" ;;
    lib/wallet/types.ts) echo "the one interface all three answer to" ;;
    lib/utils.ts) echo "the class name helper the primitives import" ;;
    components/app/LiveResponse.tsx) echo "OURS — the assistant's real reply" ;;
    components/app/WalletButton.tsx) echo "OURS — the wallet control" ;;
    components/atoms/*) echo "BeautifulUI, copied" ;;
    components/primitives/*) echo "BeautifulUI, copied" ;;
    components/site/*) echo "BeautifulUI's harness, copied and adapted" ;;
    context/*.md) echo "" ;;
    *) echo "" ;;
  esac
}

walk() {
  local dir="$1" prefix="$2"
  local entries
  entries=$(ls -A "$dir" 2>/dev/null | grep -v "^\.gitkeep$" | grep -v "^\." | sort)
  local last
  last=$(echo "$entries" | tail -1)

  while IFS= read -r name; do
    [ -z "$name" ] && continue
    local path="$dir/$name"
    local conn="├──"
    [ "$name" = "$last" ] && conn="└──"
    if [ -d "$path" ]; then
      echo "$prefix$conn$name/"
      walk "$path" "$prefix$( [ "$name" = "$last" ] && echo "    " || echo "│   " )"
    else
      local note
      note=$(describe "${path#./}")
      if [ -n "$note" ]; then
        printf "%s%s%-34s %s\n" "$prefix" "$conn" "$name" "$note"
      else
        printf "%s%s%s\n" "$prefix" "$conn" "$name"
      fi
    fi
  done <<< "$entries"
}

echo "myntle/"
walk "." ""
