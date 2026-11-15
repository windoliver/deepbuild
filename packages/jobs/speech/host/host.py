# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "kokoro==0.9.4",
#   "misaki[en,zh]==0.9.4",
#   "attrs==25.4.0",
#   "torch==2.8.0",
#   "numpy==2.2.6",
#   "soxr==1.0.0",
#   "g2p-en==2.1.0",
#   "nltk==3.9.2",
#   "pypinyin==0.55.0",
#   "cmake==4.1.2",
#   "en-core-web-sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
# ]
# [tool.uv]
# override-dependencies = [
#   "espeakng-loader; sys_platform == 'never'",
#   "phonemizer-fork; sys_platform == 'never'",
# ]
# ///
"""The speech plug-in's model host (#509): the speech engines behind the job kind speech and the transcriber behind
narration.transcript, served on loopback as a job tool's host (#1924).

GET /report answers the files it holds, each by its SHA-256 as read from disk, and its capabilities: `say` on macOS
with /usr/bin/say, and `azure-speech-key` when this process's environment holds AZURE_SPEECH_KEY and
AZURE_SPEECH_REGION. POST /<tool> takes {params, inputs: {name: base64}} and answers {outputs: {name: base64}}. A word
an engine has no pronunciation for answers 409 {blocked: {code: "speech.unknown_word", word}}; an input the tool
refuses, such as an unknown voice, answers 422 {refused}, and any other failure 422 {error}, each naming why.

speech writes `audio`, a 16-bit mono WAV at the engine's own rate, and `record`, the JSON {kind, engine, voice, rate,
say, sample_rate, samples, audio_sha256}; an empty `say` is an empty WAV, and no engine is called.
narration.transcript reads `pcm`, interleaved f32 little-endian, as one channel at 16 kHz with 0.6 s of silence each
side, through whisper.cpp (beam 5, temperature 0, no fallback, one prompt per locale), and writes `transcript`, the
record of what it heard, each word's and each name's ARPAbet phonemes without stress by g2p_en.

Each file is fetched once by its SHA-256 into the cache and checked before it is used; a file whose bytes don't match
is never kept. whisper-cli is built once from the pinned source archive, into the cache under the archive's hash.
Kokoro runs seeded on one CPU thread and whisper.cpp on a fixed thread count, so a rerun gives the same bytes. espeak-ng
is never installed or run, and NLTK fetches nothing.

Run: uv run --script host.py [--port 8720]
"""
import argparse
import base64
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import types
import unicodedata
import urllib.request
import wave
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

import numpy as np

