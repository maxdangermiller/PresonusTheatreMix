#!/usr/bin/env python3
"""
Behringer X32 console simulator (OSC over UDP, port 10023), for testing the app's X32 support
without a console. It answers what the app uses:

  /xinfo                 -> /xinfo ,ssss <ip> <name> <model> <firmware>
  /xremote               -> this client gets every change made by others (or at the prompt) for 10 s
  <path> (no arguments)  -> the value back (names, colors, faders, mutes, DCA / mute group
                            assignments, mute groups, preamp gain, HPF, EQ, dynamics, gate)
  <path> <value>         -> stored, and sent to the other /xremote clients
  /meters ,s /meters/1   -> input meters every 50 ms for 10 s (levels from the 'signal' command)

Prompt commands:
  press N            mute group N's button (toggles /config/mute/N, like the console)
  fader ch|dcaN dB   move a channel's (or DCA's) fader, e.g. "fader 3 -10", "fader dca2 0"
  mute ch|dcaN       toggle a channel's (or DCA's) mute
  signal ch dB       a channel's input level for the meters ("signal 3 -20"; "signal 3 off")
  dca                which channels are on each DCA, with the DCA names
  names              channel names and colors
  get PATH           a raw value, e.g. "get /ch/01/eq/1/g"
  quit

Run: python3 sim/x32_sim.py [--bind 127.0.0.1] [--port 10023] [--name X32-SIM] [--model X32]
"""

import argparse
import math
import select
import socket
import struct
import sys
import threading
import time

COLORS = ["OFF", "RD", "GN", "YE", "BL", "MG", "CY", "WH"]


# region OSC

def pad(b: bytes) -> bytes:
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def osc_string(s: str) -> bytes:
    return pad(s.encode() + b"\0")


def encode(address: str, *args) -> bytes:
    tags, data = ",", b""
    for a in args:
        if isinstance(a, bool) or isinstance(a, int):
            tags += "i"; data += struct.pack(">i", int(a))
        elif isinstance(a, float):
            tags += "f"; data += struct.pack(">f", a)
        elif isinstance(a, bytes):
            tags += "b"; data += struct.pack(">i", len(a)) + pad(a)
        else:
            tags += "s"; data += osc_string(str(a))
    return osc_string(address) + osc_string(tags) + data


