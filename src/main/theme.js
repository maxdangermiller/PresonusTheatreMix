// main/theme.js
// The theme engine's main-process side: which theme is chosen (app settings), custom themes
// from the "themes" folder, and telling every window when the theme changes.

import { app, BrowserWindow, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { BUILTIN_THEMES, DEFAULT_THEME, THEME_COLOR_NAMES, resolve_theme } from '../utils/themes.js';
import { getSettings, updateSettings } from './settings.js';

// Only plain color values are accepted from theme files (no url(), no ";" etc.)
const COLOR_VALUE = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\)|[a-zA-Z]+)$/;

const themesFolder = () => path.join(app.getPath('userData'), 'themes');

const EXAMPLE = {
	name: "My Theme",
	base: "vivid",
	colors: {cueRed: "#b3202a", selected: "#7a3db8", activeAccent: "#ffd400"},
};

const README = `Custom themes for PreSonus TheatreMix

Put a .json file in this folder for each theme, then pick it in Settings (⌘,) or View → Theme.
A theme only lists the colors it changes; the rest come from its "base" theme
("vivid", "classic" or "light"). Colors are CSS colors: "#rrggbb", "rgb(...)", "rgba(...)".

Example (My Theme.json):
${JSON.stringify(EXAMPLE, null, 2)}

Colors you can set:
${THEME_COLOR_NAMES.join(", ")}

("scheme" is "dark" or "light": the look of scrollbars and native controls.)
The full list with what each one is for is in the app's source: src/utils/themes.js
`;

/**
 * Custom themes from the themes folder. The file name is the theme's id ("custom:<file name>").
 * @returns {{id: String, name: String, base: String, colors: Object, custom: true}[]}
 */
const load_custom_themes = () => {
	let files = [];
	try {
		files = fs.readdirSync(themesFolder()).filter((f) => f.toLowerCase().endsWith('.json'));
	} catch {
		return [];
	}
	const themes = [];
	for (const file of files) {
		try {
			const data = JSON.parse(fs.readFileSync(path.join(themesFolder(), file), 'utf8'));
			const colors = Object.fromEntries(Object.entries(data.colors ?? {})
				.filter(([name, value]) => THEME_COLOR_NAMES.includes(name) && typeof value === 'string' && COLOR_VALUE.test(value.trim()))
				.map(([name, value]) => [name, value.trim()]));
			const base = BUILTIN_THEMES.some((t) => t.id === data.base) ? data.base : DEFAULT_THEME;
			themes.push({id: `custom:${file.slice(0, -5)}`, name: String(data.name || file.slice(0, -5)), base, colors, custom: true});
		} catch (error) {
			console.warn(`[theme]: Skipping ${file}:`, error.message);
		}
	}
	return themes;
}

/** Every theme: the built-in ones, then custom ones */
const all_themes = () => [...BUILTIN_THEMES, ...load_custom_themes()];

/**
 * The chosen theme (the default if it's gone), its colors, and the list to pick from
 * @returns {{id: String, colors: Object<string, string>, themes: {id: String, name: String, custom: boolean}[]}}
 */
const getThemeState = () => {
	const themes = all_themes();
	const theme = themes.find((t) => t.id === getSettings().theme) ?? themes.find((t) => t.id === DEFAULT_THEME);
	return {
		id: theme.id,
		colors: resolve_theme(theme, themes),
		themes: themes.map(({id, name, custom}) => ({id, name, custom: !!custom})),
	};
}

/**
 * Choose a theme and repaint every window
 * @param {String} id
 */
const setTheme = (id) => {
	if (!all_themes().some((t) => t.id === id)) return getThemeState();
	updateSettings({theme: id});
	const state = getThemeState();
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) continue;
		window.setBackgroundColor(state.colors.background);
		window.webContents.send('theme-changed', state);
	}
	return state;
}

/** The window background to open new windows with (no flash of the wrong color) */
const themeBackground = () => getThemeState().colors.background;

/** Settings → Open Themes Folder: make it (with a how-to) if it isn't there, then show it */
const openThemesFolder = () => {
	const folder = themesFolder();
	fs.mkdirSync(folder, {recursive: true});
	const readme = path.join(folder, 'README.txt');
	if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
	shell.openPath(folder);
}

export { getThemeState, setTheme, themeBackground, openThemesFolder };
