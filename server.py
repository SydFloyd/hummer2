import json
import os
from functools import lru_cache
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import torch
import torchcrepe


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_HOST = os.environ.get("HUMMER_HOST", "0.0.0.0")
DEFAULT_PORT = int(os.environ.get("PORT", os.environ.get("HUMMER_PORT", "8000")))
DEFAULT_TORCH_THREADS = max(1, int(os.environ.get("HUMMER_TORCH_THREADS", "1")))

torch.set_num_threads(DEFAULT_TORCH_THREADS)
try:
    torch.set_num_interop_threads(1)
except RuntimeError:
    pass


@lru_cache(maxsize=1)
def detect_torch_device():
    if torch.cuda.is_available():
        print("Cude detected")
        return "cuda:0"
    return "cpu"


def normalize_query_value(query, key, fallback, cast):
    try:
        value = query.get(key, [fallback])[0]
        return cast(value)
    except (TypeError, ValueError):
        return fallback


def tensor_to_json_array(values):
    output = []
    for value in values:
        numeric = float(value)
        if np.isfinite(numeric):
            output.append(numeric)
        else:
            output.append(None)
    return output


def analyze_pitch_track(samples, sample_rate, hop_length, fmin, fmax, model, use_viterbi, pad):
    device = detect_torch_device()
    decoder = torchcrepe.decode.viterbi if use_viterbi else torchcrepe.decode.weighted_argmax
    waveform = torch.from_numpy(np.array(samples, dtype=np.float32, copy=True)).unsqueeze(0)
    with torch.inference_mode():
        pitch, periodicity = torchcrepe.predict(
            waveform,
            sample_rate,
            hop_length=hop_length,
            fmin=fmin,
            fmax=fmax,
            model=model,
            decoder=decoder,
            return_periodicity=True,
            device=device,
            pad=pad
        )
    pitch_np = pitch.squeeze(0).cpu().numpy()
    periodicity_np = periodicity.squeeze(0).cpu().numpy()
    frame_times = (np.arange(pitch_np.shape[0], dtype=np.float32) * float(hop_length)) / float(sample_rate)
    return {
        "frameTimes": tensor_to_json_array(frame_times),
        "f0Hz": tensor_to_json_array(pitch_np),
        "periodicityFrames": tensor_to_json_array(periodicity_np),
        "frontend": {
            "type": "torchcrepe",
            "model": model,
            "decoder": "viterbi" if use_viterbi else "weighted_argmax",
            "device": device,
            "hopLength": hop_length,
            "fmin": fmin,
            "fmax": fmax,
            "pad": pad
        }
    }


class HummerRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.respond_json(
                {
                    "ok": True,
                    "device": detect_torch_device(),
                    "torchVersion": torch.__version__,
                    "torchcrepeVersion": getattr(torchcrepe, "__version__", "unknown")
                }
            )
            return
        if parsed.path == "/":
            self.path = "/index.html"
        else:
            self.path = parsed.path
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/torchcrepe-track":
            self.respond_json({"error": "Not found."}, status=HTTPStatus.NOT_FOUND)
            return

        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length <= 0:
            self.respond_json({"error": "Expected a float32 mono waveform payload."}, status=HTTPStatus.BAD_REQUEST)
            return

        body = self.rfile.read(content_length)
        samples = np.frombuffer(body, dtype=np.float32)
        if samples.size == 0:
            self.respond_json({"error": "Expected a non-empty float32 mono waveform payload."}, status=HTTPStatus.BAD_REQUEST)
            return

        query = parse_qs(parsed.query)
        sample_rate = normalize_query_value(query, "sample_rate", 48000, int)
        hop_length = normalize_query_value(query, "hop_length", 256, int)
        fmin = normalize_query_value(query, "fmin", 65.0, float)
        fmax = normalize_query_value(query, "fmax", 1200.0, float)
        model = query.get("model", ["tiny"])[0]
        model = "full" if model == "full" else "tiny"
        use_viterbi = query.get("viterbi", ["1"])[0] != "0"
        pad = query.get("pad", ["1"])[0] != "0"

        if sample_rate <= 0 or hop_length <= 0:
            self.respond_json({"error": "sample_rate and hop_length must be positive."}, status=HTTPStatus.BAD_REQUEST)
            return

        try:
            result = analyze_pitch_track(
                samples=samples,
                sample_rate=sample_rate,
                hop_length=hop_length,
                fmin=fmin,
                fmax=fmax,
                model=model,
                use_viterbi=use_viterbi,
                pad=pad
            )
        except Exception as error:  # pragma: no cover - best effort error bridge for local tooling
            self.respond_json(
                {
                    "error": "TorchCREPE analysis failed.",
                    "detail": str(error)
                },
                status=HTTPStatus.INTERNAL_SERVER_ERROR
            )
            return

        self.respond_json(result)

    def log_message(self, format, *args):
        return super().log_message(format, *args)

    def respond_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return


def main():
    server = ThreadingHTTPServer((DEFAULT_HOST, DEFAULT_PORT), HummerRequestHandler)
    print(f"Hummer server running at http://{DEFAULT_HOST}:{DEFAULT_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()

