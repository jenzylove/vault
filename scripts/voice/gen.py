"""
Render every line the Fence can say to a small voice clip (npm run voice).

Build time only: edge-tts (Microsoft neural voices) needs the network here, once. The game itself never calls
a speech service: it plays these files from disk (src/renderer/ui/speech.ts), because his lines describe the
player's body and nothing may leave the device.

  1. scripts/voice/units.ts (via tsx) lists what to record: every whole line, and the sentences of the
     lines built from parts (src/renderer/voice/catalog.ts).
  2. Each one is spoken by edge-tts, then shaped with ffmpeg: trimmed, a touch lower and older, darker,
     compressed, a faint back room, the same loudness, Opus mono at 24 kbps.
  3. Clips land in src/renderer/public/voice/<hash>.ogg; src/renderer/voice/manifest.json maps each line's
     lookup key to its file and length. Clips already rendered with the same settings are kept; clips no
     line uses any more are deleted.

Usage: python scripts/voice/gen.py [--limit N] [--force]
Needs: pip install edge-tts==7.3.1, ffmpeg (FFMPEG env var, or on PATH), node with tsx (devDependency).
"""
import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile

import edge_tts

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'renderer', 'public', 'voice')
MANIFEST = os.path.join(ROOT, 'src', 'renderer', 'voice', 'manifest.json')

# The Fence: Christopher is the deepest, most grounded of the edge voices, a mature narrator with weight.
# A little slower and lower, then pitched and formant shifted down 4.5 percent in ffmpeg so he reads as an
# older, bigger man; the rate keeps his patience, the room keeps him in the back of a bar.
VOICE = 'en-US-ChristopherNeural'
RATE = '-8%'
PITCH = '-8Hz'
SHIFT = 0.955
FX = ','.join([
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03',
    'areverse',
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06',
    'areverse',
    # no pause inside a line longer than a third of a second: he is slow, never draggy
    'silenceremove=stop_periods=-1:stop_duration=0.35:stop_threshold=-42dB:stop_silence=0.35',
    f'asetrate={round(24000 * SHIFT)}',
    'aresample=24000',
    f'atempo={1 / SHIFT:.5f}',
    'highpass=f=55',
    'bass=g=3:f=150:w=0.7',
    'equalizer=f=3000:t=q:w=1.4:g=-2.5',
    'treble=g=-2:f=7500',
    'acompressor=threshold=-22dB:ratio=3:attack=4:release=90:makeup=2.5',
    'aecho=0.9:0.6:23|41:0.08|0.05',
])
# every clip to the same loudness: measured first, then one fixed gain, and a limiter catches the peaks
TARGET_LUFS = -16.0
LIMIT = 'alimiter=limit=0.84:attack=2:release=60:level=false'
FX_VERSION = 'fx5'
TAG = f'{VOICE}|{RATE}|{PITCH}|{SHIFT}|{FX_VERSION}'
CONCURRENCY = 5


def tool(name: str, env: str, default: str) -> str:
    p = os.environ.get(env)
    if p:
        return p
    if os.path.exists(default):
        return default
    found = shutil.which(name)
    if not found:
        sys.exit(f'{name} not found: set {env} or put it on PATH')
    return found


FFMPEG = tool('ffmpeg', 'FFMPEG', 'C:/Users/LENOVO/tools/ffmpeg-9.0-essentials_build/bin/ffmpeg.exe')
FFPROBE = tool('ffprobe', 'FFPROBE', os.path.join(os.path.dirname(FFMPEG), 'ffprobe.exe'))


def fnv1a(s: str) -> str:
    h = 0x811C9DC5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f'{h:08x}'


