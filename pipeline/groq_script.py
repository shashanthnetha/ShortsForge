"""Groq (OpenAI-compatible) — generate Short script + image prompts as JSON.

Supports two modes:
  • Single-language preset (legacy): returns full_narration, youtube_title, etc.
  • Multi-variant preset (bilingual): returns image_prompts once + variants[lang] = {title, desc, narration}.
"""
from __future__ import annotations

import json
import os
from typing import Any

from groq import Groq
import httpx

from pipeline.channel_presets import ChannelPreset
from pipeline.story_history import history_prompt_block

GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()


# ── Language-specific word-count guidance ──────────────────────────────
LANG_WORD_TARGETS = {
    "en": (
        120,
        155,
        "120-155 English words for variants.en.full_narration (~40-50 sec); "
        "add transitions, examples, and a closing takeaway — NOT a bullet list",
    ),
    "hi": (
        135,
        170,
        "135-170 Devanagari Hindi words — aim ~150 (~55-70 sec); full sentences, not headlines",
    ),
    "te": (
        40,
        80,
        "40-80 Telugu script words — aim ~60 (~30-50 sec); full sentences in Telugu alphabet, not English transliteration",
    ),
}

# Bilingual presets override per variant; these are fallbacks only.
DEFAULT_MIN_WORDS = {"hi": 80, "en": 80, "te": 25}


def _lang_label(lang: str) -> str:
    return {"en": "English", "hi": "Hindi (Devanagari script)"}.get(lang, lang)


def generate_short_pack(
    preset: ChannelPreset,
    *,
    topic_hint: str | None = None,
    channel_id: str | None = None,
    override_language: str | None = None,
) -> dict[str, Any]:
    topic_hint = (topic_hint or os.environ.get("SHORT_TOPIC", "")).strip()

    user = (
        f"Channel style: {preset['label']}.\n"
        f"Create ONE YouTube Short.\n"
    )
    if topic_hint:
        user += f"Topic idea from creator: {topic_hint}\n"

    if channel_id:
        anti_repeat = history_prompt_block(channel_id)
        if anti_repeat:
            user += anti_repeat

    n = preset["segment_count"]
    variants = preset.get("variants") or []

    if override_language:
        return _generate_single(preset, user, n, language=override_language)

    if variants:
        return _generate_multivariant(preset, user, n, variants)
    return _generate_single(preset, user, n)


