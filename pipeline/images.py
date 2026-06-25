"""Image generation via DeAPI.ai (async: submit → poll → download)."""
from __future__ import annotations

import os
import random
import time
from pathlib import Path

import httpx

DEAPI_SUBMIT_URL = "https://api.deapi.ai/api/v1/client/txt2img"
DEAPI_VIDEO_SUBMIT_URL = "https://api.deapi.ai/api/v1/client/txt2video"
DEAPI_POLL_URL = "https://api.deapi.ai/api/v1/client/request-status"

STYLE_SUFFIX = (
    ", cinematic digital illustration, detailed scene art, strong composition, "
    "professional youtube visual quality, no text, no captions, no watermark, no logos"
)

DEFAULT_NEGATIVE = (
    "blurry, low quality, watermark, logo, text, title, signature, ugly, grainy, "
    "gore, blood, nudity, child-unsafe"
)


def full_visual_prompt(scene: str, style_suffix: str | None = None) -> str:
    """Combine the scene description with a channel-specific style suffix."""
    return f"{scene.strip()}{(style_suffix or STYLE_SUFFIX)}"


def _deapi_generate(
    prompt: str,
    *,
    api_key: str,
    width: int,
    height: int,
    model: str,
    max_polls: int = 60,
    poll_interval: float = 3.0,
) -> bytes:
    """Submit image job, poll until done, download result."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    # Step 1: Submit
    payload = {
        "prompt": prompt,
        "model": model,
        "width": width,
        "height": height,
        "steps": 4,
        "seed": random.randint(1, 999999),
    }

    with httpx.Client(timeout=60.0) as client:
        # Submit with retry on 429
        for submit_try in range(5):
            resp = client.post(DEAPI_SUBMIT_URL, json=payload, headers=headers)
            if resp.status_code == 429:
                wait = 15 * (submit_try + 1)
                print(f"      DeAPI 429 on submit — waiting {wait}s (try {submit_try + 1}/5)…")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            break
        else:
            raise RuntimeError("DeAPI: 429 on submit after 5 retries")

        data = resp.json()

        request_id = data.get("data", {}).get("request_id")
        if not request_id:
            raise RuntimeError(f"No request_id in DeAPI response: {data}")
        print(f"      DeAPI submitted (id: {request_id})")

        # Step 2: Poll
        poll_headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }

        for attempt in range(1, max_polls + 1):
            time.sleep(poll_interval)

            poll_resp = client.get(
                f"{DEAPI_POLL_URL}/{request_id}",
                headers=poll_headers,
                timeout=30.0,
            )
            poll_resp.raise_for_status()
            poll_data = poll_resp.json()

            status = poll_data.get("data", {}).get("status", "")

            if status in ("completed", "success", "done"):
                image_url = poll_data["data"].get("result_url")
                if not image_url:
                    raise RuntimeError(f"Completed but no result_url: {poll_data}")

                img_resp = client.get(image_url, timeout=60.0)
                img_resp.raise_for_status()
                print(f"      DeAPI done (polled {attempt}x)")
                return img_resp.content

            if status in ("failed", "error"):
                raise RuntimeError(f"DeAPI image failed: {poll_data}")

            # Still processing — keep polling

        raise RuntimeError(f"DeAPI timed out after {max_polls} polls for {request_id}")


def save_scene_image(
    index: int,
    prompt: str,
    out_path: Path,
    *,
    width: int = 768,
    height: int = 768,
    negative: str = DEFAULT_NEGATIVE,
) -> tuple[str, str]:
    """Generate and save one image. Returns (status, detail)."""
    # ── Try Stock Search First ──────────────────────────────────────────
    pexels_key = os.environ.get("PEXELS_API_KEY", "").strip()
    pixabay_key = os.environ.get("PIXABAY_API_KEY", "").strip()
    
    query = extract_search_keywords(prompt)
    if query:
        if pexels_key:
            print(f"   🔍 Searching Pexels stock images for '{query}'...")
            link = search_pexels_image(query, pexels_key)
            if link:
                print(f"      Found Pexels stock image: {link}")
                if download_file(link, out_path):
                    return "ok", "pexels stock image"
        if pixabay_key:
            print(f"   🔍 Searching Pixabay stock images for '{query}'...")
            link = search_pixabay_image(query, pixabay_key)
            if link:
                print(f"      Found Pixabay stock image: {link}")
                if download_file(link, out_path):
                    return "ok", "pixabay stock image"

    api_key = os.environ.get("DEAPI_TOKEN", "").strip()
    if not api_key:
        return "fail", "DEAPI_TOKEN not set"

    model = os.environ.get("DEAPI_MODEL", "Flux_2_Klein_4B_BF16")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        img_bytes = _deapi_generate(
            prompt,
            api_key=api_key,
            width=width,
            height=height,
            model=model,
        )
        out_path.write_bytes(img_bytes)
        return "ok", "deapi"
    except Exception as e:
        return "fail", str(e)


def _deapi_generate_video(
    prompt: str,
    *,
    api_key: str,
    width: int,
    height: int,
    model: str,
    frames: int = 120,
    fps: int = 24,
    max_polls: int = 60,
    poll_interval: float = 4.0,
) -> bytes:
    """Submit video job, poll until done, download result."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    # Step 1: Submit
    payload = {
        "prompt": prompt,
        "model": model,
        "width": width,
        "height": height,
        "frames": frames,
        "fps": fps,
        "seed": random.randint(1, 999999),
    }

    with httpx.Client(timeout=60.0) as client:
        # Submit with retry on 429
        for submit_try in range(5):
            resp = client.post(DEAPI_VIDEO_SUBMIT_URL, json=payload, headers=headers)
            if resp.status_code == 429:
                wait = 15 * (submit_try + 1)
                print(f"      DeAPI 429 on submit video — waiting {wait}s (try {submit_try + 1}/5)…")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            break
        else:
            raise RuntimeError("DeAPI: 429 on submit video after 5 retries")

        data = resp.json()

        request_id = data.get("data", {}).get("request_id")
        if not request_id:
            raise RuntimeError(f"No request_id in DeAPI response: {data}")
        print(f"      DeAPI submitted video (id: {request_id})")

        # Step 2: Poll
        poll_headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }

        for attempt in range(1, max_polls + 1):
            time.sleep(poll_interval)

            poll_resp = client.get(
                f"{DEAPI_POLL_URL}/{request_id}",
                headers=poll_headers,
                timeout=30.0,
            )
            poll_resp.raise_for_status()
            poll_data = poll_resp.json()

            status = poll_data.get("data", {}).get("status", "")

            if status in ("completed", "success", "done"):
                video_url = poll_data["data"].get("result_url")
                if not video_url:
                    raise RuntimeError(f"Completed video but no result_url: {poll_data}")

                vid_resp = client.get(video_url, timeout=90.0)
                vid_resp.raise_for_status()
                print(f"      DeAPI video done (polled {attempt}x)")
                return vid_resp.content

            if status in ("failed", "error"):
                raise RuntimeError(f"DeAPI video failed: {poll_data}")

            # Still processing — keep polling

        raise RuntimeError(f"DeAPI timed out after {max_polls} polls for video {request_id}")


