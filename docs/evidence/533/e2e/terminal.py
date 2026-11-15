"""#533 end to end: runs one shell command, prints its output, and saves "$ command" and the output as a terminal
screenshot PNG. Paths under the scratch folder are shown as <scratch>, and the evidence store as <evidence>.

Usage: python3 -I terminal.py <out.png> <title> <scratch dir> <command>
"""
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 15)
WIDTH = 150
BG, FG, PROMPT, TITLE = (30, 30, 30), (220, 220, 220), (120, 200, 120), (250, 200, 90)


def main():
    out, title, scratch, command = sys.argv[1:5]
    run = subprocess.run(['bash', '-o', 'pipefail', '-c', command], cwd=scratch, capture_output=True, text=True)
    text = (run.stdout + run.stderr).replace(f'{scratch}/evin/store', '<evidence>').replace(scratch, '<scratch>')
    print(text, end='')
    lines = [(TITLE, f'# {title}'), (PROMPT, f'$ {command}')]
    lines += [(FG, raw) for raw in text.rstrip('\n').split('\n')]
    lines += [(PROMPT, '# exit status (bash -o pipefail, so the first failing command of a pipe):'), (FG, str(run.returncode))]
    wrapped = []
    for colour, line in lines:
        for part in [line[i:i + WIDTH] for i in range(0, len(line), WIDTH)] or ['']:
            wrapped.append((colour, part))
    step = 19
    image = Image.new('RGB', (WIDTH * 9 + 24, step * len(wrapped) + 24), BG)
    draw = ImageDraw.Draw(image)
    for i, (colour, line) in enumerate(wrapped):
        draw.text((12, 12 + i * step), line, font=FONT, fill=colour)
    image.save(out)
    sys.exit(0)


if __name__ == '__main__':
    main()
