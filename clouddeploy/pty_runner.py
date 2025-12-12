from __future__ import annotations

import os
import pty
import select
import threading
from collections import deque
from dataclasses import dataclass
from typing import AsyncIterator, Deque, Optional


@dataclass
class PtySession:
    """
    Unix/macOS PTY runner.

    Starts the given command under `bash -lc "<command>"`, so it behaves like a normal interactive shell.
    """

    command: str
    _fd: Optional[int] = None

    def __post_init__(self) -> None:
        self._buf: Deque[str] = deque(maxlen=1200)  # rolling chunks
        self._lock = threading.Lock()

    def start(self) -> None:
        pid, fd = pty.fork()
        if pid == 0:
            # Child: exec shell command
            os.execvp("bash", ["bash", "-lc", self.command])
        else:
            self._fd = fd

    def write(self, data: str) -> None:
        if self._fd is None:
            return
        os.write(self._fd, data.encode("utf-8", errors="ignore"))

    def tail(self, max_chars: int = 4000) -> str:
        with self._lock:
            text = "".join(self._buf)
        return text[-max_chars:]

    async def stream_output(self) -> AsyncIterator[str]:
        if self._fd is None:
            return

        fd = self._fd
        while True:
            r, _, _ = select.select([fd], [], [], 0.2)
            if not r:
                continue

            try:
                data = os.read(fd, 4096)
            except OSError:
                break

            if not data:
                break

            chunk = data.decode("utf-8", errors="ignore")
            with self._lock:
                self._buf.append(chunk)
            yield chunk
