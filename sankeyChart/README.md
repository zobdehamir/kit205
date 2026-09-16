# Sankey Chart (Power BI Report Server compatible)

A Power BI custom visual that renders a **multi-stage Sankey / flow diagram**
from `Key` / `Stage` / `Location` data — each key (an item, asset, order,
etc.) moves through a sequence of locations over a series of stages, and the
diagram shows how many keys made each location-to-location transition at
each stage. Built to run on **Power BI Report Server – January 2023
release** as well as later Report Server releases and Power BI Desktop/Service.

## Compatibility

The January 2023 release of Power BI Report Server (build `1.16.8420.13742`)
*lists* custom visuals API v5.2.0 in its changelog, but in practice its
visual host does not reliably render visuals that use the modern
**Formatting Model** API (`getFormattingModel()` / API 5.1.0+) for the
properties/format pane — visuals built that way can fail to render at all,
showing "This content is blocked. Contact the site owner to fix the issue."
in place of the visual. This was confirmed by decompiling a known-working
community visual (Hierarchy Slicer) side by side with an earlier build of
this one: the working visual targets `apiVersion 3.2.0` and the older
`enumerateObjectInstances()` property pane pattern, with none of the
FormattingModel machinery in its bundle.

To match that proven-compatible shape, this project targets:

- `pbiviz.json` → `"apiVersion": "3.8.0"` (a mature, widely-supported API
  version — supported since the September 2021 Report Server release —
  that still has selection, tooltips, context menu, high contrast, and
  `hostCapabilities.allowInteractions`, but predates the Formatting Model)
- `package.json` → `"powerbi-visuals-api": "3.8.0"`
- `src/settings.ts` implements the classic `enumerateObjectInstances()`
  pane instead of `getFormattingModel()` — see `parseSettings` /
  `enumerateSettingsInstances`

Don't reintroduce `powerbi-visuals-utils-formattingmodel` / `getFormattingModel()`
if Report Server / Report Builder compatibility matters — that's what caused
the blocked-content symptom in the first place. If you only need to target
Power BI Desktop/Service (not Report Server), the modern Formatting Model
API and a higher `apiVersion` work fine there.

The visual's bundled JS/CSS is fully self-contained — no `eval`, no dynamic
`import()`, no calls to any external host. It does not reach out to
`pbivisuals.powerbi.com` or anywhere else; everything it needs ships inside
the `.pbiviz` file.

## Fields

The data is expected in **long format**: one row per key per stage.

| Role     | Kind      | Description                                                |
|----------|-----------|-------------------------------------------------------------|
| Key      | Grouping  | The unique item/asset/order that moves between locations    |
| Stage    | Grouping  | The step in the sequence (e.g. "Stage 1", a date, a number) |
| Location | Grouping  | Where that key was during that stage                        |

Example rows:

| Key    | Stage   | Location   |
|--------|---------|------------|
| Key001 | Stage 1 | Warehouse  |
| Key001 | Stage 2 | Truck      |
| Key001 | Stage 3 | Store      |
| Key002 | Stage 1 | Warehouse  |
| Key002 | Stage 2 | Truck      |

For each key, its rows are sorted by Stage and consecutive stages are linked
(e.g. Warehouse@Stage1 → Truck@Stage2). If a key skips a stage, it links
directly across the gap to wherever it next appears. Each **node** is a
(Location, Stage) pair — so the same location shown at different stages
becomes a separate column position — and each **link's weight is the number
of distinct keys** making that exact transition. Duplicate Key+Stage rows
collapse to a single location (last one wins); rows with a blank Key are
skipped. Stage and Location text is trimmed and merged case-insensitively
(`"Arrival"`, `"arrival "`, and `"ARRIVAL"` are treated as the same stage,
keeping whichever casing appeared first), so inconsistent source data
doesn't fragment into lookalike duplicate columns.

