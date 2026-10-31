/**
 * Generates .impeccable/design.json from the frontmatter of DESIGN.md.
 *
 * The frontmatter owns the token primitives; this file owns everything the
 * Stitch schema cannot hold: tonal ramps, shadow and motion tokens, the
 * breakpoints, the component snippets, and the narrative.
 *
 * Run with: node scripts/build-design-sidecar.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const designMd = readFileSync(join(root, "DESIGN.md"), "utf8");

/* ── read the frontmatter ─────────────────────────────────── */

const frontmatter = designMd.split("---")[1];

function parseColors(block) {
  const colors = {};
  let current = null;
  for (const line of block.split("\n")) {
    const entry = line.match(/^\s{2}([a-z0-9-]+):\s*"(.*)"\s*$/);
    if (entry) {
      current = entry[1];
      colors[current] = entry[2];
      continue;
    }
    const group = line.match(/^([a-z]+):\s*$/);
    if (group) current = null;
  }
  return colors;
}

const colorsBlock = frontmatter.split("colors:")[1].split("typography:")[0];
const colors = parseColors(colorsBlock);

/* ── tonal ramps ──────────────────────────────────────────── */

/**
 * Eight steps from dark to light at a fixed hue. Chroma is held through the
 * mid range and reduced at both ends, because the sRGB gamut cannot hold a
 * saturated blue at 15 percent lightness or a saturated one at 92 percent.
 */
function tonalRamp(oklch) {
  const m = oklch.match(
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/,
  );
  if (!m) return null;
  const [, lRaw, cRaw, h] = m;
  const l = Number(lRaw);
  const c = Number(cRaw);
  const hue = Number(h);

  const stops = [0.15, 0.26, 0.37, 0.48, 0.59, 0.7, 0.81, 0.92];

  return stops.map((target) => {
    const chromaScale =
      target < 0.3 ? 0.45 + (target - 0.15) * 2.33 : target > 0.75 ? 1 - (target - 0.75) * 1.9 : 1;
    const chroma = Math.max(0, Number((c * chromaScale).toFixed(4)));
    const lightness = Number(
      target.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""),
    );
    return `oklch(${lightness} ${chroma} ${hue})`;
  });
}

const COLOR_META = {
  "signal-blue": { role: "primary", displayName: "Signal Blue" },
  "signal-blue-deep": { role: "primary", displayName: "Signal Blue Deep" },
  "signal-blue-wash": { role: "primary", displayName: "Signal Blue Wash" },
  "positive-green": { role: "primary", displayName: "Positive Green" },
  "caution-orange": { role: "primary", displayName: "Caution Orange" },
  "critical-red": { role: "primary", displayName: "Critical Red" },
  "cool-paper": { role: "neutral", displayName: "Cool Paper" },
  "cool-canvas": { role: "neutral", displayName: "Cool Canvas" },
  "surface-white": { role: "neutral", displayName: "Surface White" },
  recess: { role: "neutral", displayName: "Recess" },
  field: { role: "neutral", displayName: "Field" },
  "row-wash": { role: "neutral", displayName: "Row Wash" },
  "graphite-wash": { role: "neutral", displayName: "Graphite Wash" },
  graphite: { role: "neutral", displayName: "Graphite" },
  slate: { role: "neutral", displayName: "Slate" },
  ash: { role: "neutral", displayName: "Ash" },
  hairline: { role: "neutral", displayName: "Hairline" },
  "hairline-strong": { role: "neutral", displayName: "Hairline Strong" },
};

const colorMeta = {};
for (const [key, value] of Object.entries(colors)) {
  const meta = COLOR_META[key] ?? { role: "neutral", displayName: key };
  const ramp = tonalRamp(value);
  colorMeta[key] = {
    role: meta.role,
    displayName: meta.displayName,
    canonical: value,
    ...(ramp ? { tonalRamp: ramp } : {}),
  };
}

/* ── the sidecar ──────────────────────────────────────────── */

