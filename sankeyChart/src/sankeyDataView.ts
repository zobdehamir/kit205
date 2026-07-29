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
    stageIndex: number;
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
    stageLabels: string[];
}

const EMPTY_DATA: SankeyData = { nodes: [], links: [], stageLabels: [] };

function findRoleColumnIndex(table: DataViewTable, role: string): number {
    return table.columns.findIndex(column => column.roles && column.roles[role]);
}

function formatValue(value: PrimitiveValue): string {
    if (value === null || value === undefined) {
        return "";
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return String(value).trim();
}

/**
 * Resolves a raw value to a canonical display string, merging values that
 * only differ by case/whitespace (e.g. "Arrival" and "arrival ") into a
 * single canonical label — the text as first encountered — so inconsistent
 * source data doesn't fragment into lookalike duplicate stages/locations.
 */
function canonicalize(canonicalByNormalizedKey: Map<string, string>, raw: PrimitiveValue): string {
    const display: string = formatValue(raw);
    if (!display) {
        return "";
    }
    const normalizedKey: string = display.toLowerCase();
    let canonical: string = canonicalByNormalizedKey.get(normalizedKey);
    if (canonical === undefined) {
        canonical = display;
        canonicalByNormalizedKey.set(normalizedKey, canonical);
    }
    return canonical;
}

interface KeyStageEntry {
    stageIdx: number;
    location: string;
    rowIndex: number;
}

/**
 * Builds the final, ordered list of stage labels. `defaultOrder` is the
 * order stages were first encountered in the DataView's own row order
 * (Power BI's natural/default sort for the field). If the user supplied an
 * explicit comma/newline-separated override (for stage names with no
 * natural sequence, e.g. "Arrival, Sale, Dispatch"), that order wins
 * instead; any stage value present in the data but missing from the
 * override is appended at the end so it's never silently dropped.
 */
function buildStageOrder(defaultOrder: string[], stageOrderOverride: string): string[] {
    const overrideList: string[] = (stageOrderOverride || "")
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    if (overrideList.length === 0) {
        return defaultOrder;
    }

    const matched: string[] = [];
    const seen = new Set<string>();
    overrideList.forEach(label => {
        const match: string = defaultOrder.find(d => d.toLowerCase() === label.toLowerCase() && !seen.has(d));
        if (match) {
            matched.push(match);
            seen.add(match);
        }
    });

    const remaining: string[] = defaultOrder.filter(d => !seen.has(d));
    return [...matched, ...remaining];
}

/**
 * Converts long-format Key/Stage/Location rows (one row per key per stage)
 * into a multi-column Sankey graph: each (stage, location) pair becomes a
 * distinct node, and a link is drawn between a key's location at one stage
 * and its location at the next stage it appears in. Link value is the
 * number of distinct keys making that transition.
 */
export function convertDataView(dataView: DataView, host: IVisualHost, defaultColor: string, colorByCategory: boolean, stageOrderOverride: string = ""): SankeyData {
    if (!dataView || !dataView.table || !dataView.table.rows || dataView.table.rows.length === 0) {
        return EMPTY_DATA;
    }

    const table: DataViewTable = dataView.table;
    const keyIndex: number = findRoleColumnIndex(table, "key");
    const stageColumnIndex: number = findRoleColumnIndex(table, "stage");
    const locationIndex: number = findRoleColumnIndex(table, "location");

    if (keyIndex === -1 || stageColumnIndex === -1 || locationIndex === -1) {
        return EMPTY_DATA;
    }

    // Canonicalize stage/location text (trim + case-insensitive merge) and
    // capture stages in the order Power BI's DataView first delivers them,
    // used as the default order when no explicit override is set.
    const stageCanonicalByKey = new Map<string, string>();
    const locationCanonicalByKey = new Map<string, string>();
    table.rows.forEach(row => {
        canonicalize(stageCanonicalByKey, row[stageColumnIndex]);
    });
    const defaultStageOrder: string[] = Array.from(stageCanonicalByKey.values());

    const stageLabels: string[] = buildStageOrder(defaultStageOrder, stageOrderOverride);
    const stageIndexByLabel = new Map<string, number>();
    stageLabels.forEach((label, index) => stageIndexByLabel.set(label, index));

    // Group rows by key, keeping (at most) one location per stage per key.
    const entriesByKey = new Map<string, Map<number, KeyStageEntry>>();
    table.rows.forEach((row, rowIndex) => {
        const keyValue: string = formatValue(row[keyIndex]);
        const locationValue: string = canonicalize(locationCanonicalByKey, row[locationIndex]);
        const stageValue: string = canonicalize(stageCanonicalByKey, row[stageColumnIndex]);
        const stageIdx: number = stageIndexByLabel.get(stageValue);

        if (!keyValue || !locationValue || stageIdx === undefined) {
            return;
        }

        let stagesForKey: Map<number, KeyStageEntry> = entriesByKey.get(keyValue);
        if (!stagesForKey) {
            stagesForKey = new Map<number, KeyStageEntry>();
            entriesByKey.set(keyValue, stagesForKey);
        }
        stagesForKey.set(stageIdx, { stageIdx, location: locationValue, rowIndex });
    });

    const nodes: SankeyNode[] = [];
    const nodeIndexByCompositeKey = new Map<string, number>();
    const links: SankeyLink[] = [];
    const linkIndexByKey = new Map<string, number>();

    const getOrCreateNode = (entry: KeyStageEntry): number => {
        const compositeKey = `${entry.stageIdx}::${entry.location}`;
        let index: number = nodeIndexByCompositeKey.get(compositeKey);
        if (index === undefined) {
            index = nodes.length;
            nodeIndexByCompositeKey.set(compositeKey, index);
            const color: string = colorByCategory
                ? host.colorPalette.getColor(entry.location).value
                : defaultColor;
            nodes.push({
                name: entry.location,
                stageIndex: entry.stageIdx,
                color,
                selectionId: host.createSelectionIdBuilder()
                    .withTable(table, entry.rowIndex)
                    .createSelectionId()
            });
        }
        return index;
    };

    entriesByKey.forEach(stagesForKey => {
        const sortedEntries: KeyStageEntry[] = Array.from(stagesForKey.values())
            .sort((a, b) => a.stageIdx - b.stageIdx);

        const nodeIndices: number[] = sortedEntries.map(getOrCreateNode);

        for (let i = 1; i < sortedEntries.length; i++) {
            const prev: KeyStageEntry = sortedEntries[i - 1];
            const curr: KeyStageEntry = sortedEntries[i];
            const sourceIdx: number = nodeIndices[i - 1];
            const targetIdx: number = nodeIndices[i];
            const linkKey = `${sourceIdx}->${targetIdx}`;

            let linkIdx: number = linkIndexByKey.get(linkKey);
            if (linkIdx === undefined) {
                linkIdx = links.length;
                linkIndexByKey.set(linkKey, linkIdx);
                links.push({
                    source: sourceIdx,
                    target: targetIdx,
                    value: 0,
                    selectionId: host.createSelectionIdBuilder()
                        .withTable(table, curr.rowIndex)
                        .createSelectionId(),
                    tooltipInfo: []
                });
            }

            const link: SankeyLink = links[linkIdx];
            link.value += 1;
            link.tooltipInfo = [
                { displayName: "From", value: `${prev.location} (${stageLabels[prev.stageIdx]})` },
                { displayName: "To", value: `${curr.location} (${stageLabels[curr.stageIdx]})` },
                { displayName: "Keys", value: String(link.value) }
            ];
        }
    });

    return { nodes, links, stageLabels };
}
