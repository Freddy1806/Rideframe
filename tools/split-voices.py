#!/usr/bin/env python3
"""Cut ElevenLabs takes (one line per paragraph) into single lines and update assets/audio/manifest.json.
usage: python3 tools/split-voices.py <group> <take.mp3> [<group> <take.mp3> ...]   (groups from tools/voices.json)
Needs ffmpeg. Finds the pauses with silencedetect; if the count does not match, it lowers the threshold until it does."""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, 'assets', 'audio'); OUT = os.path.join(AUD, 'voices')
LINES = json.load(open(os.path.join(ROOT, 'tools', 'voices.json')))

def pauses(path, noise, dur):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', f'silencedetect=noise={noise}dB:d={dur}', '-f', 'null', '-'], capture_output=True, text=True).stderr
    s = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', r)]; e = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', r)]
    h, mi, se = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r).groups(); total = 3600 * int(h) + 60 * int(mi) + float(se)
    return list(zip(s, e)), total

def split(group, path):
    lines = LINES[group]; n = len(lines)
    for dur in (0.55, 0.45, 0.35, 0.7, 0.9):
        for noise in (-38, -34, -42, -30):
            sil, total = pauses(path, noise, dur)
            inner = [(a, b) for a, b in sil if a > 0.15 and b < total - 0.15]
            if len(inner) == n - 1: break
        if len(inner) == n - 1: break
    else:
        sys.exit(f'{group}: found {len(inner) + 1} pieces, expected {n}. Check the take.')
    cuts = [0.0] + [(a + b) / 2 for a, b in inner] + [total]
    os.makedirs(OUT, exist_ok=True); res = {}
    for i, text in enumerate(lines):
        name = f'{group}_{i + 1:02d}.mp3'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-ss', f'{cuts[i]:.3f}', '-to', f'{cuts[i + 1]:.3f}',
                        '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5',
                        '-ar', '44100', '-b:a', '160k', os.path.join(OUT, name)], check=True)
        res[text] = 'voices/' + name
    return res

def main(args):
    mpath = os.path.join(AUD, 'manifest.json')
    m = json.load(open(mpath)) if os.path.exists(mpath) else {}
    m.setdefault('voices', {}); m.setdefault('coach', {})
    for g, p in zip(args[::2], args[1::2]):
        for text, f in split(g, p).items():
            if text.startswith('coach:'): m['coach'][text[6:]] = f
            elif '#' not in text: m['voices'][text] = f
        print(g, 'ok')
    json.dump(m, open(mpath, 'w'), indent=1, ensure_ascii=False)

if __name__ == '__main__': main(sys.argv[1:])