# ─────────────────────────────────────────────────────────────────────────
# Single-language path (backward compat for ghost_stories, school_story, etc.)
# ─────────────────────────────────────────────────────────────────────────
def _generate_single(preset: ChannelPreset, user: str, n: int, language: str | None = None) -> dict[str, Any]:
    language = (language or preset.get("language") or "en").lower()
    lo, hi, blurb = LANG_WORD_TARGETS.get(language, LANG_WORD_TARGETS["en"])

    if language == "hi":
        narration_rule = (
            '"full_narration": "COMPLETE narration as ONE continuous paragraph in Devanagari Hindi. '
            f'This is what the voice will read aloud. MUST be {blurb}. '
            'Spoken Hindi style — use extremely simple, casual, everyday spoken vocabulary (colloquial Hindi that a 10-year-old understands). Avoid complex Sanskritized, bookish, or formal words. Keep it very simple, engaging, and friendly — no segment markers, no numbering, no English transliteration."'
        )
        strict_extra = (
            "- LANGUAGE: full_narration, youtube_title, and youtube_description MUST be in Devanagari Hindi.\n"
            "- image_prompts MUST be in ENGLISH (the image model does not understand Hindi).\n"
            f"- WORD COUNT: full_narration MUST contain {lo}-{hi} Hindi words.\n"
            "- STYLE: Use extremely simple, colloquial, easy-to-understand everyday spoken Hindi. Do NOT use complex, bookish, or highly formal vocabulary. Keep it punchy and casual like an everyday conversation.\n"
        )
    elif language == "te":
        narration_rule = (
            '"full_narration": "COMPLETE narration as ONE continuous paragraph in Telugu script (Telugu alphabet). '
            f'This is what the voice will read aloud. MUST be {blurb}. '
            'Spoken Telugu style — use extremely simple, casual, everyday spoken vocabulary (colloquial Telugu that everyone understands). Avoid formal, literary, or grandiloquent words. Keep it simple, clear, and engaging — no segment markers, no numbering, no English transliteration."'
        )
        strict_extra = (
            "- LANGUAGE: full_narration, youtube_title, and youtube_description MUST be in Telugu script (Telugu alphabet).\n"
            "- image_prompts MUST be in ENGLISH (the image model does not understand Telugu).\n"
            f"- WORD COUNT: full_narration MUST contain {lo}-{hi} Telugu words.\n"
            "- STYLE: Use extremely simple, colloquial, easy-to-understand everyday spoken Telugu. Do NOT use formal, literary, or bookish vocabulary. Keep it simple, direct, and casual.\n"
        )
    else:
        narration_rule = (
            '"full_narration": "COMPLETE story/script as one continuous paragraph. This is what the voice will read. '
            f'Must be {blurb}. Natural narration — no segment breaks, no numbering."'
        )
        strict_extra = (
            f"- full_narration is ONE continuous paragraph, {lo}-{hi} English words.\n"
            "- STYLE: Use simple, casual, conversational everyday English. Avoid complex jargon, academic terms, or formal vocabulary. Keep it punchy, engaging, and friendly.\n"
        )

    user += f"""
Return ONLY valid JSON with this shape:
{{
  "youtube_title": "short catchy title, under 90 chars, no hashtags",
  "youtube_description": "2-3 sentences plus optional #Shorts at end",
  {narration_rule},
  "image_prompts": [
    "highly detailed visual description for scene 1: specify composition (e.g. close-up, wide shot), subject details (age, gender, detailed facial expression, posture), clothing, actions, specific background/environment objects, lighting (e.g. moody side-light, gold lighting, soft cinematic glow), and color theme. Must be 2-3 sentences. No text in image.",
    "highly detailed visual description for scene 2...",
    "..."
  ]
}}

STRICT RULES:
{strict_extra}- "image_prompts" array MUST have exactly {n} entries.
- Each image_prompt matches a different chronological moment/beat in order, directly visualizing the story events.
- Image prompts must be highly detailed visual descriptions (2-3 sentences each) to enable high-quality generation. Describe background atmosphere (e.g. dust particles floating in light rays, weathered textures, heavy fog) to make the image beautiful.
- No style words like 'photorealistic', and no quotes/narration text inside image prompts.
- The narration must flow naturally as one spoken piece (no "segment 1", "segment 2" etc).
- OPTIONAL ENHANCEMENT: You are encouraged to inject speaker tags (e.g., [Narrator], [Host], [Guest], [Ghost], [Buddha], [Sage]) and sound effect tags (e.g., [sfx: whoosh], [sfx: riser], [sfx: boom], [sfx: horror_atmosphere], [sfx: chime], [sfx: sparkle]) inline inside "full_narration" to make the voiceovers dynamic and engaging. For example: "[Narrator] In the dark woods, a whisper was heard. [sfx: whoosh] [Ghost] Come closer. [Narrator] He froze in pure terror." Keep these tags in their exact square bracket format.
"""

    max_attempts = 3
    last_err = ""
    for attempt in range(max_attempts):
        extra = ""
        min_words = DEFAULT_MIN_WORDS.get(language, 80) if language != preset.get("language") else preset.get("min_words", 80)
        if attempt > 0:
            extra = (
                f"\n\nCRITICAL: Previous attempt failed validation or JSON formatting: {last_err}.\n"
                "Please rewrite the narration to be longer and more detailed. "
                "Ensure that the output is VALID JSON. Do not include unescaped newlines inside JSON string values. "
                f"Aim for {lo}-{hi} words (MUST be at least {min_words} words). Add more descriptive sentences to each beat.\n"
            )

        temp = 0.85 if attempt < 2 else 0.45
        try:
            data = _call_llm(preset, user + extra, temperature=temp)
        except Exception as e:
            last_err = str(e)
            print(f"   ⚠ LLM API call attempt {attempt + 1} failed: {e}")
            
            # Switch provider for subsequent retries if both keys are set
            groq_key = os.environ.get("GROQ_API_KEY", "").strip()
            gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
            if groq_key and gemini_key:
                current_provider = os.environ.get("LLM_PROVIDER", "groq").strip().lower()
                new_provider = "gemini" if current_provider == "groq" else "groq"
                print(f"   🔄 Switching LLM provider to {new_provider} for retry...")
                os.environ["LLM_PROVIDER"] = new_provider
                
            if attempt == max_attempts - 1:
                raise
            
            import time
            wait_time = 3 * (attempt + 1)
            print(f"   Waiting {wait_time}s before retrying...")
            time.sleep(wait_time)
            continue

        try:
            narration = data.get("full_narration", "").strip()
            if not narration:
                raise ValueError("Missing full_narration")

            prompts = data.get("image_prompts")
            if not isinstance(prompts, list) or len(prompts) != n:
                raise ValueError(f"Expected {n} image_prompts, got {len(prompts or [])}")
            for i, p in enumerate(prompts):
                if not isinstance(p, str) or not p.strip():
                    raise ValueError(f"image_prompt {i} is empty")

            word_count = len(narration.split())
            
            # Allow a massive grace margin on the last attempt to avoid crashing
            effective_min = min_words
            if attempt == max_attempts - 1:
                effective_min = 60 if language == "en" else (20 if language == "te" else 70)
                
            if word_count < effective_min:
                raise ValueError(
                    f"Narration too short ({word_count} words, expected ≥ {effective_min} for {language})"
                )

            return data
        except ValueError as e:
            last_err = str(e)
            if attempt == max_attempts - 1:
                raise

    # Fallback (should be unreachable due to raise above)
    return data


