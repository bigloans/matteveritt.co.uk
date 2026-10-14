# Design plan: matteveritt.co.uk portfolio v2

## Inspection (phase 0)

| Item | Finding |
| --- | --- |
| Stack | One static `index.html` with inline CSS and vanilla JS |
| Build | None. GitHub Pages runs its default Jekyll pass over the repo |
| Hosting | GitHub Pages, repo `bigloans/matteveritt.co.uk`, branch `main`, custom domain in `CNAME` |
| Deploy config | `_config.yml` excludes tooling and briefs from the public site |
| Tokens | One `:root` custom property block inside `index.html`, plus two dark theme copies |
| Fonts | Self-hosted woff2 in `/fonts`: Atkinson Hyperlegible Next 400, 600, 700 and Mono 400, 500 |
| Scripts | `scripts/audit.js` (page audit), `scripts/check_case_study.py` and `check_case_study_browser.mjs` (old single-page checks) |
| Baseline | `docs/audit-baseline.json` and `docs/lighthouse-baseline.json` |

## Architecture

- Pages stay static HTML, CSS and vanilla JS. No framework.
- `tokens.json` is the single token source.
- `scripts/build.mjs` is the one build step. It is a small Node script with no dependencies. It:
  - writes `assets/tokens.css` from `tokens.json`
  - writes the `/spec/` page body from `tokens.json`
  - stamps the shared head, header and footer into every page
  - renders the landing Work list and each piece's meta line and Next link from `work/projects.json`
  - computes read times at 230 words per minute
  - fails with `--check` when any committed file is out of date, so the outputs can't drift
- "Show the spec" reads token names and values from `assets/tokens.css` at runtime through the CSSOM. The CSS, the labels and `/spec/` therefore share one source.
- Generated files are committed, because GitHub Pages serves the repo as it is.

## Sitemap

| URL | Page | Type |
| --- | --- | --- |
| `/` | Landing | Landing |
| `/work/replacing-the-component-library/` | I replaced my own component library with a spec AI builds from | Case study |
| `/work/visual-rules-for-agents/` | Visual rules an AI agent can follow | Short read |
| `/work/design-system-with-agents/` | Running a design system with 15 agents | Short read |
| `/spec/` | This site's spec | Spec |

Projects index order: case study, visual rules, agents. The Next link on the last piece wraps to the first.

## Content map

| Current section | Destination |
| --- | --- |
| At a glance | Case study, At a glance. Highlight link and Decisions line removed |
| Customers, v1 | Case study, The problem (`#customers`) |
| Customers, Track record and Tenure | Landing, About |
| The problem | Case study, The problem |
| Options | Case study, Options |
| The product | Case study, What I built |
| The gate | Case study, What I built (`#gate`) |
| Visual language | Visual rules read |
| Designers | Agents read, with two sentences in case study Adoption |
| First evidence | Case study, First evidence (`#evidence`, alias `#story`) |
| Team of one | Agents read |
| Adoption | Case study, Adoption |
| Metrics | Case study, Measures and trade-offs |
| Trade-offs | Case study, Measures and trade-offs (`#tradeoffs`, alias `#trade-offs`) |
| Roadmap | One line in Measures (`#roadmap`) |
| Reflection | Case study keeps two lessons. "Put guardrails where people work" goes to the agents read |
| Contact | Landing Contact, and the call to action at the end of the case study |
| Hero spec file illustration | Dropped. It is the planned slot for a real spec excerpt |

### Old anchor redirects

| Old hash | Destination |
| --- | --- |
| `visual`, `visual-language` | Visual rules read |
| `designers`, `team`, `reversed` | Agents read |
| All other old ids, plus `story`, `trade-offs`, `changed-mind` | Case study, same hash |

- The brief sends `designers` to the visual rules read, but its content map puts Designers in the agents read. I follow the content, so the hash lands on the section it names.
- The brief's list uses `visual`, `evidence` and `tradeoffs`. The live page used `visual-language`, `story` and `trade-offs`. Both sets redirect, and both exist as ids on the destination.

## Tokens

All values live in `tokens.json`. Names carry the value for scales, so a label reads `--space-48: 48px`.

