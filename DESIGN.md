---
name: Myntle
description: Talk to your money, approve the trade, and watch the settlement resolve.
colors:
  signal-blue: "oklch(0.626 0.205 254.947)"
  signal-blue-deep: "oklch(0.556 0.187 255.617)"
  signal-blue-wash: "oklch(0.96 0.019 252.878)"
  positive-green: "oklch(0.603 0.155 150.883)"
  positive-wash: "oklch(0.958 0.017 159.118)"
  caution-orange: "oklch(0.689 0.179 49.902)"
  caution-wash: "oklch(0.964 0.021 67.581)"
  critical-red: "oklch(0.621 0.192 23.042)"
  critical-wash: "oklch(0.956 0.017 17.462)"
  cool-paper: "oklch(0.985 0.001 286.376)"
  cool-canvas: "oklch(0.961 0.002 247.84)"
  surface-white: "oklch(1 0 0)"
  recess: "oklch(0.979 0.002 247.839)"
  field: "oklch(0.961 0.001 286.375)"
  row-wash: "oklch(0.97 0.002 247.839)"
  graphite-wash: "oklch(0.933 0.003 247.86)"
  graphite: "oklch(0.247 0.006 258.361)"
  slate: "oklch(0.506 0.01 264.477)"
  ash: "oklch(0.695 0.009 264.505)"
  hairline: "oklch(0.946 0.003 264.542)"
  hairline-strong: "oklch(0.912 0.005 258.326)"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1
  mono:
    fontFamily: "\"JetBrains Mono\", ui-monospace, \"SF Mono\", monospace"
    fontSize: "12px"
    lineHeight: 1
rounded:
  chip: "6px"
  control: "8px"
  card: "10px"
  window: "14px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
  "3xl": "48px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.cool-canvas}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
    typography: "500 14px/1"
  button-primary-hover:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.cool-canvas}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
    typography: "500 14px/1"
  button-secondary:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
    typography: "500 14px/1"
  button-accent:
    backgroundColor: "{colors.signal-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
    typography: "500 14px/1"
  button-ghost:
    backgroundColor: "{colors.graphite-wash}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
    typography: "500 14px/1"
  input-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
    typography: "400 13px/1.4"
  status-pill:
    backgroundColor: "{colors.signal-blue-wash}"
    textColor: "{colors.signal-blue-deep}"
    rounded: "{rounded.pill}"
    height: "24px"
    padding: "0 10px"
    typography: "500 13px/1"
  value-pill:
    backgroundColor: "{colors.recess}"
    textColor: "{colors.slate}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    typography: "500 12px/1"
  card:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.card}"
    padding: "12px"
    typography: "400 14px/1.5"
  menu:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.card}"
    padding: "4px"
    typography: "400 13px/1.4"
---

# Design System: Myntle

## Overview

**Creative North Star: "The Ledger Room"**

The system is a quiet, well-lit room in which a record is kept. Nothing in it is trying to be a trading terminal, and nothing in it is trying to be a fintech brand. It is cool, precise, and unhurried: a near-white page with a faint blue cast, pinned with a 45-degree hairline stripe the way a sheet of ruled paper is pinned to a desk, white cards floating a millimetre above it on hairline rings, and a single blue that appears only when something is live. The room is lit evenly, so a user can read a number without the interface competing for the attention that the number needs.

The density is high and the scale is small. Type runs between 10 and 20 pixels and concentrates hard at 12 and 13, which is the register of an instrument rather than a document, and the whole surface is built from pills, 6-to-14 pixel radii, and rules one pixel wide. The one deliberate departure from neutrality is the stripe, and it is the only texture in the system.

This system is deliberately not several things, and those rejections are as much a part of its character as its palette. It is not a crypto terminal: no black ground, no neon, no glow, no ticker grid. It is not glassmorphism: no frosted panels, no blurred backdrops, no drifting gradient orbs. It is not a startup landing page: no gradient headline, no floating glass badge. And it is not illustrated: there is no stock artwork and no decorative icon standing in for an idea. An icon appears only where it names a state or an action.

