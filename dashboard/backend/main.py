# dashboard/backend/main.py
import os
import sys
import asyncio
import importlib
import subprocess
import random
from pathlib import Path
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

# Import the existing presets module
import pipeline.channel_presets

app = FastAPI(title="ShortsForge AI API")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active subprocess store
active_process = None
active_run_id = None
live_logs = []

class PresetUpdate(BaseModel):
    id: str
    label: str
    groq_system_hint: str
    segment_count: int
    topic_pool: List[str]
    image_style_suffix: Optional[str] = None
    image_negative_prompt: Optional[str] = None
    language: Optional[str] = None
    tts_voice: Optional[str] = None
    caption_font: Optional[str] = None
    caption_font_name: Optional[str] = None
    min_words: Optional[int] = None
    variants: Optional[List[dict]] = None
    topic_rotation: Optional[str] = None
    yt_token_env: Optional[str] = None
    extra_yt_token_envs: Optional[List[str]] = None
    visual_mode: Optional[str] = "image"
    category: Optional[str] = None
    emoji: Optional[str] = None

class TriggerRun(BaseModel):
    channel: str
    topic: Optional[str] = ""
    upload: bool = False
    privacy: str = "private"
    visual_mode: Optional[str] = None
    language: Optional[str] = None
    gender: Optional[str] = None

@app.get("/api/presets")
def get_presets():
    """Dynamically load and return the channel presets."""
    importlib.reload(pipeline.channel_presets)
    return pipeline.channel_presets.PRESETS

@app.post("/api/presets")
def update_preset(preset: PresetUpdate):
    """Save the updated preset to pipeline/channel_presets.py."""
    importlib.reload(pipeline.channel_presets)
    presets = pipeline.channel_presets.PRESETS
    
    # Update dict representation
    preset_dict = preset.dict(exclude_none=True)
    presets[preset.id] = preset_dict

    # Format as valid python code and write it back
    import pprint
    formatted_presets = pprint.pformat(presets, indent=4, width=120)
    
    file_path = REPO_ROOT / "pipeline" / "channel_presets.py"
    
    content = f'''"""Channel niches: system prompt + defaults for Groq script generation.

Each preset includes a topic_pool — a list of setting/situation ideas.
One is picked randomly per run if no --topic is provided, ensuring variety.
"""

from __future__ import annotations

from typing import TypedDict


class Variant(TypedDict, total=False):
    """One output variant — same images, different audio/subs/upload target."""
    lang: str  # "en", "hi", etc. used as key in Groq response
    label: str  # human-readable for logs
    tts_voice: str  # Edge TTS voice (e.g. "hi-IN-MadhurNeural")
    caption_font: str  # font filename inside assets/fonts/
    caption_font_name: str  # FFmpeg-visible font family name
    yt_token_env: str  # env var name for YouTube refresh token (e.g. "YT_REFRESH_TOKEN_HI")
    min_words: int  # min word count for narration validation


class ChannelPreset(TypedDict, total=False):
    id: str
    label: str
    groq_system_hint: str
    segment_count: int  # images + script beats
    topic_pool: list[str]
    image_style_suffix: str  # appended to every image prompt
    image_negative_prompt: str  # passed as negative prompt
    # Single-variant fields (backward compat — used when `variants` is absent):
    language: str
    tts_voice: str
    caption_font: str
    caption_font_name: str
    min_words: int  # min word count for narration validation (single-variant)
    # Multi-variant mode — Groq returns translations for each lang, pipeline renders+uploads per variant.
    variants: list[Variant]
    # topic_rotation: "myth" → pipeline/myth_topics.py (IST day theme + no-repeat within theme)
    topic_rotation: str
    # Single-variant YouTube upload: which env var holds this channel's refresh token
    yt_token_env: str
    # Extra uploads: same MP4 uploaded to additional channels using these env var names
    extra_yt_token_envs: list[str]
    # Visual mode: "image" or "video" (defaults to "image")
    visual_mode: str
    # UI Custom fields
    category: str
    emoji: str


PRESETS: dict[str, ChannelPreset] = {formatted_presets}


def list_channel_ids() -> list[str]:
    return sorted(PRESETS.keys())


def get_preset(channel_id: str) -> ChannelPreset:
    key = channel_id.strip().lower().replace("-", "_")
    if key not in PRESETS:
        raise KeyError(f"Unknown channel preset {{channel_id!r}}. Try: {{', '.join(list_channel_ids())}}")
    return PRESETS[key]
'''
    try:
        file_path.write_text(content, encoding="utf-8")
        return {"success": True, "message": f"Preset '{preset.id}' updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write presets file: {str(e)}")