### Colour

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-surface` | `#FFFFFF` | `#0B1628` | Page background |
| `--color-surface-alt` | `#F3F5F8` | `#12223A` | Gate output, contents sheet |
| `--color-text` | `#0B1628` | `#E8EDF4` | Text and headings |
| `--color-text-muted` | `#5D6878` | `#B9C6D8` | Metadata, notes |
| `--color-interactive` | `#0B6B63` | `#2EC4B6` | Links, primary buttons, focus |
| `--color-on-interactive` | `#FFFFFF` | `#0B1628` | Text on primary buttons |
| `--color-redline` | `#C2185B` | `#FF7AB6` | Spec annotations only |
| `--color-hairline` | `#D3D9E1` | `#2A3B57` | 1px separators |

- `on-interactive` and `hairline` are additions. Buttons need a text role, and separators need a non-text colour.
- Recreation colours sit in a separate `demo` group. They depict the product's brand and appear only inside recreations.
- The build computes every text-on-surface pairing in both themes and fails below 4.5:1.

### Type

- Families: `--font-text` Atkinson Hyperlegible Next, `--font-mono` Atkinson Hyperlegible Mono.
- Scale: `--text-14`, `16`, `18`, `20`, `28`, `40`, `64`.
- Leading: `--leading-tight` 1.05, `--leading-snug` 1.15, `--leading-body` 1.55, `--leading-body-compact` 1.5.
- Weights: `--weight-regular` 400, `--weight-medium` 500 (mono only), `--weight-semibold` 600, `--weight-bold` 700.
- Body: 18 / 1.55 from 900px, 16 / 1.5 below.
- Reading column: `--size-measure` 68ch, about 690px at 18px.

| Element | Desktop | Below 900px |
| --- | --- | --- |
| Landing h1 | 64 / 1.05 / 700 | 40 / 1.05 / 700 |
| Article h1 | 40 / 1.05 / 700 | 28 / 1.15 / 700 |
| h2 | 28 / 1.15 / 600 | 20 / 1.15 / 600 |
| h3 | 20 / 1.15 / 600 | 18 / 1.15 / 600 |
| Lede, figures | 20 / 1.55 | 18 / 1.5 |
| Meta, notes, code | 14 or 16 | 14 or 16 |

### Spacing, radius, elevation, motion

- Spacing: `--space-4`, `8`, `12`, `16`, `24`, `32`, `48`, `64`, `96`.
- Section gap: `--space-section` 96, stepping to 64 below 900px. Block gap: `--space-block` 48, stepping to 32.
- Radius: `--radius-control` 10, `--radius-surface` 16, `--radius-modal` 20, `--radius-pill` 999px, `--radius-circle` 50%.
- Elevation: `--shadow-overlay`, used by the contents sheet only.
- Motion: `--motion-fast` 200ms. Used by the spec reveal and the contents sheet. Reduced motion sets every transition to none.
- Sizes: `--size-page` 1200px, `--size-target` 44px, `--size-hairline` 1px, `--size-focus` 2px.

## Wireframes

### Landing, desktop (1444)

```
+------------------------------------------------------------------+
| Matt Everitt     Work  About  Contact      [Show the spec] (o)   |
+------------------------------------------------------------------+
|                                                                  |
| I run design systems as products.                    64px, cols 1-9
| My latest replaced a component library with a        20px, cols 1-7
| specification that AI coding agents build from...                |
| Design system manager, open to ...                   16px muted  |
| [Read the case study]  [Email me]                                |
|                                                                  |
| Work                                                             |
| I replaced my own component        | Example gate output         |
| library with a spec AI builds from | $ gate check src/           |
| One sentence summary               |   x raw-colour  ...         |
| Case study, 2026, 7 minute read    |   3 blocking, exit 1        |
| ---------------------------------------------------------------- |
| Visual rules an AI agent can follow           Short read, 3 min  |
| One sentence                                                     |
| Running a design system with 15 agents        Short read, 3 min  |
| One sentence                                                     |
|                                                                  |
| About                                                            |
| 100 to 160 words of prose, cols 1-7                              |
|                                                                  |
| Contact                                                          |
| I'm looking for a role as ...                                    |
| [Email me]  [LinkedIn]                                           |
+------------------------------------------------------------------+
| Set in Atkinson ...                                              |
| Read this site's spec                                            |
+------------------------------------------------------------------+
```

### Landing, 390