def read_string(buf: bytes, offset: int):
    end = buf.index(b"\0", offset)
    return buf[offset:end].decode(errors="replace"), offset + ((end - offset) // 4 + 1) * 4


def decode(buf: bytes):
    address, offset = read_string(buf, 0)
    if offset >= len(buf):
        return address, []
    tags, offset = read_string(buf, offset)
    args = []
    for t in tags[1:]:
        if t == "i":
            args.append(struct.unpack(">i", buf[offset:offset + 4])[0]); offset += 4
        elif t == "f":
            args.append(struct.unpack(">f", buf[offset:offset + 4])[0]); offset += 4
        elif t == "s":
            s, offset = read_string(buf, offset); args.append(s)
    return address, args

# endregion


def db_to_fader(db: float) -> float:
    if db >= 10: return 1.0
    if db >= -10: return (db + 30) / 40
    if db >= -30: return (db + 50) / 80
    if db >= -60: return (db + 70) / 160
    if db > -90: return (db + 90) / 480
    return 0.0


def fader_to_db(f: float) -> float:
    if f >= 0.5: return f * 40 - 30
    if f >= 0.25: return f * 80 - 50
    if f >= 0.0625: return f * 160 - 70
    if f > 0: return f * 480 - 90
    return -math.inf


def default_state() -> dict:
    s = {}
    for ch in range(1, 33):
        p = f"/ch/{ch:02d}"
        s.update({f"{p}/config/name": "", f"{p}/config/color": 0, f"{p}/mix/fader": 0.75, f"{p}/mix/on": 1,
                  f"{p}/grp/dca": 0, f"{p}/grp/mute": 0, f"{p}/preamp/hpon": 0, f"{p}/preamp/hpf": 0.0,
                  f"{p}/eq/on": 1, f"{p}/dyn/on": 0, f"{p}/dyn/thr": 1.0, f"{p}/gate/on": 0, f"{p}/gate/thr": 0.0})
        for band, (kind, freq) in enumerate([(2, 0.2), (2, 0.4), (2, 0.6), (2, 0.8)], start=1):
            s.update({f"{p}/eq/{band}/type": kind, f"{p}/eq/{band}/f": freq, f"{p}/eq/{band}/g": 0.5, f"{p}/eq/{band}/q": 0.4648})
        s[f"/headamp/{ch - 1:03d}/gain"] = 0.1667
    for d in range(1, 9):
        s.update({f"/dca/{d}/config/name": "", f"/dca/{d}/config/color": 0, f"/dca/{d}/fader": 0.75, f"/dca/{d}/on": 1})
    for m in range(1, 7):
        s[f"/config/mute/{m}"] = 0
    s["/main/st/config/name"] = ""
    return s


class X32Sim:
    def __init__(self, args):
        self.args = args
        self.state = default_state()
        self.lock = threading.Lock()
        self.remote = {}      # (ip, port) -> expiry
        self.meters = {}      # (ip, port) -> expiry
        self.signal = {}      # channel -> linear level
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((args.bind, args.port))

    def say(self, text: str):
        print(f"\r{time.strftime('%H:%M:%S')} {text}\n> ", end="", flush=True)

    def send(self, addr, data: bytes):
        try:
            self.sock.sendto(data, addr)
        except OSError as e:
            self.say(f"send to {addr} failed: {e}")

    def push(self, path: str, exclude=None):
        """Tell the /xremote clients about a change"""
        now = time.time()
        data = encode(path, self.state[path])
        for addr, expiry in list(self.remote.items()):
            if expiry < now:
                del self.remote[addr]
            elif addr != exclude:
                self.send(addr, data)

    def set(self, path: str, value, exclude=None):
        old = self.state.get(path)
        if isinstance(old, int) and not isinstance(old, bool):
            value = int(round(value)) if not isinstance(value, str) else value
        elif isinstance(old, float):
            value = float(value)
        self.state[path] = value
        self.push(path, exclude)
        return old

    def handle(self, data: bytes, addr):
        try:
            address, args = decode(data)
        except (ValueError, struct.error, IndexError):
            self.say(f"{addr} sent something that isn't OSC")
            return
        if address in ("/xinfo", "/info"):
            self.send(addr, encode("/xinfo", self.args.bind, self.args.name, self.args.model, "4.06"))
        elif address == "/xremote":
            if addr not in self.remote:
                self.say(f"{addr[0]}:{addr[1]} subscribed (/xremote)")
            self.remote[addr] = time.time() + 10
        elif address in ("/meters", "/renew") and (not args or args[0] == "/meters/1"):
            self.meters[addr] = time.time() + 10
        elif address in self.state:
            if not args:
                self.send(addr, encode(address, self.state[address]))
            else:
                old = self.set(address, args[0], exclude=addr)
                if old != self.state[address] and self.args.verbose:
                    self.say(f"{addr[1]} set {address} = {self.describe(address)}")
                elif old != self.state[address]:
                    self.log_change(address, addr)
        else:
            self.say(f"unknown {address} {args}")

    def describe(self, path: str) -> str:
        v = self.state[path]
        if path.endswith("/fader"):
            db = fader_to_db(v)
            return f"{v:.4f} ({'-inf' if db == -math.inf else f'{db:+.1f} dB'})"
        if path.endswith("/color"):
            return f"{v} ({COLORS[v % 8]}{' inverted' if v >= 8 else ''})"
        if path.endswith("/grp/dca"):
            return f"{v} (DCAs {','.join(str(d) for d in range(1, 9) if v >> (d - 1) & 1) or 'none'})"
        return repr(v)

    def log_change(self, path: str, addr):
        # Keep the log readable: the interesting changes only
        if any(path.endswith(s) for s in ("/config/name", "/grp/dca", "/mix/on", "/dca/1/on") ) or path.startswith("/dca/") \
                or path.startswith("/config/mute") or path.endswith("/color") or path.startswith("/main/"):
            self.say(f"{path} = {self.describe(path)}")

    def meter_loop(self):
        while True:
            time.sleep(0.05)
            now = time.time()
            if not self.meters:
                continue
            levels = [self.signal.get(ch, 0.0) * (0.85 + 0.15 * math.sin(now * 7 + ch)) for ch in range(1, 33)]
            values = levels + [0.0] * 64       # gate and compressor gain reduction
            blob = struct.pack("<i", len(values)) + struct.pack(f"<{len(values)}f", *values)
            data = encode("/meters/1", blob)
            for addr, expiry in list(self.meters.items()):
                if expiry < now:
                    del self.meters[addr]
                else:
                    self.send(addr, data)

    def command(self, line: str):
        parts = line.split()
        if not parts:
            return
        cmd = parts[0].lower()
        try:
            if cmd == "press" and len(parts) == 2:
                path = f"/config/mute/{int(parts[1])}"
                self.set(path, 0 if self.state[path] else 1)
                self.say(f"mute group {parts[1]} pressed -> {'on' if self.state[path] else 'off'}")
            elif cmd == "fader" and len(parts) == 3:
                target = parts[1]
                path = f"/dca/{target[3:]}/fader" if target.startswith("dca") else f"/ch/{int(target):02d}/mix/fader"
                self.set(path, db_to_fader(float(parts[2])))
                self.say(f"{path} = {self.describe(path)}")
            elif cmd == "mute" and len(parts) == 2:
                target = parts[1]
                path = f"/dca/{target[3:]}/on" if target.startswith("dca") else f"/ch/{int(target):02d}/mix/on"
                self.set(path, 0 if self.state[path] else 1)
                self.say(f"{path} = {self.state[path]} ({'on' if self.state[path] else 'muted'})")
            elif cmd == "signal" and len(parts) == 3:
                ch = int(parts[1])
                self.signal[ch] = 0.0 if parts[2] == "off" else 10 ** (float(parts[2]) / 20)
                self.say(f"channel {ch} signal {parts[2]}")
            elif cmd == "dca":
                for d in range(1, 9):
                    chans = [ch for ch in range(1, 33) if self.state[f"/ch/{ch:02d}/grp/dca"] >> (d - 1) & 1]
                    self.say(f"DCA {d} '{self.state[f'/dca/{d}/config/name']}' {COLORS[self.state[f'/dca/{d}/config/color'] % 8]}"
                             f" fader {self.describe(f'/dca/{d}/fader')} {'on' if self.state[f'/dca/{d}/on'] else 'MUTED'}: {chans}")
            elif cmd == "names":
                for ch in range(1, 33):
                    p = f"/ch/{ch:02d}"
                    if self.state[f"{p}/config/name"]:
                        self.say(f"ch {ch} '{self.state[f'{p}/config/name']}' {COLORS[self.state[f'{p}/config/color'] % 8]}"
                                 f" {'on' if self.state[f'{p}/mix/on'] else 'MUTED'} fader {self.describe(f'{p}/mix/fader')}")
            elif cmd == "get" and len(parts) == 2:
                self.say(f"> {parts[1]} = {self.describe(parts[1]) if parts[1] in self.state else 'unknown'}")
            elif cmd in ("quit", "exit"):
                raise SystemExit
            else:
                self.say(f"unknown command: {line.strip()}")
        except (ValueError, KeyError) as e:
            self.say(f"bad command ({e})")

    def run(self):
        threading.Thread(target=self.meter_loop, daemon=True).start()
        self.say(f"X32 simulator '{self.args.name}' ({self.args.model}) on {self.args.bind}:{self.args.port}")
        while True:
            ready, _, _ = select.select([self.sock, sys.stdin], [], [])
            if self.sock in ready:
                data, addr = self.sock.recvfrom(65536)
                self.handle(data, addr)
            if sys.stdin in ready:
                line = sys.stdin.readline()
                if not line:
                    continue
                self.command(line)


def main():
    ap = argparse.ArgumentParser(description="Behringer X32 OSC simulator")
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=10023)
    ap.add_argument("--name", default="X32-SIM")
    ap.add_argument("--model", default="X32")
    ap.add_argument("--verbose", action="store_true", help="log every change, not just the interesting ones")
    try:
        X32Sim(ap.parse_args()).run()
    except (KeyboardInterrupt, SystemExit):
        print()


if __name__ == "__main__":
    main()