@app.delete("/api/presets/{preset_id}")
def delete_preset(preset_id: str):
    """Delete a preset from pipeline/channel_presets.py."""
    importlib.reload(pipeline.channel_presets)
    presets = pipeline.channel_presets.PRESETS
    
    if preset_id not in presets:
        raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")
        
    del presets[preset_id]

    import pprint
    formatted_presets = pprint.pformat(presets, indent=4, width=120)
    
    file_path = REPO_ROOT / "pipeline" / "channel_presets.py"
    
    content = f'''"""Channel niches: system prompt + defaults for Groq script generation.

Each preset includes a topic_pool — a list of setting/situation ideas.
One is picked randomly per run if no --topic is provided, ensuring variety.
"""

from __future__ import annotations

from typing import TypedDict


class Variant(TypedDict, total=False):
    """One output variant — same images, different audio/subs/upload target."""
    lang: str  # "en", "hi", etc. used as key in Groq response
    label: str  # human-readable for logs
    tts_voice: str  # Edge TTS voice (e.g. "hi-IN-MadhurNeural")
    caption_font: str  # font filename inside assets/fonts/
    caption_font_name: str  # FFmpeg-visible font family name
    yt_token_env: str  # env var name for YouTube refresh token (e.g. "YT_REFRESH_TOKEN_HI")
    min_words: int  # min word count for narration validation


class ChannelPreset(TypedDict, total=False):
    id: str
    label: str
    groq_system_hint: str
    segment_count: int  # images + script beats
    topic_pool: list[str]
    image_style_suffix: str  # appended to every image prompt
    image_negative_prompt: str  # passed as negative prompt
    # Single-variant fields (backward compat — used when `variants` is absent):
    language: str
    tts_voice: str
    caption_font: str
    caption_font_name: str
    min_words: int  # min word count for narration validation (single-variant)
    # Multi-variant mode — Groq returns translations for each lang, pipeline renders+uploads per variant.
    variants: list[Variant]
    # topic_rotation: "myth" → pipeline/myth_topics.py (IST day theme + no-repeat within theme)
    topic_rotation: str
    # Single-variant YouTube upload: which env var holds this channel's refresh token
    yt_token_env: str
    # Extra uploads: same MP4 uploaded to additional channels using these env var names
    extra_yt_token_envs: list[str]
    # Visual mode: "image" or "video" (defaults to "image")
    visual_mode: str
    # UI Custom fields
    category: str
    emoji: str


PRESETS: dict[str, ChannelPreset] = {formatted_presets}


def list_channel_ids() -> list[str]:
    return sorted(PRESETS.keys())


def get_preset(channel_id: str) -> ChannelPreset:
    key = channel_id.strip().lower().replace("-", "_")
    if key not in PRESETS:
        raise KeyError(f"Unknown channel preset {{channel_id!r}}. Try: {{', '.join(list_channel_ids())}}")
    return PRESETS[key]
'''
    try:
        file_path.write_text(content, encoding="utf-8")
        return {"success": True, "message": f"Preset '{preset_id}' deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write presets file: {str(e)}")