**Key Characteristics:**

- A cool near-white page with a pinned 45-degree hairline stripe, and white cards floating above it.
- One blue, used only to mark the one live thing in a region, and a fixed set of three semantic colours reserved for the state of money.
- Hairline rings on every surface, with a soft layered shadow deciding only how far a surface floats.
- Type at 10 to 20 pixels, concentrated at 12 and 13, with Inter for text and JetBrains Mono for identifiers.
- Numbers set in tabular figures and given more weight than the labels beside them.
- Pills for actions, rounded rectangles for containers, and nothing else rounded more than the chip radius.

## Colors

The palette is a cool near-white ground, a three-step neutral ink ramp, one blue accent, and three semantic colours that exist for the state of money and nothing else.

### Primary

- **Signal Blue** (`oklch(0.626 0.205 254.947)`, rendered `#0285ff`): the one accent. It marks the single live element in a region: the connected account's chain badge, the selected segment of a control, the pending step in a timeline. It is a state marker and never a decoration. The CSS variable is `--accent`.
- **Signal Blue Deep** (`oklch(0.556 0.187 255.617)`, rendered `#0070dd`): the accent as text on a tinted ground, where the full-strength blue would not carry enough contrast. The CSS variable is `--accent-ink`.
- **Signal Blue Wash** (`oklch(0.96 0.019 252.878)`, rendered `#e9f3ff`): the accent at 4 percent strength as a fill behind accent text. The CSS variable is `--accent-tint`.

### Semantic

These three colours are reserved. Nothing else in the product is allowed to be green, orange, or red, because a user who has learned that red on this screen means money did not go through must be able to trust that.

- **Positive Green** (`oklch(0.603 0.155 150.883)`, rendered `#199a4d`): a settlement that completed. The CSS variable is `--green`.
- **Caution Orange** (`oklch(0.689 0.179 49.902)`, rendered `#ef720d`): a state that is still in motion, or a value that has drifted outside the bound the user set. The CSS variable is `--orange`.
- **Critical Red** (`oklch(0.621 0.192 23.042)`, rendered `#e3474c`): a settlement that failed, or an amount that would breach a limit. The CSS variable is `--red`.

Each has a wash companion at the same hue for a tinted fill: `--green-tint`, `--orange-tint`, and `--red-tint`.

### Neutral

- **Cool Paper** (`oklch(0.985 0.001 286.376)`): the page behind everything. The CSS variable is `--page`.
- **Cool Canvas** (`oklch(0.961 0.002 247.84)`): the application frame and the sidebar, one step below the page so the two read as different planes. The CSS variable is `--canvas`.
- **Surface White** (`oklch(1 0 0)`): every card, menu, and field that sits on the canvas. The CSS variable is `--surface`.
- **Recess** (`oklch(0.979 0.002 247.839)`): fills that sit inside a surface rather than on it, such as a segmented control's track. The CSS variable is `--inset`.
- **Field** (`oklch(0.961 0.001 286.375)`): the fill of an input, one step below the surface it sits in. The CSS variable is `--field`.
- **Row Wash** (`oklch(0.97 0.002 247.839)`): the hover fill on a row. The CSS variable is `--hover`.
- **Graphite Wash** (`oklch(0.933 0.003 247.86)`): the fill of a ghost button, a step deeper than the row wash so it reads as pressable. The CSS variable is `--hover-2`.
- **Graphite** (`oklch(0.247 0.006 258.361)`): primary text, and the fill of a primary button. The CSS variable is `--ink`.
- **Slate** (`oklch(0.506 0.01 264.477)`): secondary text, and the value in a text row when it carries no weight. The CSS variable is `--ink-2`.
- **Ash** (`oklch(0.695 0.009 264.505)`): tertiary text, metadata, and the muted lead line of a headline. The CSS variable is `--ink-3`.
- **Hairline** (`oklch(0.946 0.003 264.542)`): the one-pixel border on nearly every surface. The CSS variable is `--line`.
- **Hairline Strong** (`oklch(0.912 0.005 258.326)`): the border on an interactive control. The CSS variable is `--line-strong`.

