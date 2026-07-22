# Sankey Chart (Power BI Report Server compatible)

A Power BI custom visual that renders a Sankey diagram (flow diagram) from
`Source` / `Destination` / `Weight` data, built to run on **Power BI Report
Server – January 2023 release** as well as later Report Server releases and
Power BI Desktop/Service.

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

## Fields

| Role        | Kind      | Description                                   |
|-------------|-----------|------------------------------------------------|
| Source      | Grouping  | The origin node of each flow                   |
| Destination | Grouping  | The destination node of each flow              |
| Weight      | Measure   | The flow magnitude; duplicate Source/Destination pairs are summed |

## Formatting options

- **Data colors** – default node color, and whether nodes are auto-colored by category
- **Links** – link color mode (source color / source-target gradient / single color), link opacity
- **Nodes** – node width, node padding
- **Labels** – show/hide, text color, text size, show flow value alongside the name

## Build

```bash
npm install
npx pbiviz package
```

The packaged `.pbiviz` file is written to `dist/`. Cyclic Source → ... →
Source graphs are not supported by the underlying `d3-sankey` layout and are
skipped gracefully at render time.

## Install on Power BI Report Server

1. In the Report Server web portal, go to **Settings → Custom Visuals**
   (site-level setting; requires uploading the raw `.pbiviz` file).
2. Upload the `.pbiviz` file from `dist/`.
3. The visual becomes available in report authoring alongside built-in visuals.

Report Server only supports side-loaded (organizational) custom visuals — it
has no access to AppSource — so the `.pbiviz` file must be uploaded manually
by a server administrator.