@app.get("/api/runs")
def list_runs():
    """List all past generated video runs."""
    runs_dir = REPO_ROOT / "output" / "runs"
    if not runs_dir.exists():
        return []
    
    runs = []
    for path in sorted(runs_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if path.is_dir() and "_" in path.name:
            parts = path.name.split("_")
            channel = parts[0]
            # Handle timestamps with underscores (e.g. channel_20260615_120000)
            timestamp = "_".join(parts[1:])
            
            # Check for files
            has_video = any(p.suffix == ".mp4" for p in path.iterdir())
            has_script = (path / "script.json").exists()
            has_images = (path / "images").exists() and len(list((path / "images").glob("*.png"))) > 0
            first_image = None
            if has_images:
                img_list = sorted((path / "images").glob("*.png"))
                if img_list:
                    first_image = img_list[0].name
            
            runs.append({
                "id": path.name,
                "channel": channel,
                "timestamp": timestamp,
                "has_video": has_video,
                "has_script": has_script,
                "has_images": has_images,
                "first_image": first_image,
                "path": str(path)
            })
    return runs

@app.get("/api/runs/status")
def get_run_status():
    """Check running process status and retrieve logs."""
    return {
        "running": active_process is not None,
        "run_id": active_run_id,
        "logs": live_logs
    }

@app.post("/api/runs/cancel")
def cancel_run():
    """Cancel the active generation process."""
    global active_process, active_run_id
    if active_process is None:
        return {"success": True, "message": "No process running"}
    
    try:
        active_process.terminate()
        active_process = None
        active_run_id = None
        return {"success": True, "message": "Process terminated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to terminate process: {str(e)}")

@app.post("/api/runs/trigger")
async def trigger_run(run_req: TriggerRun):
    """Trigger scripts/run_short.py in a background process."""
    global active_process, active_run_id, live_logs
    if active_process is not None:
        raise HTTPException(status_code=400, detail="Another generation process is currently running.")
    
    # Clear previous logs
    live_logs = []
    
    cmd = [
        str(REPO_ROOT / ".venv" / "bin" / "python"),
        "-u", # Force unbuffered stdout/stderr
        str(REPO_ROOT / "scripts" / "run_short.py"),
        "--channel", run_req.channel,
    ]
    if run_req.topic:
        cmd.extend(["--topic", run_req.topic])
    if run_req.upload:
        cmd.append("--upload")
        cmd.extend(["--privacy", run_req.privacy])
    if run_req.visual_mode:
        cmd.extend(["--visual-mode", run_req.visual_mode])
    if run_req.language:
        cmd.extend(["--language", run_req.language])
    if run_req.gender:
        cmd.extend(["--gender", run_req.gender])
        
    active_run_id = f"{run_req.channel}_pending"
    
    try:
        # Launch process with unbuffered environment variables
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        active_process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(REPO_ROOT),
            env=env
        )
        
        # Monitor progress asynchronously
        asyncio.create_task(monitor_process(active_process))
        return {"success": True, "message": "Bot process triggered successfully"}
    except Exception as e:
        active_process = None
        active_run_id = None
        raise HTTPException(status_code=500, detail=f"Failed to launch bot: {str(e)}")

async def monitor_process(process):
    """Read process output line-by-line and populate live_logs."""
    global active_process, active_run_id, live_logs
    
    while True:
        line = await process.stdout.readline()
        if not line:
            break
        decoded = line.decode("utf-8", errors="replace").rstrip()
        live_logs.append(decoded)
        print(f"[Bot Log] {decoded}") # Mirror to server console
        
    await process.wait()
    active_process = None
    active_run_id = None
    live_logs.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    live_logs.append("✓ Execution finished.")

@app.get("/api/runs/{run_id}")
def get_run_details(run_id: str):
    """Retrieve detailed information and JSON script for a specific run."""
    run_dir = REPO_ROOT / "output" / "runs" / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail="Run not found")
    
    script_data = {}
    script_path = run_dir / "script.json"
    if script_path.exists():
        import json
        try:
            script_data = json.loads(script_path.read_text(encoding="utf-8"))
        except Exception:
            pass
            
    images = []
    images_dir = run_dir / "images"
    if images_dir.exists():
        images = [p.name for p in sorted(images_dir.glob("*.png"))]
        
    videos = [p.name for p in run_dir.glob("*.mp4")]
    audios = [p.name for p in run_dir.glob("*.mp3")]
    
    parts = run_id.split("_")
    channel = parts[0] if parts else "unknown"
    
    return {
        "id": run_id,
        "channel": channel,
        "script": script_data,
        "images": images,
        "videos": videos,
        "audios": audios
    }

class UploadRunRequest(BaseModel):
    run_id: str
    video_filename: str
    channel: str
    privacy: str = "private"

