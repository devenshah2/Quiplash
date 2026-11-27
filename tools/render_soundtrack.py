"""Render the original Punchline soundtrack. Requires Python 3, NumPy and FFmpeg."""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import math
import subprocess
import wave

import numpy as np

RATE = 44100
TAU = 2 * np.pi
OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "music"


@dataclass
class Song:
    title: str
    tempo: int
    bars: int
    tonic: int
    changes: list
    bassline: list
    hook: list
    chords: list
    kick: list
    swing: float
    lead: str
    seed: int


# Bass tuples specify sixteenth, interval above chord root, and duration in beats.
# Hook rows repeat every two bars; their pitches are relative to the song's tonic.
SONGS = {
    "lobby": Song(
        "Door List",
        116,
        16,
        42,
        [(0, "m9"), (-4, "M9"), (-7, "m9"), (-2, "13")],
        [
            (0, 0, 0.68),
            (3, 12, 0.23),
            (6, 7, 0.45),
            (9, 0, 0.28),
            (11, 10, 0.23),
            (14, 7, 0.38),
        ],
        [
            (2, 12, 0.45),
            (6, 15, 0.22),
            (7, 19, 0.62),
            (12, 17, 0.36),
            (15, 14, 0.25),
            (18, 12, 0.5),
            (22, 7, 0.28),
            (25, 10, 0.38),
            (28, 12, 0.58),
        ],
        [2, 7, 10, 14],
        [0, 4, 8, 12],
        0.037,
        "clav",
        13,
    ),
    "write": Song(
        "Draft After Dark",
        105,
        16,
        38,
        [
            (0, "m9"),
            (5, "13"),
            (0, "m9"),
            (-2, "M9"),
            (3, "M9"),
            (5, "13"),
            (0, "m9"),
            (7, "7"),
        ],
        [
            (0, 0, 0.59),
            (3, 0, 0.21),
            (6, 7, 0.59),
            (10, 12, 0.32),
            (13, 7, 0.21),
            (15, 0, 0.18),
        ],
        [(3, 19, 0.53), (10, 17, 0.35), (13, 14, 0.31), (19, 12, 0.8), (26, 15, 0.46)],
        [1, 6, 11, 14],
        [0, 6, 10],
        0.063,
        "tine",
        27,
    ),
    "vote": Song(
        "House Vote",
        128,
        12,
        39,
        [(0, "m7"), (-2, "M9"), (-5, "m7"), (-2, "13")],
        [
            (1, 0, 0.32),
            (3, 12, 0.18),
            (5, 0, 0.34),
            (7, 7, 0.17),
            (9, 0, 0.32),
            (11, 10, 0.17),
            (13, 12, 0.34),
            (15, 7, 0.14),
        ],
        [
            (0, 12, 0.21),
            (3, 15, 0.22),
            (6, 19, 0.36),
            (10, 22, 0.34),
            (13, 19, 0.33),
            (16, 12, 0.4),
            (20, 10, 0.33),
            (23, 15, 0.3),
            (26, 14, 0.57),
            (30, 10, 0.23),
        ],
        [2, 6, 10, 14],
        [0, 4, 8, 12],
        0.012,
        "reed",
        42,
    ),
    "reveal": Song(
        "Receipt Drop",
        124,
        8,
        41,
        [(0, "13"), (-2, "M9"), (-5, "m9"), (-2, "13")],
        [(0, 0, 0.82), (5, 12, 0.23), (7, 10, 0.22), (10, 0, 0.46), (13, 7, 0.31)],
        [
            (0, 12, 0.43),
            (2, 16, 0.31),
            (5, 19, 0.61),
            (10, 22, 0.26),
            (12, 19, 0.55),
            (16, 14, 0.45),
            (19, 17, 0.33),
            (21, 14, 0.6),
            (27, 12, 0.75),
        ],
        [0, 5, 10, 13],
        [0, 4, 7, 10, 12],
        0.026,
        "brass",
        56,
    ),
    "scores": Song(
        "Count It Up",
        112,
        8,
        40,
        [(0, "m9"), (-5, "m9"), (-2, "13"), (0, "m9")],
        [
            (0, 0, 0.57),
            (3, 7, 0.24),
            (5, 12, 0.4),
            (9, 0, 0.35),
            (12, 10, 0.33),
            (15, 7, 0.23),
        ],
        [
            (1, 12, 0.53),
            (5, 19, 0.36),
            (11, 17, 0.32),
            (13, 15, 0.35),
            (17, 10, 0.36),
            (21, 12, 0.6),
            (27, 14, 0.65),
        ],
        [2, 5, 11, 14],
        [0, 3, 8, 11],
        0.055,
        "clav",
        78,
    ),
    "end": Song(
        "Last Call Confetti",
        126,
        12,
        45,
        [
            (0, "M9"),
            (-5, "M9"),
            (-3, "m9"),
            (-7, "13"),
            (0, "M9"),
            (-5, "M9"),
            (-7, "13"),
            (0, "M9"),
        ],
        [
            (0, 0, 0.7),
            (3, 12, 0.19),
            (5, 7, 0.45),
            (8, 0, 0.63),
            (11, 12, 0.21),
            (14, 7, 0.33),
        ],
        [
            (0, 12, 0.7),
            (4, 16, 0.3),
            (6, 19, 0.53),
            (9, 21, 0.31),
            (11, 19, 0.33),
            (14, 16, 0.4),
            (16, 14, 0.52),
            (19, 16, 0.31),
            (22, 12, 0.65),
            (27, 7, 0.32),
            (30, 12, 0.43),
        ],
        [0, 3, 6, 10, 14],
        [0, 4, 8, 12],
        0.025,
        "brass",
        91,
    ),
}
VOICINGS = {
    "m9": [3, 7, 10, 14],
    "M9": [4, 7, 11, 14],
    "13": [4, 9, 10, 14],
    "7": [4, 7, 10, 14],
    "m7": [3, 7, 10, 12],
}


