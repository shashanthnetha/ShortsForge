"""FFmpeg: images + audio + captions → vertical Short MP4 (9:16).

Effects:
  - Ken Burns zoom (alternating zoom-in / zoom-out per scene)
  - Fadeblack crossfade between scenes (horror vibe)
  - Creepster font captions at the bottom
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = REPO_ROOT / "assets" / "fonts"
DEFAULT_FONT_FILE = "CreepsterCaps.ttf"
DEFAULT_FONT_NAME = "Creepster"

FPS = 30


def ensure_font_exists(font_file: str) -> None:
    if not FONTS_DIR.exists():
        FONTS_DIR.mkdir(parents=True, exist_ok=True)
    font_path = FONTS_DIR / font_file
    if font_path.is_file():
        return
    
    font_urls = {
        "NotoSansTelugu-Bold.ttf": "https://github.com/notofonts/noto-fonts/raw/main/hinted/ttf/NotoSansTelugu/NotoSansTelugu-Bold.ttf",
        "NotoSansDevanagari-Bold.ttf": "https://github.com/notofonts/noto-fonts/raw/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Bold.ttf",
    }
    
    url = font_urls.get(font_file)
    if not url:
        return
        
    print(f"   📥 Downloading {font_file} from Google Fonts...")
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            with open(font_path, "wb") as f:
                f.write(response.read())
        print(f"   ✅ Successfully downloaded {font_file}")
    except Exception as e:
        print(f"   ⚠ Failed to download {font_file}: {e}")

FADE_DUR = 0.5
ZOOM_AMOUNT = 0.08


def get_ffmpeg_path() -> str:
    # Check standard homebrew path on Apple Silicon
    opt_hw = Path("/opt/homebrew/bin/ffmpeg")
    if opt_hw.is_file():
        return str(opt_hw)
    # Check standard homebrew path on Intel Macs
    usr_local = Path("/usr/local/bin/ffmpeg")
    if usr_local.is_file():
        return str(usr_local)
    # Fallback to system search
    return shutil.which("ffmpeg") or "ffmpeg"


def get_ffprobe_path() -> str:
    # Check standard homebrew path on Apple Silicon
    opt_hw = Path("/opt/homebrew/bin/ffprobe")
    if opt_hw.is_file():
        return str(opt_hw)
    # Check standard homebrew path on Intel Macs
    usr_local = Path("/usr/local/bin/ffprobe")
    if usr_local.is_file():
        return str(usr_local)
    # Fallback to system search
    return shutil.which("ffprobe") or "ffprobe"


def get_video_duration(path: Path) -> float:
    try:
        cmd = [
            get_ffprobe_path(), "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(res.stdout.strip())
    except Exception as e:
        print(f"   ⚠ Could not probe video duration for {path.name}: {e}")
        return 5.0 # fallback default


def render_vertical_short(
    image_paths: list[Path],
    total_duration: float,
    audio_path: Path,
    srt_path: Path,
    out_video: Path,
    *,
    width: int = 1080,
    height: int = 1920,
    font_file: str = DEFAULT_FONT_FILE,
    font_name: str = DEFAULT_FONT_NAME,
) -> None:
    if not image_paths:
        raise ValueError("No images")
    ffmpeg_path = get_ffmpeg_path()
    if not ffmpeg_path:
        raise RuntimeError("ffmpeg not found; install it (brew install ffmpeg)")

    out_video = Path(out_video)
    out_video.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_video.parent / "_tmp_render"
    tmp.mkdir(parents=True, exist_ok=True)

    n = len(image_paths)
    clip_dur = (total_duration + (n - 1) * FADE_DUR) / n if n > 1 else total_duration
    frames_per_clip = max(int(clip_dur * FPS), 2)

    is_video_input = image_paths and image_paths[0].suffix.lower() == ".mp4"

    if is_video_input:
        print("   Detected video input clips. Processing motion clips directly...")
        for i, src in enumerate(image_paths):
            clip = tmp / f"clip_{i + 1:02d}.mp4"
            actual_dur = get_video_duration(src)
            print(f"      Processing clip {i + 1}/{n}: actual={actual_dur:.2f}s → target={clip_dur:.2f}s")
            
            # Stretch or shrink using setpts filter
            pts_ratio = clip_dur / actual_dur if actual_dur > 0 else 1.0
            
            # Scale and pad to vertical, set fps to 30, strip audio
            vf = (
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
                f"setpts={pts_ratio:.8f}*(PTS-STARTPTS),"
                f"fps={FPS}"
            )
            
            subprocess.run(
                [
                    ffmpeg_path, "-y", "-hide_banner", "-loglevel", "warning",
                    "-i", str(src),
                    "-vf", vf,
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "15",
                    "-an", # Strip audio to prevent conflicts
                    str(clip),
                ],
                check=True,
            )
    else:
        # ── 1. Pre-scale images ──────────────────────────────────────────
        for i, src in enumerate(image_paths):
            dst = tmp / f"img_{i + 1:02d}.png"
            subprocess.run(
                [
                    ffmpeg_path, "-y", "-hide_banner", "-loglevel", "warning",
                    "-i", str(src),
                    "-vf", (f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"),
                    "-update", "1", "-frames:v", "1",
                    str(dst),
                ],
                check=True,
            )

        # ── 2. Generate zoompan clips ────────────────────────────────────
        for i in range(n):
            src_img = tmp / f"img_{i + 1:02d}.png"
            clip = tmp / f"clip_{i + 1:02d}.mp4"
            zoom_rate = ZOOM_AMOUNT / frames_per_clip

            if i % 2 == 0:
                zoom_expr = f"min(zoom+{zoom_rate:.8f},{1 + ZOOM_AMOUNT})"
            else:
                zoom_expr = f"if(eq(on,1),{1 + ZOOM_AMOUNT},max(zoom-{zoom_rate:.8f},1.0))"

            vf = (
                f"zoompan=z='{zoom_expr}':"
                f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                f"d={frames_per_clip}:s={width}x{height}:fps={FPS},"
                f"format=yuv420p"
            )

            subprocess.run(
                [
                    ffmpeg_path, "-y", "-hide_banner", "-loglevel", "warning",
                    "-i", str(src_img),
                    "-vf", vf,
                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "15",
                    str(clip),
                ],
                check=True,
            )

    # ── 3. Prepare subtitles + font ──────────────────────────────────
    is_ass = srt_path.suffix.lower() == ".ass"
    sub_filename = "captions.ass" if is_ass else "captions.srt"
    shutil.copyfile(srt_path, tmp / sub_filename)

    ensure_font_exists(font_file)

    font_path = FONTS_DIR / font_file
    rendered_font_name = "Arial"
    fontsdir_arg = ""
    if font_path.is_file():
        font_dir = tmp / "_fonts"
        font_dir.mkdir(exist_ok=True)
        shutil.copyfile(font_path, font_dir / font_path.name)
        rendered_font_name = font_name
        fontsdir_arg = ":fontsdir=_fonts"
    else:
        print(f"   ⚠ Font {font_path} not found — using {rendered_font_name}")

    if is_ass:
        # Update the font name dynamically in the ASS file itself!
        ass_content = (tmp / "captions.ass").read_text(encoding="utf-8")
        if "Style: Default," in ass_content:
            import re
            ass_content = re.sub(r'(Style:\s*Default,)[^,]+', r'\g<1>' + rendered_font_name, ass_content)
        (tmp / "captions.ass").write_text(ass_content, encoding="utf-8")
        sub_filter = f"subtitles=filename=captions.ass{fontsdir_arg}"
    else:
        force_style = (
            f"FontName={rendered_font_name},"
            f"FontSize=18,"
            f"PrimaryColour=&H00FFFFFF,"
            f"OutlineColour=&H00000000,"
            f"BackColour=&H96000000,"
            f"BorderStyle=4,Outline=1,Bold=1,"
            f"Shadow=0,Alignment=2,"
            f"MarginV=15,MarginL=20,MarginR=20"
        )
        sub_filter = f"subtitles=filename=captions.srt{fontsdir_arg}:force_style='{force_style}'"

    # ── 4. Build xfade chain + subtitles ─────────────────────────────
    # Check if subtitles filter is supported
    has_subtitles_filter = False
    try:
        res = subprocess.run([ffmpeg_path, "-filters"], capture_output=True, text=True)
        has_subtitles_filter = "subtitles" in res.stdout
    except Exception:
        pass

    # Scan for background music
    music_dir = REPO_ROOT / "assets" / "music"
    bg_music_path = None
    if music_dir.is_dir():
        music_files = [p for p in music_dir.iterdir() if p.suffix.lower() in [".mp3", ".wav", ".m4a", ".ogg"]]
        if music_files:
            import random
            bg_music_path = random.choice(music_files)
            print(f"   🎵 Background music selected: {bg_music_path.name}")

    # Scan for sfx triggers in run directory
    sfx_triggers = []
    sfx_json_path = audio_path.parent / "sfx_triggers.json"
    if sfx_json_path.is_file():
        import json
        try:
            sfx_triggers = json.loads(sfx_json_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"   ⚠ Failed to parse sfx_triggers.json: {e}")

    inputs: list[str] = []
    for i in range(n):
        inputs += ["-i", f"clip_{i + 1:02d}.mp4"]
    
    # Input index n is the main voiceover audio
    inputs += ["-i", str(audio_path.resolve())]
    
    # Optional bg music at input index n + 1
    music_input_idx = None
    if bg_music_path:
        music_input_idx = n + 1
        inputs += ["-stream_loop", "-1", "-i", str(bg_music_path.resolve())]
        
    # Append sfx files as additional inputs
    sfx_loaded = []
    sfx_dir = REPO_ROOT / "assets" / "sfx"
    sfx_start_idx = (n + 2) if bg_music_path else (n + 1)
    
    for idx, trigger in enumerate(sfx_triggers):
        name = trigger["name"]
        offset_ms = trigger["offset_ms"]
        
        sfx_file = None
        if sfx_dir.is_dir():
            for ext in [".mp3", ".wav", ".m4a", ".ogg"]:
                candidate = sfx_dir / f"{name}{ext}"
                if candidate.is_file():
                    sfx_file = candidate
                    break
                    
        if sfx_file:
            inputs += ["-i", str(sfx_file.resolve())]
            sfx_loaded.append({
                "input_idx": sfx_start_idx + len(sfx_loaded),
                "offset_ms": offset_ms,
                "name": name
            })
            print(f"   🔊 Loaded SFX: {name} (delayed {offset_ms/1000:.2f}s)")
        else:
            print(f"   ⚠ SFX file not found: {name}")

    filter_parts: list[str] = []

    if n == 1:
        if has_subtitles_filter:
            filter_parts.append(
                f"[0:v]{sub_filter}[final]"
            )
        else:
            print("   ⚠ FFmpeg does not support subtitles filter. Generating video without burned subtitles.")
            filter_parts.append(f"[0:v]null[final]")
    else:
        prev = "[0:v]"
        for i in range(n - 1):
            offset = (i + 1) * (clip_dur - FADE_DUR)
            next_v = f"[{i + 1}:v]"
            out = f"[x{i}]"
            filter_parts.append(
                f"{prev}{next_v}xfade=transition=fadeblack:"
                f"duration={FADE_DUR:.4f}:offset={offset:.4f}{out}"
            )
            prev = out
        if has_subtitles_filter:
            filter_parts.append(
                f"{prev}{sub_filter}[final]"
            )
        else:
            print("   ⚠ FFmpeg does not support subtitles filter. Generating video without burned subtitles.")
            filter_parts.append(f"{prev}null[final]")

    # Build audio filter complex
    voice_label = f"[{n}:a]"
    has_audio_filter = False
    
    if sfx_loaded:
        sfx_labels = []
        for i, s in enumerate(sfx_loaded):
            label = f"[sfx_delay_{i}]"
            filter_parts.append(f"[{s['input_idx']}:a]volume=0.9,adelay={s['offset_ms']}|{s['offset_ms']}{label}")
            sfx_labels.append(label)
            
        mix_inputs = voice_label + "".join(sfx_labels)
        if bg_music_path:
            voice_label = "[voice_sfx_mixed]"
            filter_parts.append(f"{mix_inputs}amix=inputs={1 + len(sfx_loaded)}:duration=first{voice_label}")
        else:
            voice_label = "[audio_out]"
            filter_parts.append(f"{mix_inputs}amix=inputs={1 + len(sfx_loaded)}:duration=first{voice_label}")
            has_audio_filter = True
            
    if bg_music_path:
        music_label = f"[bg_music_vol]"
        filter_parts.append(f"[{music_input_idx}:a]volume=0.08{music_label}")
        filter_parts.append(f"{voice_label}{music_label}amix=inputs=2:duration=first[audio_out]")
        has_audio_filter = True

    fc = ";\n".join(filter_parts)

    cmd = [
        ffmpeg_path, "-y", "-hide_banner", "-loglevel", "warning",
        *inputs,
        "-filter_complex", fc,
        "-map", "[final]",
    ]
    if has_audio_filter:
        cmd += ["-map", "[audio_out]"]
    else:
        cmd += ["-map", f"{n}:a"]

    cmd += [
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        str(out_video.resolve()),
    ]
    subprocess.run(cmd, check=True, cwd=str(tmp))

    # ── cleanup ──────────────────────────────────────────────────────
    shutil.rmtree(tmp, ignore_errors=True)
