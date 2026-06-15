#!/usr/bin/env python3
"""
Generate images for short video beats (facts / story scenes).
Delegates generation to pipeline.images.
"""
from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
load_dotenv(REPO_ROOT / ".env")
load_dotenv(REPO_ROOT / "scripts" / ".env")

from pipeline.images import (
    DEFAULT_NEGATIVE,
    full_visual_prompt,
    save_scene_image,
)

OUT_DIR = REPO_ROOT / "output" / "video-scenes"

TOPICS: dict[str, dict] = {
    "teenager": {
        "title": "5 interesting facts (teen life) — visual beats",
        "scenes": [
            "Fact: teen brains need more sleep — exhausted student at desk at night, glowing clock, cozy bedroom, thought bubble with moon",
            "Fact: social media is built for endless scrolling — teenager at phone, colorful notification icons floating, living room detail",
            "Fact: small money habits compound — piggy bank, coins, growing arrow chart on desk, cheerful cartoon economy vibe",
            "Fact: healthy friendships need boundaries — two friends talking with comfortable space between them, school hallway",
            "Fact: asking for help is strength — counselor office door slightly open, warm light, student taking a breath, supportive scene",
        ],
    },
    "harrypotter": {
        "title": "5 interesting Harry Potter facts — visual beats",
        "scenes": [
            "Fact: J.K. Rowling planned years ahead — author silhouette at cafe table with stacks of notes and coffee, cozy window light",
            "Fact: Hogwarts has moving stairs — grand magical staircase shifting, torches, stone walls, students tiny on steps",
            "Fact: the golden snitch ends matches — golden snitch zipping across quidditch stadium, crowd shapes, dynamic motion",
            "Fact: names hide wordplay (e.g. Dumbledore) — whimsical bumblebee near old books and ink bottle, magical library corner",
            "Fact: the story redeems Snape's arc — potions classroom, mysterious teacher silhouette at desk, bottles and steam",
        ],
    },
    "schoolstory": {
        "title": "School story (2 min) — 5 key visuals",
        "scenes": [
            "Quiet new student in hoodie sits at back of bright classroom, classmates whispering, detailed school interior",
            "Two black SUVs parked outside a high school parking lot, students walking past, afternoon light, American campus",
            "School cafeteria busy with colorful students, new kid at table alone, trays and windows, slice-of-life detail",
            "Behind the bleachers tense moment: relaxed teen confronted by bully, three professional bodyguards in black suits standing calm nearby",
            "Roof at sunset: two students sitting talking, city horizon, peaceful mood, school building below, friendship moment",
        ],
    },
}


def work_scene(
    idx: int,
    scene: str,
    out_path: Path,
    width: int,
    height: int,
    negative: str,
) -> tuple[int, str, str]:
    p = full_visual_prompt(scene)
    st, det = save_scene_image(
        idx,
        p,
        out_path,
        width=width,
        height=height,
        negative=negative,
    )
    return idx, st, det


def main() -> None:
    token = os.environ.get("DEAPI_TOKEN", "").strip() or None
    if not token:
        print("Set DEAPI_TOKEN in .env or environment.", file=sys.stderr)
        sys.exit(1)

    topic_key = (sys.argv[1] if len(sys.argv) > 1 else "schoolstory").lower()
    topic = TOPICS.get(topic_key)
    if not topic:
        print(
            f'Unknown topic "{topic_key}". Use: teenager | harrypotter | schoolstory',
            file=sys.stderr,
        )
        sys.exit(1)

    width = int(os.environ.get("DEAPI_IMAGE_WIDTH", "768"))
    height = int(os.environ.get("DEAPI_IMAGE_HEIGHT", "768"))
    negative = os.environ.get("IMAGE_NEGATIVE_PROMPT", DEFAULT_NEGATIVE)
    workers = max(1, min(8, int(os.environ.get("HF_CONCURRENCY", "2"))))

    print(f"Topic: {topic['title']}")
    print(f"Output: {OUT_DIR}")
    print(f"Workers: {workers}")
    print()

    scenes = topic["scenes"]
    tasks = []
    for i, scene in enumerate(scenes):
        idx = i + 1
        out_path = OUT_DIR / f"scene-{idx}.png"
        tasks.append((idx, scene, out_path))

    results: dict[int, tuple[str, str]] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {
            ex.submit(
                work_scene,
                idx,
                scene,
                path,
                width,
                height,
                negative,
            ): idx
            for idx, scene, path in tasks
        }
        for fut in as_completed(futs):
            idx, status, detail = fut.result()
            results[idx] = (status, detail)

    failed = False
    for idx, _, _ in tasks:
        status, detail = results[idx]
        if status == "ok":
            print(f"Scene {idx}/{len(tasks)}… saved scene-{idx}.png ({detail})")
        else:
            print(f"Scene {idx}/{len(tasks)}… FAILED: {detail}")
            failed = True

    if failed:
        sys.exit(1)
    print("\nDone. Open output/video-scenes/")


if __name__ == "__main__":
    main()
