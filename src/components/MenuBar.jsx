import React, { useEffect, useRef, useState } from "react";

import {
    NewShowIcon, OpenShowIcon, SaveShowIcon,
    UndoIcon, RedoIcon,
    InsertCueIcon, CloneCueIcon, DeleteCueIcon,
    AssignIcon,
    StoreSettingsIcon, PositionsColumnIcon, LockIcon, UnlockIcon,
    BackIcon, GoIcon,
    ConsoleSetupIcon, QLabStatusIcon
} from "./ToolbarIcons.jsx";

const TOOLBAR_STYLE = {
    backgroundColor: "#444444",
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "4px 8px",
    flex: "none",
    overflow: "hidden",
    userSelect: "none",
};

const DIVIDER_STYLE = {
    flex: "none",
    width: "1px",
    height: "30px",
    margin: "0 8px",
    backgroundColor: "#5c5c5c",
};

const isMac = navigator.userAgent.includes("Mac");

// QLab status light colors
const QLAB_COLORS = {connected: "#3cc83c", connecting: "#9a9a9a"};

// Console Setup icon: green when connected (like TheatreMix), amber while (re)connecting
const CONSOLE_COLORS = {connected: "#3cc83c", connecting: "#e0a800"};

/**
 * Tooltip for the Console Setup button
 * @param {{state: String, host?: String, name?: String, message?: String}} status 
 */
const console_tooltip = (status) => {
    const target = status.name ? `${status.name} (${status.host})` : status.host;

    switch (status.state) {
        case 'connected': return `Console connected: ${target}`;
        case 'connecting': return `${status.message ?? "Connecting"}: ${target}`;
        default: return status.message ? `Console disconnected: ${status.message}` : "Console disconnected";
    }
}

const QLAB_STATUS_STYLE = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "42px",
    height: "40px",
    flex: "none",
};

/**
 * Shortcut text for tooltips, e.g. "⌘G" on Mac and "Ctrl+G" elsewhere
 * @param {String} keys e.g. "Mod+Shift+Z"
 * @returns {String}
 */
const shortcut = (keys) => {
    if (!isMac) return keys.replace("Mod", "Ctrl");

    const symbols = {Mod: "⌘", Shift: "⇧", Alt: "⌥"};
    const parts = keys.split("+");
    const key = parts.pop();

    // macOS order: ⌥⇧⌘
    const order = ["Alt", "Shift", "Mod"];
    return parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((m) => symbols[m]).join("") + key;
}

const TOOLTIP_DELAY_MS = 350;

const TOOLTIP_STYLE = {
    position: "fixed",
    zIndex: 200,
    maxWidth: 300,
    backgroundColor: "#1d1d1d",
    color: "#fff",
    border: "1px solid #5a5a5a",
    borderRadius: 6,
    padding: "6px 9px",
    fontFamily: "system-ui, -apple-system, Arial, sans-serif",
    fontSize: 13,
    lineHeight: 1.35,
    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.5)",
    pointerEvents: "none",
};

/**
 * @typedef {Object} ToolbarButtonProps
 * @property {String} label
 * @property {String} [keys] shortcut shown in the tooltip
 * @property {Function} [onClick] omitted for features that aren't built yet
 * @property {boolean} [disabled]
 * @property {String} [disabledReason] why it's greyed out (shown in the tooltip while it is)
 * @property {boolean} [toggled]
 * @property {String} [color] icon color (e.g. connection status)
 * @property {String} [tooltip] what the button does (or its status), under the label
 */

/**
 * A toolbar button with a tooltip: its name and shortcut, what it does, and why it's greyed out.
 * The tooltip shows for greyed-out buttons too (the wrapper gets the mouse, see index.css).
 * @param {ToolbarButtonProps & {children: React.ReactNode}} props
 */
const ToolbarButton = ({label, keys, onClick, disabled = false, disabledReason, toggled = false, color, tooltip, children}) => {
    const [tip, setTip] = useState(null);   // {x, y} once shown
    const timer = useRef(null);
    const off = disabled || !onClick;

    const show = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            timer.current = null;
            setTip({x: Math.max(6, Math.min(rect.left, window.innerWidth - 310)), y: rect.bottom + 6});
        }, TOOLTIP_DELAY_MS);
    };
    const hide = () => {
        clearTimeout(timer.current);
        timer.current = null;
        setTip(null);
    };
    useEffect(() => () => clearTimeout(timer.current), []);

    return (
        // mouseover (not React's mouseenter, which can miss a wrapper whose button ignores the mouse)
        <span className="toolbar-button-wrap" onMouseOver={(e) => { if (!tip && !timer.current) show(e); }} onMouseLeave={hide} onMouseDown={hide}>
            <button
                type="button"
                className={`toolbar-button${toggled ? " toggled" : ""}`}
                onClick={onClick}
                disabled={off}
                style={color ? {color} : undefined}
                aria-label={label}
                aria-description={tooltip}
                aria-pressed={toggled || undefined}
            >
                {children}
            </button>
            {tip ? (
                <div style={{...TOOLTIP_STYLE, left: tip.x, top: tip.y}} role="tooltip">
                    <b>{label}</b>{keys ? <span style={{opacity: 0.65, marginLeft: 8}}>{shortcut(keys)}</span> : null}
                    {tooltip ? <div style={{marginTop: 3, opacity: 0.85}}>{tooltip}</div> : null}
                    {off && disabledReason ? <div style={{marginTop: 4, color: "#ffb86b"}}>{disabledReason}</div> : null}
                </div>
            ) : null}
        </span>
    );
};

