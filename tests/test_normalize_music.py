import contextlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import normalize_music


class FindFFmpegTests(unittest.TestCase):
    def test_prefers_portable_executable_and_falls_back_to_path(self):
        with tempfile.TemporaryDirectory() as directory:
            portable = Path(directory) / "ffmpeg.exe"
            with patch.object(normalize_music, "PORTABLE_FFMPEG", portable), \
                    patch.object(normalize_music.shutil, "which", return_value="system-ffmpeg"):
                self.assertEqual(normalize_music.find_ffmpeg(), "system-ffmpeg")
                portable.touch()
                self.assertEqual(normalize_music.find_ffmpeg(), str(portable))


@unittest.skipUnless(normalize_music.find_ffmpeg(), "FFmpeg is required for audio tests")
class NormalizeMusicTests(unittest.TestCase):
    def test_normalizes_copies_and_preserves_existing_files(self):
        ffmpeg = normalize_music.find_ffmpeg()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_dir = root / "music"
            output_dir = root / "music-normalized"
            source_dir.mkdir()
            originals = {}
            for name, volume in (("quiet.mp3", "0.1"), ("loud.mp3", "0.8")):
                source = source_dir / name
                subprocess.run([
                    ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
                    "-f", "lavfi", "-i", f"sine=frequency=1000:duration=5,volume={volume}",
                    "-c:a", "libmp3lame", str(source),
                ], check=True)
                originals[name] = source.read_bytes()

            with patch.object(normalize_music, "INPUT_DIR", source_dir), \
                    patch.object(normalize_music, "OUTPUT_DIR", output_dir), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(normalize_music.main(), 0)
                for name, original in originals.items():
                    self.assertEqual((source_dir / name).read_bytes(), original)
                    result = normalize_music.analyze(ffmpeg, output_dir / name)
                    self.assertAlmostEqual(result["measured_I"], -14, delta=0.5)

                existing = (output_dir / "quiet.mp3").read_bytes()
                self.assertEqual(normalize_music.main(), 0)
                self.assertEqual((output_dir / "quiet.mp3").read_bytes(), existing)

    def test_invalid_audio_reports_failure_without_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_dir = root / "music"
            output_dir = root / "music-normalized"
            source_dir.mkdir()
            (source_dir / "invalid.mp3").write_bytes(b"not an mp3")
            errors = io.StringIO()
            with patch.object(normalize_music, "INPUT_DIR", source_dir), \
                    patch.object(normalize_music, "OUTPUT_DIR", output_dir), \
                    contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(errors):
                self.assertEqual(normalize_music.main(), 1)
            self.assertIn("invalid.mp3", errors.getvalue())
            self.assertFalse((output_dir / "invalid.mp3").exists())


if __name__ == "__main__":
    unittest.main()