def timeline(seconds):
    return np.arange(round(seconds * RATE), dtype=np.float64) / RATE


def noise_band(t, low, high, rng):
    noise = rng.standard_normal(len(t))
    f = np.maximum(1, np.fft.rfftfreq(len(t), 1 / RATE))
    response = ((1 + (low / f) ** 8) * (1 + (f / high) ** 8)) ** -0.5
    filtered = np.fft.irfft(np.fft.rfft(noise) * response, len(t))
    return filtered / max(0.01, np.std(filtered))


def drum_kit(seed):
    rng = np.random.default_rng(seed)
    kit = {}
    t = timeline(0.53)
    phase = TAU * (
        48 * t + 4.3 * (1 - np.exp(-t / 0.03)) + 0.52 * (1 - np.exp(-t / 0.006))
    )
    kick = np.sin(phase) * np.exp(-t / 0.125) + 0.15 * noise_band(
        t, 1200, 7600, rng
    ) * np.exp(-t / 0.007)
    kit["kick"] = np.tanh(1.6 * kick) * (1 - np.exp(-t / 0.001)) * 0.94
    t = timeline(0.34)
    snare = 0.52 * np.sin(TAU * (177 * t + 0.9 * (1 - np.exp(-t / 0.028)))) * np.exp(
        -t / 0.063
    ) + 0.29 * noise_band(t, 750, 9600, rng) * np.exp(-t / 0.083)
    kit["snare"] = snare * (1 - np.exp(-t / 0.0014))
    bursts = np.zeros(len(t))
    for delay, level in [(0, 0.77), (0.009, 0.64), (0.02, 0.86), (0.032, 1)]:
        age = np.maximum(0, t - delay)
        bursts += (
            level
            * (t >= delay)
            * (1 - np.exp(-age / 0.001))
            * np.exp(-age / (0.052 if delay > 0.03 else 0.008))
        )
    kit["clap"] = 0.48 * noise_band(t, 800, 5300, rng) * bursts
    for name, decay in [
        ("tick", 0.018),
        ("open", 0.091),
        ("shake", 0.038),
        ("splash", 0.23),
    ]:
        t = timeline(5.5 * decay)
        metallic = (
            sum(
                np.sin(TAU * f * t + 0.65 * np.sin(TAU * f * 1.73 * t))
                for f in (4530, 5881, 7213, 9509)
            )
            / 5
        )
        grit = noise_band(t, 4900, 15100, rng) * 0.33 + metallic * 0.24
        attack = 0.012 if name == "shake" else 0.0016
        kit[name] = grit * np.exp(-t / decay) * (1 - np.exp(-t / attack))
    t = timeline(0.15)
    kit["rim"] = (
        (np.sin(TAU * 815 * t) + 0.54 * np.sin(TAU * 1861 * t))
        * np.exp(-t / 0.016)
        * 0.53
    )
    for n, f in enumerate([168, 124, 88]):
        t = timeline(0.30)
        kit["tom" + str(n)] = np.sin(
            TAU * (f * t + 1.55 * (1 - np.exp(-t / 0.031)))
        ) * np.exp(-t / 0.084)
    return kit


