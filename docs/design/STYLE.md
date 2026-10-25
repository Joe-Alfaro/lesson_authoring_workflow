# Style brief: Lesson Studio

"Lesson Studio" is a placeholder product name. Every screen in `docs/design/` uses this brief; a
change to it goes through the same review as a mockup.

## Mood

A quiet workroom for people who write teacher lessons all day. The chrome steps back, the lesson
text comes forward, and the only colour with a job everywhere is the **pacing colour**: each lesson
section (Launch, Literacy Lab, Learning in Action, Look Back) has one hue, and that hue follows it
from the 50-minute pacing ribbon to the editor's outline rail to the section heading. Status
colours are reserved for workflow state and always travel with an icon and a word.

The memorable element is the **segment**: a lesson is a 50-minute bar split into coloured
sections, and a unit is a strip of 41 numbered tiles split into arcs. Both are made of the same
mark (a rounded block with a 2px gap), so the dashboard and the lesson read as one system.

Reference directions:

1. **A teacher's edition, read at a desk.** The lesson body is set like a printed teacher guide:
   a reading serif, a narrow measure, typed blocks labelled in a left gutter the way a script
   labels speakers ("Say", "Ask", "Directions").
2. **A plan book.** The pacing ribbon and unit strip borrow the plan-book habit of blocking time
   in colour, not decoration: every coloured block is a section or a lesson.
3. **A review desk.** Workflow states read like the marks an editor makes on proofs: a check for
   approved, a pen mark for changes requested, a clear warning for failed. Restrained, never
   alarming.

What it is not: no cream background, no newspaper hairline grid, no identical rounded cards with
soft shadows, no all-caps eyebrow labels, no monospace data labels.

## Typefaces

| Role | Family | Fallback | Notes |
| --- | --- | --- | --- |
| Interface, data, labels, tables | **Atkinson Hyperlegible Next** (400, 600, 700) | `system-ui, sans-serif` | Built for legibility; distinct letterforms keep codes such as `L.6.4.b` and `ELD.PI.6.6` unambiguous without a monospace face. Use `font-variant-numeric: tabular-nums` in tables, counts and costs. |
| Lesson content (editor and lesson view) | **Literata** (400, 600, italic 400) | `Georgia, serif` | A reading serif with optical sizes. Teacher-facing and spoken text in roman; **exemplar student responses in italic**, so the student voice is distinguishable at a glance. |

Both are free Google Fonts; production loads them with `next/font/google`.

### Type scale

A classical scale (12, 14, 16, 18, 21, 24, 36). Sentence case everywhere; no all-caps labels.

| Token | Size / line height | Family, weight | Used for |
| --- | --- | --- | --- |
| `--t-caption` | 12 / 16 | Atkinson 400 | timestamps, helper text, table meta |
| `--t-ui` | 14 / 20 | Atkinson 400, 600 for emphasis | controls, table cells, panels |
| `--t-ui-lg` | 16 / 24 | Atkinson 400 / 600 | form inputs, dialog body, panel titles |
| `--t-body` | 17 / 28 | Literata 400 | lesson body text (measure 64-68ch) |
| `--t-h3` | 18 / 26 | Atkinson 600 | section parts ("Part A: ..."), dialog titles |
| `--t-h2` | 21 / 28 | Literata 600 | lesson section headings, page subtitles |
| `--t-h1` | 24 / 32 | Atkinson 700 | page titles (unit, prompt editor) |
| `--t-display` | 36 / 42 | Literata 600, -0.01em | lesson title in editor and lesson view, sign-in |

Gutter labels ("Say", "Ask", "Directions", "Exemplar") are Atkinson 600 at 13/20 in the section
or block colour.

## Colour tokens

Light theme only. A dark theme is not proposed for a 1-2 day internal build (open question in
the spec).

### Base

| Token | Hex | Use |
| --- | --- | --- |
| `--ink` | `#1C2430` | primary text, primary button fill |
| `--ink-2` | `#4A5568` | secondary text |
| `--ink-3` | `#5F6B7A` | muted text, placeholders (5.4:1 on paper, 4.8:1 on desk) |
| `--paper` | `#FFFFFF` | document, panels, tables |
| `--desk` | `#EEF1F4` | app background behind the document and panels |
| `--rule` | `#D5DBE2` | borders, table rules |
| `--rule-strong` | `#AEB7C2` | input borders, focusable outlines |
| `--focus` | `#1F6FEB` | 2px focus ring, 2px offset, on every focusable element |
| `--select` | `#DCE8FD` | text selection, selected rows |

### Pacing (section) colours, categorical, fixed order

Validated with the dataviz palette checker (light, all checks pass: lightness band, chroma, CVD
adjacent-pair separation, contrast ≥ 3:1 against paper). Always labelled with the section name
and minutes; never colour alone. These hues are for marks (ribbon segments, rules, swatches).
Small text in a section colour (the block gutter labels) uses the `-ink` variant where the hue is
below 4.5:1: `--sec-launch-ink` `#8A5B00` (5.9:1) and `--sec-lab-ink` `#00715F` (6.0:1); Learning
in Action (6.9:1) and Look Back (5.2:1) are used as is.

| Order | Token | Hex | Tint (backgrounds) | Section |
| --- | --- | --- | --- | --- |
| 1 | `--sec-launch` | `#B87A00` | `#FBF1DC` | Launch |
| 2 | `--sec-lab` | `#008A7A` | `#DDF3EF` | Literacy Lab |
| 3 | `--sec-action` | `#4F46C8` | `#E8E7FA` | Learning in Action |
| 4 | `--sec-lookback` | `#C23A62` | `#FAE3EA` | Look Back |
| — | `--sec-homework` | `#5E6B7A` | `#ECEFF3` | Homework (outside the 50 minutes, not in the ribbon) |

