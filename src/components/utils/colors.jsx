// The app's colors. Each one is a CSS variable set by the theme engine (utils/themes.js,
// applied to every window by apply_theme below), so inline styles follow the chosen theme.
// Settings → Theme / View → Theme picks the theme.

import { THEME_COLOR_NAMES, css_variable } from '../../utils/themes.js';

/** A theme color as a CSS value, e.g. themed('cueRed') -> "var(--cue-red)" */
const themed = (name) => `var(${css_variable(name)})`;

const BACKGROUND_COLOR = themed('background');
const HEADER_COLOR = themed('header');
const DEFAULT_ROW_COLOR = themed('cueNone');
const RED_HIGHLIGHT_COLOR = themed('cueRed');
const YELLOW_HIGHLIGHT_COLOR = themed('cueYellow');
const GREEN_HIGHLIGHT_COLOR = themed('cueGreen');
const BLUE_HIGHLIGHT_COLOR = themed('cueBlue');
const PURPLE_HIGHLIGHT_COLOR = themed('cuePurple');

const TEXT_COLOR = themed('text');
// The active cue keeps its own color and gets this accent: a bar on its left edge and a light tint
const ACTIVE_CUE_ACCENT = themed('activeAccent');
const ACTIVE_CUE_TINT = themed('activeTint');

// DCA cells: what happens to the DCA in the next cue (TheatreMix's color coding, utils/dca_state.js),
// [several channels, one channel]: like TheatreMix, ensembles are brighter. "change" and "off"
// keep the cell's normal background. These mean the same in every theme, so they don't change.
const DCA_STATE_COLORS = {
    same: [{backgroundColor: "#00c400", color: "#fff"}, {backgroundColor: "#088a08", color: "#fff"}],
    position: [{backgroundColor: "#00b8b8", color: "#fff"}, {backgroundColor: "#077c7c", color: "#fff"}],
    fx: [{backgroundColor: "#ff8c00", color: "#fff"}, {backgroundColor: "#a85c00", color: "#fff"}],
    profile: [{backgroundColor: "#d8c800", color: "#000"}, {backgroundColor: "#8f8500", color: "#fff"}],
    ensemble: [{backgroundColor: "#c800c8", color: "#fff"}, {backgroundColor: "#880088", color: "#fff"}],
};
const BORDER_COLOR = themed('border');
// Selected cells / rows, and the text on them
const SELECTED_COLOR = themed('selected');
const ON_SELECTED_COLOR = themed('onSelected');
// Default (OK) buttons, and their text
const PRIMARY_COLOR = themed('primary');
const ON_PRIMARY_COLOR = themed('onPrimary');

const CUE_COLORS = [DEFAULT_ROW_COLOR, RED_HIGHLIGHT_COLOR, YELLOW_HIGHLIGHT_COLOR, GREEN_HIGHLIGHT_COLOR, BLUE_HIGHLIGHT_COLOR, PURPLE_HIGHLIGHT_COLOR];

/**
 * A cue's highlight color (TheatreMix's colour: 0 none, 1 red, 2 yellow, 3 green, 4 blue, 5 purple)
 * @param {Number} index
 */
const get_cue_color = (index) => CUE_COLORS[index] ?? DEFAULT_ROW_COLOR;

/**
 * Put a theme's colors on this window (CSS variables on <html>, and the native controls' look)
 * @param {{colors: Object<string, string>}} theme from window.themeApi
 */
const apply_theme = (theme) => {
    const root = document.documentElement;
    for (const name of THEME_COLOR_NAMES) {
        if (theme?.colors?.[name] !== undefined) root.style.setProperty(css_variable(name), theme.colors[name]);
    }
    root.style.colorScheme = theme?.colors?.scheme === 'light' ? 'light' : 'dark';
}

export { 
    BACKGROUND_COLOR, HEADER_COLOR,
    DEFAULT_ROW_COLOR, RED_HIGHLIGHT_COLOR,
    YELLOW_HIGHLIGHT_COLOR, GREEN_HIGHLIGHT_COLOR,
    BLUE_HIGHLIGHT_COLOR, PURPLE_HIGHLIGHT_COLOR, 
    TEXT_COLOR, ACTIVE_CUE_ACCENT, ACTIVE_CUE_TINT, DCA_STATE_COLORS, BORDER_COLOR,
    SELECTED_COLOR, ON_SELECTED_COLOR, PRIMARY_COLOR, ON_PRIMARY_COLOR,
    themed, get_cue_color, apply_theme
}
