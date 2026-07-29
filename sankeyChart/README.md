# Sankey Chart (Power BI Report Server compatible)

A Power BI custom visual that renders a **multi-stage Sankey / flow diagram**
from `Key` / `Stage` / `Location` data — each key (an item, asset, order,
etc.) moves through a sequence of locations over a series of stages, and the
diagram shows how many keys made each location-to-location transition at
each stage. Built to run on **Power BI Report Server – January 2023
release** as well as later Report Server releases and Power BI Desktop/Service.

## Compatibility

The January 2023 release of Power BI Report Server (build `1.16.8420.13742`)
ships with **custom visuals API v5.2.0**. Power BI hosts only load visuals
whose declared `apiVersion` is less than or equal to the API version the host
supports, so this project pins:

- `pbiviz.json` → `"apiVersion": "5.2.0"`
- `package.json` → `"powerbi-visuals-api": "5.2.0"`

Do not bump `apiVersion` above `5.2.0` unless you no longer need to support
the January 2023 Report Server release (later Report Server releases support
higher API versions — see the [Report Server changelog](https://learn.microsoft.com/en-us/power-bi/report-server/changelog)).

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
collapse to a single location (last one wins); rows with a blank Key or
Location are skipped.

Stage values are sorted numerically if every value parses as a number,
otherwise with a natural (numeric-aware) string sort, so `"Stage 2"` sorts
before `"Stage 10"`.

## Formatting options

- **Data colors** – default node color, and whether nodes are auto-colored by location
- **Links** – link color mode (source location color / source-target gradient / single color), link opacity
- **Nodes** – node width, node padding
- **Labels** – show/hide, text color, text size, show key count alongside the location name
- **Stage headers** – show/hide the stage-name row above each column, text color, text size

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

This message is **not** produced by this visual — it comes from *Power BI
Desktop optimized for Power BI Report Server* itself, which tries to reach
`https://pbivisuals.powerbi.com` to check for an updated copy of any custom
visual it loads. On a locked-down or fully offline network, that request is
blocked and the visual area shows this message instead of rendering (see
Microsoft's [Report Server custom-visuals troubleshooting doc](https://learn.microsoft.com/en-us/power-bi/report-server/custom-visuals-troubleshoot)).

If you're running everything locally with no general internet egress:

- Set the environment variable `PBI_userFavoriteResourcePackagesEnabled=0`
  on the machine running Desktop for Report Server. It skips the online
  check and falls back to the locally-uploaded `.pbiviz` copy (after a
  ~20–30s delay the first time).
- Alternatively, allow outbound HTTPS to `https://pbivisuals.powerbi.com` if
  the machine does have internet access but it's firewalled.

You can verify it's this environment-level behavior and not a problem with
the visual itself by adding any other custom visual to the same report —
it will show the same blocked message if this is the cause.