Two further neutrals exist only for the pinned texture on the page: `--stripe-bg` (`oklch(0.97 0 0)`) is the base and `--stripe` (`oklch(0.405 0 0 / 0.075)`) is the 45-degree line drawn over it at a one-pixel pitch.

### Named Rules

**The One Signal Rule.** Signal Blue marks the one live thing in a region and nothing else. A screen with a connected wallet, a pending trade, and a selected tab uses it once per region, not once per element. Its rarity is the point; when everything is accent-coloured, nothing is.

**The Settlement Colour Rule.** Green, orange, and red belong to the state of money and to nothing else. A successful action that is not a settlement takes Signal Blue or no colour at all. A red surface on this screen always means money did not go through.

## Typography

**Display Font:** Inter (with `ui-sans-serif, system-ui, sans-serif`)
**Body Font:** Inter (with `ui-sans-serif, system-ui, sans-serif`)
**Label/Mono Font:** JetBrains Mono (with `ui-monospace, "SF Mono", monospace`)

**Character:** One family does the work and one family holds the identifiers. Inter is used at small sizes with tight tracking and its `cv11` and `ss01` features enabled, which gives the numerals a mechanical evenness that suits a ledger. JetBrains Mono is reserved for contract identifiers, addresses, and raw values, and it is the only thing on screen that is allowed to be monospaced.

The two families are loaded through `next/font` as the variables `--font-inter` and `--font-mono-face`, and both variables are set on the `html` element. This is not a detail: Tailwind's preflight reads `--default-font-family` on the root element, and a custom property declared on `body` cannot be read by its own parent, so moving the variables down to `body` silently drops the whole document back to the system font.

### Hierarchy

- **Display** (400, 26px/1.25, tracking -0.02em): the largest type in the product. It appears as a two-line headline whose first line is set in Ash and whose second line is set in Graphite, which reads as one complete thought rather than as two slogans. The empty-state headline is the only current instance.
- **Headline** (600, 22px/1.3): the empty state's own heading, and the title of a card that has nothing else to say. Semi-bold, never bold.
- **Title** (600, 13px): the title of a section inside a card, and the label of a collapsed group. Small and semibold, because a title in this system is a label and not a statement.
- **Body** (400, 14px/1.5, tracking -0.01em): running prose, the assistant's reply, and the description under a heading. The streamed reply sets at 13.5px on a 1.65 line height, which reads as slightly more open than the root body because it is the one block of long text in the product.
- **Label** (500, 13px): a button, a tab, a status pill, and the label of a text row.
- **Meta** (400, 12px to 11px): metadata, timestamps, secondary detail, and anything that supports a label without competing with it.
- **Mono** (400, 12px): a contract identifier, an address, a raw enum, or a value that has to be compared character by character.

Body copy is capped at 46 characters a line (`max-w-[46ch]`) and the thread itself is capped at 720 pixels, so a paragraph never runs long enough to lose its beginning.

### Named Rules

**The Number Is the Voice Rule.** A number on screen is set in tabular figures at medium weight, and it is the loudest thing in its card. The label beside it is set in Slate at regular weight so that the value, not the label, carries the eye. A card whose number is quieter than its own caption is a card with the emphasis in the wrong place.

**The Identifier Rule.** An identifier that a user might need to check is set in JetBrains Mono, and one that they will not is set in Inter. Contract ids, addresses, and raw status strings are mono. Tickers, amounts, and dates are not. If you are unsure which one you have, it is Inter.

## Layout

The application fills the viewport and never scrolls as a whole; only the thread scrolls. The frame is a `100dvh` flex row with a sidebar on the left and the conversation on the right, separated by a 10-pixel gap (`gap-2.5`).

The sidebar is a 224-pixel column that collapses to a 52-pixel rail, with the rows inside it 208 pixels wide so that every glyph stays on the same centre line in both states. The conversation area centres its content in a 720-pixel column, with 16, 32, and 48 pixels of horizontal padding at the three breakpoints. Messages are separated by 32 pixels of vertical space, and the thread carries 32 pixels of padding at the top and 160 at the bottom so the composer can float over the end of the conversation.