@app.post("/api/runs/upload")
def upload_existing_video(req: UploadRunRequest):
    """Upload a previously generated video to YouTube."""
    run_dir = REPO_ROOT / "output" / "runs" / req.run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail="Run not found")
        
    video_path = run_dir / req.video_filename
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")
        
    title = "Shorts Video"
    description = ""
    script_path = run_dir / "script.json"
    
    if script_path.exists():
        import json
        try:
            pack = json.loads(script_path.read_text(encoding="utf-8"))
            lang_suffix = ""
            if "_" in req.video_filename:
                basename = req.video_filename.rsplit(".", 1)[0]
                if "_" in basename:
                    lang_suffix = basename.split("_", 1)[1]

            if lang_suffix and "variants" in pack and lang_suffix in pack["variants"]:
                node = pack["variants"][lang_suffix]
                title = node.get("youtube_title", title)
                description = node.get("youtube_description", "")
            else:
                title = pack.get("youtube_title", title)
                description = pack.get("youtube_description", "")
        except Exception as e:
            print(f"Error reading script.json for upload: {e}")

    # ── Hashtag injection ──────────────────────────────────────────────────
    # Niche-specific hashtag sets keyed by preset id
    NICHE_HASHTAGS: dict[str, list[str]] = {
        "cricket_stories":   ["#Cricket", "#CricketShorts", "#CricketHistory", "#CricketFacts",
                               "#Shorts", "#Cricket365", "#TestCricket", "#Sachin", "#IPL"],
        "dark_psychology":   ["#DarkPsychology", "#Psychology", "#MindHacks", "#Manipulation",
                               "#BodyLanguage", "#Shorts", "#MindControl", "#Persuasion"],
        "f1_stories":        ["#F1", "#Formula1", "#F1Shorts", "#Racing", "#GrandPrix",
                               "#Shorts", "#F1History", "#Motorsport", "#Hamilton", "#Verstappen"],
        "facts":             ["#Facts", "#DidYouKnow", "#MindBlowing", "#AmazingFacts",
                               "#Shorts", "#FunFacts", "#Science", "#LearnOnShorts"],
        "ghost_stories":     ["#GhostStories", "#Horror", "#Scary", "#Paranormal",
                               "#Shorts", "#TrueStories", "#Haunted", "#HorrorShorts"],
        "hindi_myth":        ["#Mythology", "#HinduMythology", "#IndianHistory", "#Shorts",
                               "#Devotional", "#Bharat", "#HindiShorts", "#Dharma"],
        "finance_secrets":   ["#Finance", "#MoneyTips", "#WealthBuilding", "#Investing",
                               "#Shorts", "#FinanceShorts", "#PassiveIncome", "#StockMarket"],
        "history_micro":     ["#History", "#WorldHistory", "#HistoryFacts", "#Shorts",
                               "#HistoryShorts", "#AncientHistory", "#DidYouKnow"],
    }
    DEFAULT_HASHTAGS = ["#Shorts", "#Viral", "#ShortVideo", "#Facts", "#LearnOnShorts"]

    niche_tags = NICHE_HASHTAGS.get(req.channel, DEFAULT_HASHTAGS)
    hashtag_line = " ".join(niche_tags)

    # Title: ensure #Shorts is appended (YouTube's key reach booster)
    if "#Shorts" not in title:
        title = f"{title} #Shorts"

    # Description: append hashtags block at the end (separated by blank line)
    if hashtag_line not in description:
        description = f"{description.rstrip()}\n\n{hashtag_line}"
    # ──────────────────────────────────────────────────────────────────────

            
    try:
        import pipeline.channel_presets
        importlib.reload(pipeline.channel_presets)
        preset = pipeline.channel_presets.get_preset(req.channel)
        
        yt_token_env = "YT_REFRESH_TOKEN"
        lang_suffix = ""
        if "_" in req.video_filename:
            basename = req.video_filename.rsplit(".", 1)[0]
            if "_" in basename:
                lang_suffix = basename.split("_", 1)[1]
                
        if lang_suffix and preset.get("variants"):
            for v in preset["variants"]:
                if v["lang"] == lang_suffix:
                    yt_token_env = v.get("yt_token_env", yt_token_env)
                    break
        else:
            yt_token_env = preset.get("yt_token_env") or "YT_REFRESH_TOKEN"
            
        extra_envs = preset.get("extra_yt_token_envs") or []
    except Exception:
        yt_token_env = "YT_REFRESH_TOKEN"
        extra_envs = []
        
    from pipeline.youtube_upload import upload_short
    
    try:
        primary_token_env = yt_token_env
        primary_token = os.environ.get(primary_token_env, "").strip()
        if not primary_token and primary_token_env != "YT_REFRESH_TOKEN":
            primary_token = os.environ.get("YT_REFRESH_TOKEN", "").strip()

        print(f"Uploading {video_path} to primary channel using {yt_token_env}")
        primary_vid = upload_short(
            video_path,
            title,
            description,
            privacy_status=req.privacy,
            refresh_token_env=yt_token_env,
        )
        uploaded_urls = [f"https://www.youtube.com/shorts/{primary_vid}"]
        
        for env_name in extra_envs:
            extra_token = os.environ.get(env_name, "").strip()
            if not extra_token:
                print(f"Skipping extra upload for {env_name} — env var is not set")
                continue
            if extra_token == primary_token:
                print(f"Skipping extra upload for {env_name} — same as primary token")
                continue
                
            print(f"Uploading {video_path} to extra channel using {env_name}")
            extra_vid = upload_short(
                video_path,
                title,
                description,
                privacy_status=req.privacy,
                refresh_token_env=env_name,
            )
            uploaded_urls.append(f"https://www.youtube.com/shorts/{extra_vid}")
            
        return {"success": True, "urls": uploaded_urls}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/api/runs/{run_id}/files/{filename:path}")
