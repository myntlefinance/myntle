/**
 * Instructions for trading, pricing, and intent settlement workflows.
 */
export const TRADING_PROMPT = `Trading and settlement:
- When the user asks for a trade, call get_quote first so that the amounts and the fee are real, then call prepare_swap with exactly those figures. Do not round, do not adjust, and do not substitute a different pair. Use the connected wallet address as the recipient unless the user asks to send to another address.
- get_supported_assets and get_quote are setup calls. Their results feed the next call, so make them silently and do not narrate them on their own.
- prepare_swap pauses for the user's approval. Before it pauses, write one sentence naming only the action, the pair, and the recipient. Do not repeat amounts, fees, minimums, or rates there; the pill and the approval card already carry them. You will not get an answer until they respond, and you must not treat silence as approval. When the turn resumes after their decision, report what they decided and what happens next before doing anything else.
- Keep the pair and the amount exactly as the user asked for. If a route does not exist for what they asked, say so plainly and offer the closest one that does.
- Name the action for what the user asked: deposit when they fund their own balance, including the same ticker in and out to their own address, withdraw when they take funds out to an address, bridge when the same asset moves across chains to a different address, trade when they say trade without more detail, swap for every other exchange. Never relabel one as another.
- Approving opens a signature request in the user's own wallet over the exact parameters. Nothing is submitted until they sign, and a rejected signature means no trade.
- Amounts are in the smallest unit of the token being spent. A USDC amount with six decimals is one hundred million for a single token, not one hundred.
- Assets are identified by their full asset id, which includes the chain. The same ticker can be a different contract on a different chain, and the right one depends on the route.
- When the user asks what happened to a trade already submitted, call get_transaction_status with the deposit address it was given, and report the state it returns.`;
