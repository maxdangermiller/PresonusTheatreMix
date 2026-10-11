import React, { useEffect, useRef } from 'react';

import { BACKGROUND_COLOR, BORDER_COLOR, HEADER_COLOR, TEXT_COLOR, SELECTED_COLOR } from './utils/colors.jsx';

const OVERLAY_STYLE = {
	position: "fixed",
	inset: 0,
	backgroundColor: "rgba(0, 0, 0, 0.6)",
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	zIndex: 100
}

const DIALOG_STYLE = {
	backgroundColor: BACKGROUND_COLOR,
	color: TEXT_COLOR,
	border: "2px solid " + BORDER_COLOR,
	borderRadius: "8px",
	fontFamily: "Arial",
	boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
	maxHeight: "92vh",
	maxWidth: "96vw",
}

const HEADER_STYLE = {
	backgroundColor: HEADER_COLOR,
	padding: "12px 16px",
	fontSize: 18,
	fontWeight: "bold"
}

const BODY_STYLE = {
	padding: "16px",
	display: "flex",
	flexDirection: "column",
	gap: "12px",
	overflow: "auto",
	minHeight: 0,
}

const FOOTER_STYLE = {
	display: "flex",
	justifyContent: "flex-end",
	alignItems: "center",
	gap: "10px",
	padding: "12px 16px",
	borderTop: "1px solid " + BORDER_COLOR
}

const BUTTON_STYLE = {
	fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
	fontSize: "1rem",
	color: TEXT_COLOR,
	backgroundColor: "transparent",
	border: "1px solid #6c757d",
	borderRadius: "0.375rem",
	padding: "0.375rem 0.75rem",
	cursor: "pointer"
}

const PRIMARY_BUTTON_STYLE = {
	...BUTTON_STYLE,
	backgroundColor: SELECTED_COLOR,
	borderColor: SELECTED_COLOR
}

// Text inputs / selects inside dialogs
const INPUT_STYLE = {
	fontSize: 15,
	padding: "4px 6px",
	backgroundColor: "#1b1b1b",
	color: TEXT_COLOR,
	border: "1px solid #555",
	borderRadius: "4px",
}

const ERROR_STYLE = {minHeight: "1.2em", fontSize: 13, color: "#ff8a8a"}

/**
 * @typedef {Object} DialogProps
 * @property {String} title
 * @property {String} [subtitle]
 * @property {Number | String} [width]
 * @property {Function} onCancel - Escape, clicking outside, Cancel
 * @property {Function} [onSubmit] - Enter (⌘Enter in a multi-line field) and the OK button
 * @property {String} [submitLabel] - OK button text (default "OK")
 * @property {String} [cancelLabel] - Cancel button text (default "Cancel"; "Close" for a view)
 * @property {React.ReactNode} [footerLeft] - extra footer content on the left
 * @property {boolean} [fill] - take the window's height, with the body not scrolling (its content scrolls itself)
 * @property {React.ReactNode} children
 */

/**
 * A popup in the app's style. Keys are captured so the cue list's shortcuts (Space fires a
 * cue) don't run while it's open: Enter submits (⌘Enter in a multi-line field), Escape cancels.
 * @param {DialogProps} props
 */
const Dialog = ({title, subtitle, width = 420, onCancel, onSubmit, submitLabel = "OK", cancelLabel = "Cancel", footerLeft, fill = false, children}) => {
	// Always call the latest handlers from the one key listener
	const handlers = useRef({onCancel, onSubmit});
	handlers.current = {onCancel, onSubmit};

	useEffect(() => {
		const handleKey = (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				handlers.current.onCancel();
			} else if (event.key === 'Enter' && handlers.current.onSubmit
				&& (event.target.tagName !== 'TEXTAREA' || event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				handlers.current.onSubmit(event);
			}
			event.stopPropagation();
		}

		window.addEventListener('keydown', handleKey, true);
		return () => window.removeEventListener('keydown', handleKey, true);
	}, []);

	return (
		<div style={OVERLAY_STYLE} onMouseDown={onCancel}>
			<div style={{...DIALOG_STYLE, width, ...(fill ? {height: "92vh"} : {})}} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
				<div style={HEADER_STYLE}>
					{title}
					{subtitle ? <div style={{fontSize: 14, fontWeight: "normal", opacity: 0.8, marginTop: 4}}>{subtitle}</div> : null}
				</div>

				<div style={fill ? {...BODY_STYLE, flex: 1, overflow: "hidden"} : BODY_STYLE}>{children}</div>

				<div style={FOOTER_STYLE}>
					{footerLeft ? <span style={{marginRight: "auto", display: "flex", gap: "10px"}}>{footerLeft}</span> : null}
					<button style={BUTTON_STYLE} onClick={onCancel}>{cancelLabel}</button>
					{onSubmit ? <button style={PRIMARY_BUTTON_STYLE} onClick={onSubmit}>{submitLabel}</button> : null}
				</div>
			</div>
		</div>
	);
}

export default Dialog;
export { BUTTON_STYLE, PRIMARY_BUTTON_STYLE, INPUT_STYLE, ERROR_STYLE };