CACHE = Path(os.environ.get('DEEP_MODEL_CACHE', Path.home() / 'Library/Caches/deepbuild/models'))
HF = 'https://huggingface.co'
KOKORO = f'{HF}/hexgrad/Kokoro-82M/resolve/main'
WHISPER = f'{HF}/ggerganov/whisper.cpp/resolve/main'
NLTK = 'https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages'
FILES = {
    'kokoro-config.json': (f'{KOKORO}/config.json', '5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f'),
    'kokoro-v1_0.pth': (f'{KOKORO}/kokoro-v1_0.pth', '496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4'),
    'kokoro-af_heart.pt': (f'{KOKORO}/voices/af_heart.pt', '0ab5709b8ffab19bfd849cd11d98f75b60af7733253ad0d67b12382a102cb4ff'),
    'kokoro-bf_emma.pt': (f'{KOKORO}/voices/bf_emma.pt', 'd0a423deabf4a52b4f49318c51742c54e21bb89bbbe9a12141e7758ddb5da701'),
    'kokoro-zf_xiaobei.pt': (f'{KOKORO}/voices/zf_xiaobei.pt', '9b76be63dab4f4f96962030acc0126a9aee9728608fbbe115e2b58a2bd504df6'),
    'whisper.cpp-1.9.5.tar.gz': ('https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz', 'ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720'),
    'ggml-base.en.bin': (f'{WHISPER}/ggml-base.en.bin', 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'),
    'ggml-small.bin': (f'{WHISPER}/ggml-small.bin', '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'),
    'nltk-averaged_perceptron_tagger_eng.zip': (f'{NLTK}/taggers/averaged_perceptron_tagger_eng.zip', '6025f530624335c67d6547d44757b357b4e79bae030a0383e9887a92c1718f0b'),
    'nltk-cmudict.zip': (f'{NLTK}/corpora/cmudict.zip', 'd07cca47fd72ad32ea9d8ad1219f85301eeaf4568f8b6b73747506a71fb5afd6'),
}
WHISPER_FILES = ['whisper.cpp-1.9.5.tar.gz', 'ggml-base.en.bin', 'ggml-small.bin', 'nltk-averaged_perceptron_tagger_eng.zip', 'nltk-cmudict.zip']
TOOLS = {'kokoro@0.9.4': 'speech', 'platform-say@1.0.0': 'speech', 'azure-speech@1.0.0': 'speech', 'whisper-cpp@1.9.5': 'narration.transcript'}
# Each engine's own rate, in Hz: an empty line's WAV is at it too.
RATES = {'kokoro@0.9.4': 24_000, 'platform-say@1.0.0': 22_050, 'azure-speech@1.0.0': 24_000}
# Kokoro's voices and the lexicon each reads: American English, British English, Chinese.
KOKORO_VOICES = {'af_heart': 'a', 'bf_emma': 'b', 'zf_xiaobei': 'z'}
# Azure's neural voices this tool speaks, each named as Azure names it; any other is refused before a call.
AZURE_VOICES = {
    'en-US-AvaNeural', 'en-US-AndrewNeural', 'en-US-EmmaNeural', 'en-US-BrianNeural', 'en-US-JennyNeural', 'en-US-GuyNeural',
    'en-US-AriaNeural', 'en-GB-SoniaNeural', 'en-GB-RyanNeural', 'zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural',
    'ja-JP-NanamiNeural', 'ko-KR-SunHiNeural',
}
AZURE_MOST = 1000
# macOS say's rate at 1, in words per minute.
SAY_WPM = 175
SR = 16_000
PAD = 0.6
BEAM = 5
THREADS = 4
# The model and the language each locale reads with, and its prompt.
MODELS = {'en': 'ggml-base.en.bin', 'zh': 'ggml-small.bin', 'ja': 'ggml-small.bin', 'ko': 'ggml-small.bin'}
PROMPTS = {'en': '', 'zh': '以下是普通话的句子。', 'ja': '以下は日本語の文です。', 'ko': '다음은 한국어 문장입니다.'}
UNK = '❓'


class Refused(Exception):
    """A call this host won't make, naming why: answered 422."""


class Unknown(Exception):
    """A word the engine has no pronunciation for: answered 409, BLOCKED until `say` respells it."""


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch(name):
    """A file in the cache, fetched once and refused unless its bytes are the pinned hash."""
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
    """The files on disk, by name and the SHA-256 of their bytes now: hashed again whenever a file changes."""
    out = {}
    for name in FILES:
        path = fetch(name)
        st = path.stat()
        if HASHED.get(name, (None,))[0] != (st.st_size, st.st_mtime_ns):
            HASHED[name] = ((st.st_size, st.st_mtime_ns), sha256(path))
        out[name] = HASHED[name][1]
    return out


def checked(name):
    """A file's path, once its bytes are its pinned hash."""
    if held()[name] != FILES[name][1]:
        raise Refused(f'{name} on this host is not {FILES[name][1]}')
    return CACHE / name


def capabilities():
    caps = []
    if sys.platform == 'darwin' and os.path.exists('/usr/bin/say'):
        caps.append('say')
    if os.environ.get('AZURE_SPEECH_KEY') and os.environ.get('AZURE_SPEECH_REGION'):
        caps.append('azure-speech-key')
    return caps


def whisper_cli():
    """whisper-cli, built once from the pinned source archive into the cache under the archive's hash."""
    archive = fetch('whisper.cpp-1.9.5.tar.gz')
    out = CACHE / f'whisper-cli-{FILES["whisper.cpp-1.9.5.tar.gz"][1][:16]}'
    if out.exists():
        return out
    import cmake
    tool = Path(cmake.CMAKE_BIN_DIR) / 'cmake'
    print(f'building {out.name} from {archive.name}: a few minutes, once', file=sys.stderr, flush=True)
    with tempfile.TemporaryDirectory(dir=CACHE) as tmp:
        with tarfile.open(checked('whisper.cpp-1.9.5.tar.gz')) as t:
            t.extractall(Path(tmp) / 'src', filter='data')
        [src] = (Path(tmp) / 'src').iterdir()
        build = Path(tmp) / 'build'
        flags = ['-DCMAKE_BUILD_TYPE=Release', '-DGGML_METAL=OFF', '-DGGML_BLAS=OFF', '-DWHISPER_BUILD_TESTS=OFF',
                 '-DWHISPER_BUILD_EXAMPLES=ON', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF']
        subprocess.run([tool, '-S', src, '-B', build, *flags], check=True, stdout=sys.stderr)
        subprocess.run([tool, '--build', build, '-j', '4', '--target', 'whisper-cli'], check=True, stdout=sys.stderr)
        shutil.copy2(build / 'bin' / 'whisper-cli', Path(tmp) / 'whisper-cli')
        os.replace(Path(tmp) / 'whisper-cli', out)
    return out


def wav(samples, rate):
    """16-bit mono samples as a WAV file's bytes."""
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.asarray(samples, dtype='<i2').tobytes())
    return buf.getvalue()


def read_wav(data):
    """A 16-bit mono WAV file's samples and rate."""
    with wave.open(io.BytesIO(data), 'rb') as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise Refused(f'the engine wrote {w.getnchannels()} channels of {8 * w.getsampwidth()}-bit samples, not 16-bit mono')
        return np.frombuffer(w.readframes(w.getnframes()), dtype='<i2'), w.getframerate()


def to_i16(x):
    return np.round(np.clip(np.asarray(x, dtype=np.float64), -1, 1) * 32767).astype('<i2')


def mono(pcm, rate, channels, to):
    """Interleaved f32 PCM as one channel, the channels' mean, at `to` Hz."""
    if len(pcm) % (4 * channels):
        raise Refused(f'the pcm holds {len(pcm)} bytes, not whole frames of {channels} f32 samples')
    x = np.frombuffer(pcm, dtype='<f4').reshape(-1, channels).mean(axis=1)
    if rate != to and len(x):
        import soxr
        x = soxr.resample(x, rate, to, quality='VHQ')
    return np.ascontiguousarray(x, dtype=np.float32)


# ---- Kokoro.
KOKORO_LOCK = threading.Lock()
KOKORO_STATE = {}


def kokoro_state():
    """Kokoro's model, its voice packs and its lexicon front ends, each loaded once with espeak-ng out of reach."""
    if KOKORO_STATE:
        return KOKORO_STATE
    # misaki.espeak would load espeak-ng: in its place, a module whose every engine refuses.
    stub = types.ModuleType('misaki.espeak')

    class Never:
        def __init__(self, *_, **__):
            raise RuntimeError('espeak-ng is never run')
    stub.EspeakFallback = stub.EspeakG2P = Never
    sys.modules['misaki.espeak'] = stub
    import torch
    from kokoro.model import KModel
    from misaki import en
    # The repo is named only so KModel says nothing: with its config and weights given, it fetches nothing.
    model = KModel(repo_id='hexgrad/Kokoro-82M', config=str(checked('kokoro-config.json')), model=str(checked('kokoro-v1_0.pth'))).eval()
    packs = {v: torch.load(checked(f'kokoro-{v}.pt'), weights_only=True) for v in KOKORO_VOICES}
    lexicons = {'a': en.G2P(trf=False, british=False, fallback=None), 'b': en.G2P(trf=False, british=True, fallback=None)}
    KOKORO_STATE.update(model=model, packs=packs, lexicons=lexicons)
    return KOKORO_STATE


def english(g2p, say):
    """The line's phonemes in chunks Kokoro reads whole, or Unknown naming the first word the lexicon lacks."""
    from kokoro.pipeline import KPipeline
    _, tokens = g2p(say)
    for t in tokens:
        if any(c.isalnum() for c in t.text) and (t.phonemes is None or UNK in t.phonemes):
            raise Unknown(t.text)
    return [ps for _, ps, _ in KPipeline.en_tokenize(None, tokens) if ps]


def chinese(say):
    """
    A Chinese line's phonemes through pypinyin and jieba, one chunk per sentence: a character followed by its reading
    in brackets, toneless pinyin, reads as that reading; a letter outside Chinese (a Latin word) is Unknown.
    """
    import cn2an
    from misaki.zh import ZHG2P
    from pypinyin import Style, pinyin

    def plain(text):
        foreign = re.search(r'[^\W\d_一-鿿]+', text)
        if foreign:
            raise Unknown(foreign.group())
        text = ZHG2P.map_punctuation(cn2an.transform(text, 'an2cn'))
        return ZHG2P.legacy_call(text) if text.strip() else ''

    def read(char, reading):
        toned = pinyin(char, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True)[0]
        match = [p for p in toned if re.sub(r'\d', '', p).replace('ü', 'v') == reading.replace('ü', 'v')]
        if not match:
            raise Refused(f'{char} has no reading {reading}; its readings are {", ".join(toned)}')
        return ZHG2P.py2ipa(match[0])

    chunks = []
    for sentence in re.findall(r'[^。！？.!?]+[。！？.!?]*', say):
        pieces, at = [], 0
        for m in re.finditer(r'([一-鿿])\[([a-zü]+)\]', sentence):
            pieces += [plain(sentence[at:m.start()]), read(m[1], m[2])]
            at = m.end()
        pieces.append(plain(sentence[at:]))
        ps = ' '.join(' '.join(p for p in pieces if p).split())
        if len(ps) > 510:
            raise Refused(f'a sentence of the line reads as {len(ps)} phonemes, more than the 510 Kokoro reads at once')
        if ps:
            chunks.append(ps)
    return chunks


def kokoro(voice, rate, say):
    if voice not in KOKORO_VOICES:
        raise Refused(f'kokoro@0.9.4 has no voice {voice}; its voices are {", ".join(KOKORO_VOICES)}')
    import torch
    with KOKORO_LOCK:
        state = kokoro_state()
        lang = KOKORO_VOICES[voice]
        chunks = chinese(say) if lang == 'z' else english(state['lexicons'][lang], say)
        torch.set_num_threads(1)
        torch.manual_seed(0)
        pack = state['packs'][voice]
        with torch.no_grad():
            audio = [state['model'](ps, pack[len(ps) - 1], float(rate)).numpy() for ps in chunks]
    return to_i16(np.concatenate(audio) if audio else np.zeros(0)), RATES['kokoro@0.9.4']


# ---- macOS say.
def say_voices():
    """The voices `say -v ?` lists, each by its whole name and, as say also takes it, its name before a parenthesis."""
    listed = subprocess.run(['/usr/bin/say', '-v', '?'], check=True, capture_output=True, text=True).stdout
    names = {m[1].strip() for m in re.finditer(r'^(.+?)\s+[a-z]{2,3}_[A-Za-z0-9]+\s+#', listed, re.M)}
    return names | {n.split(' (')[0] for n in names}


def platform_say(voice, rate, say):
    if 'say' not in capabilities():
        raise Refused('platform-say@1.0.0 needs the capability say: macOS with /usr/bin/say')
    if voice not in say_voices():
        raise Refused(f'platform-say@1.0.0 has no voice {voice} on this Mac; `say -v ?` lists its voices')
    with tempfile.TemporaryDirectory() as d:
        text, aiff, out = Path(d) / 'line.txt', Path(d) / 'line.aiff', Path(d) / 'line.wav'
        text.write_text(say, encoding='utf8')
        subprocess.run(['/usr/bin/say', '-v', voice, '-r', str(round(SAY_WPM * rate)), '-o', aiff, '-f', text], check=True, capture_output=True)
        subprocess.run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', f'LEI16@{RATES["platform-say@1.0.0"]}', '-c', '1', aiff, out], check=True, capture_output=True)
        return read_wav(out.read_bytes())


# ---- Azure Speech: networked and paid, called only after the hub's authority ask had your yes.
def azure(voice, rate, say):
    if voice not in AZURE_VOICES:
        raise Refused(f'azure-speech@1.0.0 has no voice {voice}; its voices are {", ".join(sorted(AZURE_VOICES))}')
    if len(say) > AZURE_MOST:
        raise Refused(f'azure-speech@1.0.0 speaks a line of up to {AZURE_MOST} characters, its price per call, and this one has {len(say)}')
    key, region = os.environ.get('AZURE_SPEECH_KEY'), os.environ.get('AZURE_SPEECH_REGION', '')
    if not key or not re.fullmatch(r'[a-z0-9]+', region):
        raise Refused('azure-speech@1.0.0 needs the capability azure-speech-key: AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in this host\'s environment')
    lang = '-'.join(voice.split('-')[:2])
    ssml = (f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang={quoteattr(lang)}>'
            f'<voice name={quoteattr(voice)}><prosody rate={quoteattr(str(rate))}>{escape(say)}</prosody></voice></speak>')
    request = urllib.request.Request(f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1', data=ssml.encode('utf8'), method='POST', headers={
        'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm', 'User-Agent': 'deepbuild-speech',
    })
    with urllib.request.urlopen(request, timeout=60) as answer:
        return read_wav(answer.read())