# ─────────────────────────────────────────────────────────────────────────
# Multi-variant path (one Groq call returns every language's narration)
# ─────────────────────────────────────────────────────────────────────────
def _generate_multivariant(
    preset: ChannelPreset, user: str, n: int, variants: list,
) -> dict[str, Any]:
    # Build the per-language requirement lines
    lang_lines = []
    for v in variants:
        lang = v["lang"]
        lo, hi, blurb = LANG_WORD_TARGETS.get(lang, LANG_WORD_TARGETS["en"])
        lang_lines.append(
            f'    "{lang}": {{\n'
            f'      "youtube_title": "catchy title in {_lang_label(lang)} (<90 chars, no hashtags)",\n'
            f'      "youtube_description": "2-3 sentences in {_lang_label(lang)} + optional #Shorts",\n'
            f'      "full_narration": "ONE continuous paragraph in {_lang_label(lang)}. '
            f'{blurb}. Spoken style — use extremely simple, casual, colloquial everyday vocabulary that everyone understands. Avoid formal, bookish, or complex words."\n'
            f'    }}'
        )
    variants_block = ",\n".join(lang_lines)

    word_targets = "\n".join(
        f"  - {_lang_label(v['lang'])}: {LANG_WORD_TARGETS.get(v['lang'], LANG_WORD_TARGETS['en'])[2]}"
        for v in variants
    )
    lang_keys = ", ".join(f'"{v["lang"]}"' for v in variants)

    user += f"""
Return ONLY valid JSON with this shape:
{{
  "image_prompts": [
    "highly detailed visual description for scene 1 — IN ENGLISH ONLY: close-up, subject, clothing, action, environment, lighting, color. Must be 2-3 sentences. No text in image, no quotes.",
    "highly detailed visual description for scene 2 — in English...",
    "..."
  ],
  "variants": {{
{variants_block}
  }}
}}

STRICT RULES:
- "image_prompts" array MUST have exactly {n} entries, ALL in English.
- Each image_prompt is a highly detailed visual description (2-3 sentences each) to generate high-quality images. Describe composition (close-up, wide shot), specific environmental details, lighting, and expressions.
- "variants" object MUST contain keys: {lang_keys}.
- Each variant tells the SAME facts/story but written natively in that language (not literal translation).
- Word-count targets per language:
{word_targets}
- Narrations are continuous spoken paragraphs — no segment numbers, no headings.
- Spoken style: For all languages (English, Hindi, Telugu), use extremely simple, colloquial everyday spoken words. Avoid complex vocabulary, jargon, formal expressions, or bookish language. It must sound natural, simple, and engaging for a general audience.
- OPTIONAL ENHANCEMENT: You are encouraged to inject speaker tags (e.g., [Narrator], [Host], [Guest], [Ghost], [Buddha], [Sage]) and sound effect tags (e.g., [sfx: whoosh], [sfx: riser], [sfx: boom], [sfx: horror_atmosphere], [sfx: chime], [sfx: sparkle]) inline inside "full_narration" to make the voiceovers dynamic and engaging. For example: "[Narrator] In the dark woods, a whisper was heard. [sfx: whoosh] [Ghost] Come closer. [Narrator] He froze in pure terror." Keep these tags in their exact square bracket format.
- Titles/descriptions: each in its own language.
- BEFORE you output JSON: mentally count words in each full_narration. If English is under 115 words OR Hindi under 100 words, REWRITE that paragraph longer (same facts) until counts are met.
"""

    last_err: str | None = None
    max_attempts = 4
    for attempt in range(max_attempts):
        extra = ""
        if last_err:
            extra = (
                "\n\n=== REGENERATE (previous JSON failed validation or formatting) ===\n"
                f"{last_err}\n"
                "Return a NEW complete JSON object that fixes the issue. "
                "Ensure that the output is VALID JSON. Do not include unescaped newlines inside JSON string values. "
                "Keep the same facts/story and the same image_prompts beats; "
                "expand ONLY the narration(s) that were too short — add 3-5 full sentences each.\n"
            )
        # Later attempts: lower temperature so the model obeys length constraints more reliably.
        temp = 0.85 if attempt < 2 else 0.45
        try:
            data = _call_llm(preset, user + extra, temperature=temp)
        except Exception as e:
            last_err = str(e)
            print(f"   ⚠ LLM API call attempt {attempt + 1} failed: {e}")
            
            # Switch provider for subsequent retries if both keys are set
            groq_key = os.environ.get("GROQ_API_KEY", "").strip()
            gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
            if groq_key and gemini_key:
                current_provider = os.environ.get("LLM_PROVIDER", "groq").strip().lower()
                new_provider = "gemini" if current_provider == "groq" else "groq"
                print(f"   🔄 Switching LLM provider to {new_provider} for retry...")
                os.environ["LLM_PROVIDER"] = new_provider
                
            if attempt == max_attempts - 1:
                raise
            
            import time
            wait_time = 3 * (attempt + 1)
            print(f"   Waiting {wait_time}s before retrying...")
            time.sleep(wait_time)
            continue

        try:
            _assert_multivariant_valid(data, variants, n, is_last_attempt=(attempt == max_attempts - 1))
            return data
        except ValueError as e:
            last_err = str(e)
            if attempt == max_attempts - 1:
                raise