```
+------------------------------+
| Matt Everitt  [Show spec](o) |
| Work  About  Contact         |
+------------------------------+
| I run design                 |
| systems as products.   40px  |
| My latest replaced ...       |
| Design system manager ...    |
| [Read the case study]        |
| [Email me]                   |
+------------------------------+  fold at 844
| Work                         |
| Case study title             |
| One sentence                 |
| Case study, 2026, 7 min      |
| Example gate output          |
| [ scrolls inside ]           |
| ---------------------------- |
| Short read rows              |
| About, Contact, footer       |
+------------------------------+
```

### Case study, desktop

```
+------------------------------------------------------------------+
| header                                                           |
+------------------------------------------------------------------+
| I replaced my own component library with a spec AI builds from   |
| Lede paragraph, cols 1-8                                         |
| Case study, 2026, 7 minute read                                  |
| Role ...  Team ...  Scope ...  Timeline ...                      |
+-------------+----------------------------------------------------+
| Contents    | At a glance                                        |
| At a glance | Body column, about 690px                           |
| The problem | ...                                                |
| ...         | Reflection                                         |
| (sticky)    | Call to action, Email me, LinkedIn                 |
|             | Next: Visual rules an AI agent can follow          |
+-------------+----------------------------------------------------+
| footer                                                           |
+------------------------------------------------------------------+
```

### Case study, 390

```
+------------------------------+
| header                       |
+------------------------------+
| I replaced my own            |
| component library ...  28px  |
| Lede                         |
| Case study, 2026, 7 min      |
| Role  Product owner, ...     |
| Team, Scope, Timeline        |
| Sections, one column         |
|                  [Contents]  |  fixed, 44px, clear of safe areas
+------------------------------+
  Contents sheet opens from the bottom, closes on link, Escape or button
```

### Short read, desktop and 390

```
+--------------------------------------------+   +--------------------+
| header                                     |   | header             |
| h1                                         |   | h1                 |
| Lede                                       |   | Lede               |
| Short read, 3 minutes                      |   | Short read, 3 min  |
| Role, Scope, Timeline                      |   | Role, Scope, Time  |
| Sections, body column cols 1-8             |   | Sections           |
| Back to the case study                     |   | Back link          |
| Next: ...                                  |   | Next: ...          |
| footer                                     |   | footer             |
+--------------------------------------------+   +--------------------+
```

### Spec page, desktop and 390

```
+--------------------------------------------+   +--------------------+
| header                                     |   | header             |
| This site's spec                           |   | This site's spec   |
| Intro, one paragraph                       |   | Intro              |
| Colour: table, role, light, dark, ratios   |   | Colour table       |
| Type: specimen line per step               |   |  scrolls inside    |
| Spacing: bar per step                      |   | Type specimens     |
| Radius: role, value, sample                |   | Spacing bars       |
| Elevation, Motion                          |   | Radius, Elevation  |
| footer                                     |   | footer             |
+--------------------------------------------+   +--------------------+
```

## "Show the spec"

- Header button with `aria-pressed`. Label switches between "Show the spec" and "Hide the spec". Escape hides. State resets on every page.
- Without JavaScript the button stays `hidden`.
- Curated elements carry `data-spec` and `data-spec-priority`:
  - `data-spec="space"` with `data-spec-prop` of `margin-top`, `padding-top`, `padding-left`, `row-gap` or `column-gap`. Draws a measured redline.
  - `data-spec="type"`. Outlines the first line box and labels `--text-64: 64 / 1.05 / 700`.
  - `data-spec="radius"`. Outlines the element and labels the role.
  - `data-spec="color"`, optionally `data-spec-prop="background-color"`. Labels the role and its contrast against the resolved background.
- Values come from `getComputedStyle`. Token names come from the `:root` rules in `assets/tokens.css`. A value with no token reads "untokenised" in redline.
- One absolutely positioned layer, `aria-hidden="true"`, clipped to the viewport width. Recomputed on resize, theme change and font load.
- Labels place greedily by priority and try three positions. A label that would overlap a placed label is dropped. Below 520px only priority 1 shows.
- A polite live region announces "Showing N spec annotations. Press Escape to hide."
- Reveal is an opacity change over 200ms. Reduced motion removes it.

## Review against the design direction

Every choice below would appear on a generic portfolio. Each is revised or justified.

