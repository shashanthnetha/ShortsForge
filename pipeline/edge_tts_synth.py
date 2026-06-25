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


import re
import shutil
import json

def parse_dialogue_and_sfx(text: str) -> list[dict]:
    # Regex to match tags like [Narrator], [sfx: whoosh], [Ghost], etc.
    pattern = re.compile(r'\[([^\]]+)\]')
    
    chunks = []
    last_end = 0
    current_speaker = "Narrator"
    
    for match in pattern.finditer(text):
        start, end = match.span()
        # Anything before the tag is text for the current speaker
        prev_text = text[last_end:start].strip()
        if prev_text:
            chunks.append({
                "type": "speech",
                "speaker": current_speaker,
                "text": prev_text
            })
            
        tag_content = match.group(1).strip()
        if tag_content.lower().startswith("sfx:"):
            sfx_name = tag_content.split(":", 1)[1].strip()
            chunks.append({
                "type": "sfx",
                "name": sfx_name
            })
        else:
            current_speaker = tag_content
            
        last_end = end
        
    # Append any remaining text
    rem_text = text[last_end:].strip()
    if rem_text:
        chunks.append({
            "type": "speech",
            "speaker": current_speaker,
            "text": rem_text
        })
        
    return chunks


def get_voice_for_speaker(speaker: str, default_voice: str) -> str:
    speaker_lower = speaker.lower()
    # Alternate between male and female voices based on speaker names
    if "ryan" in default_voice.lower() or "madhur" in default_voice.lower() or "mohan" in default_voice.lower() or "christopher" in default_voice.lower():
        # Male primary, female secondary
        if any(kw in speaker_lower for kw in ["female", "guest", "ghost", "woman", "girl", "bhakti", "shakti", "devi"]):
            if "ryan" in default_voice.lower() or "christopher" in default_voice.lower():
                return "en-US-JennyNeural"
            elif "madhur" in default_voice.lower():
                return "hi-IN-SwaraNeural"
            elif "mohan" in default_voice.lower():
                return "te-IN-ShrutiNeural"
    else:
        # Female primary, male secondary
        if any(kw in speaker_lower for kw in ["male", "host", "man", "boy", "narrator", "buddha", "sage", "shiva"]):
            if "jenny" in default_voice.lower():
                return "en-GB-RyanNeural"
            elif "swara" in default_voice.lower():
                return "hi-IN-MadhurNeural"
            elif "shruti" in default_voice.lower():
                return "te-IN-MohanNeural"
                
    return default_voice