By default, stages are ordered exactly as Power BI's DataView returns them
(its natural/default order for the field — e.g. following a "Sort by
Column" set on the Stage field in your data model, or plain alphabetical if
none is set). If that default doesn't match your real process order — text
names like `Arrival`, `Sale`, `Dispatch` rarely sort the way you want —
set an explicit order in **Format visual → Sorting → Stage order**, e.g.
`Arrival, Sale, Dispatch, Stock take`. Leave it blank to fall back to
Power BI's default order.

The table's row cap (`dataReductionAlgorithm.top.count` in `capabilities.json`)
is set to 150,000. If you have more raw Key/Stage/Location rows than that,
increase it there and rebuild — rows beyond the cap are silently dropped by
Power BI before the visual ever sees them.

## Formatting options

- **Data colors** – default node color, and whether nodes are auto-colored by location
- **Links** – link color mode (source location color / source-target gradient / single color), link opacity
- **Nodes** – node width, node padding, and **Sort locations by** — how locations are ordered
  top-to-bottom within each stage column: *Automatic* (d3-sankey's default, minimizes link
  crossings), *Weight* (largest total flow first), or *Alphabetical*
- **Labels** – show/hide, text color, text size, show key count alongside the location name.
  The first stage column's labels sit to the right of the nodes, the last column's labels sit
  to the left, and every other column's labels sit centered above — this keeps labels from
  being clipped by the chart's outer edge. The visual also reserves extra left/right margin
  (scaled off the label text size) so those edge labels have room to render.
- **Sorting → Stage order** – optional comma-separated list giving the exact left-to-right
  stage sequence, e.g. `Arrival, Sale, Dispatch, Stock take`. Any stage value present in the
  data but missing from this list is appended at the end (nothing is dropped). Leave blank to
  use Power BI's default order for the field.
- **Stage headers** – show/hide the stage-name row above each column, text color, text size
- **Highlighting → Unhighlighted color** – the gray used for nodes/links not part of the
  clicked node's highlighted key set (see below)

## Vertical scrolling

If a stage column has more locations than can fit at a readable size in the
available height, the chart grows taller than the visual's viewport (each
node gets at least a small minimum height, scaling with node padding) and
the visual becomes vertically scrollable instead of squeezing everything
down to illegible slivers. The chart never scrolls horizontally — width
always matches the viewport.

## Include / Exclude a location

Right-clicking a node opens a custom **Include** / **Exclude** / **Clear
Sankey filter** menu instead of Power BI's default context menu. This is
deliberate: Power BI's built-in Include/Exclude ties its filter to the
exact identity of the clicked data point — for this visual that's one
specific Key+Stage+Location row — so its native "Include" would filter the
whole model down to just that one row (blanking every other stage of every
key) and its native "Exclude" would only drop that single row instead of
the key.

Right-clicking a **Location at a Stage** and choosing:

- **Include** — keeps every Key that was at that Location during that
  Stage, along with *all* of that Key's other rows (every other stage,
  whatever location it was at there).
- **Exclude** — drops those same Keys entirely, everywhere, not just their
  row at that Location/Stage.
- **Clear Sankey filter** — removes the filter this visual applied.

Under the hood this calls `host.applyJsonFilter` with a basic filter on the
Key column (`operator: "In"` / `"NotIn"`, listing every Key that touches
the clicked node) rather than relying on Power BI's selection-identity
based Include/Exclude, since a per-row identity can't express "this
Location at this Stage, but keep/drop the whole Key regardless of Stage."
It's applied both as `"selfFilter"` (so the Sankey redraws itself) and as
`"filter"` (so other visuals on the report page respect it too) — both
properties are declared under a `"general"` object in `capabilities.json`,
which the host requires before it will honor either call.

Right-clicking a **link** (a flow between two nodes) still opens Power BI's
default Include/Exclude menu, which has the same single-row limitation
described above — let us know if you'd like the same custom Key-level
filtering extended there too.

## Clicking a node highlights every key that passes through it

