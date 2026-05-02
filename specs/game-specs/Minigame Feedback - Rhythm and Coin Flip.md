# Minigame Feedback — Rhythm Tap & Coin Flip

## Context

Rhythm Tap and Coin Flip are the two simplest minigames in the framework, and they're the two that suffer most from a lack of moment-to-moment feedback. In Rhythm Tap a perfect hit and a missed input look identical. In Coin Flip the game's climax — the reveal — is a small inline card tucked in the corner of an otherwise unchanged screen.

This spec applies the primitives shipped in `Combat Feedback Primitives.md` to both games. It is intentionally small — the changes are local to the two view components, and they consume primitives instead of inventing new ones.

Depends on: **Combat Feedback Primitives** (must land first).

## Goals

- Rhythm Tap: every tap produces a clear color flash on the lane. Green = registered hit; red = missed (no candidate note in window or wrong-timing).
- Coin Flip: the reveal becomes a centered popup over the play surface, declaring the side the coin landed on, who won, who lost, and per-player resource deltas. The existing inline `RevealCard` is removed in favor of the popup.
- Zero backend changes. Both games already have the state needed to drive these animations.

Non-goals:

- Tap-and-drag mechanics, new note types, or any Rhythm gameplay change.
- Multi-round Coin Flip flow changes (the round-advance behavior is unchanged).

## Rhythm Tap

### Trigger model

The view already tracks the rhythm-tap state: `rhythmTapNote.hitByUsername` and the per-player `rhythmTapScore` row with `hits` / `misses` / `combo`. The animation triggers fall out of these directly:

1. **Hit flash (green)** — when a note's `hitByUsername` transitions from `undefined` to the current player's username, flash the note's lane green. Use the lane the note belongs to (`note.lane`).
2. **Miss flash (red)** — when the player taps a lane and no animation fires within ~80ms (i.e. no note transitioned to "hit by me"), flash that lane red. The simplest implementation: track per-lane "last tap key" client-side; on tap, schedule a check 80ms out — if no green flash has fired for that lane in the meantime, fire a red one.

A purer alternative — flashing red whenever the per-player `misses` counter increments — is rejected because misses don't carry a lane and the flash needs to land on the lane the player actually pressed. The "pending tap" approach above keeps the flash co-located with the input.

### Implementation in `RhythmTapView.tsx`

Per lane, wrap the lane container with `position: 'relative'` so an absolute-positioned overlay can sit on top of it. Mount a `<FlashOverlay>` per lane, keyed off two trigger ints stored in component state (`hitTrigger[lane]`, `missTrigger[lane]`).

Both flashes use **`intensity={0.30}`** (the "subtle" preset described in the Primitives spec). Rhythm Tap fires flashes on every input — at the default combat intensity of 0.55 the lanes would feel like a strobe. The 0.30 setting reads as ambient feedback, not a hit-confirm.

Inside `tapNote(lane)`:

```ts
const candidate = ...; // existing candidate logic
if (!candidate || candidate.offset > HIT_WINDOW_MS * 2) {
  bumpMissTrigger(lane);   // fire red flash immediately
  return;
}
// schedule a "did the server confirm a hit?" check; if not, flash red
const tapId = ++pendingTapIdRef.current[lane];
setTimeout(() => {
  if (pendingTapIdRef.current[lane] === tapId && !hitConfirmedRef.current[lane][tapId]) {
    bumpMissTrigger(lane);
  }
}, 80);
rtTap({ noteId: candidate.note.id, clientHitMicros }).catch(() => {});
```

A `useEffect` watching `sessionNotes` detects new transitions to `hitByUsername === myUsername` and bumps `hitTrigger[note.lane]`, also marking `hitConfirmedRef.current[note.lane][lastTapId] = true` so the pending miss check is suppressed. Track the previous-render set of hit note IDs in a ref to do the diff.

Store triggers as `number[]` of length `NUM_LANES` to keep the per-lane bump cheap. Each `<FlashOverlay>` only re-renders when its lane's trigger changes.

### Verification

1. Solo Rhythm Tap, perfect taps: every successful tap produces a brief green flash on the lane. No flash residue between taps.
2. Solo Rhythm Tap, deliberate mis-times (tap with no incoming note): each tap produces a red flash. No green leaks through.
3. Co-op Rhythm Tap (two players): only my taps drive flashes on my screen; the other player's hits/misses are invisible to me. (My screen shouldn't flash for partner taps.)
4. Rapid tapping on a single lane: flashes replay cleanly without the lane locking on a single color.

## Coin Flip

### From inline card to popup

