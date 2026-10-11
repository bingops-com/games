---
name: labops-art-direction
description: Apply the lab.bingo art direction, a clean modern interface set in a maritime world with a pirate streak. Use when designing or restyling anything a player sees in games (the shelf of games, a game's page, a table and its seats, illustrations, mascot, favicon) or when writing its interface copy.
metadata:
  short-description: Follow the lab.bingo visual identity
---

# LabOps art direction

The theme is the world of piracy, applied to `lab.bingo`: a modern, uncluttered
interface that sails in maritime waters. The interface stays a tool first. The
sea is in the details and the pirate is in the wink.

Games is one application of that world: party and board games played among
friends, each on their own screen, around a shared table. The same direction is
written for the whole lab in the `labops` repository
(`.agents/skills/labops-art-direction`) and for slots, the portal and the status
page in their own; keep them in agreement on the layers, the shared colours and
the mascot. Use it together with the `frontend-design` skill: that one asks for
deliberate choices, this one says which are already made.

Read `web/app/ui.css` before designing: its `:root` tokens are the only
source of the palette, the radii and the control heights, in light and in dark.
Reuse them; when a value is missing, derive it with `color-mix` and add a token
rather than a literal colour. The same file holds the kit every page is made
of (buttons, fields, pills, panels, member rows, dialogs, the chat), with the
pieces that behave in `web/components/ui.tsx`; the page `/uikit/` shows them
all on paper and on the sea. Place an existing piece before writing a new one,
and add a new one to the kit and to that page. A white card laid on the sea
takes the class `light` so that it stays light in the dark theme. Every drawing
lives in `web/lib/art.tsx`, and every pictogram in `web/lib/icons.tsx`: one
hand on a 24 unit grid (round-capped stroke in the text colour, a pale fill for
volume). A pictogram keeps the shape everyone already knows: a paper plane
sends, a plus creates, a magnifier searches, an arrow goes in or out. The
maritime world stays in the illustrations and the background, never in the
pictograms: one a player has to decode loses them. Add a pictogram there
rather than drawing one in place, and never let it speak alone: it sits next
to a word, or its button carries a name.

## Three layers

Keep these apart, in this order of priority.

1. **Interface: modern and sober.** Plain surfaces, legible type, slightly
   rounded shapes, generous spacing. Accent colours mark the important actions
   and states, and mean the same thing everywhere.
2. **World: maritime.** Compasses, ship's wheels, anchors, rhumb lines and
   sea-chart patterns, used as discreet background or small detail. The dot
   grid on every blue panel is the model: visible when looked for, silent
   otherwise.
3. **Signature: pirate.** Carried by names, illustrations and a few winks, not
   by the chrome. The eye patch is the recurring mark of the identity.

Board games pull towards a tavern: wood, felt, parchment, playing-card
flourishes. Games must never turn into that set: no wood, felt, parchment or
rope textures, no gold, no blackletter or "treasure map" fonts, no pirate
speech in labels, buttons, errors or rules. Anything a player has to read to
join a table or understand a rule is written plainly, in French like the rest
of the interface. A game may carry a name from the sea ("Ono", "Mèche
courte"), and so may the name a player is given by default ("Mousse-417").
Things keep their plain names: a table is a "table", a player is a "joueur".

## Shared with the other lab.bingo applications

| Role | Value |
| --- | --- |
| Sea blue (panels, primary action) | `#1443d6`, token `--sea` |
| Deep blue (end of the panel gradient) | `#0a2480`, token `--sea-deep` |
| Navy detail (eyes, patch, strokes on white) | `#0b2a94`, token `--navy` |
| Mint (collar, logo dot, a rare highlight) | `#8af2bf`, token `--mint` |

- Blue is the sea and the action colour. Pirate elements are drawn in navy, not
  black. Do not add another brand accent.
- Type: Red Hat Display for headings, Red Hat Text for body, as on the login
  page. Both are served from `public/fonts`; nothing is fetched from a CDN.
- Shape: 10px radius on fields and buttons, 14px on panels, 48px control
  height, a 3px focus ring.
- The lockup is the games emblem (the cat's head above a hand of cards, on a
  blue rounded tile, `art/brand/src/logo.png`) next to `lab.bingo games`. It
  is generated in the same series as the slots emblem, then prepared by
  `art/build.py`; the same emblem is the browser icon and the home-screen
  icon. The other lab.bingo applications keep their own mark.

## Games' own character

The model is a game room, not a catalogue: one gesture to get in, then
everything happens in the same place.

- **A blue band on the left, no header** (`web/components/Shell.tsx`). The band
  carries the lockup, Jouer, Amis, the profile, the cat, then the account and
  the language at its foot. Inside a room it shows the room instead: its code
  (a click copies the invitation link), its players, and the way out. On a
  narrow screen the band becomes a bar at the top.
- **The home page is one gesture.** A big "On joue ?", a name, one large
  primary button "Créer un salon", and the field to join with a code. Beside
  it, one blue panel shows the four games; a click on one creates a room set
  on that game. Nothing else, and it fits the window.
- **A room never changes page** (`web/components/Table.tsx`). It is one blue
  panel in three states: choosing the game (four large tiles, the chosen one
  ringed in mint, and a white card with the pitch, the rules and "Lancer la
  partie"); playing; and the result, a white card laid over the stage with
  "Rejouer" and "Changer de jeu". Players see the host's choice change live.
- **A game fits the window.** While a room is open the page never scrolls: the
  stage takes the whole height and its pieces size themselves on the room left
  (cards, grid, ring). "Pleine fenêtre" keeps only the stage; Escape brings the
  rest back. Check every stage at 1366×768, at a short window (1280×620) and on
  a phone before finishing.
- **A stage shows the game, not text about it.** One line at the top
  (`web/stages/Guide.tsx`) says what is happening. It turns white with a mint
  ring, and gains one short sentence, only when this player must act or
  something is urgent; when they wait, the title is enough. No legend sits on
  a stage: the rules open from a button. One sentence may tell the last move.
  A player must still never have to guess whose turn it is or why a button is
  disabled.
- **Settings on paper, play on the sea.** Everything drawn on a stage is
  white, with navy details; what a player must act on is a white button or a
  white card.
- **Mint means "this one".** The player's own piece, whoever's turn it is, the
  game chosen in the room. Nowhere else.
- **Each game owns its colours, and only on its stage.** They are tokens in
  `web/app/stages.css`: `--corail`, `--sable`, `--algue`, `--lagon` for the
  four suits of Ono and the four players of Bombermat; `--corail` and
  `--algue` again for Bâbord and Tribord in Codenoms, red and green like a
  ship's lights; `--feu` for a blast. Every one is doubled by a shape or a
  word.
- **A drawing sheet is white paper on the sea** (`web/stages/Pad.tsx`), the
  one white surface of its stage, as large as the window allows. Its twelve
  colours are the players' paint, not the interface's: they live in
  `web/lib/sketch.ts` and appear nowhere but on the sheet and its swatches.
  The tool in hand wears the mint ring.
- A state is never told by colour alone, and nothing is promised that does not
  work: what cannot be done yet says why in one sentence next to the control
  ("Il manque 2 joueurs pour Codenoms").
- **A profile is a record sheet**, friends are a register: plain rows
  separated by a hairline. A profile is public and says so to its owner; it
  never lists who a player's friends are, only how many.
- Things keep plain names: a room is a "salon", a player a "joueur", the one
  who opened it the "hôte".
- Light and dark are both designed. Check every change in the two themes.

## Mascot and illustrations

The mascot is a white cat with a mint collar and a navy eye patch over its left
eye (on the viewer's right), held by a thin diagonal strap. Keep those four
traits whenever the cat is drawn. It is white, so it always sits on blue: here
it sits at the foot of the left band (`web/components/Mascot.tsx`), drawn like the
slots emblem: round head with a tuft, pale blue inside the ears, a determined
brow, a round medal on the collar. It blinks, twitches an ear and sways its
tail. One cat per screen; it never takes a seat at a table and is not a game
piece.

Game drawings share one hand on a 64 unit grid: flat white fills, no outline,
no gradient, navy details, rounded joins; a paler white (opacity) is the only
shadow tone. They are white, so they always sit on blue: on a lid, on a stage,
or on a small blue tile. Pirate attributes are added one at a time (the forbidden card of Codenoms is marked with a
cross), never as a full costume. A drawing must be told from the others by its
shape alone, at 40px.

## Motion

Motion answers the player or says what just happened in the game: a lid lifts
under the pointer, a playable card rises, a bomb pulses until it blows, the
bomb of BoomParty flashes when it goes off. Nothing else moves except the cat's blink, ear and tail. No
animation delays an action, and every animation stops under
`prefers-reduced-motion: reduce`.

## Two languages

Every text a player reads exists in French and in English, written side by
side where it is used: `t('Rejoindre', 'Join')` (`useT` in `web/lib/app.ts`).
A message the server may send is added to `web/lib/i18n.ts` too. Game names
are not translated; the shout of Ono is "Ono!", the teams of
Codenoms are Port and Starboard. English copy follows the same rules as the
French: plain verbs, sentence case, no pirate speech.

## Constraints

- Decoration never lowers text contrast and never overlaps a control.
- Assets are inline SVG, data URIs or files under `web/public/`; nothing may be
  loaded from another site (the server's CSP forbids it).
- The games are original: names, drawings and wording are ours. A game may
  follow the rules of a known game; `README.md` says which.

## Before finishing

Start the server and look at the home page, a room before, during and after
a game, a profile and the friends page, in
light and dark, wide and on a phone. Would the page still read as a modern tool
with the decoration removed? Is the shelf still the only thing that moves the
eye on the home page? Is mint used only for "this one"? Is there one cat, and
on blue? Then update the "Apparence" section of `README.md` if what a player
sees has changed.
