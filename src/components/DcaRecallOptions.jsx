import React from 'react';

import { BOX_STYLE, BOX_TITLE_STYLE } from './MuteGroupButtons.jsx';

// Console Setup → DCA Recall: how DCA levels are recalled when cues change.

const OPTION_STYLE = {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    cursor: "pointer",
};

const NOTE_STYLE = {fontSize: 12, opacity: 0.7, marginTop: "2px"};

const OPTIONS = [
    {
        key: 'levelsFollowPeople',
        label: "Levels follow people",
        note: "When someone moves to a different DCA, it comes up at the level their old DCA was at. Off: a DCA only moves when a level is set for the cue.",
    },
    {
        key: 'restoreOnBack',
        label: "Back restores DCAs",
        note: "Going Back into a cue puts its DCA faders and mutes back as they were when you left it. Off: Back fires the cue like Go.",
    },
];

// Console Setup → Cue Display: the current and next cue shown on the console
const DISPLAY_OPTIONS = [
    {
        key: 'cueOnScenesScreen',
        label: "Cues on the Scenes screen",
        note: "The console's Scenes screen shows the current cue as Current Project and the next one as Current Scene.",
    },
    {
        key: 'cueOnSpareDcas',
        label: "Cues on spare DCAs",
        note: "The two DCAs after the show's (9 and 10 for DCAs 1-8) show the current cue (>1.1) and the next one (^1.2). Only their names and colors change.",
    },
];

/**
 * @param {{values: {levelsFollowPeople: boolean, restoreOnBack: boolean, cueOnScenesScreen: boolean, cueOnSpareDcas: boolean} | null, onChange: Function}} props
 */
const DcaRecallOptions = ({values, onChange}) => (
    <>
        <OptionBox title="DCA Recall" options={OPTIONS} values={values} onChange={onChange}/>
        <OptionBox title="Cue Display" options={DISPLAY_OPTIONS} values={values} onChange={onChange}>
            <label style={{display: "flex", alignItems: "center", gap: "10px", marginTop: "10px", fontSize: 13}}>
                <span style={{fontWeight: 600}}>Main fader label</span>
                <select
                    value={values?.cueOnMain ?? 'off'}
                    disabled={values === null}
                    onChange={(e) => onChange({...values, cueOnMain: e.target.value})}
                    aria-label="Main fader label"
                >
                    <option value="off">Main (unchanged)</option>
                    <option value="current">Current cue</option>
                    <option value="next">Next cue</option>
                </select>
                <span style={NOTE_STYLE}>The main fader's scribble strip shows the cue instead of "Main".</span>
            </label>
        </OptionBox>
    </>
);

/**
 * A titled box of on/off options, two to a row
 * @param {{title: String, options: {key: String, label: String, note: String}[], values: Object | null, onChange: Function}} props
 */
const OptionBox = ({title, options, values, onChange, children}) => (
    <div style={BOX_STYLE}>
        <div style={BOX_TITLE_STYLE}>{title}</div>

        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px"}}>
            {options.map(({key, label, note}) => (
                <label key={key} style={OPTION_STYLE}>
                    <input
                        type="checkbox"
                        checked={values?.[key] ?? true}
                        disabled={values === null}
                        onChange={(e) => onChange({...values, [key]: e.target.checked})}
                        style={{marginTop: "3px"}}
                    />
                    <span>
                        <div style={{fontSize: 13, fontWeight: 600}}>{label}</div>
                        <div style={NOTE_STYLE}>{note}</div>
                    </span>
                </label>
            ))}
        </div>
        {children}
    </div>
);

export default DcaRecallOptions;
