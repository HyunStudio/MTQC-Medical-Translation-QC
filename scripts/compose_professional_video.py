"""Prepare timed narration and encode genuine browser scene recordings."""
import argparse
import json
from pathlib import Path
import subprocess
import wave
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/video/professional-v4'
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

def run(*args):
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], check=True)

def stamp(seconds):
    milliseconds = round(seconds * 1000)
    return f'{milliseconds // 3600000:02}:{milliseconds // 60000 % 60:02}:{milliseconds // 1000 % 60:02},{milliseconds % 1000:03}'

def prepare():
    story = json.loads((ROOT / 'docs/web-demo/video-storyboard.json').read_text(encoding='utf-8-sig'))
    for scene in story:
        chunks, captions, time = [], [], 0.5
        scene['sentenceStarts'] = []
        for index, sentence in enumerate(scene['sentences']):
            scene['sentenceStarts'].append(time)
            source = OUT / f"{scene['id']}-{index}.wav"
            with wave.open(str(source)) as wav:
                duration = wav.getnframes() / wav.getframerate()
            chunks.append(source)
            # Short captions are timed to separately synthesized sentences.
            words = sentence.split()
            groups = [words[i:i+12] for i in range(0, len(words), 12)]
            for group in groups:
                end = time + duration * len(group) / len(words)
                captions.append(f'{len(captions)+1}\n{stamp(time)} --> {stamp(end)}\n{" ".join(group)}\n')
                time = end
        scene['duration'] = max(scene['minimumSeconds'], time + 1.5)
        scene['speechSeconds'] = time
        (OUT / f"{scene['id']}.srt").write_text('\n'.join(captions), encoding='utf-8')
        args = []
        for chunk in chunks:
            args.extend(['-i', chunk])
        concat = ''.join(f'[{i}:a]' for i in range(len(chunks))) + f'concat=n={len(chunks)}:v=0:a=1,adelay=500|500,apad[a]'
        run(*args, '-filter_complex', concat, '-map', '[a]', '-t', scene['duration'], OUT / f"{scene['id']}.wav")
    (OUT / 'timing.json').write_text(json.dumps(story, indent=2), encoding='utf-8')
    print(f"Planned duration: {sum(scene['duration'] for scene in story):.1f}s")

def encode():
    story = json.loads((OUT / 'timing.json').read_text())
    parts = []
    offset = 0
    full_captions = []
    for scene in story:
        output = OUT / f"{scene['id']}.mp4"
        # Work in OUT so subtitles paths have no Windows drive-colon escaping.
        subtitle = f"subtitles={scene['id']}.srt:force_style='FontName=Arial,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H0021160B,BorderStyle=3,Outline=2,Shadow=0,MarginV=18'"
        speed = scene.get('videoSpeed', 1)
        if speed <= 0:
            raise ValueError('Video speed must be positive')
        run('-i', OUT / f"{scene['id']}.webm", '-i', OUT / f"{scene['id']}.wav",
            '-map', '0:v', '-map', '1:a', '-vf', f'setpts=(PTS-STARTPTS)/{speed},' + subtitle + ',fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast',
            '-crf', 19, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '160k', '-t', scene['duration'], '-movflags', '+faststart', output)
        parts.append(f"file '{output.name}'")
        for block in (OUT / f"{scene['id']}.srt").read_text().strip().split('\n\n'):
            lines = block.splitlines()
            def seconds(value):
                h,m,s = value.replace(',', '.').split(':')
                return int(h)*3600+int(m)*60+float(s)
            start, end = lines[1].split(' --> ')
            full_captions.append(f'{len(full_captions)+1}\n{stamp(offset+seconds(start))} --> {stamp(offset+seconds(end))}\n'+'\n'.join(lines[2:])+'\n')
        offset += scene['duration']
    (OUT / 'concat.txt').write_text('\n'.join(parts), encoding='utf-8')
    run('-f', 'concat', '-safe', 0, '-i', OUT / 'concat.txt', '-c', 'copy', '-movflags', '+faststart', OUT / 'MTQC-professional-demo.mp4')
    (OUT / 'MTQC-professional-demo.en.srt').write_text('\n'.join(full_captions), encoding='utf-8')
    print(OUT / 'MTQC-professional-demo.mp4')

if __name__ == '__main__':
    import os
    parser = argparse.ArgumentParser()
    parser.add_argument('--encode', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    os.chdir(OUT)
    encode() if args.encode else prepare()
