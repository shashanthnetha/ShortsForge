# dashboard/backend/main.py
import os
import sys
import asyncio
import importlib
import subprocess
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

class TriggerRun(BaseModel):
    channel: str
    topic: Optional[str] = ""
    upload: bool = False
    privacy: str = "private"
    visual_mode: Optional[str] = None

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
            
            runs.append({
                "id": path.name,
                "channel": channel,
                "timestamp": timestamp,
                "has_video": has_video,
                "has_script": has_script,
                "has_images": has_images,
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