const Divider = () => <div style={DIVIDER_STYLE} aria-hidden="true" />;

/**
 * @typedef {Object} MenuBarProps
 * @property {Function} load_show - function that loads the show
 * @property {boolean} hasShow - is a show open?
 */

/**
 * Toolbar, laid out like TheatreMix's:
 * file | undo | cue editing | assign | view | transport | console
 * @param {MenuBarProps} params
 */
const MenuBar = ({load_show, hasShow}) => {
    const popupRef = useRef(null);

    const [lockEditing, setLockEditing] = useState(false);
    const [showPositions, setShowPositions] = useState(false);
    const [editState, setEditState] = useState({canUndo: false, canRedo: false});

    // Save is grayed out when there's nothing to save
    const [canSave, setCanSave] = useState(false);

    /** @type {[{state: String, workspace?: String, message?: String}, Function]} */
    const [qlab, setQLab] = useState({state: 'off'});

    const [consoleStatus, setConsoleStatus] = useState({state: 'disconnected'});

    const handleOpenFile = async () => {
        // Access the API exposed by the preload script
        const path = await window.electronAPI.openFile();

        if (path) {
            load_show(path);
        }
    };

    const handleOpenSettings = () => {
        // Prevent duplicate windows if already open
        if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.focus();
            return;
        }

        // Open the new window via a targeted path matching your React routing
        popupRef.current = window.open(
            '#/popup',
            'PopupModal',
            'width=600,height=800' // Merged into overrideBrowserWindowOptions by Electron
        );
    }

    // Why a button is greyed out (shown in its tooltip)
    const noShow = "Open or create a show first.";
    const locked = !hasShow ? noShow : "Editing is locked: unlock it (padlock, ⌘L) to change the show.";

    // Toolbar buttons run the same commands as the app menu
    const trigger = (action) => () => window.menuApi.trigger(action);

    useEffect(() => {
        // File → Console Setup (⌘K) opens the same popup as the toolbar button
        const unsubscribeMenu = window.menuApi.onMenuAction((action) => {
            if (action === 'console-setup') {
                handleOpenSettings();
            }
        });

        // Keep the lock button in sync with View → Lock Editing
        const applyView = (view) => { setLockEditing(view.lockEditing); setShowPositions(!!view.showPositions); };
        const unsubscribeView = window.menuApi.onViewSettings(applyView);
        window.menuApi.getViewSettings().then(applyView);

        const unsubscribeEditState = window.showApi.onEditState(setEditState);
        window.showApi.getEditState().then(setEditState);

        const unsubscribeCanSave = window.showApi.onCanSave(setCanSave);
        window.showApi.canSave().then(setCanSave);

        // QLab connection light
        const unsubscribeQLab = window.qlabApi.onStatus(setQLab);
        window.qlabApi.getStatus().then(setQLab);

        // Console connection colors the Console Setup icon
        const unsubscribeConsole = window.presonus.onStatus(setConsoleStatus);
        window.presonus.getStatus().then(setConsoleStatus);

        return () => {
            unsubscribeMenu();
            unsubscribeView();
            unsubscribeEditState();
            unsubscribeQLab();
            unsubscribeCanSave();
            unsubscribeConsole();
        };
    }, []);

    return (
        <div style={TOOLBAR_STYLE} role="toolbar" aria-label="Show toolbar">
            <ToolbarButton label="New Show" keys="Mod+N" onClick={trigger('new-show')}
                tooltip="Start a blank show for the StudioLive and set up its channels."><NewShowIcon/></ToolbarButton>
            <ToolbarButton label="Open Show" keys="Mod+O" onClick={handleOpenFile}
                tooltip="Open a show (.tmixp, or a TheatreMix .tmix)."><OpenShowIcon/></ToolbarButton>
            <ToolbarButton label="Save Show" keys="Mod+S" onClick={() => window.showApi.save()} disabled={!hasShow || !canSave}
                tooltip="Save the show's changes." disabledReason={!hasShow ? noShow : "Nothing to save: no changes since it was saved."}><SaveShowIcon/></ToolbarButton>

            <Divider/>

            <ToolbarButton label="Undo" keys="Mod+Z" onClick={trigger('undo')} disabled={!hasShow || !editState.canUndo}
                tooltip="Take back the last change to the show." disabledReason={!hasShow ? noShow : "Nothing to undo."}><UndoIcon/></ToolbarButton>
            <ToolbarButton label="Redo" keys="Mod+Shift+Z" onClick={trigger('redo')} disabled={!hasShow || !editState.canRedo}
                tooltip="Put back the change you just undid." disabledReason={!hasShow ? noShow : "Nothing to redo."}><RedoIcon/></ToolbarButton>

            <Divider/>

            {/* Cue editing acts on the selected cue (editing has to be unlocked) */}
            <ToolbarButton label="Insert Cue" keys="Mod+M" onClick={trigger('insert-cue')} disabled={!hasShow || lockEditing}
                tooltip="Add an empty cue after the selected one, numbered halfway to the next." disabledReason={locked}><InsertCueIcon/></ToolbarButton>
            <ToolbarButton label="Clone Cue" keys="Mod+Alt+C" onClick={trigger('clone-cue')} disabled={!hasShow || lockEditing}
                tooltip="Copy the selected cue (its DCAs and all) to just after it." disabledReason={locked}><CloneCueIcon/></ToolbarButton>
            <ToolbarButton label="Delete Cue" keys="Mod+Backspace" onClick={trigger('delete-cue')} disabled={!hasShow || lockEditing}
                tooltip="Delete the selected cue(s). Undo brings them back." disabledReason={locked}><DeleteCueIcon/></ToolbarButton>

            <Divider/>

            <ToolbarButton label="Assign..." keys="Mod+E" onClick={trigger('assign')} disabled={!hasShow || lockEditing}
                tooltip="Set the selected DCA's channels, characters, positions, offsets, label and level." disabledReason={locked}><AssignIcon/></ToolbarButton>
            <ToolbarButton
                label="Store Channel Settings from Console"
                keys="Mod+Alt+S"
                onClick={trigger('store-settings')}
                disabled={!hasShow}
                disabledReason={noShow}
                tooltip="Store the gain / HPF / EQ / dynamics on the console now for the selected DCA's channels (or the selected cue's, or the running cue's), as the characters they play in that cue."
            >
                <StoreSettingsIcon/>
            </ToolbarButton>

            <Divider/>

            <ToolbarButton label="View Positions" keys="Mod+T" onClick={() => window.menuApi.setShowPositions(!showPositions)} disabled={!hasShow} toggled={hasShow && showPositions}
                tooltip={showPositions ? "Hide the position codes in the DCA cells." : "Show each DCA's position codes in its cell."} disabledReason={noShow}><PositionsColumnIcon/></ToolbarButton>
            <ToolbarButton
                label={lockEditing ? "Unlock Editing" : "Lock Editing"}
                keys="Mod+L"
                onClick={() => window.menuApi.setLockEditing(!lockEditing)}
                disabled={!hasShow}
                disabledReason={noShow}
                tooltip={lockEditing ? "Editing is locked, so the cue list can't be changed by accident. Click to edit." : "Lock the cue list against accidental edits during a show."}
                toggled={hasShow && lockEditing}
            >
                {lockEditing ? <LockIcon/> : <UnlockIcon/>}
            </ToolbarButton>

            <Divider/>

            <ToolbarButton label="Back" keys="Mod+B" onClick={trigger('back')} disabled={!hasShow}
                tooltip="Fire the previous cue (Ctrl+Space)." disabledReason={noShow}><BackIcon/></ToolbarButton>
            <ToolbarButton label="Go" keys="Mod+G" onClick={trigger('go')} disabled={!hasShow}
                tooltip="Fire the next cue (Space)." disabledReason={noShow}><GoIcon/></ToolbarButton>

            <Divider/>

            <ToolbarButton
                label="Console Setup"
                keys="Mod+K"
                onClick={handleOpenSettings}
                color={CONSOLE_COLORS[consoleStatus.state]}
                tooltip={console_tooltip(consoleStatus)}
            >
                <ConsoleSetupIcon/>
            </ToolbarButton>

            {/* Only shown when the show recalls QLab cues */}
            {qlab.state !== 'off' && (
                <span
                    style={{...QLAB_STATUS_STYLE, color: QLAB_COLORS[qlab.state] ?? QLAB_COLORS.connecting}}
                    title={qlab.state === 'connected'
                        ? `QLab connected: ${qlab.workspace}`
                        : `QLab disconnected${qlab.message ? `: ${qlab.message}` : ""}`}
                    role="status"
                    aria-label={qlab.state === 'connected' ? `QLab connected: ${qlab.workspace}` : "QLab disconnected"}
                >
                    <QLabStatusIcon/>
                </span>
            )}
        </div>
    );
}

export default MenuBar;
