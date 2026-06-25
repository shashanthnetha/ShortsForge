# pipeline/download_sfx.py
import os
import urllib.request
from pathlib import Path

SFX_SOURCES = {
    "crowd_cheering.mp3": "https://upload.wikimedia.org/wikipedia/commons/transcoded/0/09/Applause_ii.ogg/Applause_ii.ogg.mp3",
    "crowd_roaring.mp3": "https://upload.wikimedia.org/wikipedia/commons/transcoded/6/6e/Arrowhead_Stadium_crowd_noise.wav/Arrowhead_Stadium_crowd_noise.wav.mp3",
    "whistle_blowing.mp3": "https://upload.wikimedia.org/wikipedia/commons/transcoded/f/f2/Whistle.ogg/Whistle.ogg.mp3",
}

def main():
    repo_root = Path(__file__).resolve().parent.parent
    sfx_dir = repo_root / "assets" / "sfx"
    sfx_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Target SFX Directory: {sfx_dir}")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
    }

    for filename, url in SFX_SOURCES.items():
        dest_path = sfx_dir / filename
        print(f"Downloading {filename} from {url}...")
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req) as response:
                with open(dest_path, "wb") as f:
                    f.write(response.read())
            print(f"✓ Successfully downloaded {filename} ({dest_path.stat().st_size} bytes)")
        except Exception as e:
            print(f"❌ Failed to download {filename}: {e}")

if __name__ == "__main__":
    main()
