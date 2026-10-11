import Actor from '../models/Actor';
import ActorGroup from '../models/ActorGroup';
import ActorProfile from '../models/ActorProfile';
import Position from '../models/Position';
import Cue from '../models/Cue';
import Ensemble from '../models/Ensemble';
import ShowFile from '../models/ShowFile';
import Profile from '../models/Profile';
import Config from '../models/Config';

import { dca_level_key } from '../utils/dca_levels';

class ShowRepository {

    constructor(database) {
        this.db = database;
    }

    load() {

        const show = new ShowFile();;

        show.actors = this.db.all('SELECT * FROM actors').map(x => new Actor(x));

        show.actorGroups = this.db.all('SELECT * FROM actorGroups').map(x => new ActorGroup(x));

        show.actorProfiles = this.db.all('SELECT * FROM actorProfiles').map(x => new ActorProfile(x));

        show.positions = this.db.all('SELECT * FROM positions').map(x => new Position(x));

        show.profiles = this.db.all('SELECT * FROM profiles').map(x => new Profile(x));

        show.ensembles = this.db.all('SELECT * FROM ensembles').map(x => new Ensemble(x));

        show.cues = this.db.all('SELECT * FROM cues').map(x => new Cue(x));

        const configRows = this.db.all('SELECT * FROM config').map(x => new Config(x));

        show.config = Object.fromEntries(
            configRows.map(row => [
                row.param,
                row.value
            ])
        );

        show.dcaLevels = this.loadDcaLevels();

        show.consoleSetup = this.loadConsoleSetup();

        show.channelSettings = this.loadChannelSettings();

        return show;
    }

    /**
     * Load per-cue DCA levels (only present in .tmixp files)
     * @returns {Object} { "number.point": { dca: level } }
     */
    loadDcaLevels() {

        const exists = this.db.get(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dcaLevels'"
        );

        if (!exists) {
            return {};
        }

        const levels = {};

        for (const row of this.db.all('SELECT number, point, dca, level FROM dcaLevels')) {
            const key = dca_level_key(row.number, row.point);

            levels[key] = levels[key] ?? {};
            levels[key][row.dca] = row.level;
        }

        return levels;
    }

    /**
     * Load StudioLive console setup (only present in .tmixp files).
     * Kept apart from TheatreMix's config so merging a .tmix doesn't overwrite it.
     * @returns {Object<string, string>} e.g. { muteButtonMap: "0=6,1=5" }
     */
    loadConsoleSetup() {

        const exists = this.db.get(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'consoleSetup'"
        );

        if (!exists) {
            return {};
        }

        return Object.fromEntries(
            this.db.all('SELECT param, value FROM consoleSetup').map((row) => [row.param, row.value ?? ""])
        );
    }

    /**
     * Load stored StudioLive channel settings (only present in .tmixp files)
     * @returns {{owner: String, section: String, data: String}[]}
     */
    loadChannelSettings() {

        const exists = this.db.get(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'channelSettings'"
        );

        return exists ? this.db.all('SELECT owner, section, data FROM channelSettings') : [];
    }

    /**
     * Replace the stored StudioLive channel settings (profiles' / actors' gain, HPF, EQ, dynamics)
     * @param {{owner: String, section: String, data: String}[]} rows
     */
    saveChannelSettings(rows) {

        const save = this.db.transaction(() => {

            this.db.run(`
                CREATE TABLE IF NOT EXISTS channelSettings (
                    owner   TEXT NOT NULL,
                    section TEXT NOT NULL,
                    data    TEXT,
                    PRIMARY KEY (owner, section)
                )
            `);

            this.db.run('DELETE FROM channelSettings');

            for (const row of rows ?? []) {
                this.db.run('INSERT INTO channelSettings (owner, section, data) VALUES (?, ?, ?)', [row.owner, row.section, row.data]);
            }
        });

        save();
    }

    /**
     * Replace the StudioLive console setup
     * @param {Object<string, string>} setup 
     */
    saveConsoleSetup(setup) {

        const save = this.db.transaction(() => {

            this.db.run(`
                CREATE TABLE IF NOT EXISTS consoleSetup (
                    param   TEXT PRIMARY KEY,
                    value   TEXT
                )
            `);

            this.db.run('DELETE FROM consoleSetup');

            for (const [param, value] of Object.entries(setup ?? {})) {
                this.db.run('INSERT INTO consoleSetup (param, value) VALUES (?, ?)', [param, value]);
            }
        });

        save();
    }

