"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { sankey, sankeyLinkHorizontal, SankeyNode as SankeySankeyNode, SankeyLink as SankeySankeyLink, SankeyExtraProperties } from "d3-sankey";

import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ITooltipService = powerbi.extensibility.ITooltipService;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstanceEnumeration = powerbi.VisualObjectInstanceEnumeration;
import PrimitiveValue = powerbi.PrimitiveValue;
import FilterAction = powerbi.FilterAction;

import { VisualSettings, defaultSettings, parseSettings, enumerateSettingsInstances } from "./settings";
import { convertDataView, SankeyNode, SankeyLink, FilterColumnTarget } from "./sankeyDataView";

type Selection<T extends d3.BaseType> = d3.Selection<T, unknown, null, undefined>;

interface NodeExtraProps extends SankeyExtraProperties {
    name: string;
    stageIndex: number;
    color: string;
    selectionId: powerbi.visuals.ISelectionId;
    rawKeys: PrimitiveValue[];
}

interface LinkExtraProps extends SankeyExtraProperties {
    selectionId: powerbi.visuals.ISelectionId;
    tooltipInfo: powerbi.extensibility.VisualTooltipDataItem[];
    rawKeys: PrimitiveValue[];
}

type LayoutNode = SankeySankeyNode<NodeExtraProps, LinkExtraProps>;
type LayoutLink = SankeySankeyLink<NodeExtraProps, LinkExtraProps>;

interface LinkRenderSegment {
    source: LayoutNode;
    target: LayoutNode;
    y0: number;
    y1: number;
    width: number;
    color: string;
    opacity: number;
    variant: "highlighted" | "gray";
    selectionId: powerbi.visuals.ISelectionId;
    tooltipInfo: powerbi.extensibility.VisualTooltipDataItem[];
}

let visualInstanceCounter = 0;

// This is Power BI's required literal schema identifier for a basic filter
// passed to host.applyJsonFilter, not a network resource -- it must stay
// exactly "http://powerbi.com/product/schema#basic".
// eslint-disable-next-line powerbi-visuals/no-http-string
const BASIC_FILTER_SCHEMA = "http://powerbi.com/product/schema#basic";

