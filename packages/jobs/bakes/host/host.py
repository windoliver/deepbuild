# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "torch==2.8.0",
#   "torchaudio==2.8.0",
#   "transformers==4.57.6",
#   "numpy==2.2.6",
#   "soxr==1.0.0",
#   "beat-this==1.1.0",
#   "einops==0.8.2",
#   "rotary-embedding-torch==0.8.9",
# ]
# ///
"""The analysis bake's model host (#1819): the pinned open models behind the job kinds bake.words, bake.beats and
bake.activity, served on loopback as a job tool's host (#1924).

GET /report answers the weight files it holds, each by its SHA-256 as read from disk, and its capabilities. POST
/<tool> takes {params, inputs: {name: base64}} and answers {outputs: {bake: base64}}: one JSON record of the model's
readings in whole model frames. The host never derives a tempo, a span or a shape; the canvas does, by pinned rules.

Each weight file is fetched once by its SHA-256 into the cache and checked before it is used; a file whose bytes don't
match is never loaded. Every model runs on one CPU thread, so a rerun of the same input gives the same bytes.

Run: uv run --script host.py [--port 8719]
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import numpy as np

FLICKS = 705_600_000
CACHE = Path(os.environ.get('DEEP_MODEL_CACHE', Path.home() / 'Library/Caches/deepbuild/models'))
HF = 'https://huggingface.co'
CHARSIU = f'{HF}/charsiu/en_w2v2_fc_10ms/resolve/e9bf8dd314313fc57f6e4d0b5425bde4bbeac80f'
CMU = f'{HF}/charsiu/tokenizer_en_cmu/resolve/10507401aedf5e0aba164128535b49225ff95260'
FILES = {
    'charsiu-en_w2v2_fc_10ms.bin': (f'{CHARSIU}/pytorch_model.bin', '6dc8a18422db7c22e951d5f72dc2afc267b942eb0b8459ac6dcc0cf412536de1'),
    'charsiu-en_w2v2_fc_10ms.json': (f'{CHARSIU}/config.json', '7406aa4f917267640865688aa62f2337664a3abb9a49a2f204d932b53aeb6cb7'),
    'charsiu-tokenizer_en_cmu.json': (f'{CMU}/vocab.json', '781514e251e9615ea4a05bbf3760ffcf8ec2ebe67355f411177ea64b0602d897'),
    'cmudict-0.7b.dict': ('https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690/cmudict.dict', '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22'),
    'beat_this-final0.ckpt': ('https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt', '8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331'),
    'silero_vad-6.2.3.jit': ('https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.jit', 'e1122837f4154c511485fe0b9c64455f7b929c96fbb8d79fbdb336383ebd3720'),
}
# Each tool: its kind, the weight files it runs, its model frame and the sample rate the model reads.
TOOLS = {
    'charsiu-aligner@1.0.0': ('bake.words', ['charsiu-en_w2v2_fc_10ms.bin', 'charsiu-en_w2v2_fc_10ms.json', 'charsiu-tokenizer_en_cmu.json', 'cmudict-0.7b.dict'], 10, 16_000),
    'beat-this@1.1.0': ('bake.beats', ['beat_this-final0.ckpt'], 20, 22_050),
    'silero-vad@6.2.3': ('bake.activity', ['silero_vad-6.2.3.jit'], 32, 16_000),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch(name):
    """A weight file in the cache, fetched once and refused unless its bytes are the pinned hash."""
    url, want = FILES[name]
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix('.part')
        urllib.request.urlretrieve(url, tmp)
        if sha256(tmp) != want:
            tmp.unlink()
            raise SystemExit(f'{name} from {url} is not {want}; nothing was kept')
        tmp.rename(path)
    return path


HASHED = {}


def held():
    """The weight files on disk, by name and the SHA-256 of their bytes now: hashed again whenever a file changes."""
    out = {}
    for name in FILES:
        path = fetch(name)
        st = path.stat()
        if HASHED.get(name, (None,))[0] != (st.st_size, st.st_mtime_ns):
            HASHED[name] = ((st.st_size, st.st_mtime_ns), sha256(path))
        out[name] = HASHED[name][1]
    return out


def mono(pcm, rate, channels, to):
    """Interleaved f32 PCM as one channel, the channels' mean, at the model's rate."""
    x = np.frombuffer(pcm, dtype='<f4').reshape(-1, channels).mean(axis=1)
    if rate != to and len(x):
        import soxr
        x = soxr.resample(x, rate, to, quality='VHQ')
    return np.ascontiguousarray(x, dtype=np.float32)


MODELS = {}


def model(tool, files):
    """Each model loaded once, from the files whose hashes the host reported."""
    if tool in MODELS:
        return MODELS[tool]
    import torch
    torch.set_num_threads(1)
    paths = {n: CACHE / n for n in files}
    if tool.startswith('charsiu'):
        from transformers import Wav2Vec2Config, Wav2Vec2ForCTC
        config = Wav2Vec2Config.from_json_file(paths['charsiu-en_w2v2_fc_10ms.json'])
        net = Wav2Vec2ForCTC(config)
        state = torch.load(paths['charsiu-en_w2v2_fc_10ms.bin'], map_location='cpu', weights_only=True)
        missing, unexpected = net.load_state_dict(state, strict=False)
        if [k for k in missing if 'masked_spec_embed' not in k] or unexpected:
            raise SystemExit(f'{tool}: weights don\'t fit the model: missing {missing}, unexpected {unexpected}')
        vocab = json.loads(paths['charsiu-tokenizer_en_cmu.json'].read_text())
        lexicon = {}
        for line in paths['cmudict-0.7b.dict'].read_text(encoding='latin-1').splitlines():
            word, *phones = line.split('#')[0].split()
            if '(' not in word:
                lexicon.setdefault(word.lower(), [re.sub(r'\d', '', p) for p in phones])
        MODELS[tool] = (net.eval(), vocab, lexicon)
    elif tool.startswith('beat-this'):
        from beat_this.inference import Audio2Frames
        MODELS[tool] = Audio2Frames(checkpoint_path=str(paths['beat_this-final0.ckpt']), device='cpu', float16=False)
    else:
        MODELS[tool] = torch.jit.load(str(paths['silero_vad-6.2.3.jit']), map_location='cpu').eval()
    return MODELS[tool]


def viterbi(scores, states, optional):
    """The best path through the states in order, each held one frame or more; an optional state may be skipped."""
    n, t = len(states), len(scores)
    s = scores[:, states]
    best = np.full(n, -np.inf)
    best[:2] = s[0, :2]
    back = np.zeros((t, n), dtype=np.int32)
    # A step from k − 2 skips the optional state k − 1, into a state that isn't optional.
    may_skip = np.concatenate([[False, False], optional[1:-1] & ~optional[2:]])
    for f in range(1, t):
        stay, step = best, np.concatenate([[-np.inf], best[:-1]])
        skip = np.where(may_skip, np.concatenate([[-np.inf, -np.inf], best[:-2]]), -np.inf)
        moves = np.stack([stay, step, skip])
        back[f] = np.arange(n) - moves.argmax(0)
        best = moves.max(0) + s[f]
    k = n - 1 if best[n - 1] >= best[n - 2] else n - 2
    path = [k]
    for f in range(t - 1, 0, -1):
        k = back[f, k]
        path.append(k)
    return path[::-1]


def words(net, vocab, lexicon, x, text):
    """
    Each word's and phoneme's times in flicks, by a Viterbi path through the frame classifier's phoneme scores, the
    text's words in order with an optional silence before, between and after them. A frame's time is its window's
    centre, 12.5 ms after its start; a word after a silence starts where its sound rises out of that silence: the first
    10 ms whose level passes a tenth of the way from the silence's median level to the word's peak, within 80 ms.
    """
    import torch
    spoken = [w for w in re.findall(r"[a-z']+", text.lower()) if w.strip("'")]
    unknown = [w for w in spoken if w not in lexicon]
    if unknown:
        raise ValueError(f'no pronunciation for {", ".join(unknown)}')
    if not spoken or len(x) == 0:
        return []
    with torch.no_grad():
        v = torch.from_numpy((x - x.mean()) / np.sqrt(x.var() + 1e-7))[None]
        scores = torch.log_softmax(net(v).logits[0], dim=-1).numpy().astype(np.float64)
    sil = vocab['[SIL]']
    states, owner = [], []
    for i, w in enumerate(spoken):
        states.append(sil); owner.append((-1, i))
        for j, p in enumerate(lexicon[w]):
            states.append(vocab[p]); owner.append((i, j))
    states.append(sil); owner.append((-1, len(spoken)))
    if len(scores) < len(states):
        raise ValueError(f'{len(scores)} frames are too few for {len(states)} phonemes and silences')
    path = viterbi(scores, states, np.array([o[0] == -1 for o in owner]))
    hop, centre, per_sample = 160, 200, FLICKS // 16_000
    at = lambda f: (f * hop + centre) * per_sample
    level = np.sqrt(np.convolve(x.astype(np.float64) ** 2, np.ones(hop) / hop, 'same'))
    out = [{'text': w, 'phonemes': []} for w in spoken]
    for f, k in enumerate(path):
        i, j = owner[k]
        if i < 0:
            continue
        ph = out[i]['phonemes']
        if len(ph) <= j:
            ph.append({'p': lexicon[spoken[i]][j], 'start': at(f), 'end': at(f + 1), 'frame': f})
        else:
            ph[j]['end'] = at(f + 1)
    for w in out:
        first = w['phonemes'][0]
        f = first.pop('frame')
        for p in w['phonemes'][1:]:
            p.pop('frame')
        if f == 0 or owner[path[f - 1]][0] == -1:
            centre_sample = f * hop + centre
            lo, hi = max(0, centre_sample - 1280), min(len(x), centre_sample + 1280)
            floor = np.median(level[max(0, lo - 3200):lo]) if lo > 0 else 0.0
            peak = level[lo:hi].max()
            rise = np.nonzero(level[lo:hi] > floor + 0.1 * (peak - floor))[0]
            if len(rise):
                first['start'] = min(max(0, lo + int(rise[0]) - hop // 2) * per_sample, first['end'] - per_sample)
        w['start'], w['end'] = first['start'], w['phonemes'][-1]['end']
    return [{'text': w['text'], 'start': w['start'], 'end': w['end'], 'phonemes': w['phonemes']} for w in out]


def run(tool, params, inputs):
    kind, files, ms, rate = TOOLS[tool]
    weights = held()
    pcm = inputs.get('pcm', b'')
    frame = ms * FLICKS // 1000
    record = {'kind': kind, 'analyzer': tool, 'weights': [{'name': n, 'sha256': weights[n]} for n in files],
              'pcm_sha256': hashlib.sha256(pcm).hexdigest(), 'frame': frame}
    x = mono(pcm, int(params['sample_rate']), int(params['channels']), rate) if pcm else np.zeros(0, np.float32)
    if kind == 'bake.words':
        text = inputs.get('text', b'').decode('utf8')
        record['words'] = words(*model(tool, files), x, text) if len(x) else []
    elif kind == 'bake.beats':
        record['beats'] = []
        if len(x):
            import torch
            with torch.no_grad():
                logits = model(tool, files)(x, rate)[0].numpy()
            # Beat This's own minimal rule: a frame that is the largest of the 7 around it, above even odds, and not
            # next to the beat before it.
            for f in range(len(logits)):
                if logits[f] > 0 and logits[f] == logits[max(0, f - 3):f + 4].max() and not (record['beats'] and record['beats'][-1] == (f - 1) * frame):
                    record['beats'].append(f * frame)
    else:
        record['speech'], record['speech_reversed'] = [], []
        if len(x):
            # Read forward and backward over whole frames, so frame i of each pass covers the same samples and a
            # causal model's lag at a span's edges falls on opposite sides.
            import torch
            vad = model(tool, files)
            x = np.concatenate([x, np.zeros((-len(x)) % 512, np.float32)])
            for name, signal in (('speech', x), ('speech_reversed', np.ascontiguousarray(x[::-1]))):
                vad.reset_states()
                with torch.no_grad():
                    p = vad.audio_forward(torch.from_numpy(signal), rate)[0].numpy()
                record[name] = [round(float(v), 4) for v in (p if name == 'speech' else p[::-1])]
    return json.dumps(record, sort_keys=True, separators=(',', ':')).encode('utf8')


class Handler(BaseHTTPRequestHandler):
    def answer(self, code, value):
        body = json.dumps(value).encode('utf8')
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != '/report':
            return self.answer(404, {'error': 'not found'})
        weights = held()
        self.answer(200, {'weights': [{'name': n, 'sha256': s} for n, s in sorted(weights.items())], 'capabilities': ['cpu']})

    def do_POST(self):
        tool = self.path.lstrip('/')
        if tool not in TOOLS:
            return self.answer(404, {'error': f'no tool {tool}'})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('content-length', '0'))))
            inputs = {n: base64.b64decode(v) for n, v in body.get('inputs', {}).items()}
            bake = run(tool, body.get('params', {}), inputs)
        except Exception as e:  # the call fails naming why; the hub keeps nothing
            return self.answer(422, {'error': f'{tool}: {e}'})
        self.answer(200, {'outputs': {'bake': base64.b64encode(bake).decode('ascii')}})

    def log_message(self, *_):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8719)
    a = ap.parse_args()
    held()
    print(json.dumps({'ready': f'127.0.0.1:{a.port}'}), flush=True)
    HTTPServer(('127.0.0.1', a.port), Handler).serve_forever()


if __name__ == '__main__':
    sys.exit(main())
