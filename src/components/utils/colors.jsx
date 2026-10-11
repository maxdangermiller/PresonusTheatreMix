const BACKGROUND_COLOR = "#2a2a2a";
const HEADER_COLOR = "#444444";
const DEFAULT_ROW_COLOR = "#000000";
const RED_HIGHLIGHT_COLOR = "#703a3c";
const YELLOW_HIGHLIGHT_COLOR = "#846c37";
const GREEN_HIGHLIGHT_COLOR = "#506d43";
const BLUE_HIGHLIGHT_COLOR = "#40536a";
const PURPLE_HIGHLIGHT_COLOR = "#664d77";
const TEXT_COLOR = "#ffffff";
// The active cue keeps its own color and gets this accent: a bar on its left edge and a light tint
const ACTIVE_CUE_ACCENT = "#4ade80";
const ACTIVE_CUE_TINT = "rgba(74, 222, 128, 0.18)";

// DCA cells: what happens to the DCA in the next cue (TheatreMix's color coding, utils/dca_state.js),
// [several channels, one channel]: like TheatreMix, ensembles are brighter. "change" and "off"
// keep the cell's normal background.
const DCA_STATE_COLORS = {
    same: [{backgroundColor: "#00c400"}, {backgroundColor: "#088a08"}],
    position: [{backgroundColor: "#00b8b8"}, {backgroundColor: "#077c7c"}],
    fx: [{backgroundColor: "#ff8c00"}, {backgroundColor: "#a85c00"}],
    profile: [{backgroundColor: "#d8c800", color: "#000"}, {backgroundColor: "#8f8500"}],
    ensemble: [{backgroundColor: "#c800c8"}, {backgroundColor: "#880088"}],
};
const BORDER_COLOR = "#111111";
const SELECTED_COLOR = "#005BD9";

const get_cue_color = (index) => {
    switch(index) {
        case 0:
            return DEFAULT_ROW_COLOR;
        case 1:
            return RED_HIGHLIGHT_COLOR;
        case 2: 
            return YELLOW_HIGHLIGHT_COLOR;
        case 3:
            return GREEN_HIGHLIGHT_COLOR;
        case 4:
            return BLUE_HIGHLIGHT_COLOR;
        case 5:
            return PURPLE_HIGHLIGHT_COLOR;
        default:
            return DEFAULT_ROW_COLOR
    }
}

export { 
    BACKGROUND_COLOR, HEADER_COLOR,
    DEFAULT_ROW_COLOR, RED_HIGHLIGHT_COLOR,
    YELLOW_HIGHLIGHT_COLOR, GREEN_HIGHLIGHT_COLOR,
    BLUE_HIGHLIGHT_COLOR, PURPLE_HIGHLIGHT_COLOR, 
    TEXT_COLOR, ACTIVE_CUE_ACCENT, ACTIVE_CUE_TINT, DCA_STATE_COLORS, BORDER_COLOR,
    SELECTED_COLOR,
    get_cue_color
}