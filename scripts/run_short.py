#!/usr/bin/env python3
"""
Fully automated YouTube Short pipeline.

Single-variant flow:
  Groq → narration + image prompts
  Edge TTS → audio (30-40s)
  DeAPI → images
  Captions → SRT
  FFmpeg → 9:16 vertical MP4
  YouTube upload (optional)

Bilingual flow (preset has `variants`):
  Groq → image_prompts + per-language {title, description, narration}
  DeAPI → images (once, shared)
  For each variant:
    Edge TTS → audio in that language with that voice
    Captions → SRT
    FFmpeg → MP4 with variant-specific font
    YouTube upload (optional, per-channel token)

Usage:
  .venv/bin/python scripts/run_short.py --channel ghost_stories
  .venv/bin/python scripts/run_short.py --channel facts --upload --privacy public
  .venv/bin/python scripts/run_short.py --channel hindi_myth
  # hindi_myth: topic = IST day theme (Ganesha→Shiva→…) + random unused line; --topic overrides
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
load_dotenv(REPO_ROOT / ".env")
load_dotenv(REPO_ROOT / "scripts" / ".env")

from pipeline.captions import build_ass
from pipeline.channel_presets import get_preset, list_channel_ids
from pipeline.edge_tts_synth import synthesize_full
from pipeline.groq_script import generate_short_pack
from pipeline.images import DEFAULT_NEGATIVE, full_visual_prompt, save_scene_image, save_scene_video
from pipeline.render_short import render_vertical_short
from pipeline.story_history import save_title


VOICE_MAP = {
    "en": {
        "male": "en-GB-RyanNeural",
        "female": "en-US-JennyNeural"
    },
    "hi": {
        "male": "hi-IN-MadhurNeural",
        "female": "hi-IN-SwaraNeural"
    },
    "te": {
        "male": "te-IN-MohanNeural",
        "female": "te-IN-ShrutiNeural"
    }
}

FONT_MAP = {
    "en": {
        "file": "BebasNeue-Regular.ttf",
        "name": "Bebas Neue"
    },
    "hi": {
        "file": "NotoSansDevanagari-Bold.ttf",
        "name": "Noto Sans Devanagari"
    },
    "te": {
        "file": "NotoSansTelugu-Bold.ttf",
        "name": "Noto Sans Telugu"
    }
}


def resolve_voice_and_font(
    lang: str,
    gender: str | None,
    default_voice: str | None = None,
    default_font_file: str = "CreepsterCaps.ttf",
    default_font_name: str = "Creepster"
) -> tuple[str | None, str, str]:
    """
    Resolves TTS voice, font file, and font name based on language and gender,
    falling back to preset defaults if not custom.
    """
    lang = lang.lower()
    
    # Resolve voice
    resolved_voice = default_voice
    if gender and lang in VOICE_MAP:
        resolved_voice = VOICE_MAP[lang].get(gender.lower(), default_voice)
    elif not resolved_voice and lang in VOICE_MAP:
        resolved_voice = VOICE_MAP[lang]["male"]
        
    # Resolve font
    resolved_font_file = default_font_file
    resolved_font_name = default_font_name
    
    if lang in FONT_MAP:
        # If Hindi or Telugu, or if English is explicitly set and we're switching from non-English
        if lang in ["hi", "te"] or (lang == "en" and default_font_file in ["NotoSansDevanagari-Bold.ttf", "NotoSansTelugu-Bold.ttf"]):
            resolved_font_file = FONT_MAP[lang]["file"]
            resolved_font_name = FONT_MAP[lang]["name"]
            
    return resolved_voice, resolved_font_file, resolved_font_name


def _render_and_upload(
    *,
    variant_label: str,
    narration: str,
    title: str,
    description: str,
    voice: str | None,
    rate: str | None = None,
    font_file: str,
    font_name: str,
    image_paths: list,
    run_dir: Path,
    suffix: str,
    upload: bool,
    privacy: str,
    yt_token_env: str = "YT_REFRESH_TOKEN",
) -> Path:
    """Render one video (audio + SRT + MP4) for a single variant. Optionally upload."""
    print(f"\n━━━ Variant: {variant_label} ━━━")

    audio_path = run_dir / f"voiceover{suffix}.mp3"
    print(f"② Edge TTS ({voice or 'default'})…")
    total_dur, sentence_timings = synthesize_full(narration, audio_path, voice=voice, rate=rate)
    print(f"   Audio: {total_dur:.1f}s ({len(sentence_timings)} sentences tracked)")
    if total_dur > 55:
        print(f"   ⚠ Audio is {total_dur:.0f}s — target is 30-45s")
    if total_dur < 25:
        print(f"   ⚠ Audio is {total_dur:.0f}s — might be too short")

    srt_path = run_dir / f"captions{suffix}.ass"
    print("④ Captions…")
    build_ass(sentence_timings, srt_path, total_dur, font_name=font_name)

    video_path = run_dir / f"short{suffix}.mp4"
    print(f"⑤ FFmpeg: rendering 1080×1920 (font={font_name})…")
    render_vertical_short(
        image_paths, total_dur, audio_path, srt_path, video_path,
        font_file=font_file, font_name=font_name,
    )
    print(f"   → {video_path}")

    if upload:
        from pipeline.youtube_upload import upload_short
        print(f"⑥ YouTube: uploading ({yt_token_env})…")
        vid = upload_short(
            video_path, title, description,
            privacy_status=privacy,
            refresh_token_env=yt_token_env,
        )
        print(f"   Uploaded! https://www.youtube.com/shorts/{vid}")
    else:
        print("   (skip upload — pass --upload)")

    return video_path


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate & optionally upload a YouTube Short.")
    ap.add_argument("--channel", required=True, choices=list_channel_ids())
    ap.add_argument("--topic", default="", help="Optional topic hint for Groq.")
    ap.add_argument("--upload", action="store_true", help="Upload to YouTube after render.")
    ap.add_argument("--privacy", default="private", choices=["private", "unlisted", "public"])
    ap.add_argument("--visual-mode", choices=["image", "video"], default=None, help="Force visual generation mode.")
    ap.add_argument("--language", choices=["en", "hi", "te"], default=None, help="Force target language for generation.")
    ap.add_argument("--gender", choices=["male", "female"], default=None, help="Force gender of the voice.")
    args = ap.parse_args()

    preset = get_preset(args.channel)

    # Ensure sfx assets are downloaded
    sfx_dir = REPO_ROOT / "assets" / "sfx"
    if not sfx_dir.exists() or not any(sfx_dir.iterdir()):
        try:
            print("🔊 SFX assets missing. Automatically downloading...")
            from pipeline.download_sfx import main as download_sfx
            download_sfx()
        except Exception as e:
            print(f"   ⚠ Failed to auto-download SFX: {e}")

    visual_mode = args.visual_mode or preset.get("visual_mode") or "image"
    print(f"🎬 Visual Mode: {visual_mode}")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    run_dir = REPO_ROOT / "output" / "runs" / f"{args.channel}_{ts}"
    visual_dir = run_dir / ("videos" if visual_mode == "video" else "images")
    visual_dir.mkdir(parents=True, exist_ok=True)

    # Myth rotation: IST calendar picks theme (Ganesha → Shiva → …); random unused topic in that theme.
    myth_theme_for_commit: str | None = None
    myth_topic_for_commit: str | None = None

    # Pick a topic: CLI --topic wins; else myth rotation; else random from topic_pool.
    topic_hint = args.topic.strip() or None
    if not topic_hint:
        if preset.get("topic_rotation") == "myth":
            from pipeline.myth_topics import pick_myth_topic

            topic_hint, myth_theme_for_commit = pick_myth_topic(args.channel)
            myth_topic_for_commit = topic_hint
            print(f"📿 Myth theme today (IST): {myth_theme_for_commit} → {topic_hint!r}")
        else:
            pool = preset.get("topic_pool") or []
            if pool:
                topic_hint = random.choice(pool)
                print(f"🎲 Random topic from pool: {topic_hint!r}")

    variants = preset.get("variants") or []
    if args.language:
        variants = []
        print(f"🌐 Forcing target language: {args.language}")
    primary_video_path: Path | None = None

    # ── 1. Script via Groq ───────────────────────────────────────────
    print("① Groq: generating script…")
    pack = generate_short_pack(
        preset, topic_hint=topic_hint, channel_id=args.channel, override_language=args.language
    )
    (run_dir / "script.json").write_text(json.dumps(pack, indent=2, ensure_ascii=False), encoding="utf-8")

    image_prompts = pack["image_prompts"]

    if variants:
        # Bilingual mode: each lang gets its own audio/SRT/video
        first_v = variants[0]
        first_node = pack["variants"][first_v["lang"]]
        print(f"   Title ({first_v['label']}): {first_node['youtube_title']}")
        for v in variants:
            node = pack["variants"][v["lang"]]
            wc = len(node["full_narration"].split())
            print(f"   {v['label']}: {wc} words")
        print(f"   {len(image_prompts)} image prompts (shared)")
        history_title = first_node["youtube_title"]
        history_narration = first_node["full_narration"]
    else:
        title = pack["youtube_title"]
        narration = pack["full_narration"]
        word_count = len(narration.split())
        print(f"   Title: {title}")
        print(f"   Narration: {word_count} words, {len(image_prompts)} image prompts")
        history_title = title
        history_narration = narration

    # ── 2. Images via DeAPI (generated ONCE, shared by all variants) ──
    w = int(os.environ.get("DEAPI_IMAGE_WIDTH", "768"))
    h = int(os.environ.get("DEAPI_IMAGE_HEIGHT", "768"))
    style_suffix = preset.get("image_style_suffix")
    negative = (
        os.environ.get("IMAGE_NEGATIVE_PROMPT")
        or preset.get("image_negative_prompt")
        or DEFAULT_NEGATIVE
    )
    cooldown = int(os.environ.get("DEAPI_COOLDOWN", "10"))

    image_paths: list[Path] = []
    if visual_mode == "video":
        print(f"③ Videos: {len(image_prompts)} scenes ({cooldown}s cooldown)…")
        for i, ip in enumerate(image_prompts):
            prompt = full_visual_prompt(ip, style_suffix=style_suffix)
            out = visual_dir / f"scene_{i + 1:02d}.mp4"
            frames = int(os.environ.get("DEAPI_VIDEO_FRAMES", "120"))
            fps = int(os.environ.get("DEAPI_VIDEO_FPS", "24"))
            st, detail = save_scene_video(i + 1, prompt, out, width=w, height=h, frames=frames, fps=fps)
            if st != "ok":
                raise RuntimeError(f"Video {i + 1} failed: {detail}")
            print(f"   scene {i + 1}/{len(image_prompts)}: {detail}")
            image_paths.append(out)
            if i < len(image_prompts) - 1:
                time.sleep(cooldown)
    else:
        print(f"③ Images: {len(image_prompts)} scenes ({cooldown}s cooldown)…")
        for i, ip in enumerate(image_prompts):
            prompt = full_visual_prompt(ip, style_suffix=style_suffix)
            out = visual_dir / f"scene_{i + 1:02d}.png"
            st, detail = save_scene_image(i + 1, prompt, out, width=w, height=h, negative=negative)
            if st != "ok":
                raise RuntimeError(f"Image {i + 1} failed: {detail}")
            print(f"   scene {i + 1}/{len(image_prompts)}: {detail}")
            image_paths.append(out)
            if i < len(image_prompts) - 1:
                time.sleep(cooldown)

    # ── 4-6. Render (per variant) ────────────────────────────────────
    if variants:
        for v in variants:
            node = pack["variants"][v["lang"]]
            
            resolved_v_voice, resolved_v_font_file, resolved_v_font_name = resolve_voice_and_font(
                lang=v["lang"],
                gender=args.gender,
                default_voice=v.get("tts_voice"),
                default_font_file=v.get("caption_font", "CreepsterCaps.ttf"),
                default_font_name=v.get("caption_font_name", "Creepster")
            )
            
            _render_and_upload(
                variant_label=v["label"],
                narration=node["full_narration"],
                title=node["youtube_title"],
                description=node.get("youtube_description", ""),
                voice=resolved_v_voice,
                rate=v.get("tts_rate"),
                font_file=resolved_v_font_file,
                font_name=resolved_v_font_name,
                image_paths=image_paths,
                run_dir=run_dir,
                suffix=f"_{v['lang']}",
                upload=args.upload,
                privacy=args.privacy,
                yt_token_env=v.get("yt_token_env", "YT_REFRESH_TOKEN"),
            )
    else:
        target_lang = args.language or preset.get("language") or "en"
        
        resolved_voice, resolved_font_file, resolved_font_name = resolve_voice_and_font(
            lang=target_lang,
            gender=args.gender,
            default_voice=preset.get("tts_voice") or os.environ.get("EDGE_TTS_VOICE"),
            default_font_file=preset.get("caption_font", "CreepsterCaps.ttf"),
            default_font_name=preset.get("caption_font_name", "Creepster")
        )
        
        primary_video_path = _render_and_upload(
            variant_label=target_lang,
            narration=narration,
            title=title,
            description=pack.get("youtube_description", ""),
            voice=resolved_voice,
            rate=preset.get("tts_rate") or os.environ.get("EDGE_TTS_RATE"),
            font_file=resolved_font_file,
            font_name=resolved_font_name,
            image_paths=image_paths,
            run_dir=run_dir,
            suffix="",
            upload=args.upload,
            privacy=args.privacy,
            yt_token_env=preset.get("yt_token_env") or "YT_REFRESH_TOKEN",
        )

    # ── 7. History ───────────────────────────────────────────────────
    summary = " ".join(history_narration.split()[:25]) + "…"
    save_title(args.channel, history_title, summary)

    if myth_theme_for_commit and myth_topic_for_commit:
        from pipeline.myth_topics import commit_myth_topic

        commit_myth_topic(args.channel, myth_theme_for_commit, myth_topic_for_commit)

    # Optional second upload: same rendered MP4 to extra channels (e.g. second bhakti channel).
    # Uses env var names listed in preset["extra_yt_token_envs"].
    extra_envs = preset.get("extra_yt_token_envs") or []
    if args.upload and primary_video_path and extra_envs:
        from pipeline.youtube_upload import upload_short

        primary_token_env = preset.get("yt_token_env") or "YT_REFRESH_TOKEN"
        primary_token = os.environ.get(primary_token_env, "").strip()
        if not primary_token and primary_token_env != "YT_REFRESH_TOKEN":
            primary_token = os.environ.get("YT_REFRESH_TOKEN", "").strip()

        for env_name in extra_envs:
            extra_token = os.environ.get(env_name, "").strip()
            if not extra_token:
                print(f"   (skip extra upload for {env_name} — env var is not set or empty)")
                continue

            if extra_token == primary_token:
                print(f"   (skip extra upload for {env_name} — value is identical to primary token)")
                continue

            print(f"⑦ Extra YouTube upload ({env_name})…")
            vid_extra = upload_short(
                primary_video_path,
                history_title,
                pack.get("youtube_description", ""),
                privacy_status=args.privacy,
                refresh_token_env=env_name,
            )
            print(f"   Extra channel video: https://www.youtube.com/shorts/{vid_extra}")

    print("\n✓ Done.")


if __name__ == "__main__":
    main()
