"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import powerbi from "powerbi-visuals-api";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;
import ValidatorType = powerbi.visuals.ValidatorType;

/**
 * Data colors formatting card
 */
class DataPointCardSettings extends FormattingSettingsCard {
    defaultColor = new formattingSettings.ColorPicker({
        name: "defaultColor",
        displayName: "Default color",
        value: { value: "#01B8AA" }
    });

    colorByCategory = new formattingSettings.ToggleSwitch({
        name: "colorByCategory",
        displayName: "Color nodes by category",
        value: true
    });

    name: string = "dataPoint";
    displayName: string = "Data colors";
    slices: Array<FormattingSettingsSlice> = [this.defaultColor, this.colorByCategory];
}

/**
 * Links formatting card
 */
class LinksCardSettings extends FormattingSettingsCard {
    colorMode = new formattingSettings.ItemDropdown({
        name: "colorMode",
        displayName: "Link color",
        items: [
            { value: "source", displayName: "Source node color" },
            { value: "gradient", displayName: "Source-target gradient" },
            { value: "uniform", displayName: "Single color" }
        ],
        value: { value: "source", displayName: "Source node color" }
    });

    fill = new formattingSettings.ColorPicker({
        name: "fill",
        displayName: "Link color",
        value: { value: "#B3B3B3" }
    });

    linkOpacity = new formattingSettings.Slider({
        name: "linkOpacity",
        displayName: "Link opacity (%)",
        value: 45,
        options: {
            minValue: { type: ValidatorType.Min, value: 5 },
            maxValue: { type: ValidatorType.Max, value: 100 }
        }
    });

    name: string = "links";
    displayName: string = "Links";
    slices: Array<FormattingSettingsSlice> = [this.colorMode, this.fill, this.linkOpacity];
}

/**
 * Nodes formatting card
 */
class NodesCardSettings extends FormattingSettingsCard {
    nodeWidth = new formattingSettings.NumUpDown({
        name: "nodeWidth",
        displayName: "Node width",
        value: 16
    });

    nodePadding = new formattingSettings.NumUpDown({
        name: "nodePadding",
        displayName: "Node padding",
        value: 12
    });

    name: string = "nodes";
    displayName: string = "Nodes";
    slices: Array<FormattingSettingsSlice> = [this.nodeWidth, this.nodePadding];
}

/**
 * Labels formatting card
 */
class LabelsCardSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show labels",
        value: true
    });

    color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "Text color",
        value: { value: "#000000" }
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Text size",
        value: 10
    });

    showValue = new formattingSettings.ToggleSwitch({
        name: "showValue",
        displayName: "Show value",
        value: true
    });

    name: string = "labels";
    displayName: string = "Labels";
    topLevelSlice: formattingSettings.ToggleSwitch = this.show;
    slices: Array<FormattingSettingsSlice> = [this.color, this.fontSize, this.showValue];
}

/**
 * Visual settings model class
 */
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    dataPointCard = new DataPointCardSettings();
    linksCard = new LinksCardSettings();
    nodesCard = new NodesCardSettings();
    labelsCard = new LabelsCardSettings();

    cards = [this.dataPointCard, this.linksCard, this.nodesCard, this.labelsCard];
}
