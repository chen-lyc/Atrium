#!/usr/bin/env python3

import json
import os
import selectors
import glob
import shutil
import subprocess
import sys


def find_real_clangd() -> str:
    if "CLANGD_REAL_PATH" in os.environ:
        return os.environ["CLANGD_REAL_PATH"]

    home = os.path.expanduser("~")
    patterns = [
        os.path.join(
            home,
            ".vscode-server/data/User/globalStorage/llvm-vs-code-extensions.vscode-clangd/install/*/clangd_*/bin/clangd",
        ),
        os.path.join(
            home,
            ".cursor-server/data/User/globalStorage/llvm-vs-code-extensions.vscode-clangd/install/*/clangd_*/bin/clangd",
        ),
    ]

    candidates = []
    for pattern in patterns:
        candidates.extend(glob.glob(pattern))

    candidates = [path for path in candidates if os.access(path, os.X_OK)]
    if candidates:
        return max(candidates, key=os.path.getmtime)

    clangd = shutil.which("clangd")
    if clangd:
        return clangd

    raise RuntimeError("clangd executable not found")


child = subprocess.Popen(
    [find_real_clangd(), *sys.argv[1:]],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=sys.stderr,
)

selector = selectors.DefaultSelector()
selector.register(sys.stdin.buffer, selectors.EVENT_READ, "stdin")
selector.register(child.stdout, selectors.EVENT_READ, "clangd_stdout")

stdout_buffer = bytearray()


def write_message(body: bytes) -> None:
    sys.stdout.buffer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii"))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def rewrite_message(body: bytes) -> bytes:
    try:
        message = json.loads(body.decode("utf-8"))
        provider = (
            message.get("result", {})
            .get("capabilities", {})
            .get("documentOnTypeFormattingProvider")
        )
        if provider is not None:
            message["result"]["capabilities"]["documentOnTypeFormattingProvider"] = {
                "firstTriggerCharacter": ";",
                "moreTriggerCharacter": [],
            }
            return json.dumps(message, separators=(",", ":")).encode("utf-8")
    except Exception:
        pass
    return body


def drain_clangd_stdout() -> bool:
    chunk = child.stdout.read1(4096)
    if not chunk:
        return False

    stdout_buffer.extend(chunk)
    while True:
        header_end = stdout_buffer.find(b"\r\n\r\n")
        if header_end < 0:
            break

        header = bytes(stdout_buffer[:header_end]).decode("ascii", errors="ignore")
        content_length = None
        for line in header.split("\r\n"):
            if line.lower().startswith("content-length:"):
                content_length = int(line.split(":", 1)[1].strip())
                break

        if content_length is None:
            sys.stdout.buffer.write(stdout_buffer)
            sys.stdout.buffer.flush()
            stdout_buffer.clear()
            break

        body_start = header_end + 4
        body_end = body_start + content_length
        if len(stdout_buffer) < body_end:
            break

        body = bytes(stdout_buffer[body_start:body_end])
        del stdout_buffer[:body_end]
        write_message(rewrite_message(body))

    return True


def forward_stdin() -> bool:
    chunk = os.read(sys.stdin.fileno(), 4096)
    if not chunk:
        return False
    child.stdin.write(chunk)
    child.stdin.flush()
    return True


try:
    while child.poll() is None:
        for key, _ in selector.select():
            if key.data == "stdin":
                if not forward_stdin():
                    selector.unregister(sys.stdin.buffer)
            elif key.data == "clangd_stdout":
                if not drain_clangd_stdout():
                    selector.unregister(child.stdout)
                    child.wait()
                    raise SystemExit(child.returncode)
finally:
    if child.poll() is None:
        child.terminate()