The density is high inside components and open between them. Inside a card, the rhythm is 10 and 12 pixels, with a 28-pixel icon button and a 44-pixel top bar. Between sections of a screen, it is 24 and 32 pixels. The composer floats over the thread on a raised surface, and the transcript fades behind it rather than stopping short of it.

## Elevation & Depth

Every surface in this system carries a solid one-pixel hairline ring, and the shadow decides only how far that surface floats above what is behind it. A card is a ring in the hairline colour plus a soft layered shadow; a control is a ring in the stronger hairline plus a smaller one; an overlay, meaning a menu or a modal, keeps the ring and takes the deepest shadow in the vocabulary. Nothing is separated by shadow alone, and nothing is separated by a border alone.

The shadows themselves come from `shadow-plugin`, which supplies a smooth, layered stack on Tailwind's `--shadow-xs` through `--shadow-2xl` scale, and the semantic tokens build on top of them rather than replacing them.

**The Hairline Rule.** An edge is defined by a one-pixel ring, never by a shadow. If a surface has a shadow but no ring, it has no edge, and if it has a ring but no shadow it is on the same plane as what is behind it. The ring is what makes the surface a surface.

**The Dark-Mode Ring Rule.** In dark mode the ring becomes a low-alpha white edge, at 10 percent for a control, 11 for a card, 13 for a raised surface, and 15 for an overlay, rather than a dark line. A dark ring on a dark surface dissolves into the shadow instead of reading as one continuous stroke, so the ring has to invert with the theme.

## Shapes

The radius ladder is 6, 8, 10, 14, and full, and there is no step between them. A 6-pixel radius belongs to a chip or an inline code token. An 8-pixel radius belongs to a control: a button, an input, a wallet row. A 10-pixel radius belongs to a card or a menu. A 14-pixel radius belongs to a window, a popover, or the composer. A fully rounded pill belongs to anything that performs an action.

**The Pill Rule.** Anything the user clicks to make something happen is a pill. Anything that holds content is a rounded rectangle. The two never swap, because a pill reads as an event and a rectangle reads as a container, and a user is deciding whether to authorise a movement of money.

**The Radius Ladder Rule.** Nothing sits between the steps and nothing exceeds 14 pixels on a container. A 12-pixel radius on a card would mean the card was designed rather than built, and that is the wrong instinct here.

## Components

The components are compact, precise, and quiet. They read as instruments set into the page rather than as objects sitting on top of it, and the numbers inside a card are always the loudest thing in it.

### Buttons

- **Shape:** a full pill.
- **Primary:** Graphite fill with the canvas colour as text, at 9 pixels vertical and 16 pixels horizontal padding, with a one-pixel white inner highlight along the top edge.
- **Secondary:** Surface White fill with Graphite text, a hairline-strong ring, and a small shadow.
- **Accent:** Signal Blue fill with white text, for the single action that is the point of the screen.
- **Ghost:** Graphite Wash fill with Graphite text, for a dense toolbar or action row where a filled button would be loud.
- **Quiet:** no fill at all until it is hovered, for the least important action in a row.
- **Hover / Focus:** opacity and background shift over 100 to 150 milliseconds. Pressing scales the button to 96 percent, which is the only motion a control gets.
- **The Tactile Press Rule.** Large buttons never take the full press scale. Any full-width or `md`-and-up button presses to 99 percent (`active:scale-[0.99]`), which reads as tactile rather than animated. The 96 percent press is reserved for compact and icon-only controls.
- **Sizes:** 28 pixels tall for a toolbar pill, 27 pixels for the canonical action, and 9 pixels of vertical padding for the standard button.

### Chips and Pills

- **Status Pill:** 24 pixels tall, a full pill, 10 pixels of horizontal padding, at 13 pixels semibold. The fill is the tone's wash and the text is the tone itself, with a 6-pixel dot in the same tone at the leading edge. The dot is the state; the text names it.
- **Value Pill:** a full pill at 12 pixels semibold with 6 pixels of padding, carrying a plain value inside running prose. Softer than a status pill because it has no dot, and separate from the code chip because it is not an identifier.
- **Code Chip:** a 6-pixel radius, 6 pixels of horizontal padding, at 12 pixels mono, for an identifier lifted out of prose.

