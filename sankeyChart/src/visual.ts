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

import { VisualSettings, defaultSettings, parseSettings, enumerateSettingsInstances } from "./settings";
import { convertDataView, SankeyNode, SankeyLink } from "./sankeyDataView";

type Selection<T extends d3.BaseType> = d3.Selection<T, unknown, null, undefined>;

interface NodeExtraProps extends SankeyExtraProperties {
    name: string;
    stageIndex: number;
    color: string;
    selectionId: powerbi.visuals.ISelectionId;
}

interface LinkExtraProps extends SankeyExtraProperties {
    selectionId: powerbi.visuals.ISelectionId;
    tooltipInfo: powerbi.extensibility.VisualTooltipDataItem[];
}

type LayoutNode = SankeySankeyNode<NodeExtraProps, LinkExtraProps>;
type LayoutLink = SankeySankeyLink<NodeExtraProps, LinkExtraProps>;

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;

    private target: HTMLElement;
    private svg: Selection<SVGSVGElement>;
    private linksGroup: Selection<SVGGElement>;
    private nodesGroup: Selection<SVGGElement>;
    private labelsGroup: Selection<SVGGElement>;
    private stageHeadersGroup: Selection<SVGGElement>;
    private landingPage: Selection<HTMLDivElement>;

    private settings: VisualSettings;
    private allowInteractions: boolean;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.tooltipService = options.host.tooltipService;
        this.settings = defaultSettings;
        this.target = options.element;
        this.allowInteractions = options.host.hostCapabilities.allowInteractions !== false;

        this.svg = d3.select(this.target)
            .append("svg")
            .attr("class", "sankeyChart");

        this.linksGroup = this.svg.append("g").attr("class", "links");
        this.nodesGroup = this.svg.append("g").attr("class", "nodes");
        this.labelsGroup = this.svg.append("g").attr("class", "labels");
        this.stageHeadersGroup = this.svg.append("g").attr("class", "stageHeaders");

        this.landingPage = d3.select(this.target)
            .append("div")
            .attr("class", "landingPage")
            .style("display", "none")
            .text("Add Key, Stage and Location fields to build the Sankey diagram.");

        this.svg.on("click", () => {
            if (!this.allowInteractions) {
                return;
            }
            this.selectionManager.clear();
            this.updateSelectionStyles();
        });

        this.svg.on("contextmenu", (event: MouseEvent) => {
            if (!this.allowInteractions) {
                return;
            }
            event.preventDefault();
            this.selectionManager.showContextMenu({} as powerbi.visuals.ISelectionId, { x: event.clientX, y: event.clientY });
        });
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);

        const width: number = Math.max(0, options.viewport.width);
        const height: number = Math.max(0, options.viewport.height);

        try {
            const dataView: powerbi.DataView = options.dataViews && options.dataViews[0];
            this.settings = parseSettings(dataView);

            this.svg.attr("width", width).attr("height", height);
            this.landingPage.style("width", `${width}px`).style("height", `${height}px`);

            const hasRows: boolean = !!(dataView && dataView.table && dataView.table.rows && dataView.table.rows.length);

            if (!hasRows) {
                this.showMessage("Add Key, Stage and Location fields to build the Sankey diagram.");
                this.render([], [], [], width, height);
                this.events.renderingFinished(options);
                return;
            }

            const { nodes, links, stageLabels } = convertDataView(dataView, this.host, this.settings.dataPoint.defaultColor, this.settings.dataPoint.colorByCategory, this.settings.sorting.stageOrder);

            if (!nodes.length || !links.length) {
                this.showMessage("No transitions to show. Each Key needs rows for at least two different Stage values, with matching Key/Stage/Location text in every row.");
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
            return;
        }

        const nodeWidth: number = Math.max(1, this.settings.nodes.nodeWidth);
        const nodePadding: number = Math.max(0, this.settings.nodes.nodePadding);
        const showLabels: boolean = this.settings.labels.show;
        const showValue: boolean = this.settings.labels.showValue;
        const labelFontSize: number = this.settings.labels.fontSize;
        const colorMode: string = this.settings.links.colorMode;
        const uniformLinkColor: string = this.settings.links.fill;
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
            selectionId: node.selectionId
        }));

        const layoutLinks: LayoutLink[] = links.map(link => ({
            source: link.source,
            target: link.target,
            value: link.value,
            selectionId: link.selectionId,
            tooltipInfo: link.tooltipInfo
        }));

        const sideLabelMargin: number = showLabels ? Math.max(50, labelFontSize * 7) : 4;
        const margin = { top: 4 + headerHeight, right: sideLabelMargin, bottom: 4, left: sideLabelMargin };
        const innerWidth: number = Math.max(1, width - margin.left - margin.right);
        const innerHeight: number = Math.max(1, height - margin.top - margin.bottom);
        const stageCount: number = stageLabels.length;

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
            .extent([[margin.left, margin.top], [innerWidth, innerHeight]]);

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
            return;
        }

        const linkPathGenerator = sankeyLinkHorizontal<NodeExtraProps, LinkExtraProps>();
        const selectionManager = this.selectionManager;
        const tooltipService = this.tooltipService;
        const hasSelection: boolean = selectionManager.hasSelection();

        const getNodeColor = (node: LayoutNode): string => isHighContrast ? colorPalette.foreground.value : node.color;

        const getLinkColor = (link: LayoutLink, index: number): string => {
            if (isHighContrast) {
                return colorPalette.foreground.value;
            }
            if (colorMode === "uniform") {
                return uniformLinkColor;
            }
            if (colorMode === "gradient") {
                return `url(#sankey-link-gradient-${index})`;
            }
            const source = link.source as LayoutNode;
            return source.color;
        };

        const useGradient: boolean = colorMode === "gradient" && !isHighContrast;
        const gradients = this.svg.selectAll("defs").data([null]).join("defs");
        const gradientSelection = gradients.selectAll<SVGLinearGradientElement, LayoutLink>("linearGradient")
            .data(useGradient ? graph.links : [], (_d, i) => String(i));
        gradientSelection.exit().remove();
        const gradientEnter = gradientSelection.enter()
            .append("linearGradient")
            .attr("gradientUnits", "userSpaceOnUse");
        const gradientMerge = gradientEnter.merge(gradientSelection)
            .attr("id", (_d, i) => `sankey-link-gradient-${i}`)
            .attr("x1", d => (d.source as LayoutNode).x1)
            .attr("x2", d => (d.target as LayoutNode).x0);
        gradientMerge.selectAll("stop").remove();
        gradientMerge.append("stop").attr("offset", "0%").attr("stop-color", d => (d.source as LayoutNode).color);
        gradientMerge.append("stop").attr("offset", "100%").attr("stop-color", d => (d.target as LayoutNode).color);

        const linkSelection = this.linksGroup.selectAll<SVGPathElement, LayoutLink>("path.link")
            .data(graph.links, (d: LayoutLink) => d.selectionId.getKey());

        linkSelection.exit().remove();

        const linkEnter = linkSelection.enter()
            .append("path")
            .attr("class", "link")
            .attr("fill", "none");

        linkEnter.merge(linkSelection)
            .attr("d", linkPathGenerator as unknown as (d: LayoutLink) => string)
            .attr("stroke", getLinkColor)
            .attr("stroke-width", d => Math.max(1, d.width))
            .attr("stroke-opacity", d => hasSelection && !selectionManager.getSelectionIds().some((id: powerbi.visuals.ISelectionId) => id.equals(d.selectionId)) ? linkOpacity * 0.3 : linkOpacity)
            .style("cursor", "pointer")
            .on("mousemove", (event: MouseEvent, d: LayoutLink) => {
                tooltipService.show({
                    coordinates: [event.offsetX, event.offsetY],
                    isTouchEvent: false,
                    dataItems: d.tooltipInfo,
                    identities: [d.selectionId]
                });
            })
            .on("mouseleave", () => tooltipService.hide({ immediately: true, isTouchEvent: false }))
            .on("click", (event: MouseEvent, d: LayoutLink) => {
                if (!this.allowInteractions) {
                    return;
                }
                event.stopPropagation();
                selectionManager.select(d.selectionId, event.ctrlKey || event.metaKey).then(() => this.updateSelectionStyles());
            })
            .on("contextmenu", (event: MouseEvent, d: LayoutLink) => {
                if (!this.allowInteractions) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                selectionManager.showContextMenu(d.selectionId, { x: event.clientX, y: event.clientY });
            });

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
            .attr("fill", getNodeColor)
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
                selectionManager.showContextMenu(d.selectionId, { x: event.clientX, y: event.clientY });
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

    private updateSelectionStyles(): void {
        const selectionManager = this.selectionManager;
        const hasSelection: boolean = selectionManager.hasSelection();
        const linkOpacity: number = Math.min(100, Math.max(5, this.settings.links.linkOpacity)) / 100;

        this.linksGroup.selectAll<SVGPathElement, LayoutLink>("path.link")
            .attr("stroke-opacity", d => hasSelection && !selectionManager.getSelectionIds().some((id: powerbi.visuals.ISelectionId) => id.equals(d.selectionId)) ? linkOpacity * 0.3 : linkOpacity);

        this.nodesGroup.selectAll<SVGRectElement, LayoutNode>("rect.node")
            .attr("opacity", d => hasSelection && !selectionManager.getSelectionIds().some((id: powerbi.visuals.ISelectionId) => id.equals(d.selectionId)) ? 0.3 : 1);
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