def serve_run_file(run_id: str, filename: str):
    """Serve media files (video, images, audio) directly from a run directory."""
    file_path = REPO_ROOT / "output" / "runs" / run_id / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

@app.get("/api/config")
def get_config():
    """Read .env configuration key-value pairs."""
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return {}
    
    config = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            config[k.strip()] = v.strip()
    return config

@app.post("/api/config")
def update_config(config: Dict[str, str]):
    """Update .env configuration file safely."""
    env_path = REPO_ROOT / ".env"
    lines = []
    
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()
        
    updated_keys = set()
    new_lines = []
    
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            k, _ = stripped.split("=", 1)
            k_strip = k.strip()
            if k_strip in config:
                new_lines.append(f"{k_strip}={config[k_strip]}")
                updated_keys.add(k_strip)
                continue
        new_lines.append(line)
        
    # Append keys that were not in the file originally
    for k, v in config.items():
        if k not in updated_keys:
            new_lines.append(f"{k}={v}")
            
    try:
        env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save .env file: {str(e)}")


class UpdateScriptRequest(BaseModel):
    youtube_title: Optional[str] = None
    youtube_description: Optional[str] = None
    full_narration: Optional[str] = None
    variant: Optional[str] = None


class RegenerateSceneRequest(BaseModel):
    scene_index: int  # 1-indexed
    prompt: str
    visual_mode: Optional[str] = "image"