| Generic choice | Decision |
| --- | --- |
| Dark navy hero with gradient glow and grid | Revised. Hero is paper or navy surface with no wash, so the type carries it |
| Rotated code window in the hero | Revised. Removed. A real spec excerpt can take the slot later |
| Big-number stat cards | Revised. At a glance sets three figures as sentences with bold numbers, no card chrome |
| Identical project cards in a grid | Revised. One feature entry with the gate output, then two text rows |
| Card hover lift and fade-in on scroll | Revised. Removed. Motion is user-triggered only |
| Eyebrow labels above headings | Revised. Removed. Headings name the section |
| Chips for criteria | Revised. One sentence lists the five criteria |
| Coloured status pills in Metrics | Revised. Plain headed lists |
| Alternating dark and light sections | Revised. One surface per theme. The hairline separates only chrome and the Work list |
| Sticky contents sidebar | Justified. A 1,600 word case study needs a route through it |
| Teal accent | Justified. It is the only interactive colour and doubles as the product's brand |
| Two buttons in the hero | Justified. The 30 second reader needs a read path and a contact path |
| Theme toggle | Justified. The case study argues for two themes from one token set |
| Footer colophon | Justified. The typeface choice is part of the accessibility argument |
| Monochrome gate output | Justified. Glyphs carry pass and fail, so colour stays free for redlines |
| Gradient border on the AI badge | Justified. It is the product component being shown, inside a recreation |

## Post-build review (phase 9)

Screenshots of every page at 1444 and 390 in both themes, plus the landing page with "Show the spec" on, were reviewed against the design direction.

| Finding | Change |
| --- | --- |
| The hairline above the North star separated two figures of the same kind, so it was decoration | Removed |
| In dark theme, the navy half of the AI disclosure recreation merged with the page and its clipped corner showed as a stray arc | Recreation frames get a 1px hairline, which separates product recreations from prose |
| Redline labels sat on top of text when placed above an element | Labels try the space right of the text first, then above, then below. Colour labels shorten when wider than the viewport |
| The 64px statement broke after "design" at 14ch | Measure widened to 18ch, so it sets on two lines |
| The gate output pushed the landing page wider than 390px | Grid children get `min-width: 0`, so the output scrolls inside its own box |
| The decision log table overflowed at 320px | Rows stack below 520px |
| The intentional 3.34:1 ghost button label failed Lighthouse colour contrast | The visible label is SVG text with a screen reader label, so the demo stays visible and the page audit still lists it |

## Version 3: personality back (13 October 2026)

Matt reviewed v2 live and found it too quiet. It read like a blog, not a portfolio to explore. V3 reverses the brief's restraint rules on purpose and keeps everything else.

| Changed | Kept |
| --- | --- |
| Navy bands with a drifting aurora glow and a faint grid, fixed navy in both themes | Content, word counts and page structure |
| Gradient type on one phrase per hero, teal through blue to pink | One token source, the build and `--check` |
| Count-up stat cards in the hero and At a glance | "Show the spec" and `/spec/` |
| Cards with lift and a pointer spotlight, glowing gradient borders on chosen items | WCAG 2.2 AA, with every new colour checked by the build |
| Visual blocks for lanes, options, the gate layers, steps, the funnel, metrics and trade-offs | No JavaScript needed for content |
| Scroll reveals, typed windows and animated card art | Reduced motion stops all of it |
| Sticky glass header and a reading progress bar | Lighthouse 98 or more on every page |

## "Show the spec" as inspect mode (13 October 2026)

| Step | What happens |
| --- | --- |
| 1 | The canvas dims and a blueprint grid fades in |
| 2 | Rulers slide in from the top and left, with the layout grid's left edge as zero |
| 3 | The 12-column layout grid rises column by column, with a tag naming the columns and gutter token |
| 4 | A scan line sweeps the viewport. Each group draws as the line reaches it |
| 5 | Components get a solid frame, corner handles, a violet name tag and a size badge that counts up |
| 6 | Spacing gets a hatched area, a measure line and a value that counts up from 0px |
| 7 | Type gets line bands with baseline, cap-height and x-height guides from real font metrics |
| 8 | Radius gets a corner arc. Colour gets a swatch chip with its contrast ratio |
| 9 | Groups below the fold draw as they scroll into view |

- Every value still comes from `getComputedStyle` and the token names from `tokens.css`.
- About 20 groups on the landing page and 8 to 10 per article. Below 520px, priority 1 only and no rulers.
- Hiding fades the whole canvas out. Reduced motion shows the final state at once.

## Brief 4: correct, calm and specific (14 October 2026)

### Phase 0 inspection

