#!/usr/bin/env python3
"""Create loudness-normalized copies of the game's music."""

import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
INPUT_DIR = ROOT / "source" / "music-original"
OUTPUT_DIR = ROOT / "source" / "music"
PORTABLE_FFMPEG = ROOT / "tools" / "ffmpeg" / "ffmpeg.exe"
TARGET = "I=-14:TP=-1:LRA=11"
MEASUREMENTS = {
    "input_i": "measured_I",
    "input_tp": "measured_TP",
    "input_lra": "measured_LRA",
    "input_thresh": "measured_thresh",
    "target_offset": "offset",
}


def find_ffmpeg():
    if PORTABLE_FFMPEG.is_file():
        return str(PORTABLE_FFMPEG)
    return shutil.which("ffmpeg")


def run_ffmpeg(command):
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "FFmpeg failed without an error message.")
    return result.stderr


def analyze(ffmpeg, source):
    output = run_ffmpeg([
        ffmpeg, "-nostdin", "-hide_banner", "-nostats", "-i", str(source),
        "-map", "0:a:0", "-af", f"loudnorm={TARGET}:print_format=json",
        "-f", "null", "-",
    ])
    start = output.rfind("{")
    end = output.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("FFmpeg did not return loudness measurements.")
    try:
        measurements = json.loads(output[start:end + 1])
        values = {name: float(measurements[key]) for key, name in MEASUREMENTS.items()}
    except (ValueError, KeyError, TypeError) as error:
        raise ValueError("Invalid loudness measurements from FFmpeg.") from error
    if not all(math.isfinite(value) for value in values.values()):
        raise ValueError("Cannot normalize this track: loudness measurements are not finite (possibly silence).")
    return values


def normalize(ffmpeg, source, destination):
    measurements = analyze(ffmpeg, source)
    options = ":".join(f"{name}={value}" for name, value in measurements.items())
    with tempfile.TemporaryDirectory(dir=destination.parent) as temp_dir:
        temporary = Path(temp_dir) / "normalized.mp3"
        run_ffmpeg([
            ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(source),
            "-map", "0:a:0", "-map_metadata", "0",
            "-af", f"loudnorm={TARGET}:{options}:linear=true",
            "-ar", "48000", "-c:a", "libmp3lame", "-q:a", "2", str(temporary),
        ])
        with temporary.open("rb") as source_file:
            with destination.open("xb") as destination_file:
                try:
                    shutil.copyfileobj(source_file, destination_file)
                except OSError:
                    destination_file.close()
                    destination.unlink()
                    raise
    return measurements["measured_I"]


def main():
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        print(
            f"Error: FFmpeg was not found at {PORTABLE_FFMPEG} or in PATH.",
            file=sys.stderr,
        )
        return 1
    if not INPUT_DIR.is_dir():
        print(f"Error: Music folder not found: {INPUT_DIR}", file=sys.stderr)
        return 1
    songs = sorted(path for path in INPUT_DIR.iterdir() if path.is_file() and path.suffix.lower() == ".mp3")
    if not songs:
        print(f"Error: No MP3 files found in {INPUT_DIR}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    failed = 0
    for index, source in enumerate(songs, 1):
        destination = OUTPUT_DIR / source.name
        if destination.exists():
            print(f"[{index}/{len(songs)}] Skipped (already exists): {source.name}", flush=True)
            continue
        print(f"[{index}/{len(songs)}] Processing: {source.name}", flush=True)
        try:
            loudness = normalize(ffmpeg, source, destination)
        except (OSError, RuntimeError, ValueError) as error:
            failed += 1
            print(f"Error processing {source.name}: {error}", file=sys.stderr, flush=True)
        else:
            print(f"  Original: {loudness:.1f} LUFS; target: -14 LUFS", flush=True)
    print(f"Finished. Output: {OUTPUT_DIR}. Failed: {failed}.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
