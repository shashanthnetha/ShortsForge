"""Build SRT and ASS captions from Edge TTS sentence-level timestamps.

Splits each sentence into word groups (~3-4 words) and distributes
timing proportionally within the sentence's known time window.
ASS format implements kinetic word-level highlight captions.
"""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pipeline.edge_tts_synth import SentenceTiming


def _fmt(ms: int) -> str:
    """Milliseconds -> SRT timestamp (hh:mm:ss,ms)."""
    h = ms // 3_600_000
    m = (ms % 3_600_000) // 60_000
    s = (ms % 60_000) // 1_000
    frac = ms % 1_000
    return f"{h:02d}:{m:02d}:{s:02d},{frac:03d}"


def _fmt_ass(ms: int) -> str:
    """Milliseconds -> ASS timestamp (h:mm:ss.cc)."""
    h = ms // 3_600_000
    m = (ms % 3_600_000) // 60_000
    s = (ms % 60_000) // 1_000
    cc = (ms % 1_000) // 10
    return f"{h}:{m:02d}:{s:02d}.{cc:02d}"


def build_srt(
    sentences: list[SentenceTiming],
    out_path: Path,
    total_duration: float,
    *,
    max_words_per_line: int = 4,
) -> Path:
    """Create .srt from sentence timestamps, splitting long sentences."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not sentences:
        out_path.write_text("1\n00:00:00,000 --> 00:00:01,000\n \n", encoding="utf-8")
        return out_path

    chunks: list[tuple[int, int, str]] = []

    for sent in sentences:
        words = sent["text"].split()
        if not words:
            continue

        start_ms = sent["offset_ms"]
        dur_ms = sent["duration_ms"]

        if len(words) <= max_words_per_line:
            chunks.append((start_ms, start_ms + dur_ms, sent["text"].upper()))
        else:
            n_groups = (len(words) + max_words_per_line - 1) // max_words_per_line
            ms_per_word = dur_ms / len(words) if words else 1

            pos = 0
            for g in range(n_groups):
                grp_start = pos
                grp_end = min(pos + max_words_per_line, len(words))
                grp_text = " ".join(words[grp_start:grp_end]).upper()

                t_start = start_ms + int(grp_start * ms_per_word)
                t_end = start_ms + int(grp_end * ms_per_word)
                t_end = min(t_end, start_ms + dur_ms)

                chunks.append((t_start, t_end, grp_text))
                pos = grp_end

    lines: list[str] = []
    for i, (start, end, text) in enumerate(chunks):
        lines.append(str(i + 1))
        lines.append(f"{_fmt(start)} --> {_fmt(end)}")
        lines.append(text)
        lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")
    return out_path


def build_ass(
    sentences: list[SentenceTiming],
    out_path: Path,
    total_duration: float,
    *,
    font_name: str = "Bebas Neue",
    font_size: int = 64,
    primary_color: str = "&H00C5FF05",   # highlighted color (ABGR Neon Emerald #05ffc5)
    secondary_color: str = "&H00FFFFFF", # default color (ABGR White)
    outline_color: str = "&H00000000",   # black outline
    max_words_per_line: int = 3,
) -> Path:
    """Create .ass from sentence timestamps with word-level highlight tags (karaoke)."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    header = f"""[Script Info]
Title: ShortsForge Kinetic Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, Strikeout, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary_color},{secondary_color},{outline_color},&H00000000,1,0,0,0,100,100,0,0,1,4,0,2,20,20,280,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    if not sentences:
        # Write empty template with one empty dialogue line
        content = header + "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,, \n"
        out_path.write_text(content, encoding="utf-8")
        return out_path

    events = []

    for sent in sentences:
        words = sent["text"].split()
        if not words:
            continue

        start_ms = sent["offset_ms"]
        dur_ms = sent["duration_ms"]

        n_groups = (len(words) + max_words_per_line - 1) // max_words_per_line
        ms_per_word = dur_ms / len(words) if words else 1

        pos = 0
        for g in range(n_groups):
            grp_start_idx = pos
            grp_end_idx = min(pos + max_words_per_line, len(words))
            grp_words = words[grp_start_idx:grp_end_idx]

            t_start = start_ms + int(grp_start_idx * ms_per_word)
            t_end = start_ms + int(grp_end_idx * ms_per_word)
            t_end = min(t_end, start_ms + dur_ms)

            line_dur_cs = (t_end - t_start) // 10
            if line_dur_cs <= 0:
                line_dur_cs = 1

            base_cs = line_dur_cs // len(grp_words)
            rem_cs = line_dur_cs % len(grp_words)

            word_parts = []
            for i, w in enumerate(grp_words):
                w_clean = w.upper()
                w_cs = base_cs + (1 if i < rem_cs else 0)
                word_parts.append(f"{{\\k{w_cs}}}{w_clean}")

            line_text = " ".join(word_parts)
            
            # Format times
            start_str = _fmt_ass(t_start)
            end_str = _fmt_ass(t_end)

            events.append(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{line_text}")
            pos = grp_end_idx

    content = header + "\n".join(events) + "\n"
    out_path.write_text(content, encoding="utf-8")
    return out_path
