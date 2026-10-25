// utils/themes.js
// The theme engine's built-in themes, shared by the main process (Settings, menu) and every
// window (which turns the active theme's colors into CSS variables, components/utils/colors.jsx).
//
// A theme is {id, name, base?, colors}. Colors a theme leaves out come from its base (a built-in
// theme's id, "vivid" if it doesn't say), so a custom theme only lists what it changes. Custom
// themes are .json files in the app's "themes" folder (Settings → Open Themes Folder).

/**
 * Every color a theme sets. Each is a CSS variable: name -> --name in kebab case
 * (e.g. cueRed -> --cue-red). The comments say where each one shows.
 */
const VIVID = {
	scheme: "dark",              // native controls and scrollbars: "dark" or "light"
	background: "#2a2a2a",       // window background
	text: "#ffffff",
	textMuted: "#b5b5b5",        // notes, column titles
	textFaint: "#8a8a8a",        // placeholders, a DCA label with no channels
	header: "#444444",           // cue list header, dialog title bar
	border: "#111111",           // cue list grid lines
	line: "#444444",             // separators, light outlines
	lineStrong: "#555555",       // list and input outlines
	panel: "#141414",            // list and table boxes in dialogs
	input: "#1b1b1b",            // text boxes and menus
	cueList: "#000000",          // behind the cue list
	toolbar: "#444444",          // toolbar background
	toolbarDivider: "#5c5c5c",
	hover: "#555555",            // toolbar button under the mouse
	pressed: "#666666",
	toggled: "#5a5a5a",          // a toolbar button that's on
	tooltip: "#1d1d1d",
	tooltipBorder: "#5a5a5a",
	selected: "#005bd9",         // selected cells and rows, the active tab
	onSelected: "#ffffff",       // text on a selection
	primary: "#005bd9",          // OK / default buttons
	onPrimary: "#ffffff",
	button: "#464646",           // gray buttons (Console Setup)
	buttonHover: "#555555",
	buttonPressed: "#6e6e6e",
	buttonDisabled: "#282828",
	buttonDisabledText: "#646464",
	buttonBorder: "#6c757d",     // outlined buttons (dialogs)
	overlay: "rgba(0, 0, 0, 0.6)",   // behind a dialog
	shadow: "rgba(0, 0, 0, 0.5)",
	window: "#323232",           // Console Setup window
	windowTitle: "#2b2b2b",
	well: "#1e1e1e",             // Console Setup lists and boxes
	groupBorder: "#828790",      // Console Setup box outlines
	// Cue highlight colors (right-click a cue): none, red, yellow, green, blue, purple
	cueNone: "#000000",
	cueRed: "#960d18",
	cueYellow: "#f5b800",
	cueGreen: "#00a34f",
	cueBlue: "#1239ba",
	cuePurple: "#4c257e",
	activeAccent: "#4ade80",     // the active cue's bar
	activeTint: "rgba(74, 222, 128, 0.18)",
	dcaAssigned: "#0b0b0b",      // a DCA cell with channels (TheatreMix: black)
	dcaEnsemble: "#454545",      // an ensemble DCA cell
	skipped: "#c08cf0",          // a skipped cue's text
	mark: "#ff6b6b",             // a marked cue's dot
	ok: "#3cc83c",               // connected, active backup
	warn: "#ffb86b",             // notes that need attention
	caution: "#e0a800",          // connecting, mute group warnings
	error: "#ff8a8a",
	editing: "#6a0000",          // a cell being typed into
	editingOutline: "#bb3333",
	toastError: "#5a1f1f",
	toastErrorBorder: "#aa4444",
	toastInfo: "#1f3b5a",
	toastInfoBorder: "#4a7fb5",
	graph: "#0d0d0d",            // EQ graph background
	graphGrid: "#2c2c2c",
	graphLine: "#4fc3f7",
	flashFired: "#287828",       // Console Setup: a mute group button that ran its action
	flashPressed: "#1e468c",
};