@lru_cache(maxsize=600)
def tone(kind, midi, milliseconds, velocity=1):
    duration = milliseconds / 1000
    tail = 0.19 if kind in ("tine", "pad") else 0.065
    t = timeline(duration + tail)
    f = 440 * 2 ** ((midi - 69) / 12)
    phase = TAU * f * t
    release = np.exp(-np.maximum(t - duration, 0) / (tail / 5))
    if kind == "bass":
        # Plucked solid-body tone, with a pick transient and a fast-closing harmonics envelope.
        phase += 0.58 * (1 - np.exp(-t / 0.012))
        body = (
            np.sin(phase)
            + 0.4 * np.sin(2 * phase) * np.exp(-t / 0.22)
            + 0.22 * np.sin(3 * phase) * np.exp(-t / 0.12)
        )
        string = sum(
            np.sin(h * phase + 0.24 * h) * np.exp(-t / (0.12 / h**0.42)) / h
            for h in range(4, 12)
        )
        y = np.tanh(1.2 * (body + 0.63 * string)) * (0.55 + 0.45 * np.exp(-t / 0.18))
        attack = 0.003
    elif kind == "tine":
        y = np.sin(
            phase + (1.33 + 0.22 * velocity) * np.exp(-t / 0.19) * np.sin(phase * 2.005)
        )
        y += 0.20 * np.sin(phase * 2.008 + 0.2) + 0.14 * np.sin(phase * 3.997) * np.exp(
            -t / 0.21
        )
        y *= np.exp(-t / 0.65)
        attack = 0.005
    elif kind == "clav":
        wave1 = sum(
            (np.sin(h * phase) * np.sin(h * 0.82) / h)
            * np.exp(-t / (0.10 + h**-0.7 * 0.16))
            for h in range(1, 15)
        )
        wave2 = np.sin(2 * phase + 0.68 * np.sin(3.006 * phase)) * np.exp(-t / 0.105)
        y = wave1 + 0.22 * wave2
        attack = 0.0025
    elif kind == "brass":
        wave1 = sum(np.sin(h * phase) * np.exp(-h / 8) / h for h in range(1, 16))
        wave2 = sum(
            np.sin(h * phase * 1.003 + 0.13) * np.exp(-h / 8) / h for h in range(1, 15)
        )
        y = (wave1 + wave2 * 0.74) * (0.66 + 0.34 * np.exp(-t / 0.12))
        attack = 0.025
    elif kind == "reed":
        y = np.sin(
            phase + 0.96 * np.exp(-t / 0.17) * np.sin(2 * phase)
        ) + 0.32 * np.sin(phase * 1.004)
        y *= 0.6 * np.exp(-t / 0.16) + 0.27
        attack = 0.012
    else:
        y = (
            np.sin(phase)
            + 0.43 * np.sin(phase * 1.003 + 0.6)
            + 0.21 * np.sin(phase * 2.001)
        ) * 0.72
        attack = 0.043
    return ((1 - np.exp(-t / attack)) * release * y).astype(np.float32)


class Mix:
    def __init__(self, song, final):
        self.beat = 60 / song.tempo
        self.length = round((song.bars * 4 * self.beat + (1.5 if final else 0)) * RATE)
        self.drums, self.bass, self.keys, self.hook = (
            np.zeros((self.length, 2), np.float32) for _ in range(4)
        )
        self.pump = np.ones(self.length, np.float32)
        self.wrap = not final

    def put(self, bus, data, time, gain, pan=0):
        start = round(max(0, time) * RATE)
        if start >= self.length:
            return
        position = (pan + 1) * math.pi / 4
        stereo = np.array([math.cos(position), math.sin(position)], np.float32) * gain
        n = min(len(data), self.length - start)
        bus[start : start + n] += data[:n, None] * stereo
        if self.wrap and n < len(data):
            bus[: len(data) - n] += data[n:, None] * stereo

    def note(self, bus, kind, midi, time, length, level, pan=0):
        self.put(
            bus, tone(kind, midi, round(length * self.beat * 1000)), time, level, pan
        )

    def duck(self, time, depth):
        start = round(time * RATE)
        n = min(round(0.28 * RATE), self.length - start)
        env = 1 - depth * np.exp(-np.arange(n) / (RATE * 0.086))
        self.pump[start : start + n] = np.minimum(self.pump[start : start + n], env)


