#!/usr/bin/env python3
"""
Sports Channel Rotation Helper.

Rotates through available sports niches:
1. World Cup Chronicles (Football) -> new_preset_1781632935565
2. Formula 1 Racing -> f1_stories
3. Cricket Records -> cricket_stories
4. Sports Anomalies (General) -> sports_universe
"""
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# List of sports channels to rotate through (excluding World Cup which runs daily)
SPORTS_CHANNELS = [
    "f1_stories",               # Formula 1 Racing & Rivalries
    "cricket_stories",          # Cricket Records & Legend Tales
    "sports_universe"           # Sports Anomalies & Olympic Legends
]

def main():
    history_dir = REPO_ROOT / "output" / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    rotation_file = history_dir / "sports_rotation.json"
    
    current_index = 0
    if rotation_file.is_file():
        try:
            state = json.loads(rotation_file.read_text(encoding="utf-8"))
            last_channel = state.get("last_channel")
            if last_channel in SPORTS_CHANNELS:
                current_index = (SPORTS_CHANNELS.index(last_channel) + 1) % len(SPORTS_CHANNELS)
        except Exception as e:
            print(f"⚠ Failed to read sports rotation state: {e}. Starting from index 0.")

    selected_channel = SPORTS_CHANNELS[current_index]
    print(f"🏆 Selected sports channel for today: {selected_channel}")
    
    # Save the new state
    try:
        rotation_file.write_text(json.dumps({"last_channel": selected_channel}, indent=2), encoding="utf-8")
        print(f"✓ Saved rotation state to {rotation_file}")
    except Exception as e:
        print(f"⚠ Failed to save sports rotation state: {e}")
        
    # Run the run_short.py script for the selected channel
    cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "run_short.py"),
        "--channel", selected_channel,
        "--upload",
        "--privacy", "public"
    ]
    
    print(f"🚀 Running: {' '.join(cmd)}")
    result = subprocess.run(cmd)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