ENGINES = {'kokoro@0.9.4': kokoro, 'platform-say@1.0.0': platform_say, 'azure-speech@1.0.0': azure}


def speak(tool, params):
    say, voice, rate = params.get('say'), params.get('voice'), params.get('rate', 1)
    if not isinstance(say, str) or not isinstance(voice, str) or isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0.5 <= rate <= 2:
        raise Refused('speech takes {say, voice, rate}: say and voice as text, rate from 0.5 to 2')
    # The empty line is no call: its audio is an empty WAV at the engine's own rate.
    samples, sr = (np.zeros(0, '<i2'), RATES[tool]) if say == '' else ENGINES[tool](voice, rate, say)
    audio = wav(samples, sr)
    record = {'kind': 'speech', 'engine': tool, 'voice': voice, 'rate': rate, 'say': say, 'sample_rate': sr,
              'samples': int(len(samples)), 'audio_sha256': hashlib.sha256(audio).hexdigest()}
    return {'audio': audio, 'record': json.dumps(record, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf8')}


# ---- whisper.cpp and g2p_en.
G2P_LOCK = threading.Lock()
G2P = []


def phonemes(text):
    """ARPAbet phonemes without stress by g2p_en, its NLTK data from the pinned files and nothing fetched."""
    with G2P_LOCK:
        if not G2P:
            data = CACHE / 'nltk_data'
            for sub, name in (('taggers', 'averaged_perceptron_tagger_eng'), ('corpora', 'cmudict')):
                zipped = checked(f'nltk-{name}.zip')
                if not (data / sub / name).exists():
                    (data / sub).mkdir(parents=True, exist_ok=True)
                    with tempfile.TemporaryDirectory(dir=data / sub) as tmp:
                        zipfile.ZipFile(zipped).extractall(tmp)
                        os.replace(Path(tmp) / name, data / sub / name)
                shutil.copyfile(zipped, data / sub / f'{name}.zip')
            os.environ['NLTK_DATA'] = str(data)
            import nltk

            def refuse(*args, **_):
                raise RuntimeError(f'nltk.download{args} is refused: the host reads only its pinned NLTK data')
            nltk.download = refuse
            from g2p_en import G2p
            G2P.append(G2p())
        return [re.sub(r'\d', '', p) for p in G2P[0](text) if re.fullmatch(r'[A-Z]+[0-2]?', p)]


def transcribe(params, inputs):
    rate, channels, locale, names = params.get('sample_rate'), params.get('channels'), params.get('locale'), params.get('names', [])
    if not (isinstance(rate, int) and rate > 0 and isinstance(channels, int) and channels > 0 and isinstance(locale, str)
            and isinstance(names, list) and all(isinstance(n, str) for n in names)):
        raise Refused('narration.transcript takes {sample_rate, channels, locale, names}')
    lang = unicodedata.normalize('NFKC', locale).split('-')[0].split('_')[0].lower()
    if lang not in MODELS:
        raise Refused(f'whisper-cpp@1.9.5 reads English, Chinese, Japanese and Korean, not the locale {locale}')
    pcm = inputs.get('pcm', b'')
    weights = held()
    text = ''
    x = mono(pcm, rate, channels, SR) if pcm else np.zeros(0, np.float32)
    if len(x):
        cli = whisper_cli()
        pad = np.zeros(round(PAD * SR), np.float32)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'line.wav'
            path.write_bytes(wav(to_i16(np.concatenate([pad, x, pad])), SR))
            ran = subprocess.run([cli, '-m', checked(MODELS[lang]), '-f', path, '-bs', str(BEAM), '-tp', '0', '-nf', '-t', str(THREADS),
                                  '-ng', '-np', '-nt', '-l', lang, '--prompt', PROMPTS[lang]], capture_output=True, text=True)
        if ran.returncode != 0:
            raise Refused(f'whisper-cli exited {ran.returncode}: {ran.stderr[-1000:]}')
        text = ' '.join(ran.stdout.split())
    record = {
        'kind': 'narration.transcript', 'analyzer': 'whisper-cpp@1.9.5', 'weights': [{'name': n, 'sha256': weights[n]} for n in WHISPER_FILES],
        'pcm_sha256': hashlib.sha256(pcm).hexdigest(), 'locale': locale, 'model': MODELS[lang],
        'settings': {'beam': BEAM, 'temperature': 0, 'fallback': False, 'pad': PAD, 'prompt': PROMPTS[lang]},
        'text': text, 'words': [{'text': w, 'phonemes': phonemes(w)} for w in text.split()],
        'names': [{'text': n, 'phonemes': phonemes(n)} for n in names],
    }
    return {'transcript': json.dumps(record, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf8')}


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
        self.answer(200, {'weights': [{'name': n, 'sha256': s} for n, s in sorted(held().items())], 'capabilities': capabilities()})

    def do_POST(self):
        tool = self.path.lstrip('/')
        if tool not in TOOLS:
            return self.answer(404, {'error': f'no tool {tool}'})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('content-length', '0'))))
            params = body.get('params', {})
            inputs = {n: base64.b64decode(v) for n, v in body.get('inputs', {}).items()}
            outputs = speak(tool, params) if TOOLS[tool] == 'speech' else transcribe(params, inputs)
        except Unknown as e:  # BLOCKED until `say` respells the word; nothing was spoken
            return self.answer(409, {'blocked': {'code': 'speech.unknown_word', 'word': str(e)}})
        except Refused as e:  # an input this tool can't take, such as an unknown voice: refused, naming it
            return self.answer(422, {'refused': str(e)})
        except Exception as e:  # the call fails naming why; the hub keeps nothing
            return self.answer(422, {'error': f'{tool}: {e}'})
        self.answer(200, {'outputs': {n: base64.b64encode(b).decode('ascii') for n, b in outputs.items()}})

    def log_message(self, *_):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8720)
    a = ap.parse_args()
    held()
    whisper_cli()
    # Kokoro and g2p_en load before the host answers, so no call waits on a model's first load.
    with KOKORO_LOCK:
        kokoro_state()
    phonemes('')
    server = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    server.daemon_threads = True
    print(json.dumps({'ready': f'127.0.0.1:{a.port}'}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    sys.exit(main())
