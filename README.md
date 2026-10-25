# Presonus Theatre Mix
**Created By:** Max Miller

This repository is a Node.js based implementation of [TheatreMix](https://www.theatremix.com) created by James Holt. It takes in a TheatreMix file (.tmix) and allows using some features that TheatreMix supports on other consoles.

This software was developed due to the lack of support for PreSonus StudioLive consoles in TheatreMix. It is not intended to infringed on any intellectual property of Mixing Technology Pty Ltd, and still requires using the original TheatreMix app to program, this app simply translates the TheatreMix file into something the StudioLive consoles respond to.

The app uses Electron.js alongside React.js. The presonus interface is based off of @featherbear's [presonus-studiolive-api](https://github.com/featherbear/presonus-studiolive-api)

## Usage
First Install Homebrew (You have already done this)

You **CAN** copy and paste these commands

### INSTALL
### INSTALL dmg
Download the newest version from the [release tab](https://github.com/maxdangermiller/PresonusTheatreMix/releases), then open the .dmg file

From there, type in the following command but **DO NOT PRESS ENTER**. Once you have typed this, then drag the installed application from the Applications/ folder into the terminal, THEN press enter.
```bash
xattr -rd com.apple.quarantine 
```


### INSTALL Source
Starting in a new terminal, run the following commands to setup on device compilation:

```bash
brew install git
brew install node@22
cd Desktop/
mkdir PresonusTheatreMix
cd PresonusTheatreMix/
git clone https://github.com/maxdangermiller/PresonusTheatreMix.git
cd PresonusTheatreMix/
npm install
npm start
```

### UPDATE
Starting in a **new terminal**, run the following commands to update the code:

```bash
cd Desktop/PresonusTheatreMix/PresonusTheatreMix/
rm -rf node_modules package-lock.json
npm cache clean --force
git pull origin
npm install 
npm start
```

## PATCHES
**Run this to save changes made to the api**
```bash
npx patch-package @featherbear/presonus-studiolive-api
```

## Behringer X32 / Midas M32
The app also runs a Behringer X32 (or Midas M32) over its OSC remote protocol (UDP port 10023). Console Setup finds X32s on the network along with StudioLives (they're listed with their model, e.g. "X32"), and **Connect automatically** reconnects to whichever was used last.

Everything works the same as on a StudioLive: DCA assignments, names and colors (the nearest of the X32's eight colors; dim colors use the inverted version), DCA levels and mutes, line faders and offsets, muting lines not on a DCA, backup channels (a DCA's mute button), mute group buttons as Go / Back (the X32 has 6 mute groups), channel monitoring from the input meters, and the main fader's label for the current / next cue. The X32's 8 DCAs are all the show's, so there are no spare DCAs for the cue display, and it has no Scenes-screen title or User Layer.

Names are cut to the X32's 12 characters. Faders are converted through dB between the two consoles' fader laws, so a level in the show means the same dB on either.

**Stored channel settings** are kept in the same units as on a StudioLive, so they work on either console: preamp gain (the channel's own local input, `headamp` = channel − 1), HPF (X32 range 20–400 Hz), EQ on, the four bands' type (shelf / peaking), frequency, gain and Q, compressor on and threshold, gate on and threshold. The X32 has nothing to match the StudioLive's digital gain, EQ band on/off, compressor ratio / attack / release / knee, or limiter, so those aren't stored or sent on an X32. Values outside the other console's range are clamped (e.g. an X32 EQ Q of 5 is stored as the StudioLive's maximum, 4).

**Testing without an X32**, two ways:
- **The full X32 emulator, with X32-Edit** (best): Patrick-Gilles Maillot's emulator knows every X32 parameter, and Behringer's X32-Edit (and M32-Edit) connect to it, so you can watch the app drive the "console" live.
  1. Build it once: `sim/build_x32_emulator.sh` (downloads its source into `sim/x32-emulator/`, which git ignores, and builds it; it reports firmware 4.13 because X32-Edit 4.4 won't connect to an older one).
  2. Run it on this Mac's network address (not 127.0.0.1: it tells X32-Edit its address, and X32-Edit connects to that): `cd sim/x32-emulator && ./X32 -i 192.168.1.40` (use your Mac's IP; System Settings → Network). It saves its state to `.X32res.rc` when sent `/shutdown`.
  3. X32-Edit → Setup → Connection: type the IP, **Manual IP**, pick "X32 Emulator", **Connect** (Sync Direction: Mixer → PC). macOS asks to let X32-Edit find devices on the local network the first time: Allow.
  4. In this app's Console Setup the emulator shows up as "X32 Emulator"; connect. Fire cues and watch X32-Edit (its **1-16 DCA** view shows the DCA names, levels and mutes). Pressing mute group 6 in X32-Edit is Go.

  Seen with the emulator: X32-Edit leaves its channel strips' name row blank (the names are there: its Channel view and the DCA strips show them), and its mute group button can stay lit after the app turns the group back off (the next press still works).
- **The small simulator** (no build, scriptable): `python3 sim/x32_sim.py` pretends to be one on 127.0.0.1:10023 (connect to it from the app; `--bind 0.0.0.0` makes Console Setup's scan find it). Type `press 6` (mute group 6's button), `fader dca1 -10`, `mute 3`, `signal 3 -20` (a mic with signal, for channel monitoring), `dca`, `names` or `get /ch/01/eq/1/g`. It only knows the parameters the app uses.

## Console Go / Back buttons
Two of the console's **mute group** buttons can be used as Go and Back, like TheatreMix's "Mute Group Buttons".

**Setup**
1. Open the show and connect to the console (**File → Console Setup**, ⌘K).
2. In **Mute Group Buttons (StudioLive)**, pick **Go** for one mute group and **Back** for another. Each box shows the console's name for the group and whether it's **Empty**. Use empty groups: a group with channels in it shows a ⚠ warning, because pressing it will also mute those channels.
3. Press the buttons on the console to test them: the box lights up green when it fires Go/Back (blue if the button isn't mapped).
4. Click **OK** (or **Apply**), then save the show (⌘S). The buttons are stored in the `.tmixp`, so merging an updated `.tmix` won't change them.

If a show has no StudioLive buttons set yet, it uses the ones from TheatreMix (**Console Setup → Mute Group Buttons**), e.g. the Lion King show's mute group 6 = Go, 5 = Back. Once you set them here, this app's setting is used instead.

**If the buttons don't work**
1. **Help → Console Buttons...** shows what the show has mapped, whether those mute groups are empty, and how many presses have been seen.
2. Turn on **Help → Log All Console Messages**, press the buttons, then turn it off again.
3. **Help → Show Debug Log** opens the log file (`~/Library/Logs/Presonus TheatreMix/debug.log`). Lines tagged `[BUTTONS]` show every mute group change, and `[CONSOLE]` shows every message from the console while logging all messages. Send this file in for help.


## Testing with the console simulator
`sim/studiolive_sim.py` pretends to be the StudioLive 32. It's accurate enough that **Universal Control** finds it, opens the full mixer, and shows changes live, so the app can be tested without the real console.

1. Give your Mac the console's address on loopback (once per boot): `sudo ifconfig lo0 alias 169.254.4.171`
2. Start the simulator with the console's real state:
   ```bash
   python3 sim/studiolive_sim.py --bind-ip 169.254.4.171 --broadcast-addr 127.0.0.1 --state-file state.json --meter-hz 20
   ```
   `--broadcast-addr 127.0.0.1` keeps its announcements on this Mac (without it they go out on your network). `--meter-hz 20` sends meter data like the real console, which channel monitoring needs.
3. Open Universal Control and/or this app. Both find "StudioLive 32 Hayden" through discovery. Start the simulator **before** Universal Control; it only looks for consoles when it opens.

   If Universal Control shows **No Devices available**: it silently ignores a console whose serial number it has seen before with a different device ID. The simulator uses the real console's ID for its serial (`KNOWN_GUIDS` in `sim/studiolive_sim.py`); a different `--serial` needs a matching `--guid`, or a made-up serial. After a Mac restart the loopback alias from step 1 is gone, so either add it again or run the simulator with `--bind-ip 127.0.0.1` (no alias needed; connect to 127.0.0.1).
4. Type commands into the simulator to act like the console, e.g. `press 6` (press mute group 6's button the way the real console does; an empty group only sends "off"), `set line/ch1/mute 1`, `name line/ch2/username Nala`, `dca` (show DCAs), `signal 3 -20` / `signal 3 off` / `signal all off` (a mic with / without signal), `kick` (drop connections, like a network blip), `help`.

   Log messages print above the line you're typing, so a busy log doesn't break up a command. **Up/Down** go through earlier commands, **Ctrl-U** clears the line, **Ctrl-C** quits. Enter works even if the terminal was left in a bad state (Enter showing as `^M`), and the simulator leaves the terminal working when it exits.

### Real audio on the lines
The simulator can play a recording on each line, so the meters (and the app's channel colors) behave like real mics: pauses between lines, loud peaks, a mic that goes quiet. Put one audio file per line in a folder (m4a, wav, mp3, aiff…; decoded with `ffmpeg` if it's installed, otherwise macOS's `afconvert`) and either start the simulator with `--audio <folder>` or type `play <folder>` once it's running. Needs `--meter-hz 20`.

A file with **music** or **tape** in its name plays on **Tape In** (the console's stereo 2-track input) instead of a line, so the show's music feed comes in the way it does live: on Tape In's meters, and into the main mix through Tape In's fader, mute, balance and DCAs. Every other file goes to the line whose **channel number** is in its name (`01.m4a`, `ch3.m4a`, `Track 12.m4a`, `12 Otis King.m4a`), or else the line with that **name** (`Otis King.m4a`). Names are matched against what's on the console when you type `play`, so to match actors' names, run `play` after the app has connected (Line Checks puts their names on the lines); numbers always work. All the tracks run in sync from the top and loop when the longest ends, and starting a new one restarts them all together. The meters move before the fader and mute, like the real console's input meters. To hear the show, turn on **listen** (below). The levels show on Universal Control's channel meters and drive the app's line colors.

| Command | |
|---|---|
| `play <folder> [gain]` | Play every track in a folder (optional gain in dB for all of them) |
| `play <file> <ch> [gain]` | Play one file on a channel, e.g. `play ~/Desktop/nala.m4a 9 -6`; `tape` for Tape In |
| `tracks` | What's playing, on which lines, and the position |
| `pause` / `resume` / `seek <s or m:ss>` | Move around in the recordings |
| `+30` / `-1:00` (or `seek +30`) | Skip forward / back from where playback is |
| **←/→**, **Shift-←/→**, **Space** | On an empty prompt line: skip back / forward 10 s, 1 minute, pause / resume |
| `loop <start> <end>` / `loop off` | Play (and loop) just part of the recordings, e.g. `loop 0 25:59`. `play` warns when tracks turn into constant full-scale noise part way through (a recording fault) and suggests a loop that stops before it |
| `gain <ch\|all> <dB>` | Turn a track up or down. Recordings made with lots of headroom barely move the meters; `play` lists each track's peak and suggests a gain when they're quiet |
| `stop [ch]` | Stop one line's track, or all of them |
| `listen on` / `listen off` | Play the main mix out of this computer's default audio output (or start with `--listen`) |
| `listen` / `listen volume <dB>` | What's audible in the main mix / turn down what you hear without touching the console |

**Hearing the main mix:** `listen on` mixes the tracks the way the console builds its main (LR) mix and plays it through your Mac's default output: each line's fader, mute, pan and main assign, the DCAs it's in (a DCA's fader adds its level, a muted DCA mutes it), mute groups that are on, and the main fader. So firing cues in the app, or moving faders in Universal Control, is heard straight away. A track's `gain` applies too, like a mic's preamp. Needs `ffplay`, which comes with ffmpeg (`brew install ffmpeg`).

While tracks are loaded, the prompt shows where playback is, e.g. `▶ 15:02.4 ━━━━━━━━━━────── 25:59.9 >` (⏸ when paused; the bar covers the `loop` if one is set).

Big files take a while to load (19 tracks of 50 minutes is about 45 seconds); the prompt keeps working meanwhile. The app recolors lines about once a second while tracks play, so the simulator only prints line color changes with `-v`.

## Channel monitoring
Like TheatreMix, the show's channels are colored on the console from the meters: **red** when nearly clipping (−3 dBFS or louder; faulty cable or connector), held for 10 seconds after the last peak so it can be checked; **blue** after 3 seconds below −60 dBFS (mic off, flat battery, out of range); **white** when there's signal; **yellow** when there's signal and the channel is in the current cue's DCAs. Settings are at the top of `src/main/channelMonitor.js`. Lines tagged `[METERS]` in the debug log show every color change and each meter group the first time the console sends it. The console leaves silent channels and groups out of its meter frames, so a channel that's missing from them counts as silent.

## Connecting automatically
With **Connect automatically on launch** checked in **Console Setup** (on by default), the app looks for the last console it connected to when it starts, and connects if it's found within 10 seconds (it matches by serial number, so a new IP address is fine). If it isn't found, the status says so and you can connect by hand as usual.

Whenever the app connects, it fires the active cue so the console matches the show: usually that's **Line Checks**, so the actors' real names go on the lines and every DCA is cleared. Opening a show while connected does the same. Lines tagged `[AUTOCONNECT]` and `[CONNECT]` in the debug log show what happened.

## DCA colors
Like TheatreMix's DCA color coding, each assigned DCA's scribble strip shows what happens to it in the **next** cue. An unassigned DCA is always black, muted and pulled down to −∞, so it's obvious it's empty.

| Color | Next cue | Press Go when |
|---|---|---|
| White | the DCA's channels change | its fader is down |
| Green | exactly the same | any time |
| Cyan | same channels, one changes position | the actor isn't speaking |
| Orange | same channels, one changes FX | the actor isn't speaking |
| Yellow | same channels, one changes profile | the actor isn't speaking |
| Magenta | channels move between ensemble (multi-channel) DCAs | all magenta DCAs are at the same level |
| Black | nothing assigned to it (whatever the next cue does) | |

With the show's **Dim DCA Faders** setting on, a DCA whose fader is at −∞ is dimmed (dim blue if "suppress colors" is also on, otherwise a darker version of its color), and changes back as soon as the fader comes up. Skipped cues are ignored when working out the next cue; after Line Checks the next cue is the first cue. Lines tagged `[DCACOLOR]` in the debug log show each color change and why.

## Cues from the script
**File → Import Script…** reads the show's script (a PDF) and programs the cues for line-by-line mixing, using the show's own mic plot. It reads both usual script layouts:
- **Name above the line** (MTI, Broadway Junior, most musicals): each character's name in capitals, centered, with what they say under it; "(NATHAN)" at the top of a page carries the speaker on.
- **Name before the line** (Samuel French and older typed scripts): "MISS STRICT: Attention, students…", and "TOFFEE:" with the lyrics under it.

In both it finds scene headings ("SCENE FIVE: THE PRIDELANDS", "ACT I, Scene ii: Mission"), song cues ("(#6 – OUR LITTLE SECRET.)", "#3 - Follow the Fold"), entrances and exits, and singers. Lines in capitals are sung. Running heads, page numbers and notes in the margins (lighting or sound cues written on the script: "Q5.4", "Spot 1: Sarah", "LIGHT CUE") are left out, so a marked-up lighting script works too. A script that doesn't mark its songs gets them found from the singing (a run of sung lines after dialogue, named from its first lyric).

**Scanned scripts** (pages that are pictures, or text that comes out as junk) are read with text recognition, on any computer; the import window shows the progress, and what it reads is kept, so the script opens straight away after that.
- **On a Mac** it uses the Mac's own text recognition (about 3 pages a second on an M-series Mac). The reader (`native/script-ocr`) is built by `npm start` / `npm run package` / `npm run make` with Xcode's command line tools (`xcode-select --install`) and goes in the app's resources.
- **Anywhere else** (Windows, Linux, or a Mac without that reader) it uses [Tesseract](https://github.com/naptha/tesseract.js), which runs inside the app with its English data bundled, so it works offline (about 2 pages a second on the same Mac: a 144-page script took about a minute). `npm start` / `package` / `make` copy it from `node_modules` into `public/tesseract/`. It also reads white-on-black headings (song titles on a dark bar), which plain Tesseract skips.

Text recognition can misread a name ("MISS STICT"): match it in Who's who like any other. For testing, `localStorage.setItem('scriptOcr', 'tesseract')` in the window's developer tools makes a Mac use Tesseract too.

1. **Choose Script PDF…** The dialog shows what it found (pages, scenes, songs, lines).
2. **Who's who:** every name in the script, most lines first, matched to what's in **Show Setup**: a character (profile) or one of your ensembles. Nothing is made up: plurals like RAFIKIS and HYENAS match your ensembles of those names, "MUFASA'S VOICE" is Mufasa, and ENSEMBLE / ALL are **Company**: the Show Setup ensembles that cover everyone (e.g. Male + Female, a DCA each). Names left on **Choose…** are skipped (they're listed). The matches are saved with the show.
3. **Options:** the **Layout** (below), a cue for each song, and **Replace the cue list** (else the cues go after the last one). The preview shows every cue with its DCAs and page.
4. **Make Cues** (Undo takes them all back).

How it's programmed (typewriter style, the way line-by-line mixing is laid out):
- In each scene or song, the first person to speak is on DCA 1, the next new voice on DCA 2, and so on left to right, so your hand walks along the faders with the dialogue. Someone who speaks again keeps their DCA.
- **Prepping:** a song or scene cue already holds the first people who speak in it. When the DCAs run out, the next cue fires on the last line before it: whoever is talking keeps their DCA, untouched, and DCA 1 onward are loaded with the next people to speak, so they're ready before their lines.
- **Pacing:** cues come at songs, scenes, entrances and exits (in dialogue, not in the middle of songs), when the singing ends and dialogue starts, and when the DCAs run out. A cue that wouldn't change anything is left out.
- **Layout → Principal bank** (instead of typewriter), like Broadway's principal faders: the characters with the most lines (at least 3) each keep their own DCA for the whole show, most lines on DCA 1, so muscle memory always finds the same person in the same place. The import window lists who's where. Everyone else takes the DCAs left over (at least two are kept for them), and borrows a principal's DCA only while that principal isn't in the scene.
- A person in an ensemble that's up is pulled out onto their own DCA; an ensemble takes the people who aren't up already.
- Numbered like a TheatreMix show: songs are whole numbers (song #7 is cue 7) and the cues after a song .1, .2 … (.01, .02 … when there are more than nine). Cue text follows the script: the song, the scene, "Mufasa Exits / Young Nala Enters", "Dialogue: Rafiki 3".

**View → Script** (⌘P) shows the script beside the cue list (drag its edge to resize), with every cue's number in the margin where it happens. The running cue is highlighted in green and the script follows it (**Follow the cue**). Click a cue number to select the cue; select a cue and double-click the script to mark it there (or move its mark); **Unmark** removes it. Marks follow cues when they're renumbered.

**File → Export Annotated Script…** saves a copy of the PDF with each cue's number beside its line and a rule across the page (songs in purple), plus a **Cue Sheet** at the end: every cue, its page, its text and who's on each DCA.

The show keeps the script's location; if the show and its script are moved together, it's found next to the show.

## Themes
**Settings** (⌘,) → **Theme**, or **View → Theme**, changes the app's colors in every window straight away:
- **Vivid (dark)**: the default, with bright cue highlight colors.
- **Classic (dark)**: the app's original look, with muted cue highlight colors.
- **Light**: light backgrounds with pastel cue colors.

DCA state colors (green, cyan, yellow, magenta) mean the same in every theme, so they don't change; the Channel Utilisation grid stays white like TheatreMix's.

**Custom themes:** Settings → **Themes Folder…** (or View → Theme → Open Themes Folder) opens a folder for your own themes, with a README. A theme is a `.json` file that names a base theme and lists only the colors it changes, e.g. `{"name": "My Theme", "base": "light", "colors": {"cueRed": "#ffb3b3"}}`. Every color a theme can set is listed, with what it's for, in `src/utils/themes.js`.

## Current and next cue on the console
The console shows the cue that's running and the one coming next, in two places (Console Setup → **Cue Display**, both on by default):
- **Cues on spare DCAs:** the two DCAs after the show's (DCAs 9 and 10 for a show on 1-8) show the current cue as `>1.1` and the next as `^1.2` (scribble strips only fit about 10 characters), so they sit beside the show's DCAs on the DCA layer. Only their names and colors are changed; their faders, mutes and channels are left alone. Turning it off names them `DCA 9` / `DCA 10` again.
- **Cues on the Scenes screen:** the console's Scenes screen shows the current cue as **Current Project** and the next cue as **Current Scene**.
- **Main fader label** (off by default): the main fader's scribble strip shows the current cue (`>1.1`) or the next one (`^1.2`) instead of "Main". Setting it back to Main (unchanged) names it "Main" again.

In Line Checks the strips show `>LC` (the Scenes screen: `NOW Line Checks`), and after the last cue the next one is `^End` (`End of show`). Lines tagged `[CUEDISPLAY]` in the debug log show what was written.

## DCA levels
A DCA's fader level follows the people on it. When a DCA is unassigned it drops to −∞, but the level its people were at is remembered for when they're next assigned. When a cue moves someone to a different DCA, the new DCA comes up at the level their old DCA's fader was at (including any moves made on the console), so their mix stays where it was. If a DCA's new channels came from different DCAs, the level most of them share wins.

Both of these can be turned off in **Console Setup → DCA Recall**: **Levels follow people** (off: a DCA only moves when a level is set for the cue) and **Back restores DCAs** (off: Back fires the cue like Go). They're saved with the app's preferences, not in the show.

**Console Setup → DCA Recall → New DCAs start closed** (off by default): a DCA coming up for the first time starts at −∞ instead of −20 dB, so a mic is only open once you push it up for its line (line-by-line mixing).

To make a DCA go to a particular level in a cue, open the DCA in **Assign** (double-click it, or select it and press ⌘E) and tick **DCA level**; it's applied every time that cue fires. Untick it to remove it again. With no level set, a DCA coming up for the first time (it was empty, or its people have never been mixed yet) starts at −20 dB. **Back** restores a cue's DCAs: when you leave a cue, each DCA's fader and mute are remembered, and going Back into that cue puts them back exactly as they were (for every DCA that has the same people as when you left). This only applies to cues you've already been in since connecting or opening the show. Lines tagged `[LEVELS]` in the debug log show each level change and why, and DCA fader moves made on the console.

**Line mutes:** every time a cue fires, each line on one of the cue's DCAs is unmuted and every other line is muted (**Show Setup → Console → Mute controlled channels that aren't on a DCA**, on by default). The mute is sent to every line every cue, even if the app thinks the line is already right, so a mute pressed on the desk or in another app, or a reconnect, can't leave a line in the cue muted. Only the show's channels (and their backups) are ever muted or unmuted: any other channel is left alone, even if it's on one of the cue's DCAs. Lines leaving the DCAs are muted before the DCAs change and lines joining are unmuted after, so nobody is briefly live on the wrong DCA. With that off, other lines are left alone but lines in the cue are still unmuted. Lines tagged `[MUTES]` in the debug log show which lines changed.

## Editing shows
Shows can be built and edited here the way they are in TheatreMix, and saved as a `.tmixp` that TheatreMix can still open. Unlock editing first (**View → Lock Editing**, ⌘L, or the padlock).

**The cue list** works like a spreadsheet: click a cell to select it (Shift-click or Shift-arrows for a range; the arrow keys move the selection while editing is unlocked). Space is Go and Ctrl+Space is Back as always; with editing locked, ↑ / ↓ are Back / Go.
- **Type** into a Cue, Text or QLab cell (or double-click it, or press Enter) to change it; Enter saves, Escape cancels. A new cue number moves the cue to its place.
- **DCA cells:** type an ensemble name to add it (⌘Enter replaces what's there; "All" is every channel), a character / profile name or console label to assign that channel, channel numbers (`3` or `3,5`), or nothing to clear it. Double-click (or Enter, or ⌘E) opens **Assign**: the DCA's label, its channels and each one's profile, position and level offset, ensembles (Assign replaces, Merge adds), and this app's DCA level. A channel can only be on one DCA per cue: assigning it moves it, and a DCA left with nobody on it is cleared (no blank DCAs). Pasting a DCA into a cue that already has those exact channels on another DCA is refused. When the cue being edited is the one running, Assign's **Fader** column shows any line whose fader has been moved on the console from where the cue put it; click the level to keep it as that line's offset. **Apply level offsets** turns offsets on or off for the whole show (same as Show Setup → Levels).
- **Edit menu:** Cut / Copy / Paste (a cut DCA is struck through until it's pasted), Paste Merge (add a DCA's channels to another), Paste Swap (two DCAs trade places), Fill Down, Insert Cue (⌘M, halfway to the next cue), Clone Cue / Clone Cue to end, Delete Cue (⌘⌫), Skip Cue (⌘⌥K: shown in purple, struck through; Go and Back pass over it), Renumber Cues (from the selected cue to the end, each one an increment after the last), Assign / Clear Assignment. Delete / Backspace clears the selected cells. Undo / Redo (⌘Z / ⇧⌘Z) cover every edit.
- **Right-click** a cue number or text for its highlight color.
- Like TheatreMix, a cue with DCA assignments shows them on black (ensembles on gray), an unlabeled DCA with several channels is "Group", and a DCA with level offsets is underlined. Changes to the active cue go to the console straight away.

**Toolbar:** New / Open / Save, Undo / Redo (greyed out when there's nothing to undo / redo; they work with editing locked too), Insert / Clone / Delete Cue and Assign (for the selected cue, with editing unlocked), **Store Channel Settings from Console** (below), View Positions, Lock Editing, Back / Go and Console Setup.

**Store Channel Settings from Console** (toolbar, or Action → ⌥⌘S) stores the gain / HPF / EQ / dynamics on the console now for the selected DCA's channels (or every channel in the selected cue, or in the running cue), as the character each plays in that cue. A character that stores nothing yet starts storing all four; sections a character stores per actor go to the actor playing it. Show Setup shows what's stored for the selected character: gain, HPF, the EQ curve and bands, and dynamics (and each actor's, when they have their own). With nothing stored yet, it shows the line's settings on the console now. The EQ curve is drawn dashed when the channel's EQ is switched off.

**Several characters on one line:** add characters to a line in Show Setup (+ Character), and pick which one a cue uses in Assign (or by typing the character's name into a DCA cell). When a cue fires, each line is named after the character it plays in that cue, or, if it isn't in the cue, the one it plays in the next cue that uses it (its default if none does); its stored settings follow the same character.

**All 24 DCAs:** Show Setup → Console → **Use all 24 DCAs** lets DCAs to control go up to 24 (normally 8, like TheatreMix); the cue list has a column for each DCA the show controls. DCAs 13-24 are saved in the .tmixp; TheatreMix opens the show and ignores them.

**File menu:** **New Show** starts a blank StudioLive 32 show (32 channels, DCAs 1-8) and opens Show Setup. **Show Setup**: designer, venue, DCAs and channels to control, each channel's name, console label and extra profiles (+ / −), what each profile stores (gain / HPF / EQ / dynamics, ◆ = stored; **Store from console** captures them), Male / Female ensembles, backup channels and the spare backup, level offsets, QLab, REAPER, and the console settings this app uses. **Ensemble Setup**: ensembles by channel (a channel with several profiles can be in an ensemble as a particular one). **Position Setup**: positions with their delay and pan. **Actor Setup**: each character's actors, who's playing tonight, what's stored per actor (and Store from console), actor groups (Load / Save Group) and actor names in checks cues. **Export Notes** saves the session's cue marks as a web page.

**View menu:** **Positions** (⌘T) shows each DCA's position codes in its cell. **Channel Utilisation** (⌘U) is a timeline of every channel's DCA in every cue, with **Move Assignments** for moving a channel's assignments to another (an understudy), cue by cue: Move / Keep / Delete / Skip (M / K / D / S). **Active Cue Info** (⌘I) is a pop-out window with the running cue and the next one (scroll to resize the text, double-click to reset). **Color-Blind DCA Colors** is TheatreMix's color-blind palette, for the cue list and the console. **Row Size** picks a preset text size.

**Settings** (⌘,, in the app menu) sets the cue list's font size to any size, and resets resized columns. Drag the right edge of a column's header to resize it: only that column changes (the others keep their widths, and the table gets wider or narrower). Double-click the edge to put that column back to its default width; Settings → Reset column widths goes back to columns that fill the window. Sizes are saved with the app's preferences.

**Action menu:** **Mark Selected Cue** (⌘R) / **Mark Current Cue** (⇧⌘R) flag a cue with a note (a red dot by its number); a note on the running cue closes itself when the next cue fires. Marks last for the session, like TheatreMix's.

**The cue list's DCA colors** follow TheatreMix's coding for what happens in the next cue: green same, cyan position change, yellow profile change, magenta channels joining an existing ensemble, plain = the assignment changes. Ensembles are a brighter shade. The console's DCA scribble strips use the same rules.

### Live features
- **Line faders at 0 dB:** when a line comes onto a DCA after being on none, its channel fader goes to 0 dB, or to 0 dB plus its offset (Assign → Offset) with Show Setup → Levels → Store level offsets on. While it stays on a DCA, even moving to another one, it keeps any trim made on the console; an offset change moves the fader by the difference.
- **Stored channel settings:** when a cue fires, each channel gets its profile's stored gain / HPF / EQ / dynamics (or the active actor's, for sections stored per actor; sections a profile doesn't store come from the channel's default profile). Only changes are sent. A cue using a channel's other profile also shows that profile's name on the scribble strip. The StudioLive values are kept in this app's own table; TheatreMix's X32 values in the show are left alone.
- **Backup channels** (Show Setup → Backup): pressing a DCA's mute button on the console switches its channels that have a backup to the backup (the backup gets the DCA, unmuted, named with a ~, and the main's fader level if it's between −30 and +6 dB, else 0 dB plus the offset; the main channel is muted), and back. The tray under the cue list shows each pair (active in green) and switches it on a double-click; the spare backup can stand in for any channel there. Show Setup → Console can turn the mute-button switching off.
- **REAPER** (Show Setup → REAPER): while REAPER is recording, each cue fired drops a marker and its place in the recording is saved with the show; while it's stopped, firing a cue moves REAPER there, less the pre-roll. In REAPER: Preferences → Control/OSC/web → Add → OSC (Default pattern), local listen port 8000, device IP this computer, device port 9000.

Not here (X32-only in TheatreMix): FX assignments / mutes and snippets / scenes.

## Reading the console's User Layer
The console's User Layer isn't in the state it shares with apps, so this app can't set it yet. **Help → Read User Layer from Console…** asks the connected console for its User Layer the same way Universal Control's "Copy From Mixer" does, and saves everything the console sends back over the next 4 seconds to a `userlayer-probe-….txt` file next to the debug log. Send that file to work out whether the app can set the User Layer to the active cue's lines.

## DEBUGGING
1) First locate the Presonus TheatreMix app in your applications folder
2) Right click and press show package contents. 
3) Click on Contents -> MacOS
4) Open a terminal and drag the "Presonus TheatreMix" file into the terminal
5) Type a space then "**--inspect=9229**"
6) The app is running and the debug log is now showing in the terminal

### Example:
```bash
/Applications/Presonus\ TheatreMix.app/Contents/MacOS/Presonus\ TheatreMix --inspect=9229
```