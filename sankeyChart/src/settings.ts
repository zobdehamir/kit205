"use strict";

import powerbi from "powerbi-visuals-api";

import DataView = powerbi.DataView;
import DataViewObjects = powerbi.DataViewObjects;
import DataViewObject = powerbi.DataViewObject;
import Fill = powerbi.Fill;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstanceEnumeration = powerbi.VisualObjectInstanceEnumeration;

export interface VisualSettings {
    dataPoint: {
        defaultColor: string;
        colorByCategory: boolean;
    };
    links: {
        colorMode: string;
        fill: string;
        linkOpacity: number;
    };
    nodes: {
        nodeWidth: number;
        nodePadding: number;
    };
    labels: {
        show: boolean;
        color: string;
        fontSize: number;
        showValue: boolean;
    };
    stageHeaders: {
        show: boolean;
        color: string;
        fontSize: number;
    };
}

export const defaultSettings: VisualSettings = {
    dataPoint: {
        defaultColor: "#01B8AA",
        colorByCategory: true
    },
    links: {
        colorMode: "source",
        fill: "#B3B3B3",
        linkOpacity: 45
    },
    nodes: {
        nodeWidth: 16,
        nodePadding: 12
    },
    labels: {
        show: true,
        color: "#000000",
        fontSize: 10,
        showValue: true
    },
    stageHeaders: {
        show: true,
        color: "#605E5C",
        fontSize: 11
    }
};

function getObjectProperties(objects: DataViewObjects, objectName: string): DataViewObject {
    return objects ? objects[objectName] : undefined;
}

function getValue<T>(objects: DataViewObjects, objectName: string, propertyName: string, defaultValue: T): T {
    const objectProps: DataViewObject = getObjectProperties(objects, objectName);
    if (objectProps && objectProps[propertyName] !== undefined && objectProps[propertyName] !== null) {
        return objectProps[propertyName] as unknown as T;
    }
    return defaultValue;
}

function getFillValue(objects: DataViewObjects, objectName: string, propertyName: string, defaultValue: string): string {
    const objectProps: DataViewObject = getObjectProperties(objects, objectName);
    const fill: Fill = objectProps ? objectProps[propertyName] as unknown as Fill : undefined;
    if (fill && fill.solid && fill.solid.color) {
        return fill.solid.color;
    }
    return defaultValue;
}

export function parseSettings(dataView: DataView): VisualSettings {
    const objects: DataViewObjects = dataView && dataView.metadata && dataView.metadata.objects;

    return {
        dataPoint: {
            defaultColor: getFillValue(objects, "dataPoint", "defaultColor", defaultSettings.dataPoint.defaultColor),
            colorByCategory: getValue(objects, "dataPoint", "colorByCategory", defaultSettings.dataPoint.colorByCategory)
        },
        links: {
            colorMode: getValue(objects, "links", "colorMode", defaultSettings.links.colorMode),
            fill: getFillValue(objects, "links", "fill", defaultSettings.links.fill),
            linkOpacity: getValue(objects, "links", "linkOpacity", defaultSettings.links.linkOpacity)
        },
        nodes: {
            nodeWidth: getValue(objects, "nodes", "nodeWidth", defaultSettings.nodes.nodeWidth),
            nodePadding: getValue(objects, "nodes", "nodePadding", defaultSettings.nodes.nodePadding)
        },
        labels: {
            show: getValue(objects, "labels", "show", defaultSettings.labels.show),
            color: getFillValue(objects, "labels", "color", defaultSettings.labels.color),
            fontSize: getValue(objects, "labels", "fontSize", defaultSettings.labels.fontSize),
            showValue: getValue(objects, "labels", "showValue", defaultSettings.labels.showValue)
        },
        stageHeaders: {
            show: getValue(objects, "stageHeaders", "show", defaultSettings.stageHeaders.show),
            color: getFillValue(objects, "stageHeaders", "color", defaultSettings.stageHeaders.color),
            fontSize: getValue(objects, "stageHeaders", "fontSize", defaultSettings.stageHeaders.fontSize)
        }
    };
}

/**
 * Classic (pre-formatting-model) property pane enumeration, supported since
 * the earliest custom visuals API versions. Used instead of getFormattingModel
 * so the visual keeps working on older visual hosts (e.g. Power BI Report
 * Server / Report Builder) that don't render the newer formatting model pane.
 */
export function enumerateSettingsInstances(settings: VisualSettings, options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
    switch (options.objectName) {
        case "dataPoint":
            return [{
                objectName: "dataPoint",
                properties: {
                    defaultColor: { solid: { color: settings.dataPoint.defaultColor } },
                    colorByCategory: settings.dataPoint.colorByCategory
                },
                selector: null
            } as VisualObjectInstance];
        case "links":
            return [{
                objectName: "links",
                properties: {
                    colorMode: settings.links.colorMode,
                    fill: { solid: { color: settings.links.fill } },
                    linkOpacity: settings.links.linkOpacity
                },
                selector: null
            } as VisualObjectInstance];
        case "nodes":
            return [{
                objectName: "nodes",
                properties: {
                    nodeWidth: settings.nodes.nodeWidth,
                    nodePadding: settings.nodes.nodePadding
                },
                selector: null
            } as VisualObjectInstance];
        case "labels":
            return [{
                objectName: "labels",
                properties: {
                    show: settings.labels.show,
                    color: { solid: { color: settings.labels.color } },
                    fontSize: settings.labels.fontSize,
                    showValue: settings.labels.showValue
                },
                selector: null
            } as VisualObjectInstance];
        case "stageHeaders":
            return [{
                objectName: "stageHeaders",
                properties: {
                    show: settings.stageHeaders.show,
                    color: { solid: { color: settings.stageHeaders.color } },
                    fontSize: settings.stageHeaders.fontSize
                },
                selector: null
            } as VisualObjectInstance];
        default:
            return [];
    }
}