### Status colours, reserved for workflow and generation state

Pill: tint background, text colour foreground, icon on the left. Text colour on tint ≥ 4.5:1.

| Status | Text / icon | Tint | Icon |
| --- | --- | --- | --- |
| Not generated | `#4A5568` | `#EEF1F4` | hollow circle |
| Queued | `#4A5568` | `#EEF1F4` | clock |
| Generating | `#0B5CAD` | `#E1EEFB` | dot that breathes (see Motion) |
| Draft | `#334155` | `#FFFFFF` + 1px `--rule-strong` border | pencil |
| In review | `#7A4E00` | `#FCEFCF` | eye |
| Changes requested | `#9A3412` | `#FDE7DA` | pen mark |
| Approved | `#166534` | `#DCF2E3` | check |
| Failed | `#A11D1D` | `#FBE2E2` | filled warning triangle |
| Warning (import, standards) | `#7A4E00` | `#FCEFCF` | triangle outline |

Collaborator colours (presence avatars, remote cursors and selections) are a separate set so they
never read as a section or status: `#7C3AED`, `#0E7490`, `#BE185D`, `#4D7C0F`, `#C2410C`,
`#1D4ED8`; selection tint is the colour at 20% opacity.

### Placeholders in mockups

Money, tokens and durations are not known until generation runs (R12, R29), so the mockups show
them as visible placeholders such as `{{EST_COST}}`, set in a dashed outline. The built UI shows
real values formatted as `$0.00`.

## Spacing and layout

- Base unit 4px. Scale: `4, 8, 12, 16, 24, 32, 48, 64` (`--s1`..`--s8`).
- Radius by hierarchy, not one value: controls and chips 6px, panels and dialogs 10px, segment
  marks 4px, avatars and status pills fully round.
- Elevation only for things that float above the page (menus, popovers, dialogs, the selection
  toolbar): `0 1px 2px rgba(28,36,48,.08), 0 8px 24px rgba(28,36,48,.14)`. Panels in the page are
  separated by the desk colour, not shadows.
- **Desktop (primary, 1440 wide)**: top bar 56px. Page content max 1280px, 32px side gutters,
  12-column grid with 24px gutters.
- **Editor and lesson view**: three regions. Outline rail 232px (sections with their colour and
  minutes) | document column, text measure 680px centred on paper | side panel 368px (assist,
  alignment, history, versions, comments), collapsible.
- **Narrow (390 wide)**: single column, 16px gutters. Tables become stacked rows; the side panel
  becomes a bottom sheet; the outline rail becomes a section jump menu. Only the dashboard and
  lesson view are designed at this width (internal desktop tool).
- Alignment: everything left-aligned; numbers right-aligned in tables; sign-in is the only centred
  layout.

## Motion

Motion only answers an action or shows live state. All of it is disabled or replaced under
`prefers-reduced-motion: reduce`.

| Motion | Trigger | Duration | Easing | Reduced-motion fallback |
| --- | --- | --- | --- | --- |
| Generating dot breathes (opacity 1 → .35 → 1) | lesson status is Generating | 1600ms, infinite | ease-in-out | static dot; the word "Generating" carries the state |
| Status tile / pill colour change | live status update (R9) | 240ms | ease-out | instant change |
| Unit strip tile "just finished" ring (2px ring fades out) | a lesson changes to Generated or Failed | 900ms, once | ease-out | no ring; row stays highlighted for 3s with `--select` instead |
| Menu, popover, selection toolbar appear (fade + 4px rise) | open | 140ms | cubic-bezier(.2,.7,.3,1) | fade only, 80ms |
| Side panel open/close (slide 16px + fade) | panel toggle | 180ms | cubic-bezier(.2,.7,.3,1) | instant |
| Dialog appear (fade + scale .98 → 1) | open | 160ms | cubic-bezier(.2,.7,.3,1) | fade only |
| Suggestion inserted (accepted text background fades from `--select` to none) | accept AI suggestion | 1200ms | ease-out | static tint for 2s, then removed |
| Remote cursor name label fades out | 3s without that user moving | 300ms | ease-out | label hides without fading |
| Indeterminate progress bar (stripe moves) | import parsing, AI request pending | 1200ms, infinite | linear | static half-filled bar plus "Parsing..." text |

## Components (shared vocabulary)

- **Buttons**: primary (ink fill, white text), secondary (paper, `--rule-strong` border), quiet
  (text only), danger (`#A11D1D` text and border, filled only in a confirm dialog). Height 36px,
  32px in dense tables. Labels name the action ("Start generation", "Approve lesson").
- **Status pill**: icon + word, never colour alone.
- **Standard chip**: code in Atkinson 600 13px, 6px radius, paper with a rule border; focus and
  supporting chips differ by group heading, not colour. Unknown codes add the warning triangle
  and the warning tint. Hover or focus opens a popover with the full text (R15).
- **Pacing ribbon**: horizontal bar, width proportional to minutes, 2px paper gap between
  segments, each segment labelled with the section name and minutes (labels sit below the bar
  when a segment is too narrow).
- **Unit strip**: one 28px tile per lesson, numbered, grouped by arc with the arc name above;
  fill is the status tint with the status icon colour as a 3px bottom bar.
- **Typed blocks** in the lesson: a 96px left gutter carries the block label ("Say",
  "Directions", "Ask", "Exemplar"); boxed blocks (Teacher tip, Pulse check, Reflection, ELD
  instructions, Student support) use a 3px left rule in the section colour and a paper fill on the
  desk, with their own title row.
