import Cue from '../../models/Cue.js';
import ShowFile from '../../models/ShowFile.js';
import { dca_field, parse_channels, parse_map, default_profile } from '../../utils/show_edits.js';

/**
 * The label a DCA shows when none is set: its channel's profile in this cue (or its default
 * profile), by label, else name. Like TheatreMix, a DCA with several channels is "Group".
 * @param {ShowFile} show
 * @param {Cue} cue
 * @param {Number} dca_number
 * @returns {String} label, or "" if the DCA has no channels
 */
const get_auto_label = (show, cue, dca_number) => {
    const channels = parse_channels(cue[dca_field(dca_number, 'Channels')]);
    const [first] = channels;
    if (first === undefined) return "";
    if (channels.length > 1) return "Group";

    const profile_id = parse_map(cue.channelProfiles).get(first);
    const profile = (profile_id !== undefined && show.profiles.find((p) => String(p.id) === profile_id))
        || default_profile(show, first);

    return profile?.label || profile?.name || `Ch ${first}`;
}

/**
 * Get DCA Label: the label set for the DCA in this cue, else its channel's profile ("Group" for several).
 * An empty DCA with no label is "-" (what the console shows).
 * @param {ShowFile} show
 * @param {Cue} cue
 * @param {Integer} dca_number
 * @returns {String} label
 */
const get_DCA_label = (show, cue, dca_number) => {

    if (show == null || cue == null) {
        return "";
    }

    const label = cue[dca_field(dca_number, 'Label')];

    if (label !== null && label !== undefined && label !== "") {
        // Use specified label
        return label;
    }

    return get_auto_label(show, cue, dca_number) || "-";
}

export {get_DCA_label, get_auto_label};
