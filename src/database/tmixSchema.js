// TheatreMix 3.5's show file tables, exactly as TheatreMix creates them (copied from a .tmix,
// including its own odd `ensembles` column definition), so a new show saved by this app opens
// in TheatreMix. This app's own tables (dcaLevels, consoleSetup) are added when saving.

const TMIX_SCHEMA = [
	"CREATE TABLE `config` (`param`\tTEXT,`value`\tTEXT,PRIMARY KEY(param))",
	"CREATE TABLE `cues` (`number`\tINTEGER NOT NULL DEFAULT 999,`point`\tINTEGER NOT NULL DEFAULT 0,`name`\tTEXT,`dca01Channels`\tTEXT,`dca02Channels`\tTEXT,`dca03Channels`\tTEXT,`dca04Channels`\tTEXT,`dca05Channels`\tTEXT,`dca06Channels`\tTEXT,`dca07Channels`\tTEXT,`dca08Channels`\tTEXT,`dca01Label`\tTEXT,`dca02Label`\tTEXT,`dca03Label`\tTEXT,`dca04Label`\tTEXT,`dca05Label`\tTEXT,`dca06Label`\tTEXT,`dca07Label`\tTEXT,`dca08Label`\tTEXT,`channelPositions`\tTEXT,`channelProfiles`\tTEXT,`fxMutes`\tTEXT, `channelFX` TEXT, `snippets` TEXT, `qLabCue` TEXT, `channelLevels` TEXT, `scenes` TEXT, `colour` INTEGER, `scenePoints` TEXT, `dca09Channels` TEXT, `dca09Label` TEXT, `dca10Channels` TEXT, `dca10Label` TEXT, `dca11Channels` TEXT, `dca11Label` TEXT, `dca12Channels` TEXT, `dca12Label` TEXT, `skip` INTEGER DEFAULT 0)",
	"CREATE TABLE `positions` (`id`\tINTEGER PRIMARY KEY AUTOINCREMENT,`name`\tTEXT,`shortName`\tTEXT,`delay`\tNUMERIC,`pan`\tNUMERIC, `buses` TEXT)",
	"CREATE TABLE `profiles` (`id`\tINTEGER PRIMARY KEY AUTOINCREMENT,`channel`\tINTEGER,`name`\tTEXT,`label`\tTEXT,`default`\tINTEGER DEFAULT 0,`data`\tTEXT)",
	"CREATE TABLE `ensembles` (`id`\tINTEGER PRIMARY KEY AUTOINCREMENT,`name`\tTEXT,`channels`\tTEXT`channelProfiles`\tTEXT, `channelProfiles` TEXT)",
	"CREATE TABLE `snippetCache` (`snippet`\tINTEGER PRIMARY KEY,`name`\tTEXT)",
	"CREATE TABLE `fxCache` (`fx`\tINTEGER PRIMARY KEY,`name`\tTEXT)",
	"CREATE TABLE `sceneCache` (`scene`\tINTEGER PRIMARY KEY,`point`  INTEGER DEFAULT 0,`name`\tTEXT)",
	"CREATE TABLE `actors` (`id`\tINTEGER PRIMARY KEY AUTOINCREMENT,`channel`\tINTEGER,`name`\tTEXT,`order`\tINTEGER DEFAULT 0,`active`\tINTEGER DEFAULT 0)",
	"CREATE TABLE `actorProfiles` (`actor`\tINTEGER,`profile`\tINTEGER,`data`\tTEXT)",
	"CREATE TABLE `actorGroups` (`id`\tINTEGER PRIMARY KEY AUTOINCREMENT,`name`\tTEXT,`data`\tTEXT)",
	"CREATE UNIQUE INDEX `cueID` ON `cues` (`number`, `point`)",
	"CREATE UNIQUE INDEX `actorProfileID` ON `actorProfiles` (`actor`, `profile`)",
];

// A StudioLive 32's input channels and DCAs
const NEW_SHOW_CHANNELS = 32;
const NEW_SHOW_DCAS = 8;

/**
 * The settings a new show starts with: exactly what TheatreMix 3.5 writes for a new show (it
 * won't open a show missing any of them), except that this app's StudioLive has 32 channels, and
 * actor names in checks cues and the "in the current cue" highlight start on.
 * targetConsole stays "X32": TheatreMix only opens shows for consoles it knows.
 * @param {String} designer
 */
const newShowConfig = (designer = "") => ({
	targetConsole: "X32", designer, venue: "",
	dcas: Array.from({length: NEW_SHOW_DCAS}, (_, i) => i + 1).join(","),
	channels: Array.from({length: NEW_SHOW_CHANNELS}, (_, i) => i + 1).join(","),
	backupChannels: "", fxAssigns: "", fxMutes: "", defaultFX: "-1", snippetRecall: "0",
	fxBusMap: "1=13,2=14,3=15,4=16", buttonMap: "0=12,1=11", muteButtonMap: "", muteButtonAssignKeys: "",
	profileSchemaVersion: "2", qLabCues: "0", consoleModel: "", consoleVersion: "", consoleIP: "", consoleMAC: "",
	autoConnect: "0", enableChannelMonitoring: "1", gangLR: "0", gangLRChannels: "", gangLRName: "", gangLRColour: "",
	activeChannelHighlight: "1", cueZeroSnippets: "", minVersion: "3.0", spareBackup: "0", labelLR: "0",
	labelTargetBus: "1000", consoleMuteDCAUnassign: "1", qLabPasscode: "", suppressDCAMuteBackupSwitch: "0",
	channelLevels: "0", cueZeroResetLevels: "0", sceneRecall: "0", cueZeroScenes: "", dimDCAFaders: "0",
	qLabSuppressBack: "0", qlclDyn1: "0", cueZeroScenePoints: "", dimDCAFadersSuppressColours: "0", selectOnSpill: "1",
	cueZeroActorLabels: "1", dawRemote: "0", dawIP: "127.0.0.1", dawPreRoll: "0",
});

export { TMIX_SCHEMA, NEW_SHOW_CHANNELS, NEW_SHOW_DCAS, newShowConfig };