@app.post("/api/runs/{run_id}/update-script")
async def update_run_script(run_id: str, req: UpdateScriptRequest):
    run_dir = REPO_ROOT / "output" / "runs" / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail="Run not found")
        
    script_path = run_dir / "script.json"
    if not script_path.exists():
        raise HTTPException(status_code=404, detail="script.json not found for this run")
        
    import json
    try:
        script_data = json.loads(script_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse script.json: {str(e)}")
        
    variant = req.variant
    if variant and "variants" in script_data and variant in script_data["variants"]:
        if req.youtube_title is not None:
            script_data["variants"][variant]["youtube_title"] = req.youtube_title
        if req.youtube_description is not None:
            script_data["variants"][variant]["youtube_description"] = req.youtube_description
        if req.full_narration is not None:
            script_data["variants"][variant]["full_narration"] = req.full_narration
        narration = script_data["variants"][variant]["full_narration"]
    else:
        if req.youtube_title is not None:
            script_data["youtube_title"] = req.youtube_title
        if req.youtube_description is not None:
            script_data["youtube_description"] = req.youtube_description
        if req.full_narration is not None:
            script_data["full_narration"] = req.full_narration
        narration = script_data.get("full_narration", "")

    # Save updated script data
    script_path.write_text(json.dumps(script_data, indent=2, ensure_ascii=False), encoding="utf-8")
    
    # Re-synthesize audio and captions if narration changed
    channel = run_id.split("_")[0]
    import pipeline.channel_presets
    importlib.reload(pipeline.channel_presets)
    try:
        preset = pipeline.channel_presets.get_preset(channel)
    except Exception:
        preset = {}
        
    suffix = f"_{variant}" if variant else ""
    target_lang = variant or preset.get("language") or "en"
    
    from scripts.run_short import resolve_voice_and_font
    
    gender = os.environ.get("EDGE_TTS_GENDER")
    
    if variant and preset.get("variants"):
        v_preset = next((v for v in preset["variants"] if v["lang"] == variant), {})
        resolved_voice, resolved_font_file, resolved_font_name = resolve_voice_and_font(
            lang=target_lang,
            gender=gender,
            default_voice=v_preset.get("tts_voice"),
            default_font_file=v_preset.get("caption_font", "CreepsterCaps.ttf"),
            default_font_name=v_preset.get("caption_font_name", "Creepster")
        )
        rate = v_preset.get("tts_rate")
    else:
        resolved_voice, resolved_font_file, resolved_font_name = resolve_voice_and_font(
            lang=target_lang,
            gender=gender,
            default_voice=preset.get("tts_voice") or os.environ.get("EDGE_TTS_VOICE"),
            default_font_file=preset.get("caption_font", "CreepsterCaps.ttf"),
            default_font_name=preset.get("caption_font_name", "Creepster")
        )
        rate = preset.get("tts_rate") or os.environ.get("EDGE_TTS_RATE")
        
    audio_path = run_dir / f"voiceover{suffix}.mp3"
    srt_path = run_dir / f"captions{suffix}.ass"
    video_path = run_dir / f"short{suffix}.mp4"
    
    from pipeline.edge_tts_synth import synthesize_full
    from pipeline.captions import build_ass
    from pipeline.render_short import render_vertical_short
    
    print(f"Re-synthesizing voiceover for variant '{target_lang}'...")
    total_dur, sentence_timings = synthesize_full(narration, audio_path, voice=resolved_voice, rate=rate)
    
    print("Re-building subtitles...")
    build_ass(sentence_timings, srt_path, total_dur, font_name=resolved_font_name)
    
    # Collect visual clips in order
    visual_dir = run_dir / ("videos" if (run_dir / "videos").exists() else "images")
    ext = "*.mp4" if visual_dir.name == "videos" else "*.png"
    image_paths = sorted(list(visual_dir.glob(ext)))
    
    if not image_paths:
        if (run_dir / "images").exists():
            image_paths = sorted(list((run_dir / "images").glob("*.png")))
        elif (run_dir / "videos").exists():
            image_paths = sorted(list((run_dir / "videos").glob("*.mp4")))
            
    if not image_paths:
        raise HTTPException(status_code=400, detail="No visual clips found in run directory to compile video")
        
    print(f"Re-rendering final vertical short video: {video_path}")
    render_vertical_short(
        image_paths, total_dur, audio_path, srt_path, video_path,
        font_file=resolved_font_file, font_name=resolved_font_name
    )
    
    return {
        "success": True, 
        "message": "Script updated and video re-rendered successfully",
        "details": get_run_details(run_id)
    }


@app.post("/api/runs/{run_id}/regenerate-scene")
async def regenerate_run_scene(run_id: str, req: RegenerateSceneRequest):
    run_dir = REPO_ROOT / "output" / "runs" / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail="Run not found")
        
    script_path = run_dir / "script.json"
    if not script_path.exists():
        raise HTTPException(status_code=404, detail="script.json not found for this run")
        
    import json
    try:
        script_data = json.loads(script_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse script.json: {str(e)}")
        
    image_prompts = script_data.get("image_prompts", [])
    idx = req.scene_index - 1
    if idx < 0 or idx >= len(image_prompts):
        raise HTTPException(status_code=400, detail=f"Invalid scene index: {req.scene_index}. Must be 1 to {len(image_prompts)}")
        
    image_prompts[idx] = req.prompt
        
    # Save script.json
    script_path.write_text(json.dumps(script_data, indent=2, ensure_ascii=False), encoding="utf-8")
    
    # Regenerate scene visual via DeAPI
    channel = run_id.split("_")[0]
    import pipeline.channel_presets
    importlib.reload(pipeline.channel_presets)
    try:
        preset = pipeline.channel_presets.get_preset(channel)
    except Exception:
        preset = {}
        
    visual_mode = req.visual_mode or preset.get("visual_mode") or "image"
    style_suffix = preset.get("image_style_suffix")
    
    w = int(os.environ.get("DEAPI_IMAGE_WIDTH", "768"))
    h = int(os.environ.get("DEAPI_IMAGE_HEIGHT", "768"))
    
    from pipeline.images import save_scene_image, save_scene_video, full_visual_prompt
    
    visual_prompt = full_visual_prompt(image_prompts[idx], style_suffix=style_suffix)
    
    if visual_mode == "video":
        visual_dir = run_dir / "videos"
        visual_dir.mkdir(parents=True, exist_ok=True)
        out_path = visual_dir / f"scene_{req.scene_index:02d}.mp4"
        frames = int(os.environ.get("DEAPI_VIDEO_FRAMES", "120"))
        fps = int(os.environ.get("DEAPI_VIDEO_FPS", "24"))
        status, detail = save_scene_video(req.scene_index, visual_prompt, out_path, width=w, height=h, frames=frames, fps=fps)
    else:
        visual_dir = run_dir / "images"
        visual_dir.mkdir(parents=True, exist_ok=True)
        out_path = visual_dir / f"scene_{req.scene_index:02d}.png"
        negative = os.environ.get("IMAGE_NEGATIVE_PROMPT") or preset.get("image_negative_prompt") or DEFAULT_NEGATIVE
        status, detail = save_scene_image(req.scene_index, visual_prompt, out_path, width=w, height=h, negative=negative)
        
    if status != "ok":
        raise HTTPException(status_code=500, detail=f"DeAPI generation failed: {detail}")
        
    # Re-compile video
    from scripts.run_short import resolve_voice_and_font
    from pipeline.render_short import render_vertical_short
    
    ext = "*.mp4" if visual_mode == "video" else "*.png"
    image_paths = sorted(list(visual_dir.glob(ext)))
    if not image_paths:
        raise HTTPException(status_code=500, detail="No visual clips found to re-compile video")
        
    audio_files = list(run_dir.glob("voiceover*.mp3"))
    if not audio_files:
        raise HTTPException(status_code=400, detail="No synthesized voiceover audio files found to compile video")
        
    for audio_path in audio_files:
        suffix = audio_path.name.replace("voiceover", "").replace(".mp3", "")
        variant_lang = suffix.lstrip("_") if suffix else None
        target_lang = variant_lang or preset.get("language") or "en"
        
        gender = os.environ.get("EDGE_TTS_GENDER")
        if variant_lang and preset.get("variants"):
            v_preset = next((v for v in preset["variants"] if v["lang"] == variant_lang), {})
            _, resolved_font_file, resolved_font_name = resolve_voice_and_font(
                lang=target_lang,
                gender=gender,
                default_voice=v_preset.get("tts_voice"),
                default_font_file=v_preset.get("caption_font", "CreepsterCaps.ttf"),
                default_font_name=v_preset.get("caption_font_name", "Creepster")
            )
        else:
            _, resolved_font_file, resolved_font_name = resolve_voice_and_font(
                lang=target_lang,
                gender=gender,
                default_voice=preset.get("tts_voice") or os.environ.get("EDGE_TTS_VOICE"),
                default_font_file=preset.get("caption_font", "CreepsterCaps.ttf"),
                default_font_name=preset.get("caption_font_name", "Creepster")
            )
            
        srt_path = run_dir / f"captions{suffix}.ass"
        if not srt_path.exists():
            srt_path = run_dir / f"captions{suffix}.srt"
        video_path = run_dir / f"short{suffix}.mp4"
        
        from pipeline.edge_tts_synth import _ffprobe_duration
        try:
            total_dur = _ffprobe_duration(audio_path)
        except Exception:
            total_dur = 30.0
            
        render_vertical_short(
            image_paths, total_dur, audio_path, srt_path, video_path,
            font_file=resolved_font_file, font_name=resolved_font_name
        )
        
    return {
        "success": True,
        "message": f"Scene {req.scene_index} regenerated and video(s) re-compiled",
        "details": get_run_details(run_id)
    }


@app.get("/api/runs/{run_id}/captions")
def get_run_captions(run_id: str):
    """Parse captions.ass and return timecoded subtitle segments as JSON."""
    import re
    run_dir = REPO_ROOT / "output" / "runs" / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail="Run not found")
    
    ass_path = run_dir / "captions.ass"
    if not ass_path.exists():
        return {"captions": [], "total_duration": 0}

    captions = []
    total_duration = 0.0
    
    def timecode_to_seconds(tc: str) -> float:
        """Convert H:MM:SS.CC to float seconds."""
        try:
            parts = tc.split(":")
            hours = int(parts[0])
            minutes = int(parts[1])
            sec_parts = parts[2].split(".")
            seconds = int(sec_parts[0])
            centiseconds = int(sec_parts[1]) if len(sec_parts) > 1 else 0
            return hours * 3600 + minutes * 60 + seconds + centiseconds / 100.0
        except Exception:
            return 0.0

    # Strip ASS override tags like {\k44} or {\an8}
    tag_re = re.compile(r"\{[^}]*\}")
    
    try:
        content = ass_path.read_text(encoding="utf-8", errors="replace")
        for line in content.splitlines():
            if not line.startswith("Dialogue:"):
                continue
            # Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
            parts = line.split(",", 9)
            if len(parts) < 10:
                continue
            start_tc = parts[1].strip()
            end_tc = parts[2].strip()
            raw_text = parts[9].strip()
            clean_text = tag_re.sub("", raw_text).strip()
            if not clean_text:
                continue
            
            start = timecode_to_seconds(start_tc)
            end = timecode_to_seconds(end_tc)
            total_duration = max(total_duration, end)
            captions.append({
                "start": round(start, 3),
                "end": round(end, 3),
                "text": clean_text
            })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse captions: {e}")

    return {"captions": captions, "total_duration": round(total_duration, 3)}