def save_scene_video(
    index: int,
    prompt: str,
    out_path: Path,
    *,
    width: int = 768,
    height: int = 768,
    frames: int = 120,
    fps: int = 24,
) -> tuple[str, str]:
    """Generate and save one video. Returns (status, detail)."""
    # ── Try Stock Search First ──────────────────────────────────────────
    pexels_key = os.environ.get("PEXELS_API_KEY", "").strip()
    pixabay_key = os.environ.get("PIXABAY_API_KEY", "").strip()
    
    query = extract_search_keywords(prompt)
    if query:
        if pexels_key:
            print(f"   🔍 Searching Pexels stock videos for '{query}'...")
            link = search_pexels_video(query, pexels_key)
            if link:
                print(f"      Found Pexels stock video: {link}")
                if download_file(link, out_path):
                    return "ok", "pexels stock video"
        if pixabay_key:
            print(f"   🔍 Searching Pixabay stock videos for '{query}'...")
            link = search_pixabay_video(query, pixabay_key)
            if link:
                print(f"      Found Pixabay stock video: {link}")
                if download_file(link, out_path):
                    return "ok", "pixabay stock video"

    api_key = os.environ.get("DEAPI_TOKEN", "").strip()
    if not api_key:
        return "fail", "DEAPI_TOKEN not set"

    model = os.environ.get("DEAPI_VIDEO_MODEL", "Ltx2_3_22B_Dist_INT8")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        vid_bytes = _deapi_generate_video(
            prompt,
            api_key=api_key,
            width=width,
            height=height,
            model=model,
            frames=frames,
            fps=fps,
        )
        out_path.write_bytes(vid_bytes)
        return "ok", "deapi video"
    except Exception as e:
        return "fail", str(e)


