# Walkthrough recording

The cut is a real screen recording of the app, with your voice over it. This sheet is the whole job: one silent take, then one voice pass. I do the rest.

## Setup, five minutes

- Chrome, signed in, Rabby unlocked, and enough of the source token for the trade plus gas.
- Maximize the window and keep the address bar visible. Hide the bookmarks bar with ⌘⇧B and close every other tab.
- Turn on Do Not Disturb, silence notifications, hide the Dock.
- Press ⌘⇧5, choose **Record Selected Portion**, and drag a region around the browser window. Record at 60 fps if the machine offers it. Leave the microphone off for this take.
- Keep two or three past chats in the sidebar; a wall of test titles does not read as a real account.

## The take, one continuous recording

Do not narrate. Move slowly, hold still while the app is working, and let the take run long. Everything between the interesting moments is cut later.

1. Open on the home screen. Hold for two seconds before touching anything.
2. Click the composer and type the prompt at a normal pace. Do not paste it; pasting reads as staged.
   `Swap 20 USDC on <the chain that holds it> for NEAR`
3. Send, then take your hands off the mouse. Do not scroll, hover, or move while the tool line and the reply stream.
4. When the card lands, hold for three seconds. Move the cursor to the card and rest it there. Hover Approve without clicking for a moment.
5. Click Approve. Rabby opens. Sign, then close the popup.
6. The card goes to Processing. Do not touch anything until it reads Executed. Keep recording through the wait.
7. Click Details. Hover the transaction link for two seconds. Do not open it.
8. Click Portfolio and hold on the total. Click Super account and hold. If the Super account needs unlocking, do that before the take, not during it.
9. Go back to Home, hold on the empty state for two seconds, then stop recording.

If the assistant asks which chain you meant, answer with the chain that holds the token and keep going. If the trade fails on chain, stop and start a new take; do not try to talk around a failure.

## The voice, ten minutes

Record this while watching the take, so the words land on the picture. One file per line is easiest to sync; a single take with a pause between lines also works.

1. This is Myntle. I'm going to ask for a trade in plain language, and show you exactly what happens to it.
2. I want to swap twenty USDC for NEAR. That is the whole instruction.
3. It checks my balance, prices the route through NEAR Intents, and comes back with a quote.
4. This card is the whole trade. It shows what I receive, the minimum I will accept if the price moves, the slippage bound, and the time the price is held until.
5. The assistant never sees my wallet, and it cannot sign. It can only propose, and I decide.
6. I approve once, and my wallet signs a message rather than a transaction. There is no gas, and no NEAR account to create.
7. Now it is moving. The app follows the settlement until the record says it is final, and the result on screen comes from that record, not from the model.
8. The portfolio is the same account from another angle, including the private balance I unlock in the browser.
9. Myntle. Ask for a trade, and see what actually settled.

Speak at about 150 words a minute and leave a beat at the end of each line. Do not fill the waits with filler; the pause is where the app is working.

If you would rather not use your voice, generate the same nine lines in ElevenLabs and I will lay them in. Your voice is better for this video, because a judge is watching a person use the app.

## Hand it over

Drop the screen take in `demo/raw/` as `take.mov`, and the voice files beside it in `demo/raw/voice/` named `01` through `09`. Then I cut the waits, sync the voice, add the lower-third captions and the end card, and export the 1080p file.

## What to avoid

- Talking while clicking. The wait times are unpredictable, and the quote can expire while you explain it.
- Moving the mouse during the model's reply. The cursor is the viewer's hand, and a wandering pointer reads as uncertainty.
- Recording the whole desktop. The Dock, the menu bar, and whatever else is open are noise the edit has to hide.
- A second take with a different prompt. Keep the same trade across takes so the cut matches.