def _assert_multivariant_valid(data: dict[str, Any], variants: list, n: int, is_last_attempt: bool = False) -> None:
    prompts = data.get("image_prompts")
    if not isinstance(prompts, list) or len(prompts) != n:
        raise ValueError(f"Expected {n} image_prompts, got {len(prompts or [])}")
    for i, p in enumerate(prompts):
        if not isinstance(p, str) or not p.strip():
            raise ValueError(f"image_prompt {i} is empty")

    vmap = data.get("variants")
    if not isinstance(vmap, dict):
        raise ValueError("Groq response missing 'variants' object")

    for v in variants:
        lang = v["lang"]
        node = vmap.get(lang)
        if not isinstance(node, dict):
            raise ValueError(f"variants['{lang}'] missing")

        narration = (node.get("full_narration") or "").strip()
        if not narration:
            raise ValueError(f"variants['{lang}'].full_narration empty")

        min_words = v.get("min_words", DEFAULT_MIN_WORDS.get(lang, 80))
        if is_last_attempt:
            min_words = 60 if lang == "en" else 70
            
        word_count = len(narration.split())
        if word_count < min_words:
            lo, hi, _ = LANG_WORD_TARGETS.get(lang, LANG_WORD_TARGETS["en"])
            raise ValueError(
                f"variants['{lang}'].full_narration too short "
                f"({word_count} words, need ≥{min_words}; ideal range {lo}-{hi})"
            )

        if not (node.get("youtube_title") or "").strip():
            raise ValueError(f"variants['{lang}'].youtube_title empty")


