"""Edge TTS — free, no API key. Returns audio + sentence-level timestamps."""
from __future__ import annotations

import asyncio
import os
import subprocess
from pathlib import Path
from typing import TypedDict

VOICE = "en-US-ChristopherNeural"


class SentenceTiming(TypedDict):
    text: str
    offset_ms: int
    duration_ms: int


def _ffprobe_duration(path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
    ).strip()
    return float(out)


async def _synthesize_with_timing(
    text: str, out_path: Path, voice: str, rate: str = "-5%",
) -> list[SentenceTiming]:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice, rate=rate)
    sentences: list[SentenceTiming] = []

    with open(out_path, "wb") as audio_file:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_file.write(chunk["data"])
            elif chunk["type"] == "SentenceBoundary":
                sentences.append(
                    SentenceTiming(
                        text=chunk["text"],
                        offset_ms=int(chunk["offset"]) // 10_000,
                        duration_ms=int(chunk["duration"]) // 10_000,
                    )
                )

    return sentences


def synthesize_full(
    text: str, out_path: Path, voice: str | None = None, rate: str | None = None,
) -> tuple[float, list[SentenceTiming]]:
    """TTS the full narration. Returns (duration_seconds, sentence_timings)."""
    voice = voice or os.environ.get("EDGE_TTS_VOICE", VOICE)
    rate = rate or os.environ.get("EDGE_TTS_RATE", "-5%")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    word_count = len(text.split())
    # Expected duration is at least word_count / 3.5 seconds
    expected_min_dur = word_count / 3.5

    max_attempts = 3
    for attempt in range(max_attempts):
        try:
            sentences = asyncio.run(_synthesize_with_timing(text, out_path, voice, rate=rate))
            dur = _ffprobe_duration(out_path)

            if dur < expected_min_dur and word_count > 10:
                raise ValueError(
                    f"Synthesized audio duration ({dur:.1f}s) is abnormally short for {word_count} words "
                    f"(expected >= {expected_min_dur:.1f}s). The stream might have been cut off."
                )

            # If no sentences were tracked, build fallback timings
            if not sentences and text.strip():
                print("   ⚠ Edge TTS did not return sentence boundaries. Generating fallback timings…")
                import re
                raw_sents = re.split(r'(?<=[.!?])\s+', text.strip())
                raw_sents = [s.strip() for s in raw_sents if s.strip()]
                if raw_sents:
                    total_words = sum(len(s.split()) for s in raw_sents)
                    if total_words > 0:
                        current_offset_ms = 0
                        for s in raw_sents:
                            words_in_sent = len(s.split())
                            sent_dur_ms = int((words_in_sent / total_words) * dur * 1000)
                            sentences.append({
                                "text": s,
                                "offset_ms": current_offset_ms,
                                "duration_ms": sent_dur_ms
                            })
                            current_offset_ms += sent_dur_ms
                    else:
                        sentences.append({
                            "text": text,
                            "offset_ms": 0,
                            "duration_ms": int(dur * 1000)
                        })

            return dur, sentences

        except Exception as e:
            print(f"   ⚠ Edge TTS attempt {attempt + 1} failed: {e}")
            if attempt == max_attempts - 1:
                raise
            import time
            time.sleep(2)

    # Fallback return (should be unreachable due to raise above)
    return 0.0, []