### Cards and Containers

- **Corner Style:** 10 pixels.
- **Background:** Surface White.
- **Shadow Strategy:** a hairline ring plus the card shadow, which is the shallowest of the three floating surfaces.
- **Border:** the hairline ring, which is the border.
- **Internal Padding:** 12 pixels, with 10 pixels on the header bar and the footer of a card, and 10 by 12 on a table cell.

### Inputs and Fields

- **Style:** a Field fill, a hairline ring, and an 8-pixel radius.
- **Focus:** the ring is removed and replaced by a 2-pixel Signal Blue outline offset by 2 pixels, which is the focus treatment for the whole system.
- **Disabled:** reduced to half opacity, and the cursor stops inviting the click.
- **The composer** is the one input that floats, on a raised surface with a 14-pixel radius, or a 24-pixel radius when it expands into its pill form.

### Navigation

- **The sidebar** is a 224-pixel column collapsing to a 52-pixel rail. The rows are pills of 208 pixels with a 7-pixel radius, and the active row carries a Graphite Wash fill that slides between rows rather than blinking.
- **A segmented control** is a 32-pixel-tall full pill in the Recess colour with a Surface White thumb that slides on a 200-millisecond strong ease. The selected segment is Graphite and the unselected is Ash.

### Text Row

The workhorse of every card, and the reason the layout has a spine. A label on the left in Slate at 14 pixels, a value on the right in Graphite at 14 pixels semibold with tabular figures, and optional metadata in Ash at 13 pixels. The row is 44 pixels tall with 8 pixels of vertical padding, and the value is baseline-aligned with its metadata.

### Tool Chips

The inline record of what the assistant did. Each step is one chip with a label in plain language, such as "Quoted a price", and a detail in Ash. The chip never shows the raw tool name.

### Timeline

The transaction timeline is not driven by the conversation stream. It is driven by the transaction record, because the outcome comes from the chain and not from the assistant, and the two can disagree. Its states are quoted, approved, submitted, deposit confirmed, processing, and then one of settled, refunded, incomplete deposit, or failed.

## Do's and Don'ts

### Do:

- **Do** put the number a decision turns on on screen in tabular figures, and give it more weight than the label beside it.
- **Do** mark a settlement state with the semantic colour for that state and with nothing else on the screen competing for it.
- **Do** write complete sentences in every heading, button, empty state, and error message. A button reads "Swap 100 USDC for NEAR", never "Confirm", and an error reads "This swap would exceed your daily limit of 200 USDC", never "Limit exceeded".
- **Do** show the minimum amount out next to the amount out, the contract id beneath its ticker, and the deadline in every card where the user is about to authorise a spend.
- **Do** reach for the vocabulary of the room when naming a surface: a row, a column, an entry, a balance, a receipt.
- **Do** keep the accent for the one live element in a region, and use a hairline ring plus a shadow on every surface.

### Don't:

- **Don't** use staccato fragments or slogan triplets anywhere. Not "Fast. Scalable. Decentralized.", not "Your money, in plain language." on its own, not "Limit exceeded". If it does not read as a sentence someone would say out loud, it is not finished.
- **Don't** add a decorative element. No eyebrow label above a heading, no badge that carries no state, no chip that repeats the line beneath it, no icon that names nothing.
- **Don't** show a number the user does not need for the decision in front of them, and never round a figure in a way that could change that decision.
- **Don't** describe what might happen when you can describe what will. "This swap will send 100 USDC to the exchange" is the action; "This swap may or may not succeed" is the anxiety.
- **Don't** reach for crypto-terminal neon, glassmorphism, gradient orbs, glass badges, or decorative illustration. They are not restylings of this system, they are a different one.
- **Don't** drive the transaction timeline from the assistant's stream, and don't let a successful signature or a successful HTTP response become evidence that money moved.