Today the reveal is rendered as `<RevealCard>` inside the regular layout (lines 244–287 of `CoinFlipView.tsx`), occupying a corner of an otherwise-static screen. Replace it with a `<ResultsPopup>` that opens centered over the existing play surface when `revealed === true`, dismisses to a "next round" state.

### Popup body

The popup renders, top-down:

- **Headline**: `Heads!` or `Tails!` — large, in the team's standard headline weight (text-3xl/4xl, slate-100).
- **A coin icon / glyph**: simple text glyph for v1 (`H` or `T` in a circle). A real spinning-coin animation is a stretch goal and explicitly out of scope.
- **Per-player results table**: one row per `sessionMember` with their pick, their wager, and the resource delta (`payout − wager`). The current player's row is highlighted with the standard amber tint already used in the lobby.
  - Format: `Alice · Heads · −10 scrap` / `Bob · Tails · +20 scrap`.
  - Color the delta cell green for positive, rose for negative.
- **My summary line**: a single emphatic line — "You won 20 scrap" / "You lost 10 scrap" / "You sat this round out." — pulled from the same logic the existing `RevealCard` uses.
- **Done button**: dismisses the popup. The popup also auto-dismisses after `POPUP_AUTO_DISMISS_MS` so a non-clicker isn't stuck.

After dismissal, the underlying view returns to its "place a bet for the next round" state — the existing `!myBet || revealed` branch already renders the wager UI; with the popup gone, that UI is visible again. Note: `revealed` becomes false again on the *next* `cfPick` from any player, so the popup may re-open on a new reveal. That's the intended flow.

### Implementation in `CoinFlipView.tsx`

- Add component state `popupVisible: boolean` defaulting to `false`. A `useEffect` flips it to `true` whenever `revealed` flips to true.
- Replace the `<RevealCard>` JSX with `<ResultsPopup visible={popupVisible} onDismiss={() => setPopupVisible(false)}>`. Move the result-summary content into the children.
- Keep the inline "Round X" header in the main view; the popup is the *event*, not the persistent state. Players who dismiss the popup should still see the round number in the page header.
- Optional: small "result" badge in the page header after dismissal, so a player who closed the popup early can see what happened on the previous round (`Round 3 → Heads`). This is a 4-line addition and worth doing.

### Verification

1. Solo Coin Flip: bet 10 on Heads. Reveal. Popup opens centered with `Heads!` headline, my row highlighted with `−10` or `+10` delta, summary line matches.
2. Solo Coin Flip: dismiss the popup early. The wager UI for the next round is visible underneath. Place another bet → popup re-opens on next reveal.
3. 2-player Coin Flip: A bets Heads 10, B bets Tails 20. Reveal Heads. Popup on A's screen highlights A's row green (`+20`), B's red (`−20`); popup on B's screen the inverse. Both players' summaries are correct from their own perspective.
4. Auto-dismiss: don't tap anything for 4 seconds — popup closes on its own.
5. Edge case — single bidder: A is solo, bets 10, reveals. Popup says "Refund (no contest)" if that's the existing logic; verify it still appears in the popup wording.

## Files to modify

- `src/components/minigames/RhythmTapView.tsx` — add per-lane `<FlashOverlay>`, miss-detection timeout logic, hit-detection diff, the `position: 'relative'` wrapper on each lane container.
- `src/components/minigames/CoinFlipView.tsx` — replace the inline `<RevealCard>` with a `<ResultsPopup>` containing the per-player results table; remove the `RevealCard` function (or keep it as the popup-body sub-component, renamed).

No backend changes. No new tables. No reducer additions.

## Risks

1. **Pending-tap miss timer leaks**: if the player tears down the view (leaves the minigame) while a pending miss check is queued, the `setTimeout` fires on an unmounted component. Use a `useRef` to track tap ids and bail in the timeout if the ref has been cleared on unmount.
2. **Server-confirmed miss vs. timer-confirmed miss**: there's a corner where the server rejects the tap (race condition, note already hit by partner) but the 80ms timer still fires red. That's actually correct behavior — from the player's perspective they did miss — but if it ever feels wrong, the fallback is to confirm misses by watching the `misses` counter increment instead. Ship the timer approach first, revisit if reports come in.
3. **Popup obscuring the next round's bet UI**: auto-dismiss is the safety net. Confirm the auto-dismiss timer is short enough (4s) that an inattentive player isn't stuck staring at a stale result.
4. **Player count of 1 in Coin Flip**: the per-player table shouldn't look broken when there's only one row. Verify it renders centered and the headline still carries the moment.