def units() -> list:
    npx = shutil.which('npx') or shutil.which('npx.cmd')
    if not npx:
        sys.exit('npx not found')
    r = subprocess.run([npx, 'tsx', os.path.join('scripts', 'voice', 'units.ts')], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        sys.exit(r.stderr)
    data = json.loads(r.stdout)
    print(f"{data['lines']} spoken lines, {len(data['units'])} clips to have")
    return data['units']


async def run(*args: str) -> str:
    p = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await p.communicate()
    if p.returncode != 0:
        raise RuntimeError(err.decode('utf-8', 'replace')[-800:])
    return out.decode('utf-8', 'replace')


async def duration_ms(path: str) -> int:
    out = await run(FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path)
    return int(round(float(out.strip()) * 1000))


async def render(text: str, dest: str, tmp: str) -> None:
    raw = os.path.join(tmp, os.path.basename(dest) + '.mp3')
    for attempt in range(8):
        try:
            await edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH).save(raw)
            if os.path.getsize(raw) > 0:
                break
        except Exception as e:  # the service drops a request now and then: back off and try again
            if attempt == 7:
                raise RuntimeError(f'edge-tts failed for {text!r}: {e}')
        await asyncio.sleep(1.5 * (attempt + 1))
    part = dest + '.part.ogg'
    p = await asyncio.create_subprocess_exec(FFMPEG, '-hide_banner', '-nostats', '-i', raw, '-af', f'{FX},loudnorm=print_format=json',
                                             '-f', 'null', '-', stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    _, err = await p.communicate()
    log = err.decode('utf-8', 'replace')
    m = json.loads(log[log.rindex('{'):log.rindex('}') + 1])
    gain = TARGET_LUFS - float(m['input_i'])
    await run(FFMPEG, '-y', '-loglevel', 'error', '-i', raw, '-af', f'{FX},volume={gain:.2f}dB,{LIMIT},aresample=24000,apad=pad_dur=0.06',
              '-ac', '1', '-ar', '24000', '-c:a', 'libopus', '-b:a', '24k', '-vbr', 'on', '-application', 'audio', part)
    os.replace(part, dest)
    os.remove(raw)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='render only the first N (a quick listen)')
    ap.add_argument('--force', action='store_true', help='render every clip again')
    a = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    todo = units()
    if a.limit:
        todo = todo[:a.limit]
    names = {}
    for u in todo:
        name = fnv1a(f"{TAG}|{u['key']}") + '.ogg'
        if name in names and names[name] != u['key']:
            sys.exit(f"hash clash: {names[name]!r} and {u['key']!r}")
        names[name] = u['key']

    sem = asyncio.Semaphore(CONCURRENCY)
    clips = {}
    done = 0
    tmp = tempfile.mkdtemp(prefix='fence-voice-')

    async def one(u: dict) -> None:
        nonlocal done
        name = fnv1a(f"{TAG}|{u['key']}") + '.ogg'
        dest = os.path.join(OUT, name)
        async with sem:
            if a.force or not os.path.exists(dest) or os.path.getsize(dest) == 0:
                await render(u['text'], dest, tmp)
            clips[u['key']] = [f'voice/{name}', await duration_ms(dest)]
        done += 1
        if done % 25 == 0 or done == len(todo):
            print(f'  {done}/{len(todo)}')

    await asyncio.gather(*(one(u) for u in todo))
    shutil.rmtree(tmp, ignore_errors=True)

    if not a.limit:
        keep = set(names)
        for f in os.listdir(OUT):
            if f.endswith('.ogg') and f not in keep:
                os.remove(os.path.join(OUT, f))
    manifest = {'voice': VOICE, 'rate': RATE, 'pitch': PITCH, 'fx': f'{FX_VERSION}: shift {SHIFT}; {FX}; gain to {TARGET_LUFS} LUFS; {LIMIT}; opus 24k mono',
                'clips': dict(sorted(clips.items()))}
    with open(MANIFEST, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
        fh.write('\n')
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith('.ogg'))
    total_ms = sum(c[1] for c in clips.values())
    print(f'{len(clips)} clips, {size / 1024:.0f} KB, {total_ms / 1000:.0f} s of speech -> {os.path.relpath(MANIFEST, ROOT)}')


if __name__ == '__main__':
    asyncio.run(main())