# ── Stock Search Helpers ──────────────────────────────────────────────────

def extract_search_keywords(prompt: str) -> str:
    """Extract 2-3 prominent keywords from prompt for stock searches."""
    # Remove styling suffix (takes text before first comma)
    clean_prompt = prompt.split(",")[0]
    
    # Common stopwords to exclude
    stopwords = {
        "a", "an", "the", "in", "on", "at", "of", "with", "by", "for", "and", "or", "but",
        "is", "are", "was", "were", "to", "from", "inside", "outside", "into", "onto",
        "showing", "depicting", "featuring", "close-up", "wide-shot", "shot", "photo",
        "photography", "highly", "detailed", "realistic", "cinematic", "view", "scene",
        "portrait", "landscape", "composition", "lighting", "background", "super",
        "very", "extremely", "renders", "rendering", "realistic", "real", "photo", "image",
        "close", "up", "shot", "photo", "realistic", "cinematic"
    }
    
    import re
    cleaned = re.sub(r'[^a-zA-Z0-9\s]', ' ', clean_prompt.lower())
    words = []
    for w in cleaned.split():
        if w not in stopwords and len(w) > 2:
            words.append(w)
            
    return " ".join(words[:3])


def download_file(url: str, dest: Path) -> bool:
    """Download a file from a URL to destination path."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        with httpx.Client(timeout=60.0) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            dest.write_bytes(resp.content)
            return True
    except Exception as e:
        print(f"      Failed to download stock asset from {url}: {e}")
        return False


def search_pexels_video(query: str, api_key: str) -> str | None:
    headers = {"Authorization": api_key}
    url = "https://api.pexels.com/videos/search"
    params = {"query": query, "per_page": 5, "orientation": "portrait"}
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            videos = data.get("videos", [])
            if not videos:
                return None
            for video in videos:
                files = video.get("video_files", [])
                mp4_files = [f for f in files if f.get("file_type") == "video/mp4"]
                if not mp4_files:
                    continue
                vertical_files = [f for f in mp4_files if f.get("height", 0) > f.get("width", 0)]
                candidates = vertical_files if vertical_files else mp4_files
                candidates.sort(key=lambda f: abs(f.get("height", 0) - 1920))
                if candidates:
                    return candidates[0]["link"]
    except Exception as e:
        print(f"      Pexels video search failed for '{query}': {e}")
    return None


def search_pixabay_video(query: str, api_key: str) -> str | None:
    url = "https://pixabay.com/api/videos/"
    params = {"key": api_key, "q": query, "per_page": 5}
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            hits = data.get("hits", [])
            if not hits:
                return None
            for hit in hits:
                videos_dict = hit.get("videos", {})
                for size in ["large", "medium", "small"]:
                    vid_node = videos_dict.get(size)
                    if vid_node and vid_node.get("url"):
                        return vid_node["url"]
    except Exception as e:
        print(f"      Pixabay video search failed for '{query}': {e}")
    return None


def search_pexels_image(query: str, api_key: str) -> str | None:
    headers = {"Authorization": api_key}
    url = "https://api.pexels.com/v1/search"
    params = {"query": query, "per_page": 5, "orientation": "portrait"}
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
            photos = data.get("photos", [])
            if photos:
                src = photos[0].get("src", {})
                return src.get("large2x") or src.get("large") or src.get("original")
    except Exception as e:
        print(f"      Pexels image search failed for '{query}': {e}")
    return None


def search_pixabay_image(query: str, api_key: str) -> str | None:
    url = "https://pixabay.com/api/"
    params = {"key": api_key, "q": query, "per_page": 5, "orientation": "vertical", "image_type": "photo"}
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            hits = data.get("hits", [])
            if hits:
                return hits[0].get("largeImageURL") or hits[0].get("webformatURL")
    except Exception as e:
        print(f"      Pixabay image search failed for '{query}': {e}")
    return None