/** The built-in themes */
const BUILTIN_THEMES = [
	{id: 'vivid', name: "Vivid (dark)", colors: VIVID},
	{
		// The app's first color scheme: muted cue colors
		id: 'classic', name: "Classic (dark)", base: 'vivid',
		colors: {cueRed: "#703a3c", cueYellow: "#846c37", cueGreen: "#506d43", cueBlue: "#40536a", cuePurple: "#664d77"},
	},
	{
		id: 'light', name: "Light", base: 'vivid',
		colors: {
			scheme: "light",
			background: "#ececec",
			text: "#141414",
			textMuted: "#555555",
			textFaint: "#8a8a8a",
			header: "#d4d4d4",
			border: "#b4b4b4",
			line: "#cccccc",
			lineStrong: "#a6a6a6",
			panel: "#ffffff",
			input: "#ffffff",
			cueList: "#ffffff",
			toolbar: "#dcdcdc",
			toolbarDivider: "#bdbdbd",
			hover: "#c8c8c8",
			pressed: "#b8b8b8",
			toggled: "#c2c2c2",
			tooltip: "#fffbe6",
			tooltipBorder: "#b8b8b8",
			selected: "#b9d3fb",
			onSelected: "#0b1f44",
			primary: "#1a66e0",
			onPrimary: "#ffffff",
			button: "#dedede",
			buttonHover: "#d0d0d0",
			buttonPressed: "#bdbdbd",
			buttonDisabled: "#efefef",
			buttonDisabledText: "#a8a8a8",
			buttonBorder: "#9aa0a6",
			overlay: "rgba(0, 0, 0, 0.3)",
			shadow: "rgba(0, 0, 0, 0.2)",
			window: "#ececec",
			windowTitle: "#dedede",
			well: "#ffffff",
			groupBorder: "#a0a4aa",
			cueNone: "#ffffff",
			cueRed: "#f6c9cb",
			cueYellow: "#fbe7a0",
			cueGreen: "#c8ecc9",
			cueBlue: "#c9d9f6",
			cuePurple: "#e2cff3",
			activeAccent: "#16a34a",
			activeTint: "rgba(22, 163, 74, 0.16)",
			dcaAssigned: "#ffffff",
			dcaEnsemble: "#d6d6d6",
			skipped: "#7a3db8",
			mark: "#d32f2f",
			ok: "#15803d",
			warn: "#b45309",
			caution: "#a16207",
			error: "#c62828",
			editing: "#ffe1e1",
			editingOutline: "#d33333",
			toastError: "#fde2e2",
			toastErrorBorder: "#dd8888",
			toastInfo: "#dbeafe",
			toastInfoBorder: "#7aa7e0",
			graph: "#ffffff",
			graphGrid: "#e3e3e3",
			graphLine: "#0277bd",
			flashFired: "#9fdc9f",
			flashPressed: "#a9c6f5",
		},
	},
];

const DEFAULT_THEME = 'vivid';
const THEME_COLOR_NAMES = Object.keys(VIVID);

/** cueRed -> --cue-red */
const css_variable = (name) => `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/**
 * A theme's full set of colors: its own over its base's (and over Vivid's)
 * @param {{id: String, base?: String, colors: Object}} theme
 * @param {Object[]} themes every theme, to find the base
 * @returns {Object<string, string>}
 */
const resolve_theme = (theme, themes = BUILTIN_THEMES) => {
	const chain = [];
	for (let t = theme; t && !chain.includes(t) && chain.length < 10; t = themes.find((x) => x.id === (t.base ?? (t.id === 'vivid' ? null : 'vivid')))) chain.unshift(t);
	const colors = Object.assign({}, VIVID, ...chain.map((t) => t.colors ?? {}));
	return Object.fromEntries(THEME_COLOR_NAMES.map((name) => [name, String(colors[name])]));
}

export { BUILTIN_THEMES, DEFAULT_THEME, THEME_COLOR_NAMES, css_variable, resolve_theme };