Clicking a node doesn't just highlight that one rectangle — it highlights
every node and link belonging to any Key that passes through it, across
*every* stage, not only the stages adjacent to the click. So clicking
"Warehouse" at Stage 1 highlights every other location those same keys
visited at Stage 2, Stage 3, and so on. Everything else — nodes and links
belonging only to unrelated keys — turns gray (**Format visual →
Highlighting → Unhighlighted color**, default light gray) instead of
keeping its normal color, so the relevant path reads clearly against a
muted background.

The highlight is proportional, not all-or-nothing: if a node or link is
shared by both highlighted and unrelated keys (e.g. a "Hub" location
visited by 3 keys, only 2 of which are highlighted), only that fraction of
its height/width stays colored — the rest of that same shape turns gray,
with a clean edge at the boundary — rather than coloring or graying the
whole shape. Clicking the background, or the already-selected node again,
clears the highlight and restores normal colors everywhere.

## Safety limits on very large datasets

Two guardrails keep an oversized dataset from rendering blank or freezing
the host instead of failing clearly:

- If the data resolves to more than 3,000 nodes or 6,000 links, the visual
  shows a message asking you to filter to fewer Keys/Stages/Locations
  rather than attempting the render.
- The chart's total height (see Vertical scrolling above) is capped at
  20,000px even if the "every row gets a minimum readable height" math
  would ask for more — past that point rows get thinner rather than the
  SVG growing indefinitely.

Both limits are constants near the top of `src/visual.ts`
(`MAX_RENDERED_NODES`, `MAX_RENDERED_LINKS`, `MAX_SVG_HEIGHT_PX`) if you
need to raise or lower them for your environment.

## Build

```bash
npm install
npx pbiviz package
```

The packaged `.pbiviz` file is written to `dist/`.

## Install on Power BI Report Server

1. In the Report Server web portal, go to **Settings → Custom Visuals**
   (site-level setting; requires uploading the raw `.pbiviz` file).
2. Upload the `.pbiviz` file from `dist/`.
3. The visual becomes available in report authoring alongside built-in visuals.

Report Server only supports side-loaded (organizational) custom visuals — it
has no access to AppSource — so the `.pbiviz` file must be uploaded manually
by a server administrator.

## Troubleshooting: "This content is blocked. Contact the site owner to fix the issue."

Two known causes, in order of likelihood:

1. **Formatting Model API incompatibility (the actual cause found for this
   visual).** Report Server / Report Builder's visual host doesn't reliably
   render visuals that implement `getFormattingModel()` (API 5.1.0+) —
   the visual can fail to render entirely with this exact message. Fix:
   target `apiVersion` ≤ `3.8.0` and implement `enumerateObjectInstances()`
   instead, as this project now does (see Compatibility above). If you're
   evaluating a different/third-party visual and hit this, check whether it
   was built against an API ≥ 5.1.0 with a formatting-model-based pane.

2. **Blocked network egress.** *Power BI Desktop optimized for Power BI
   Report Server* tries to reach `https://pbivisuals.powerbi.com` to check
   for an updated copy of any custom visual it loads. On a locked-down or
   fully offline network, that request is blocked and the visual area can
   show this same message (see Microsoft's [Report Server custom-visuals
   troubleshooting doc](https://learn.microsoft.com/en-us/power-bi/report-server/custom-visuals-troubleshoot)).
   If you're running everything locally with no general internet egress:
   - Set the environment variable `PBI_userFavoriteResourcePackagesEnabled=0`
     on the machine running Desktop for Report Server, to skip the online
     check and fall back to the locally-uploaded `.pbiviz` copy.
   - Or allow outbound HTTPS to `https://pbivisuals.powerbi.com` if the
     machine does have (firewalled) internet access.

To tell them apart: if a *different*, independently-sourced custom visual
(e.g. one already published on AppSource/GitHub) renders fine in the same
report, the problem is specific to the failing visual's build (cause 1). If
*every* custom visual fails the same way, it's environment/network (cause 2).