def room(signal, taps):
    wet = np.zeros_like(signal)
    for seconds, level in taps:
        n = round(seconds * RATE)
        wet[n:] += signal[:-n, ::-1] * level
    return wet


def render(name, s):
    rng = np.random.default_rng(s.seed)
    kit = drum_kit(s.seed)
    m = Mix(s, name == "end")
    for bar in range(s.bars):
        finale = name == "end" and bar == s.bars - 1
        register, quality = s.changes[bar % len(s.changes)]
        if name == "end" and bar == s.bars - 2:
            register, quality = -5, "13"
        if finale:
            register, quality = 0, "M9"
        root = s.tonic + register
        chord = [root + 12 + i for i in VOICINGS[quality]]
        section = bar // 4

        def grid(step):
            swing = s.swing * (step % 2)
            return (bar * 4 + step / 4 + swing) * m.beat

        def hit(sample, step, level, pan=0, lag=0):
            time = grid(step) + lag
            m.put(m.drums, kit[sample], time, level, pan)
            if sample == "kick":
                m.duck(time, 0.41 if name in ("vote", "end") else 0.29)

        if finale:
            hit("kick", 0, 0.96)
            hit("splash", 0, 0.55, 0.22)
            m.note(m.bass, "bass", root, grid(0), 2.5, 0.73)
            for j, note in enumerate(chord):
                m.note(
                    m.keys,
                    "tine",
                    note,
                    grid(0) + j * 0.009,
                    3.7,
                    0.23,
                    (j - 1.5) * 0.31,
                )
                m.note(
                    m.hook,
                    "brass",
                    note + 12,
                    grid(0) + j * 0.006,
                    1.7,
                    0.10,
                    (j - 1.5) * 0.25,
                )
            continue
        break_bar = bar % 8 == 7
        kicks = s.kick.copy()
        if name in ("write", "scores") and bar % 2:
            kicks = [0, 4, 7, 10, 14] if name == "write" else [0, 6, 9, 13]
        if break_bar:
            kicks = kicks[:2]
        for step in kicks:
            hit("kick", step, 0.94 if step % 4 == 0 else 0.75)
        for step in [4, 12]:
            if break_bar and step == 12:
                continue
            hit("snare", step, 0.70 if name == "write" else 0.68, 0, 0.009)
            hit("clap", step, 0.44 if name == "write" else 0.66, -0.12, 0.016)
            hit("clap", step, 0.24, 0.57, 0.035)
        if bar % 2 and name in ("write", "scores"):
            hit("snare", 11, 0.18, -0.11, 0.006)
        for step in range(0, 16, 2):
            if break_bar and step >= 12:
                continue
            off = step % 4 == 2
            open_hat = off and ((name == "vote" and section != 1) or step in (6, 14))
            hit(
                "open" if open_hat else "tick",
                step,
                (0.46 if off else 0.33) * rng.uniform(0.86, 1.1),
                0.28,
                0.002,
            )
        for step in range(1, 16, 2):
            if (step + bar) % 5 == 0 or (name == "write" and step % 4 == 3):
                continue
            hit("shake", step, 0.23 * rng.uniform(0.70, 1.15), -0.42, 0.009)
        if bar % 2 == 1:
            for step in [3, 10, 15]:
                hit("rim", step, 0.15 if name == "write" else 0.19, -0.47, 0.012)
        if bar % 4 == 3:
            for j, step in enumerate([12, 13, 14, 15] if break_bar else [14, 15]):
                hit("tom" + str(min(2, j)), step, 0.32 + 0.08 * j, -0.3 + 0.18 * j)
        if bar % 4 == 0 and name != "write":
            hit("splash", 0, 0.37, 0.34)
        for step, offset, length in s.bassline:
            if break_bar and step > 10:
                continue
            if bar % 4 == 2 and step == s.bassline[-1][0]:
                offset = 12
            m.note(
                m.bass,
                "bass",
                root + offset,
                grid(step),
                length,
                0.79 if step == 0 else 0.70,
            )
        for step in s.chords:
            if break_bar and step > 8:
                continue
            if name == "write" and bar % 4 in (0, 1) and step == 14:
                continue
            for j, note in enumerate(chord):
                pan = (j - 1.5) * 0.27
                length = 0.45 if name == "write" else 0.23 if name == "vote" else 0.37
                m.note(m.keys, "tine", note, grid(step) + j * 0.003, length, 0.18, pan)
                if name in ("lobby", "scores", "end"):
                    m.note(
                        m.keys,
                        "clav",
                        note + 12,
                        grid(step) + 0.013 + j * 0.002,
                        0.19,
                        0.095,
                        -pan * 0.9,
                    )
        if (section % 2 == 1 or name == "end") and not break_bar:
            for j, note in enumerate(chord[::2]):
                m.note(m.keys, "pad", note, grid(0), 3.6, 0.12, (j - 0.5) * 0.93)
        for step, offset, length in s.hook:
            if step // 16 != bar % 2:
                continue
            if name == "write" and (
                (section % 2 == 0 and bar % 4 != 3) or (bar % 4 == 2 and step % 3)
            ):
                continue
            if name == "lobby" and bar % 8 in (4, 5):
                continue
            if break_bar and step % 16 >= 12:
                continue
            melody = s.tonic + offset + 12
            if section % 2 and name in ("vote", "scores") and step % 4 == 2:
                melody += 12
            time = grid(step % 16)
            gain = {
                "write": 0.20,
                "lobby": 0.31,
                "vote": 0.27,
                "reveal": 0.25,
                "scores": 0.28,
                "end": 0.29,
            }[name]
            m.note(m.hook, s.lead, melody, time, length, gain, -0.13)
            if s.lead == "brass":
                m.note(
                    m.hook,
                    "brass",
                    melody - 12,
                    time + 0.014,
                    length * 0.88,
                    gain * 0.53,
                    0.39,
                )
            m.note(
                m.hook, s.lead, melody, time + m.beat * 0.75, length, gain * 0.17, 0.62
            )
    # Short stereo rooms for the claps and keys. Keep the kick, bass and narration centered.
    m.keys += room(
        m.keys, [(0.029, 0.18), (0.061, 0.115), (0.104, 0.075), (0.169, 0.043)]
    )
    m.hook += room(
        m.hook, [(0.039, 0.16), (0.078, 0.12), (0.147, 0.07), (0.201, 0.045)]
    )
    mix = (
        m.drums
        + m.bass * m.pump[:, None]
        + (m.keys + m.hook) * np.sqrt(m.pump[:, None])
    )
    mix = np.tanh(mix * 1.22) / np.tanh(1.7)
    mix *= 0.94 / np.max(np.abs(mix))
    n = round(RATE * 0.006)
    mix[:n] *= np.linspace(0, 1, n)[:, None]
    mix[-n:] *= np.linspace(1, 0, n)[:, None]
    return mix