- Branch: `portfolio-v3`, fast-forwarded to `main` so it carries the 13 October motion work that brief 4 removes.
- Baseline: `docs/audit-baseline-v3.json`, from `scripts/audit.js` (brief 1 script with the brief 2 checks) on all five pages at 1444 × 862, 390 × 844 and 320 × 568, with "Show the spec" off and on.
- Baseline result: 7 or fewer sizes, Atkinson families only, `small` empty, `hScroll` false, no middle dots, arrows or dashes outside artefacts. `lowContrast` lists only the ghost button demo.
- The employer permission line no longer appears on any page. The footer that held it was removed on 13 October.
- The money saving figure survives only in the CV.

### Phase 0 answers

| Question | Matt's answer |
| --- | --- |
| 1. When did the team end, and what disciplines were on it? | February 2026. A front-end engineer and a UI designer |
| 2. Is the public team history wording right? | Yes, as written |
| 3. What do colleagues come to you for? | Everything concerning the design system |
| 4. Which product skills would you defend? | Roadmapping, backlog ownership, prioritisation, discovery, stakeholder management, metrics and release planning. Remove Figma and release management. Replace WCAG 2.2 AA with accessibility |
| 5. Which piece of work outside the spec would you point to? | Left for now |
| 6. Anything outside work? | Skipped |

### Decisions brief 4 left open

| Choice | Decision |
| --- | --- |
| Branch | `portfolio-v3` fast-forwarded to `main` first, so it starts from the live site |
| Danger primitive | `orange-400` `#FF7A45`. Hue 17 degrees, 44 degrees from pink-400. 7.0:1 on navy-900, 6.17:1 on navy-800 |
| Roles beyond the brief's list | `accent` (blue-400) for file names and code keys, and `annotation-component` (violet-400) for component tags in "Show the spec" |
| Text roles | One `text` role. Headings and body read well at the same value, so no `text-strong` |
| Hairlines | `#26385A` merged into navy-700 `#2A3B57` |
| Header at 900px and above | Not sticky, like the narrow header. A 2px brand gradient rule sits on top |
| Menu sheet | Drops below the header row. The Menu button becomes Close while open |
| Spec draw-in | Fades in over `--motion-fast`, then each group draws over `--motion-draw`, `--motion-stagger` apart, top to bottom. The scan line, counters, rising columns and sliding rulers are gone |
| Resize label | A changed spacing label reads "was --space-96, now --space-64" and highlights for 1.2 seconds |
| Gate demo card | Its image is `assets/gate-demo.svg`, a small bar chart. The ghost button sits on the original active surface, so the original teal label gives the real 3.34:1 |
| Gate demo messages | Static findings reuse the real gate's wording. The contrast line follows the same `file:line [category] message` format |
| Product recreations | The visual rules read still shows the product's light theme, because the read is about the product's two themes. Site-level light values are gone |
| Redaction log | `docs/redaction-log.md` is gitignored. It quotes the originals, and the repo is public |
| Changelog | Three entries, as the brief lists. The 13 October motion experiments are folded into version 3 |

### Post-build review (phase 8)

| Finding | Change |
| --- | --- |
| Boxed icons above the three "What I built" cards repeated each heading and said nothing | Removed, with their styles |
| The gate demo card stretched to the panel's height, leaving a gap above the button | The card's rows now align to the top |
| The browser's default h5 margin gave the demo card heading 30.06px of off-scale spacing | h5 joined the margin reset |

## Version 4: the v4 look with v3 content (14 October 2026)

Matt reviewed brief 4's flat version live and preferred the 13 October look. The flat backgrounds made the spacing feel worse.

| Brought back from the 13 October look | Kept from brief 4 |
| --- | --- |
| Aurora bands, page glows, gradient text, glow borders and the orbiting feature border | The 2px gradient bar, nav on the right and the name without a dot |
| Card lift, the pointer spotlight, tilt, scroll reveals, count-up figures and the typed excerpt | The "Break a rule" gate demo, now in terminal chrome, and the "Follow a bug" demo |
| The landing stat row, floating chips, window chrome and read card art | All brief 4 content: redactions, About, team history, EU AI Act text, contact without calls to action, footer and changelog |
| Pink and violet accents, through new `accent-pink` and `accent-violet` roles | Primitives and roles, the danger role and the generated token excerpt |

- The pass chip's ratio is now computed from the tokens, at 8.35:1.
- `scripts/check-v3.mjs` no longer checks idle motion or `grad-text`, because the motion is back by choice.