    /**
     * Replace all per-cue DCA levels
     * @param {Object} levels { "number.point": { dca: level } }
     */
    saveDcaLevels(levels) {

        const save = this.db.transaction(() => {

            this.db.run(`
                CREATE TABLE IF NOT EXISTS dcaLevels (
                    number  INTEGER NOT NULL,
                    point   INTEGER NOT NULL,
                    dca     INTEGER NOT NULL,
                    level   REAL    NOT NULL,
                    PRIMARY KEY (number, point, dca)
                )
            `);

            this.db.run('DELETE FROM dcaLevels');

            const stmt =
                this.db.db.prepare(
                    'INSERT INTO dcaLevels (number, point, dca, level) VALUES (?, ?, ?, ?)'
                );

            for (const [key, dcas] of Object.entries(levels)) {

                const [number, point] = key.split('.').map(Number);

                for (const [dca, level] of Object.entries(dcas)) {
                    stmt.run(number, point, Number(dca), level);
                }
            }
        });

        save();
    }

    /**
     * Write every TheatreMix table the editor changes. Each row only gets the table's own
     * columns (so rows from older / newer TheatreMix versions still fit).
     * @param {ShowFile} show
     */
    saveShowTables(show) {

        const save = this.db.transaction(() => {

            this.addDcaColumns(show);

            for (const [table, rows] of Object.entries({
                cues: show.cues,
                profiles: show.profiles,
                ensembles: show.ensembles,
                positions: show.positions,
                actors: show.actors,
                actorGroups: show.actorGroups,
                actorProfiles: show.actorProfiles,
            })) {
                this.replaceRows(table, rows ?? []);
            }

            this.replaceRows('config', Object.entries(show.config ?? {}).map(([param, value]) => ({param, value})));
        });

        save();
    }

    /**
     * TheatreMix's cues table has 12 DCAs; a show using the StudioLive's other DCAs (13-24) gets
     * their columns added (TheatreMix ignores them)
     * @param {ShowFile} show
     */
    addDcaColumns(show) {

        const columns = new Set(this.db.all('PRAGMA table_info("cues")').map((c) => c.name));
        for (let dca = 13; dca <= 24; dca++) {
            for (const kind of ['Channels', 'Label']) {
                const name = `dca${dca}${kind}`;
                const used = show.cues.some((cue) => cue[name] !== undefined && cue[name] !== null && cue[name] !== "");
                if (used && !columns.has(name)) this.db.run(`ALTER TABLE cues ADD COLUMN "${name}" TEXT`);
            }
        }
    }

    /**
     * Replace a table's rows
     * @param {String} table
     * @param {Object[]} rows
     */
    replaceRows(table, rows) {

        const columns = this.db.all(`PRAGMA table_info("${table}")`).map((c) => c.name);
        if (!columns.length) return;

        this.db.run(`DELETE FROM "${table}"`);

        const stmt = this.db.db.prepare(
            `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`
        );

        for (const row of rows) {
            stmt.run(columns.map((c) => {
                const v = row[c];
                if (v === undefined) return null;
                if (typeof v === 'boolean') return v ? 1 : 0;
                return v;
            }));
        }
    }

    saveConfig(show) {

        const save = this.db.transaction(() => {

            this.db.run('DELETE FROM config');

            Object.entries(show.config)
                .forEach(([param, value]) => {

                    this.db.run(
                        'INSERT INTO config(param,value) VALUES (?,?)',
                        [param, value]
                    );
                });
        });

        save();
    }

    saveActors(show) {

        const save = this.db.transaction(() => {

            this.db.run('DELETE FROM actors');

            const stmt =
                this.db.db.prepare(`
                    INSERT INTO actors
                    (
                        id,
                        channel,
                        name,
                        "order",
                        active
                    )
                    VALUES (?, ?, ?, ?, ?)
                `);

            for (const actor of show.actors) {

                stmt.run(
                    actor.id,
                    actor.channel,
                    actor.name,
                    actor.order,
                    actor.active
                );
            }
        });

        save();
    }

    saveCues(show) {

        const tx = this.db.transaction(() => {

            this.db.run('DELETE FROM cues');

            const columns =
                Object.keys(show.cues[0] || {});

            if (!columns.length) {
                return;
            }

            const placeholders =
                columns.map(() => '?').join(',');

            const sql =
                `
                INSERT INTO cues
                (${columns.join(',')})
                VALUES
                (${placeholders})
                `;

            const stmt =
                this.db.db.prepare(sql);

            for (const cue of show.cues) {

                stmt.run(
                    columns.map(c => cue[c])
                );
            }
        });

        tx();
    }
}

export default ShowRepository;