def encode(path, pcm, song):
    with TemporaryDirectory() as scratch:
        wav = Path(scratch) / "mix.wav"
        with wave.open(str(wav), "wb") as f:
            f.setparams((2, 2, RATE, 0, "NONE", "not compressed"))
            f.writeframes((pcm * 32767).astype("<i2").tobytes())
        cmd = ["ffmpeg", "-hide_banner", "-nostats", "-i", str(wav)]
        scan = subprocess.run(
            cmd
            + ["-af", "loudnorm=I=-16:TP=-1.8:print_format=json", "-f", "null", "-"],
            check=True,
            capture_output=True,
            text=True,
        ).stderr
        meters, _ = json.JSONDecoder().raw_decode(scan[scan.rindex("{") :])
        gain = min(-16 - float(meters["input_i"]), -1.8 - float(meters["input_tp"]))
        subprocess.run(
            cmd
            + [
                "-loglevel",
                "error",
                "-af",
                f"volume={gain}dB",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "128k",
                "-metadata",
                "title=" + song.title,
                "-metadata",
                "artist=Punchline",
                "-y",
                str(path),
            ],
            check=True,
        )
        print(
            f'{path.name:<12} {len(pcm)/RATE:5.1f}s  {float(meters["input_i"])+gain:.1f} LUFS  '
            f'{float(meters["input_tp"])+gain:.1f} dBTP  {path.stat().st_size//1024} KiB',
            flush=True,
        )


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, song in SONGS.items():
        encode(OUTPUT / (name + ".mp3"), render(name, song), song)