const sidecar = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  title: "Design System: Myntle",
  extensions: {
    colorMeta,
    typographyMeta: {
      display: {
        displayName: "Display",
        purpose:
          "The largest type in the product. A two-line headline whose first line is set in Ash and whose second is set in Graphite, so it reads as one complete thought rather than two slogans.",
      },
      headline: {
        displayName: "Headline",
        purpose:
          "The empty state's heading and the title of a card that has nothing else to say. Semi-bold, never bold.",
      },
      title: {
        displayName: "Title",
        purpose:
          "A section title inside a card. Small and semibold, because a title here is a label and not a statement.",
      },
      body: {
        displayName: "Body",
        purpose:
          "Running prose, the assistant's reply, and the description under a heading. Capped at 46 characters a line.",
      },
      label: {
        displayName: "Label",
        purpose: "A button, a tab, a status pill, and the label of a text row.",
      },
      mono: {
        displayName: "Mono",
        purpose:
          "Contract identifiers, addresses, and raw values that a user might need to check character by character.",
      },
    },
    shadows: [
      {
        name: "hairline",
        value: "0 0 0 1px var(--line)",
        purpose:
          "The ring on nearly every surface. The ring defines the edge; the shadow only decides how far the surface floats.",
      },
      {
        name: "btn",
        value: "0 0 0 1px var(--line-strong), var(--shadow-xs)",
        purpose: "A control, one step more defined than a card.",
      },
      {
        name: "card",
        value: "0 0 0 1px var(--line), var(--shadow-sm)",
        purpose: "The shallowest of the three floating surfaces. A card sits a millimetre above the canvas.",
      },
      {
        name: "raised",
        value: "0 0 0 1px var(--line), var(--shadow-md)",
        purpose:
          "The composer and any surface that floats over the thread rather than sitting beside it.",
      },
      {
        name: "overlay",
        value: "0 0 0 1px var(--line), var(--shadow-lg)",
        purpose: "Menus and modals. The only surfaces that genuinely float above the page.",
      },
      {
        name: "inset-field",
        value: "inset 0 1px 2px oklch(0 0 0 / 0.12)",
        purpose: "A recessed input, read as a well rather than as a hole.",
      },
    ],
    motion: [
      {
        name: "ease-out-strong",
        value: "cubic-bezier(0.23, 1, 0.32, 1)",
        purpose:
          "The default easing for entrances and for the segmented control's thumb. The built-in curves are too weak for this system.",
      },
      {
        name: "ease-in-out-strong",
        value: "cubic-bezier(0.77, 0, 0.175, 1)",
        purpose: "Reserved for transitions that begin and end on screen.",
      },
      {
        name: "ease-link",
        value: "cubic-bezier(0.16, 1, 0.3, 1)",
        purpose: "The animated underline on a link.",
      },
      {
        name: "fade-up",
        value: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both",
        purpose:
          "A block arriving from eight pixels below. Used for a reply and for an artifact that appears after its sentence has landed.",
      },
      {
        name: "fade-in",
        value: "fade-in 200ms ease both",
        purpose: "A block appearing in place, with no movement.",
      },
      {
        name: "shimmer-text",
        value: "shimmer-text 1.6s linear infinite",
        purpose: "A placeholder standing in for text that has not arrived yet.",
      },
    ],
    breakpoints: [
      { name: "sm", value: "640px" },
      { name: "lg", value: "1024px" },
    ],
  },
  components: [
    {
      name: "Primary Button",
      kind: "button",
      refersTo: "button-primary",
      description:
        "The action that matters in a region. Graphite fill, a one-pixel white inner highlight, and a pill shape.",
      html: '<button class="ds-btn-primary">Swap 100 USDC for NEAR</button>',
      css: [
        ".ds-btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: oklch(0.247 0.006 258.361); color: oklch(0.961 0.002 247.84); padding: 9px 16px; border: none; border-radius: 9999px; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; font-weight: 500; line-height: 1; box-shadow: inset 0 1px 0 rgba(255,255,255,0.14); transition: opacity 150ms ease-out, transform 150ms ease-out; cursor: pointer; }",
        ".ds-btn-primary:hover { opacity: 0.9; }",
        ".ds-btn-primary:active { transform: scale(0.96); }",
        ".ds-btn-primary:focus-visible { outline: 2px solid oklch(0.626 0.205 254.947); outline-offset: 2px; }",
      ].join(" "),
    },
    {
      name: "Secondary Button",
      kind: "button",
      refersTo: "button-secondary",
      description:
        "A supporting action. White surface, a hairline-strong ring, and a small shadow.",
      html: '<button class="ds-btn-secondary">Reject</button>',
      css: [
        ".ds-btn-secondary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: oklch(1 0 0); color: oklch(0.247 0.006 258.361); padding: 9px 16px; border: none; border-radius: 9999px; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; font-weight: 500; line-height: 1; box-shadow: 0 0 0 1px oklch(0.912 0.005 258.326), 0 1px 2px rgba(0,0,0,0.06); transition: background-color 150ms ease-out, transform 150ms ease-out; cursor: pointer; }",
        ".ds-btn-secondary:hover { background: oklch(0.979 0.002 247.839); }",
        ".ds-btn-secondary:active { transform: scale(0.96); }",
        ".ds-btn-secondary:focus-visible { outline: 2px solid oklch(0.626 0.205 254.947); outline-offset: 2px; }",
      ].join(" "),
    },
    {
      name: "Accent Button",
      kind: "button",
      refersTo: "button-accent",
      description:
        "The single action that is the point of the screen. Signal Blue, used once.",
      html: '<button class="ds-btn-accent">Approve this trade</button>',
      css: [
        ".ds-btn-accent { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: oklch(0.626 0.205 254.947); color: #ffffff; padding: 9px 16px; border: none; border-radius: 9999px; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; font-weight: 500; line-height: 1; box-shadow: inset 0 1px 0 rgba(255,255,255,0.14); transition: background-color 150ms ease-out, transform 150ms ease-out; cursor: pointer; }",
        ".ds-btn-accent:hover { background: oklch(0.556 0.187 255.617); }",
        ".ds-btn-accent:active { transform: scale(0.96); }",
        ".ds-btn-accent:focus-visible { outline: 2px solid oklch(0.626 0.205 254.947); outline-offset: 2px; }",
      ].join(" "),
    },
    {
      name: "Ghost Button",
      kind: "button",
      refersTo: "button-ghost",
      description:
        "A dense toolbar action. Graphite Wash until it is pressed.",
      html: '<button class="ds-btn-ghost">Connect a wallet</button>',
      css: [
        ".ds-btn-ghost { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: oklch(0.933 0.003 247.86); color: oklch(0.247 0.006 258.361); padding: 9px 16px; border: none; border-radius: 9999px; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; font-weight: 500; line-height: 1; transition: background-color 150ms ease-out, transform 150ms ease-out; cursor: pointer; }",
        ".ds-btn-ghost:hover { background: oklch(0.912 0.005 258.326); }",
        ".ds-btn-ghost:active { transform: scale(0.96); }",
        ".ds-btn-ghost:focus-visible { outline: 2px solid oklch(0.626 0.205 254.947); outline-offset: 2px; }",
      ].join(" "),
    },
    {
      name: "Text Field",
      kind: "input",
      refersTo: "input-field",
      description:
        "A single-line input. A Field fill, a hairline ring, and an 8 pixel radius. Focus replaces the ring with a 2 pixel Signal Blue outline.",
      html:
        '<input class="ds-field" type="text" placeholder="Swap 100 USDC for NEAR" aria-label="Ask for a trade" />',
      css: [
        ".ds-field { width: 100%; background: oklch(0.961 0.001 286.375); color: oklch(0.247 0.006 258.361); border: none; border-radius: 8px; padding: 8px 10px; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 13px; line-height: 1.4; box-shadow: inset 0 0 0 1px oklch(0.946 0.003 264.542); }",
        ".ds-field::placeholder { color: oklch(0.695 0.009 264.505); }",
        ".ds-field:focus-visible { outline: 2px solid oklch(0.626 0.205 254.947); outline-offset: 2px; }",
      ].join(" "),
    },
    {
      name: "Status Pill",
      kind: "chip",
      refersTo: "status-pill",
      description:
        "A state with a name. The dot is the state, the text names it, and the colour is reserved for the settlement of money.",
      html:
        '<span class="ds-status"><span class="ds-status-dot"></span>Settled</span>',
      css: [
        ".ds-status { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 9999px; background: oklch(0.958 0.017 159.118); color: oklch(0.603 0.155 150.883); font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 13px; font-weight: 500; line-height: 1; }",
        ".ds-status-dot { width: 6px; height: 6px; border-radius: 9999px; background: oklch(0.603 0.155 150.883); }",
        ".ds-status.is-critical { background: oklch(0.956 0.017 17.462); color: oklch(0.621 0.192 23.042); }",
        ".ds-status.is-critical .ds-status-dot { background: oklch(0.621 0.192 23.042); }",
        ".ds-status.is-caution { background: oklch(0.964 0.021 67.581); color: oklch(0.689 0.179 49.902); }",
        ".ds-status.is-caution .ds-status-dot { background: oklch(0.689 0.179 49.902); }",
      ].join(" "),
    },
    {
      name: "Value Pill",
      kind: "chip",
      refersTo: "value-pill",
      description:
        "A plain value set off inside running prose. No dot, no state, and no colour unless the value is a state.",
      html: '<span class="ds-value">1.2405 NEAR</span>',
      css: [
        ".ds-value { display: inline-flex; align-items: center; padding: 0 6px; border-radius: 9999px; background: oklch(0.979 0.002 247.839); color: oklch(0.506 0.01 264.477); font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 12px; font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums; box-shadow: 0 0 0 1px oklch(0.946 0.003 264.542); }",
      ].join(" "),
    },
    {
      name: "Code Chip",
      kind: "chip",
      refersTo: "value-pill",
      description:
        "An identifier lifted out of prose. The only monospaced thing in the system.",
      html: '<code class="ds-code">usdc.near</code>',
      css: [
        ".ds-code { display: inline; padding: 2px 6px; border-radius: 6px; background: oklch(0.979 0.002 247.839); color: oklch(0.506 0.01 264.477); font-family: \"JetBrains Mono\", ui-monospace, \"SF Mono\", monospace; font-size: 12px; line-height: 1; vertical-align: -1px; }",
      ].join(" "),
    },
    {
      name: "Card",
      kind: "card",
      refersTo: "card",
      description:
        "A container. White surface, a hairline ring, the shallowest floating shadow, and 12 pixels of padding.",
      html: [
        '<div class="ds-card">',
        '  <div class="ds-row"><span class="ds-row-label">Amount out</span><span class="ds-row-value">1.2405</span></div>',
        '  <div class="ds-row"><span class="ds-row-label">Minimum out</span><span class="ds-row-value">1.2291</span></div>',
        "</div>",
      ].join("\n"),
      css: [
        ".ds-card { background: oklch(1 0 0); color: oklch(0.247 0.006 258.361); border-radius: 10px; padding: 12px; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; line-height: 1.5; box-shadow: 0 0 0 1px oklch(0.946 0.003 264.542), 0 1px 2px rgba(0,0,0,0.06); }",
        ".ds-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 8px 0; }",
        ".ds-row-label { color: oklch(0.506 0.01 264.477); font-size: 14px; font-weight: 400; }",
        ".ds-row-value { color: oklch(0.247 0.006 258.361); font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }",
      ].join(" "),
    },
    {
      name: "Menu",
      kind: "nav",
      refersTo: "menu",
      description:
        "A popover. A 10 pixel radius, a raised shadow, and rows that wash on hover.",
      html: [
        '<div class="ds-menu">',
        '  <button class="ds-menu-row">NEAR Protocol</button>',
        '  <button class="ds-menu-row">Ethereum</button>',
        '  <button class="ds-menu-row">Solana</button>',
        "</div>",
      ].join("\n"),
      css: [
        ".ds-menu { width: 220px; padding: 4px; border-radius: 10px; background: oklch(1 0 0); font-family: Inter, ui-sans-serif, system-ui, sans-serif; box-shadow: 0 0 0 1px oklch(0.946 0.003 264.542), 0 8px 28px rgba(0,0,0,0.12); }",
        ".ds-menu-row { display: block; width: 100%; padding: 8px 10px; border: none; border-radius: 8px; background: transparent; color: oklch(0.247 0.006 258.361); font-family: inherit; font-size: 13px; text-align: left; cursor: pointer; transition: background-color 100ms ease-out; }",
        ".ds-menu-row:hover { background: oklch(0.97 0.002 247.839); }",
        ".ds-menu-row:focus-visible { outline: 2px solid oklch(0.626 0.205 254.947); outline-offset: -2px; }",
      ].join(" "),
    },
    {
      name: "Sidebar Row",
      kind: "nav",
      refersTo: "sidebar-row",
      description:
        "A navigation row. A 7 pixel radius, a Graphite Wash fill when it is the active row, and the label at 14 pixels.",
      html: '<button class="ds-nav-row">New chat</button>',
      css: [
        ".ds-nav-row { display: block; width: 100%; padding: 0 8px; height: 32px; border: none; border-radius: 7px; background: transparent; color: oklch(0.247 0.006 258.361); font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; font-weight: 400; text-align: left; cursor: pointer; transition: background-color 100ms ease-out; }",
        ".ds-nav-row:hover { background: oklch(0.97 0.002 247.839); }",
        ".ds-nav-row.is-active { background: oklch(0.933 0.003 247.86); }",
        ".ds-nav-row:focus-visible { outline: 2px solid oklch(0.626 0.205 254.947); outline-offset: 2px; }",
      ].join(" "),
    },
  ],
  narrative: {
    northStar: "The Ledger Room",
    overview:
      "The system is a quiet, well-lit room in which a record is kept. Nothing in it is trying to be a trading terminal, and nothing in it is trying to be a fintech brand. It is cool, precise, and unhurried: a near-white page with a faint blue cast, pinned with a 45-degree hairline stripe the way a sheet of ruled paper is pinned to a desk, white cards floating a millimetre above it on hairline rings, and a single blue that appears only when something is live. The room is lit evenly, so a user can read a number without the interface competing for the attention that the number needs. The density is high and the scale is small. Type runs between 10 and 20 pixels and concentrates hard at 12 and 13, which is the register of an instrument rather than a document, and the whole surface is built from pills, 6-to-14 pixel radii, and rules one pixel wide. The one deliberate departure from neutrality is the stripe, and it is the only texture in the system.",
    keyCharacteristics: [
      "A cool near-white page with a pinned 45-degree hairline stripe, and white cards floating above it.",
      "One blue, used only to mark the one live thing in a region, and a fixed set of three semantic colours reserved for the state of money.",
      "Hairline rings on every surface, with a soft layered shadow deciding only how far a surface floats.",
      "Type at 10 to 20 pixels, concentrated at 12 and 13, with Inter for text and JetBrains Mono for identifiers.",
      "Numbers set in tabular figures and given more weight than the labels beside them.",
      "Pills for actions, rounded rectangles for containers, and nothing else rounded more than the chip radius.",
    ],
    rules: [
      {
        name: "The One Signal Rule",
        body: "Signal Blue marks the one live thing in a region and nothing else. A screen with a connected wallet, a pending trade, and a selected tab uses it once per region, not once per element. Its rarity is the point; when everything is accent-coloured, nothing is.",
        section: "colors",
      },
      {
        name: "The Settlement Colour Rule",
        body: "Green, orange, and red belong to the state of money and to nothing else. A successful action that is not a settlement takes Signal Blue or no colour at all. A red surface on this screen always means money did not go through.",
        section: "colors",
      },
      {
        name: "The Number Is the Voice Rule",
        body: "A number on screen is set in tabular figures at medium weight, and it is the loudest thing in its card. The label beside it is set in Slate at regular weight so that the value, not the label, carries the eye. A card whose number is quieter than its own caption is a card with the emphasis in the wrong place.",
        section: "typography",
      },
      {
        name: "The Identifier Rule",
        body: "An identifier that a user might need to check is set in JetBrains Mono, and one that they will not is set in Inter. Contract ids, addresses, and raw status strings are mono. Tickers, amounts, and dates are not. If you are unsure which one you have, it is Inter.",
        section: "typography",
      },
      {
        name: "The Hairline Rule",
        body: "An edge is defined by a one-pixel ring, never by a shadow. If a surface has a shadow but no ring, it has no edge, and if it has a ring but no shadow it is on the same plane as what is behind it. The ring is what makes the surface a surface.",
        section: "elevation",
      },
      {
        name: "The Dark-Mode Ring Rule",
        body: "In dark mode the ring becomes a low-alpha white edge, at 10 percent for a control, 11 for a card, 13 for a raised surface, and 15 for an overlay, rather than a dark line. A dark ring on a dark surface dissolves into the shadow instead of reading as one continuous stroke, so the ring has to invert with the theme.",
        section: "elevation",
      },
      {
        name: "The Pill Rule",
        body: "Anything the user clicks to make something happen is a pill. Anything that holds content is a rounded rectangle. The two never swap, because a pill reads as an event and a rectangle reads as a container, and a user is deciding whether to authorise a movement of money.",
        section: "shapes",
      },
      {
        name: "The Radius Ladder Rule",
        body: "Nothing sits between the steps and nothing exceeds 14 pixels on a container. A 12-pixel radius on a card would mean the card was designed rather than built, and that is the wrong instinct here.",
        section: "shapes",
      },
    ],
    dos: [
      "Do put the number a decision turns on on screen in tabular figures, and give it more weight than the label beside it.",
      "Do mark a settlement state with the semantic colour for that state and with nothing else on the screen competing for it.",
      "Do write complete sentences in every heading, button, empty state, and error message. A button reads \"Swap 100 USDC for NEAR\", never \"Confirm\", and an error reads \"This swap would exceed your daily limit of 200 USDC\", never \"Limit exceeded\".",
      "Do show the minimum amount out next to the amount out, the contract id beneath its ticker, and the deadline in every card where the user is about to authorise a spend.",
      "Do reach for the vocabulary of the room when naming a surface: a row, a column, an entry, a balance, a receipt.",
      "Do keep the accent for the one live element in a region, and use a hairline ring plus a shadow on every surface.",
    ],
    donts: [
      "Don't use staccato fragments or slogan triplets anywhere. Not \"Fast. Scalable. Decentralized.\", not \"Your money, in plain language.\" on its own, not \"Limit exceeded\". If it does not read as a sentence someone would say out loud, it is not finished.",
      "Don't add a decorative element. No eyebrow label above a heading, no badge that carries no state, no chip that repeats the line beneath it, no icon that names nothing.",
      "Don't show a number the user does not need for the decision in front of them, and never round a figure in a way that could change that decision.",
      "Don't describe what might happen when you can describe what will. \"This swap will send 100 USDC to the exchange\" is the action; \"This swap may or may not succeed\" is the anxiety.",
      "Don't reach for crypto-terminal neon, glassmorphism, gradient orbs, glass badges, or decorative illustration. They are not restylings of this system, they are a different one.",
      "Don't drive the transaction timeline from the assistant's stream, and don't let a successful signature or a successful HTTP response become evidence that money moved.",
    ],
  },
};

writeFileSync(
  join(root, ".impeccable", "design.json"),
  `${JSON.stringify(sidecar, null, 2)}\n`,
  "utf8",
);

console.log(
  `wrote .impeccable/design.json — ${Object.keys(colorMeta).length} colours, ${sidecar.components.length} components`,
);