def _call_groq(
    preset: ChannelPreset,
    user: str,
    api_key: str,
    *,
    temperature: float = 0.85,
) -> dict[str, Any]:
    client = Groq(api_key=api_key)
    resp = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": preset["groq_system_hint"]},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        max_tokens=3072,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content
    if not raw:
        raise RuntimeError("Empty Groq response")
    return json.loads(raw)


def _call_gemini(
    preset: ChannelPreset,
    user: str,
    api_key: str,
    *,
    temperature: float = 0.85,
) -> dict[str, Any]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}"
    system_instruction = preset.get("groq_system_hint") or ""
    
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": user}
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": temperature,
            "maxOutputTokens": 3072,
        }
    }
    
    if system_instruction:
        payload["systemInstruction"] = {
            "parts": [
                {"text": system_instruction}
            ]
        }
        
    headers = {"Content-Type": "application/json"}
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        res_data = resp.json()
        
        try:
            raw_text = res_data["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(raw_text)
        except (KeyError, IndexError, json.JSONDecodeError) as e:
            raise RuntimeError(f"Failed to parse JSON from Gemini response: {e}. Raw response: {res_data}")


def _call_llm(
    preset: ChannelPreset,
    user: str,
    *,
    temperature: float = 0.85,
) -> dict[str, Any]:
    provider = os.environ.get("LLM_PROVIDER", "groq").strip().lower()
    
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    
    if not groq_key and not gemini_key:
        raise ValueError(
            "❌ Both GROQ_API_KEY and GEMINI_API_KEY are missing or empty!\n"
            "To fix this:\n"
            "  1. Local run: Add GROQ_API_KEY or GEMINI_API_KEY to your local `.env` file.\n"
            "  2. GitHub Actions run: Go to your repository settings -> Secrets and variables -> Actions, "
            "and add GROQ_API_KEY or GEMINI_API_KEY as a repository secret."
        )

    # Auto-resolve provider if the preferred one doesn't have an API key set
    if provider == "groq" and not groq_key and gemini_key:
        provider = "gemini"
    elif provider == "gemini" and not gemini_key and groq_key:
        provider = "groq"
        
    if provider == "gemini":
        if not gemini_key:
            raise KeyError("GEMINI_API_KEY environment variable is not set or empty")
        print(f"   🤖 Querying Gemini ({GEMINI_MODEL})...")
        return _call_gemini(preset, user, gemini_key, temperature=temperature)
    else:
        if not groq_key:
            raise KeyError("GROQ_API_KEY environment variable is not set or empty")
        print(f"   🤖 Querying Groq ({GROQ_MODEL})...")
        return _call_groq(preset, user, groq_key, temperature=temperature)
