"use strict";

import powerbi from "powerbi-visuals-api";

import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import PrimitiveValue = powerbi.PrimitiveValue;
import ISelectionId = powerbi.visuals.ISelectionId;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

export interface SankeyNode {
    name: string;
    color: string;
    selectionId: ISelectionId;
}

export interface SankeyLink {
    source: number;
    target: number;
    value: number;
    selectionId: ISelectionId;
    tooltipInfo: VisualTooltipDataItem[];
}

export interface SankeyData {
    nodes: SankeyNode[];
    links: SankeyLink[];
}

function findRoleColumnIndex(table: DataViewTable, role: string): number {
    return table.columns.findIndex(column => column.roles && column.roles[role]);
}

function formatValue(value: PrimitiveValue): string {
    if (value === null || value === undefined) {
        return "(Blank)";
    }
    return String(value);
}

/**
 * Converts the raw source/destination/weight table rows into a deduplicated
 * node list and a list of aggregated links suitable for a d3-sankey layout.
 */
export function convertDataView(dataView: DataView, host: IVisualHost, defaultColor: string, colorByCategory: boolean): SankeyData {
    const nodes: SankeyNode[] = [];
    const nodeIndexByName = new Map<string, number>();
    const links: SankeyLink[] = [];
    const linkIndexByKey = new Map<string, number>();

    if (!dataView || !dataView.table || !dataView.table.rows || dataView.table.rows.length === 0) {
        return { nodes, links };
    }

    const table: DataViewTable = dataView.table;
    const sourceIndex: number = findRoleColumnIndex(table, "source");
    const destinationIndex: number = findRoleColumnIndex(table, "destination");
    const weightIndex: number = findRoleColumnIndex(table, "weight");

    if (sourceIndex === -1 || destinationIndex === -1) {
        return { nodes, links };
    }

    const sourceDisplayName: string = table.columns[sourceIndex] ? table.columns[sourceIndex].displayName : "Source";
    const destinationDisplayName: string = table.columns[destinationIndex] ? table.columns[destinationIndex].displayName : "Destination";
    const weightDisplayName: string = weightIndex !== -1 && table.columns[weightIndex] ? table.columns[weightIndex].displayName : "Weight";

    const getOrCreateNode = (name: string): number => {
        let index: number = nodeIndexByName.get(name);
        if (index === undefined) {
            index = nodes.length;
            nodeIndexByName.set(name, index);
            const color: string = colorByCategory
                ? host.colorPalette.getColor(name).value
                : defaultColor;
            nodes.push({
                name,
                color,
                selectionId: host.createSelectionIdBuilder()
                    .withTable(table, index)
                    .createSelectionId()
            });
        }
        return index;
    };

    table.rows.forEach((row, rowIndex) => {
        const sourceName: string = formatValue(row[sourceIndex]);
        const destinationName: string = formatValue(row[destinationIndex]);
        const rawWeight: PrimitiveValue = weightIndex !== -1 ? row[weightIndex] : 1;
        const weight: number = typeof rawWeight === "number" ? rawWeight : Number(rawWeight);

        if (!sourceName || !destinationName || sourceName === destinationName || !isFinite(weight) || weight <= 0) {
            return;
        }

        const sourceNodeIndex: number = getOrCreateNode(sourceName);
        const destinationNodeIndex: number = getOrCreateNode(destinationName);
        const linkKey = `${sourceNodeIndex}->${destinationNodeIndex}`;

        let linkIndex: number = linkIndexByKey.get(linkKey);
        if (linkIndex === undefined) {
            linkIndex = links.length;
            linkIndexByKey.set(linkKey, linkIndex);
            links.push({
                source: sourceNodeIndex,
                target: destinationNodeIndex,
                value: 0,
                selectionId: host.createSelectionIdBuilder()
                    .withTable(table, rowIndex)
                    .createSelectionId(),
                tooltipInfo: []
            });
        }

        const link: SankeyLink = links[linkIndex];
        link.value += weight;
        link.tooltipInfo = [
            { displayName: sourceDisplayName, value: sourceName },
            { displayName: destinationDisplayName, value: destinationName },
            { displayName: weightDisplayName, value: String(link.value) }
        ];
    });

    return { nodes, links };
}