def synthesize_full(
    text: str, out_path: Path, voice: str | None = None, rate: str | None = None,
) -> tuple[float, list[SentenceTiming]]:
    """TTS the full narration. Supports multi-speaker parsing and inline SFX cues."""
    voice = voice or os.environ.get("EDGE_TTS_VOICE", VOICE)
    rate = rate or os.environ.get("EDGE_TTS_RATE", "-5%")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Parse script chunks
    chunks = parse_dialogue_and_sfx(text)
    
    # If no dialogue/SFX tags were parsed, fallback to simple legacy synthesis
    has_tags = any(c["type"] == "sfx" or c["speaker"] != "Narrator" for c in chunks)
    if not has_tags:
        return _synthesize_legacy(text, out_path, voice, rate)

    print(f"   🎙️ Multi-speaker/SFX detected: parsed {len(chunks)} timeline segments...")
    
    max_attempts = 3
    for attempt in range(max_attempts):
        temp_dir = out_path.parent / "_temp_synth"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        
        sentences: list[SentenceTiming] = []
        sfx_triggers = []
        accumulated_ms = 0
        speech_files = []
        
        try:
            speech_idx = 0
            for chunk in chunks:
                if chunk["type"] == "speech":
                    chunk_voice = get_voice_for_speaker(chunk["speaker"], voice)
                    chunk_mp3 = temp_dir / f"chunk_{speech_idx:03d}.mp3"
                    chunk_wav = temp_dir / f"chunk_{speech_idx:03d}.wav"
                    
                    # Synthesize this speech segment to MP3
                    chunk_sents = asyncio.run(_synthesize_with_timing(chunk["text"], chunk_mp3, chunk_voice, rate=rate))
                    
                    # Convert MP3 to WAV to eliminate MP3 header padding/silence gaps
                    from pipeline.render_short import get_ffmpeg_path
                    ffmpeg_path = get_ffmpeg_path()
                    subprocess.run(
                        [
                            ffmpeg_path, "-y", "-hide_banner", "-loglevel", "warning",
                            "-i", str(chunk_mp3), str(chunk_wav)
                        ],
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    
                    # Measure the exact PCM WAV duration
                    chunk_dur = _ffprobe_duration(chunk_wav)
                    
                    # Shift sentence offsets by accumulated duration
                    for sent in chunk_sents:
                        sent["offset_ms"] += accumulated_ms
                        sentences.append(sent)
                        
                    accumulated_ms += int(chunk_dur * 1000)
                    speech_files.append(chunk_wav)
                    speech_idx += 1
                    
                elif chunk["type"] == "sfx":
                    # Record SFX offset time
                    sfx_triggers.append({
                        "name": chunk["name"],
                        "offset_ms": accumulated_ms
                    })
            
            # Save SFX triggers JSON
            sfx_json_path = out_path.parent / "sfx_triggers.json"
            sfx_json_path.write_text(json.dumps(sfx_triggers, indent=2), encoding="utf-8")
            
            if not speech_files:
                raise ValueError("No speech segments found to synthesize")
                
            # Concat wav files to a temp wav file
            from pipeline.render_short import get_ffmpeg_path
            ffmpeg_path = get_ffmpeg_path()
            
            concat_list_path = temp_dir / "concat_list.txt"
            concat_content = "\n".join(f"file '{p.name}'" for p in speech_files)
            concat_list_path.write_text(concat_content, encoding="utf-8")
            
            merged_wav = temp_dir / "merged_voice.wav"
            subprocess.run(
                [
                    ffmpeg_path, "-y", "-hide_banner", "-loglevel", "warning",
                    "-f", "concat", "-safe", "0", "-i", str(concat_list_path),
                    "-c", "copy", str(merged_wav)
                ],
                check=True,
                cwd=str(temp_dir),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            
            # Now convert the merged WAV to the final output MP3 file
            subprocess.run(
                [
                    ffmpeg_path, "-y", "-hide_banner", "-loglevel", "warning",
                    "-i", str(merged_wav),
                    "-c:a", "libmp3lame", "-q:a", "2",
                    str(out_path)
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            
            # Get actual merged duration
            dur = _ffprobe_duration(out_path)
            
            # Clean up temp files
            shutil.rmtree(temp_dir, ignore_errors=True)
            return dur, sentences
            
        except Exception as e:
            print(f"   ⚠ Multi-speaker TTS attempt {attempt + 1} failed: {e}")
            shutil.rmtree(temp_dir, ignore_errors=True)
            if attempt == max_attempts - 1:
                raise
            import time
            time.sleep(2)
            
    return 0.0, []


def _synthesize_legacy(
    text: str, out_path: Path, voice: str, rate: str
) -> tuple[float, list[SentenceTiming]]:
    """Standard single-voice legacy synthesis."""
    word_count = len(text.split())
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

            # Ensure sfx_triggers.json is removed if legacy mode is used
            sfx_json_path = out_path.parent / "sfx_triggers.json"
            if sfx_json_path.exists():
                sfx_json_path.unlink()

            return dur, sentences

        except Exception as e:
            print(f"   ⚠ Edge TTS attempt {attempt + 1} failed: {e}")
            if attempt == max_attempts - 1:
                raise
            import time
            time.sleep(2)

    return 0.0, []