// Safety caps so an extremely large dataset degrades to a clear message
// instead of risking a blank/frozen render -- especially important on
// constrained older visual hosts (e.g. Power BI Report Server / Report
// Builder's embedded renderer) that may struggle with thousands of SVG
// elements or a very tall SVG even where a modern browser would cope fine.
const MAX_RENDERED_NODES = 3000;
const MAX_RENDERED_LINKS = 6000;
const MAX_SVG_HEIGHT_PX = 20000;

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;

    private target: HTMLElement;
    private wrapper: Selection<HTMLDivElement>;
    private scrollContainer: Selection<HTMLDivElement>;
    private svg: Selection<SVGSVGElement>;
    private linksGroup: Selection<SVGGElement>;
    private nodesGroup: Selection<SVGGElement>;
    private labelsGroup: Selection<SVGGElement>;
    private stageHeadersGroup: Selection<SVGGElement>;
    private landingPage: Selection<HTMLDivElement>;
    private contextMenu: Selection<HTMLDivElement>;
    private includeMenuItem: Selection<HTMLDivElement>;
    private excludeMenuItem: Selection<HTMLDivElement>;

    private settings: VisualSettings;
    private lastGraphNodes: LayoutNode[] = [];
    private lastGraphLinks: LayoutLink[] = [];
    private allowInteractions: boolean;
    private keyColumnTarget: FilterColumnTarget;
    private activeMenuRawKeys: PrimitiveValue[];
    private instanceId: string;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.tooltipService = options.host.tooltipService;
        this.settings = defaultSettings;
        this.target = options.element;
        this.allowInteractions = options.host.hostCapabilities.allowInteractions !== false;

        // Own wrapper for position:relative instead of touching options.element
        // directly -- Power BI's host applies its own positioning (typically
        // position:absolute) to the root element to place the visual on the
        // report canvas, and overriding that with an inline style previously
        // broke rendering (the scroll container's dimensions and scrollbar
        // stopped working reliably in the real host). This wrapper gives the
        // custom context menu a stable positioning context without touching
        // anything Power BI itself manages.
        this.wrapper = d3.select(this.target)
            .append("div")
            .attr("class", "sankeyVisualRoot")
            .style("position", "relative")
            .style("width", "100%")
            .style("height", "100%");

        this.scrollContainer = this.wrapper
            .append("div")
            .attr("class", "sankeyScrollContainer");

        this.svg = this.scrollContainer
            .append("svg")
            .attr("class", "sankeyChart");

        this.linksGroup = this.svg.append("g").attr("class", "links");
        this.nodesGroup = this.svg.append("g").attr("class", "nodes");
        this.labelsGroup = this.svg.append("g").attr("class", "labels");
        this.stageHeadersGroup = this.svg.append("g").attr("class", "stageHeaders");

        this.landingPage = this.wrapper
            .append("div")
            .attr("class", "landingPage")
            .style("display", "none")
            .text("Add Key, Stage and Location fields to build the Sankey diagram.");

        this.instanceId = `sankey-${++visualInstanceCounter}`;
        this.activeMenuRawKeys = [];

        this.contextMenu = this.wrapper
            .append("div")
            .attr("class", "sankeyContextMenu")
            .style("display", "none")
            .on("click", (event: MouseEvent) => event.stopPropagation())
            .on("contextmenu", (event: MouseEvent) => event.preventDefault());

        this.includeMenuItem = this.contextMenu.append("div")
            .attr("class", "sankeyContextMenuItem")
            .on("click", () => {
                this.applyKeyFilter(this.activeMenuRawKeys, "include");
                this.hideContextMenu();
            });

        this.excludeMenuItem = this.contextMenu.append("div")
            .attr("class", "sankeyContextMenuItem")
            .on("click", () => {
                this.applyKeyFilter(this.activeMenuRawKeys, "exclude");
                this.hideContextMenu();
            });

        this.contextMenu.append("div")
            .attr("class", "sankeyContextMenuDivider");

        this.contextMenu.append("div")
            .attr("class", "sankeyContextMenuItem sankeyContextMenuItemMuted")
            .text("Clear Sankey filter")
            .on("click", () => {
                this.clearKeyFilter();
                this.hideContextMenu();
            });

        d3.select(document).on(`click.${this.instanceId}`, () => this.hideContextMenu());

        this.svg.on("click", () => {
            if (!this.allowInteractions) {
                return;
            }
            this.selectionManager.clear();
            this.updateSelectionStyles();
            this.hideContextMenu();
        });

        this.svg.on("contextmenu", (event: MouseEvent) => {
            if (!this.allowInteractions) {
                return;
            }
            event.preventDefault();
            this.hideContextMenu();
        });
    }

    public destroy(): void {
        d3.select(document).on(`click.${this.instanceId}`, null);
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        const width: number = Math.max(0, options.viewport.width);
        const height: number = Math.max(0, options.viewport.height);

        try {
            const dataView: powerbi.DataView = options.dataViews && options.dataViews[0];
            this.settings = parseSettings(dataView);

            this.scrollContainer.style("width", `${width}px`).style("height", `${height}px`);
            this.svg.attr("width", width);
            this.landingPage.style("width", `${width}px`).style("height", `${height}px`);

            const hasRows: boolean = !!(dataView && dataView.table && dataView.table.rows && dataView.table.rows.length);

            if (!hasRows) {
                this.keyColumnTarget = null;
                this.showMessage("Add Key, Stage and Location fields to build the Sankey diagram.");
                this.render([], [], [], width, height);
                this.events.renderingFinished(options);
                return;
            }

            const { nodes, links, stageLabels, keyColumnTarget } = convertDataView(dataView, this.host, this.settings.dataPoint.defaultColor, this.settings.dataPoint.colorByCategory, this.settings.sorting.stageOrder);
            this.keyColumnTarget = keyColumnTarget;

            if (!nodes.length || !links.length) {
                this.showMessage("No transitions to show. Each Key needs rows for at least two different Stage values, with matching Key/Stage/Location text in every row.");
                this.render([], [], [], width, height);
                this.events.renderingFinished(options);
                return;
            }

            if (nodes.length > MAX_RENDERED_NODES || links.length > MAX_RENDERED_LINKS) {
                this.showMessage(`Too much data to render clearly (${nodes.length} location/stage combinations, ${links.length} flows). Try filtering to fewer Keys, Stages, or Locations, or aggregate your data further.`);
                this.render([], [], [], width, height);
                this.events.renderingFinished(options);
                return;
            }

            this.showMessage(null);
            this.render(nodes, links, stageLabels, width, height);

            this.events.renderingFinished(options);
        }
        catch (error) {
            console.log("Error in update method", error);
            this.showMessage(`This visual hit an error while rendering: ${String(error)}`);
            this.events.renderingFailed(options, String(error));
        }
    }

    private showMessage(message: string | null): void {
        if (message === null) {
            this.landingPage.style("display", "none");
            this.svg.style("display", "block");
            return;
        }
        this.landingPage.style("display", "flex").text(message);
        this.svg.style("display", "none");
    }

    private render(nodes: SankeyNode[], links: SankeyLink[], stageLabels: string[], width: number, height: number): void {
        if (!nodes.length || !links.length || width <= 0 || height <= 0) {
            this.linksGroup.selectAll("*").remove();
            this.nodesGroup.selectAll("*").remove();
            this.labelsGroup.selectAll("*").remove();
            this.stageHeadersGroup.selectAll("*").remove();
            this.svg.attr("height", height);
            this.lastGraphNodes = [];
            this.lastGraphLinks = [];
            return;
        }

        const nodeWidth: number = Math.max(1, this.settings.nodes.nodeWidth);
        const nodePadding: number = Math.max(0, this.settings.nodes.nodePadding);
        const showLabels: boolean = this.settings.labels.show;
        const showValue: boolean = this.settings.labels.showValue;
        const labelFontSize: number = this.settings.labels.fontSize;
        const colorMode: string = this.settings.links.colorMode;
        const linkOpacity: number = Math.min(100, Math.max(5, this.settings.links.linkOpacity)) / 100;

        const colorPalette = this.host.colorPalette;
        const isHighContrast: boolean = colorPalette.isHighContrast;
        const nodeStrokeColor: string = isHighContrast ? colorPalette.background.value : "#ffffff";
        const labelColorFinal: string = isHighContrast ? colorPalette.foreground.value : this.settings.labels.color;

        const showStageHeaders: boolean = this.settings.stageHeaders.show && stageLabels.length > 1;
        const stageHeaderColor: string = isHighContrast ? colorPalette.foreground.value : this.settings.stageHeaders.color;
        const stageHeaderFontSize: number = this.settings.stageHeaders.fontSize;
        const headerHeight: number = showStageHeaders ? stageHeaderFontSize + 10 : 0;

        const layoutNodes: LayoutNode[] = nodes.map(node => ({
            name: node.name,
            stageIndex: node.stageIndex,
            color: node.color,
            selectionId: node.selectionId,
            rawKeys: node.rawKeys
        }));

        const layoutLinks: LayoutLink[] = links.map(link => ({
            source: link.source,
            target: link.target,
            value: link.value,
            selectionId: link.selectionId,
            tooltipInfo: link.tooltipInfo,
            rawKeys: link.rawKeys
        }));

        const sideLabelMargin: number = showLabels ? Math.max(50, labelFontSize * 7) : 4;
        const margin = { top: 4 + headerHeight, right: sideLabelMargin, bottom: 4, left: sideLabelMargin };
        const innerWidth: number = Math.max(1, width - margin.left - margin.right);
        const availableContentHeight: number = Math.max(1, height - margin.top - margin.bottom);
        const stageCount: number = stageLabels.length;

        // Ensure every column has at least a minimally readable node height:
        // if the busiest column can't fit that within the viewport, grow the
        // SVG taller than the viewport and let the scroll container scroll.
        // The label text (when shown) is almost always the real crowding
        // factor -- a bare node bar can be a couple of px tall with no
        // visual problem, but labels overlap once rows get shorter than
        // roughly the font size -- so the minimum row height must be driven
        // by label font size, not just an arbitrary small bar height.
        const nodesPerStage = new Map<number, number>();
        nodes.forEach(node => nodesPerStage.set(node.stageIndex, (nodesPerStage.get(node.stageIndex) || 0) + 1));
        let maxNodesInColumn = 1;
        nodesPerStage.forEach(count => { if (count > maxNodesInColumn) maxNodesInColumn = count; });
        const minNodeHeight: number = showLabels ? Math.max(4, labelFontSize + 4) : 4;
        const requiredContentHeight: number = maxNodesInColumn * minNodeHeight + Math.max(0, maxNodesInColumn - 1) * nodePadding;
        const contentHeight: number = Math.min(MAX_SVG_HEIGHT_PX, Math.max(availableContentHeight, requiredContentHeight));

        this.svg.attr("height", contentHeight + margin.top + margin.bottom);

        const nodeSortBy: string = this.settings.nodes.sortBy;
        const nodeSortComparator: (a: LayoutNode, b: LayoutNode) => number = nodeSortBy === "weight"
            ? (a, b) => (b.value ?? 0) - (a.value ?? 0)
            : nodeSortBy === "alphabetical"
                ? (a, b) => a.name.localeCompare(b.name)
                : undefined;

        const sankeyGenerator = sankey<NodeExtraProps, LinkExtraProps>()
            .nodeWidth(nodeWidth)
            .nodePadding(nodePadding)
            .nodeAlign((node: LayoutNode) => stageCount > 1 ? node.stageIndex : 0)
            .extent([[margin.left, margin.top], [margin.left + innerWidth, margin.top + contentHeight]]);

        if (nodeSortComparator) {
            sankeyGenerator.nodeSort(nodeSortComparator);
        }

        let graph: { nodes: LayoutNode[]; links: LayoutLink[] };
        try {
            graph = sankeyGenerator({
                nodes: layoutNodes,
                links: layoutLinks
            });
        }
        catch (error) {
            // Cyclic graphs are not supported by d3-sankey; bail out gracefully.
            console.log("Unable to compute Sankey layout", error);
            this.linksGroup.selectAll("*").remove();
            this.nodesGroup.selectAll("*").remove();
            this.labelsGroup.selectAll("*").remove();
            this.stageHeadersGroup.selectAll("*").remove();
            this.lastGraphNodes = [];
            this.lastGraphLinks = [];
            return;
        }

        this.lastGraphNodes = graph.nodes;
        this.lastGraphLinks = graph.links;

        const selectionManager = this.selectionManager;
        const tooltipService = this.tooltipService;
        const highlightedKeys: Set<string> | null = this.getHighlightedKeySet();

        const useGradient: boolean = colorMode === "gradient" && !isHighContrast;
        const gradients = this.svg.selectAll("defs").data([null]).join("defs");
        const gradientSelection = gradients.selectAll<SVGLinearGradientElement, LayoutLink>("linearGradient.colorGradient")
            .data(useGradient ? graph.links : [], (_d, i) => String(i));
        gradientSelection.exit().remove();
        const gradientEnter = gradientSelection.enter()
            .append("linearGradient")
            .attr("class", "colorGradient")
            .attr("gradientUnits", "userSpaceOnUse");
        const gradientMerge = gradientEnter.merge(gradientSelection)
            .attr("id", (_d, i) => `sankey-link-gradient-${i}`)
            .attr("x1", d => (d.source as LayoutNode).x1)
            .attr("x2", d => (d.target as LayoutNode).x0);
        gradientMerge.selectAll("stop").remove();
        gradientMerge.append("stop").attr("offset", "0%").attr("stop-color", d => (d.source as LayoutNode).color);
        gradientMerge.append("stop").attr("offset", "100%").attr("stop-color", d => (d.target as LayoutNode).color);

        this.renderNodeHighlightGradients(graph.nodes, highlightedKeys);
        this.renderLinkSegments(graph.links, highlightedKeys);

        const nodeSelection = this.nodesGroup.selectAll<SVGRectElement, LayoutNode>("rect.node")
            .data(graph.nodes, (d: LayoutNode) => d.selectionId.getKey());

        nodeSelection.exit().remove();

        const nodeEnter = nodeSelection.enter()
            .append("rect")
            .attr("class", "node");

        nodeEnter.merge(nodeSelection)
            .attr("x", d => d.x0)
            .attr("y", d => d.y0)
            .attr("width", d => Math.max(1, d.x1 - d.x0))
            .attr("height", d => Math.max(1, d.y1 - d.y0))
            .attr("fill", (d, i) => this.resolveNodeFill(d, i, highlightedKeys))
            .attr("opacity", d => this.resolveNodeOpacity(d, highlightedKeys))
            .attr("stroke", nodeStrokeColor)
            .style("cursor", "pointer")
            .on("mousemove", (event: MouseEvent, d: LayoutNode) => {
                tooltipService.show({
                    coordinates: [event.offsetX, event.offsetY],
                    isTouchEvent: false,
                    dataItems: [
                        { displayName: "Location", value: d.name },
                        { displayName: "Stage", value: stageLabels[d.stageIndex] ?? "" },
                        { displayName: "Keys", value: String(d.value) }
                    ],
                    identities: [d.selectionId]
                });
            })
            .on("mouseleave", () => tooltipService.hide({ immediately: true, isTouchEvent: false }))
            .on("click", (event: MouseEvent, d: LayoutNode) => {
                if (!this.allowInteractions) {
                    return;
                }
                event.stopPropagation();
                selectionManager.select(d.selectionId, event.ctrlKey || event.metaKey).then(() => this.updateSelectionStyles());
            })
            .on("contextmenu", (event: MouseEvent, d: LayoutNode) => {
                if (!this.allowInteractions) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                this.showContextMenuFor(d, event);
            });

        const labelSelection = this.labelsGroup.selectAll<SVGTextElement, LayoutNode>("text.label")
            .data(showLabels ? graph.nodes : [], (d: LayoutNode) => d.selectionId.getKey());

        labelSelection.exit().remove();

        const labelEnter = labelSelection.enter()
            .append("text")
            .attr("class", "label");

        const isFirstColumn = (d: LayoutNode): boolean => d.stageIndex === 0;
        const isLastColumn = (d: LayoutNode): boolean => d.stageIndex === stageCount - 1;

        labelEnter.merge(labelSelection)
            .attr("x", d => isFirstColumn(d) ? d.x1 + 6 : isLastColumn(d) ? d.x0 - 6 : (d.x0 + d.x1) / 2)
            .attr("y", d => (isFirstColumn(d) || isLastColumn(d)) ? (d.y0 + d.y1) / 2 : d.y0 - 4)
            .attr("dy", d => (isFirstColumn(d) || isLastColumn(d)) ? "0.35em" : null)
            .attr("text-anchor", d => isFirstColumn(d) ? "start" : isLastColumn(d) ? "end" : "middle")
            .style("fill", labelColorFinal)
            .style("font-size", `${labelFontSize}px`)
            .text(d => showValue ? `${d.name} (${d.value})` : d.name);

        const stageColumns = new Map<number, { x0: number; x1: number }>();
        graph.nodes.forEach(node => {
            if (!stageColumns.has(node.stageIndex)) {
                stageColumns.set(node.stageIndex, { x0: node.x0, x1: node.x1 });
            }
        });
        const stageHeaderData: Array<{ label: string; x0: number; x1: number }> = showStageHeaders
            ? stageLabels
                .map((label, index) => {
                    const column = stageColumns.get(index);
                    return column ? { label, x0: column.x0, x1: column.x1 } : undefined;
                })
                .filter((d): d is { label: string; x0: number; x1: number } => d !== undefined)
            : [];

        type StageHeaderDatum = { label: string; x0: number; x1: number };
        const stageHeaderSelection = this.stageHeadersGroup.selectAll<SVGTextElement, StageHeaderDatum>("text.stageHeader")
            .data(stageHeaderData, (d: StageHeaderDatum) => d.label);

        stageHeaderSelection.exit().remove();

        const stageHeaderEnter = stageHeaderSelection.enter()
            .append("text")
            .attr("class", "stageHeader");

        stageHeaderEnter.merge(stageHeaderSelection)
            .attr("x", d => (d.x0 + d.x1) / 2)
            .attr("y", margin.top - headerHeight + stageHeaderFontSize)
            .attr("text-anchor", "middle")
            .style("fill", stageHeaderColor)
            .style("font-size", `${stageHeaderFontSize}px`)
            .style("font-weight", "600")
            .text(d => d.label);
    }

    /**
     * Shows the custom Include/Exclude menu for a clicked (location, stage)
     * node. Power BI's own right-click Include/Exclude ties its filter to
     * the exact identity of the clicked data point -- for this visual that
     * would mean a single Key+Stage+Location row, so "Include" would filter
     * the whole model down to that one row (blanking every other stage of
     * every key) and "Exclude" would only drop that one row instead of the
     * key. Filtering on the Key column directly, with the full set of raw
     * key values gathered at this node, keeps/drops each key's entire
     * journey (every stage, whatever location) instead.
     */
    private showContextMenuFor(node: LayoutNode, event: MouseEvent): void {
        this.activeMenuRawKeys = node.rawKeys;

        const label = `"${node.name}"`;
        this.includeMenuItem.text(`Include ${label} (keep these keys' full journey)`);
        this.excludeMenuItem.text(`Exclude ${label} (drop these keys entirely)`);

        const hostRect: DOMRect = (this.wrapper.node() as HTMLElement).getBoundingClientRect();
        const x: number = event.clientX - hostRect.left;
        const y: number = event.clientY - hostRect.top;

        this.contextMenu
            .style("left", `${x}px`)
            .style("top", `${y}px`)
            .style("display", "block");
    }

    private hideContextMenu(): void {
        this.contextMenu.style("display", "none");
        this.activeMenuRawKeys = [];
    }

    private applyKeyFilter(rawKeys: PrimitiveValue[], action: "include" | "exclude"): void {
        if (!this.keyColumnTarget || !rawKeys || !rawKeys.length) {
            return;
        }
        const filter = {
            $schema: BASIC_FILTER_SCHEMA,
            target: { table: this.keyColumnTarget.table, column: this.keyColumnTarget.column },
            filterType: 1,
            operator: action === "include" ? "In" : "NotIn",
            values: rawKeys
        };
        // "selfFilter" makes this visual's own query respect the filter (so
        // the Sankey itself redraws); "filter" additionally applies it as a
        // normal cross-visual filter on the report page. Both properties
        // must be declared under the "general" object in capabilities.json
        // for the host to accept either call.
        this.host.applyJsonFilter(filter as unknown as powerbi.IFilter, "general", "selfFilter", FilterAction.merge);
        this.host.applyJsonFilter(filter as unknown as powerbi.IFilter, "general", "filter", FilterAction.merge);
    }

    private clearKeyFilter(): void {
        if (!this.keyColumnTarget) {
            return;
        }
        const filter = {
            $schema: BASIC_FILTER_SCHEMA,
            target: { table: this.keyColumnTarget.table, column: this.keyColumnTarget.column },
            filterType: 1,
            operator: "All",
            values: []
        };
        this.host.applyJsonFilter(filter as unknown as powerbi.IFilter, "general", "selfFilter", FilterAction.remove);
        this.host.applyJsonFilter(filter as unknown as powerbi.IFilter, "general", "filter", FilterAction.remove);
    }

    /**
     * Every node/link that shares at least one Key with a currently
     * selected node or link should stay highlighted -- clicking a location
     * highlights every stage of every key that passed through it, not just
     * that one rectangle. Returns null when nothing is selected (meaning:
     * don't dim anything).
     */
    private getHighlightedKeySet(): Set<string> | null {
        if (!this.selectionManager.hasSelection()) {
            return null;
        }
        const selectedIds = this.selectionManager.getSelectionIds();
        const keys = new Set<string>();
        this.lastGraphNodes.forEach(node => {
            if (selectedIds.some((id: powerbi.visuals.ISelectionId) => id.equals(node.selectionId))) {
                node.rawKeys.forEach(k => keys.add(String(k)));
            }
        });
        this.lastGraphLinks.forEach(link => {
            if (selectedIds.some((id: powerbi.visuals.ISelectionId) => id.equals(link.selectionId))) {
                link.rawKeys.forEach(k => keys.add(String(k)));
            }
        });
        return keys;
    }

    /**
     * Fraction (0-1) of this element's keys that are in the highlighted
     * set. 1 when nothing is selected (everything counts as "fully
     * relevant"), 0 when none of its keys are highlighted, and a value in
     * between when the node/link is shared by both highlighted and
     * unrelated keys -- that fraction drives how much of the shape stays
     * colored vs. turns gray, rather than an all-or-nothing toggle.
     */
    private highlightFraction(rawKeys: PrimitiveValue[], highlightedKeys: Set<string> | null): number {
        if (highlightedKeys === null) {
            return 1;
        }
        if (!rawKeys.length) {
            return 0;
        }
        const highlightedCount = rawKeys.filter(k => highlightedKeys.has(String(k))).length;
        return highlightedCount / rawKeys.length;
    }

    /** The link's "natural" color, as if it were fully highlighted. */
    private resolveLinkBaseColor(link: LayoutLink, index: number): string {
        if (this.host.colorPalette.isHighContrast) {
            return this.host.colorPalette.foreground.value;
        }
        const colorMode: string = this.settings.links.colorMode;
        if (colorMode === "uniform") {
            return this.settings.links.fill;
        }
        if (colorMode === "gradient") {
            return `url(#sankey-link-gradient-${index})`;
        }
        return (link.source as LayoutNode).color;
    }

    /**
     * Splits each link into one or two render segments so only the portion
     * of its band belonging to highlighted keys is colored -- e.g. a link
     * carrying 3 keys where only 2 are highlighted renders as a colored
     * sub-band covering 2/3 of its width plus a gray sub-band for the rest,
     * rather than coloring (or graying) the whole band. sankeyLinkHorizontal
     * only reads source.x1/target.x0/y0/y1 to build the path, so a segment
     * with an adjusted y0/y1 (recentered within the original band) and a
     * proportionally narrower width renders as exactly that sub-band.
     */
    private buildLinkSegments(links: LayoutLink[], highlightedKeys: Set<string> | null): LinkRenderSegment[] {
        const linkOpacity: number = Math.min(100, Math.max(5, this.settings.links.linkOpacity)) / 100;
        const grayOpacity: number = Math.max(linkOpacity, 0.6);
        const grayColor: string = this.host.colorPalette.isHighContrast
            ? this.host.colorPalette.foreground.value
            : this.settings.highlighting.unhighlightedColor;

        const segments: LinkRenderSegment[] = [];
        links.forEach((link, index) => {
            const source = link.source as LayoutNode;
            const target = link.target as LayoutNode;
            const baseWidth: number = link.width ?? 0;
            const fraction: number = this.highlightFraction(link.rawKeys, highlightedKeys);

            if (fraction >= 1) {
                segments.push({
                    source, target, y0: link.y0, y1: link.y1, width: baseWidth,
                    color: this.resolveLinkBaseColor(link, index), opacity: linkOpacity,
                    variant: "highlighted", selectionId: link.selectionId, tooltipInfo: link.tooltipInfo
                });
                return;
            }
            if (fraction <= 0) {
                segments.push({
                    source, target, y0: link.y0, y1: link.y1, width: baseWidth,
                    color: grayColor, opacity: grayOpacity,
                    variant: "gray", selectionId: link.selectionId, tooltipInfo: link.tooltipInfo
                });
                return;
            }

            const highlightedWidth: number = baseWidth * fraction;
            const grayWidth: number = baseWidth - highlightedWidth;
            segments.push({
                source, target,
                y0: link.y0 - baseWidth / 2 + highlightedWidth / 2,
                y1: link.y1 - baseWidth / 2 + highlightedWidth / 2,
                width: highlightedWidth,
                color: this.resolveLinkBaseColor(link, index), opacity: linkOpacity,
                variant: "highlighted", selectionId: link.selectionId, tooltipInfo: link.tooltipInfo
            });
            segments.push({
                source, target,
                y0: link.y0 + baseWidth / 2 - grayWidth / 2,
                y1: link.y1 + baseWidth / 2 - grayWidth / 2,
                width: grayWidth,
                color: grayColor, opacity: grayOpacity,
                variant: "gray", selectionId: link.selectionId, tooltipInfo: link.tooltipInfo
            });
        });
        return segments;
    }

    private renderLinkSegments(links: LayoutLink[], highlightedKeys: Set<string> | null): void {
        const linkPathGenerator = sankeyLinkHorizontal<NodeExtraProps, LinkExtraProps>();
        const segments: LinkRenderSegment[] = this.buildLinkSegments(links, highlightedKeys);
        const selectionManager = this.selectionManager;
        const tooltipService = this.tooltipService;

        const linkSelection = this.linksGroup.selectAll<SVGPathElement, LinkRenderSegment>("path.link")
            .data(segments, (d: LinkRenderSegment) => `${d.selectionId.getKey()}::${d.variant}`);

        linkSelection.exit().remove();

        const linkEnter = linkSelection.enter()
            .append("path")
            .attr("class", "link")
            .attr("fill", "none");

        linkEnter.merge(linkSelection)
            .attr("d", d => linkPathGenerator(d as unknown as LayoutLink))
            .attr("stroke", d => d.color)
            .attr("stroke-width", d => Math.max(1, d.width))
            .attr("stroke-opacity", d => d.opacity)
            .style("cursor", "pointer")
            .on("mousemove", (event: MouseEvent, d: LinkRenderSegment) => {
                tooltipService.show({
                    coordinates: [event.offsetX, event.offsetY],
                    isTouchEvent: false,
                    dataItems: d.tooltipInfo,
                    identities: [d.selectionId]
                });
            })
            .on("mouseleave", () => tooltipService.hide({ immediately: true, isTouchEvent: false }))
            .on("click", (event: MouseEvent, d: LinkRenderSegment) => {
                if (!this.allowInteractions) {
                    return;
                }
                event.stopPropagation();
                selectionManager.select(d.selectionId, event.ctrlKey || event.metaKey).then(() => this.updateSelectionStyles());
            })
            .on("contextmenu", (event: MouseEvent, d: LinkRenderSegment) => {
                if (!this.allowInteractions) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                selectionManager.showContextMenu(d.selectionId, { x: event.clientX, y: event.clientY });
            });
    }

    /**
     * A node's fill is normally solid (fully its own color, or fully gray),
     * but when it's shared by both highlighted and unrelated keys, a
     * per-node vertical gradient with a hard color/gray edge at the
     * highlighted fraction gives the same proportional partial-highlight
     * treatment as buildLinkSegments does for links -- e.g. a node with 3
     * keys where 2 are highlighted renders 2/3 colored, 1/3 gray, instead
     * of coloring (or graying) the whole rectangle.
     */
    private resolveNodeFill(node: LayoutNode, index: number, highlightedKeys: Set<string> | null): string {
        if (this.host.colorPalette.isHighContrast) {
            return this.host.colorPalette.foreground.value;
        }
        const fraction: number = this.highlightFraction(node.rawKeys, highlightedKeys);
        if (fraction >= 1) {
            return node.color;
        }
        if (fraction <= 0) {
            return this.settings.highlighting.unhighlightedColor;
        }
        return `url(#sankey-node-partial-${index})`;
    }

    private resolveNodeOpacity(node: LayoutNode, highlightedKeys: Set<string> | null): number {
        return this.highlightFraction(node.rawKeys, highlightedKeys) > 0 ? 1 : 0.6;
    }

    /**
     * A simple top-X%-colored/bottom-gray split (used above) only lines up
     * with a connected link's own colored/gray split when that's the node's
     * *only* attached link -- once a node stacks several links top-to-
     * bottom, each link's sub-band sits wherever that link happens to be
     * stacked, not necessarily starting at the node's own top edge. Deriving
     * the node's gradient stops directly from node.sourceLinks (or
     * node.targetLinks for a terminal node with no outgoing links) --
     * walking them in their actual stacking order and reusing each link's
     * own y0/width -- guarantees the node's fill matches exactly where that
     * side's links are colored vs gray, since it's built from the same
     * numbers buildLinkSegments uses to draw those links.
     */
    private buildNodeGradientStops(node: LayoutNode, highlightedKeys: Set<string> | null): Array<{ offset: number; color: string }> {
        const grayColor: string = this.settings.highlighting.unhighlightedColor;
        const nodeHeight: number = node.y1 - node.y0;
        const attachedLinks: LayoutLink[] = (node.sourceLinks && node.sourceLinks.length) ? node.sourceLinks : node.targetLinks;

        if (!attachedLinks || !attachedLinks.length || nodeHeight <= 0) {
            // Isolated node with no links to derive positions from -- fall
            // back to a plain top/bottom split by highlighted fraction.
            const fraction: number = this.highlightFraction(node.rawKeys, highlightedKeys);
            return [
                { offset: 0, color: node.color },
                { offset: fraction, color: node.color },
                { offset: fraction, color: grayColor },
                { offset: 1, color: grayColor }
            ];
        }

        const stops: Array<{ offset: number; color: string }> = [];
        let cursor = 0;
        attachedLinks.forEach(link => {
            const baseWidth: number = link.width ?? 0;
            const fraction: number = this.highlightFraction(link.rawKeys, highlightedKeys);
            const highlightedWidth: number = baseWidth * fraction;

            const startOffset: number = Math.max(0, Math.min(1, cursor / nodeHeight));
            const midOffset: number = Math.max(0, Math.min(1, (cursor + highlightedWidth) / nodeHeight));
            const endOffset: number = Math.max(0, Math.min(1, (cursor + baseWidth) / nodeHeight));

            stops.push({ offset: startOffset, color: node.color });
            stops.push({ offset: midOffset, color: node.color });
            stops.push({ offset: midOffset, color: grayColor });
            stops.push({ offset: endOffset, color: grayColor });

            cursor += baseWidth;
        });
        return stops;
    }

    private renderNodeHighlightGradients(nodes: LayoutNode[], highlightedKeys: Set<string> | null): void {
        const defs = this.svg.selectAll("defs").data([null]).join("defs");

        const partial = nodes
            .map((node, index) => ({ node, index, fraction: this.highlightFraction(node.rawKeys, highlightedKeys) }))
            .filter(d => d.fraction > 0 && d.fraction < 1);

        const gradientSelection = defs.selectAll<SVGLinearGradientElement, { node: LayoutNode; index: number; fraction: number }>("linearGradient.nodeHighlight")
            .data(partial, d => String(d.index));

        gradientSelection.exit().remove();

        const gradientEnter = gradientSelection.enter()
            .append("linearGradient")
            .attr("class", "nodeHighlight")
            .attr("x1", "0%").attr("x2", "0%").attr("y1", "0%").attr("y2", "100%");

        const gradientMerge = gradientEnter.merge(gradientSelection)
            .attr("id", d => `sankey-node-partial-${d.index}`);

        gradientMerge.each((d, i, groups) => {
            const stops = this.buildNodeGradientStops(d.node, highlightedKeys);
            const gradient = d3.select(groups[i]);
            gradient.selectAll("stop").remove();
            stops.forEach(stop => {
                gradient.append("stop").attr("offset", `${stop.offset * 100}%`).attr("stop-color", stop.color);
            });
        });
    }

    private updateSelectionStyles(): void {
        const highlightedKeys: Set<string> | null = this.getHighlightedKeySet();

        this.renderNodeHighlightGradients(this.lastGraphNodes, highlightedKeys);
        this.nodesGroup.selectAll<SVGRectElement, LayoutNode>("rect.node")
            .attr("fill", (d, i) => this.resolveNodeFill(d, i, highlightedKeys))
            .attr("opacity", d => this.resolveNodeOpacity(d, highlightedKeys));

        this.renderLinkSegments(this.lastGraphLinks, highlightedKeys);
    }

    /**
     * Classic (pre-formatting-model) property pane enumeration. Used instead of
     * getFormattingModel so the visual keeps working on older visual hosts
     * (e.g. Power BI Report Server / Report Builder).
     */
    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
        return enumerateSettingsInstances(this.settings, options);
    }
}