@app.get("/api/stats")
def get_channel_stats(channel: str = "facts"):
    """Fetch YouTube channel statistics or return realistic mock data."""
    import importlib
    import pipeline.channel_presets
    importlib.reload(pipeline.channel_presets)
    try:
        preset = pipeline.channel_presets.get_preset(channel)
        yt_token_env = preset.get("yt_token_env") or "YT_REFRESH_TOKEN"
        if not yt_token_env and preset.get("variants"):
            yt_token_env = preset["variants"][0].get("yt_token_env") or "YT_REFRESH_TOKEN"
    except Exception:
        yt_token_env = "YT_REFRESH_TOKEN"

    stats = None
    try:
        from pipeline.youtube_upload import _get_creds
        from googleapiclient.discovery import build
        
        client_secret = Path(os.environ.get("YT_CLIENT_SECRET", "secrets/client_secret.json"))
        token = Path(os.environ.get("YT_TOKEN", "secrets/youtube_token.json"))
        
        has_env = os.environ.get("YT_CLIENT_ID") and os.environ.get("YT_CLIENT_SECRET_VALUE") and os.environ.get(yt_token_env)
        has_files = client_secret.is_file() or token.is_file()
        
        if has_env or has_files:
            creds = _get_creds(yt_token_env)
            youtube = build("youtube", "v3", credentials=creds)
            resp = youtube.channels().list(part="snippet,statistics", mine=True).execute()
            if resp.get("items"):
                item = resp["items"][0]
                snippet = item.get("snippet", {})
                statistics = item.get("statistics", {})
                
                stats = {
                    "channel_title": snippet.get("title"),
                    "thumbnail_url": snippet.get("thumbnails", {}).get("default", {}).get("url"),
                    "subscribers": int(statistics.get("subscriberCount", 0)),
                    "views": int(statistics.get("viewCount", 0)),
                    "videos": int(statistics.get("videoCount", 0)),
                    "is_mock": False
                }
    except Exception as e:
        print(f"Failed to fetch live YouTube stats for '{channel}' (using mock fallback): {e}")

    if not stats:
        seed_val = sum(ord(c) for c in channel)
        random.seed(seed_val)
        
        base_subs = random.randint(1500, 45000)
        base_views = base_subs * random.randint(40, 80)
        base_videos = random.randint(12, 110)
        
        channel_labels = {
            "facts": "Mind-blowing facts AI",
            "ghost_stories": "Spooky Tales AI",
            "hindi_myth": "Mythology Devotional",
            "dark_psychology": "Dark Persuasion Tricks",
            "f1_stories": "F1 Apex Stories",
            "cricket_stories": "Cricket Legends AI",
            "finance_secrets": "Wealth & Secrets",
            "history_micro": "History Capsule"
        }
        
        stats = {
            "channel_title": channel_labels.get(channel, f"{channel.replace('_', ' ').title()} AI"),
            "thumbnail_url": None,
            "subscribers": base_subs,
            "views": base_views,
            "videos": base_videos,
            "is_mock": True
        }

    historical_data = []
    random.seed(stats["subscribers"])
    
    current_subs = stats["subscribers"]
    current_views = stats["views"]
    
    for day in range(30, 0, -1):
        daily_sub_gain = int(current_subs * random.uniform(0.002, 0.015))
        daily_view_gain = daily_sub_gain * random.randint(20, 60)
        
        sub_count = current_subs - (day * daily_sub_gain)
        view_count = current_views - (day * daily_view_gain)
        
        sub_count = max(10, sub_count)
        view_count = max(50, view_count)
        
        est_revenue = round((daily_view_gain / 1000) * 1.50, 2)
        
        historical_data.append({
            "day": f"Day {31 - day}",
            "subscribers": sub_count,
            "views_gain": daily_view_gain,
            "subscribers_gain": daily_sub_gain,
            "estimated_revenue": est_revenue
        })

    random.seed()
    stats["historical_data"] = historical_data
    return stats


