from __future__ import annotations

import asyncio
import os
import pty
import signal
from collections import deque
from dataclasses import dataclass
from typing import AsyncGenerator, Deque, Optional


@dataclass
class PtyChunk:
    data: str


class PtyRunner:
    """
    Runs a command inside a PTY (macOS/Linux).
    - Reads output asynchronously
    - Allows writing keystrokes
    - Keeps a rolling text buffer for AI + debugging
    """

    def __init__(self, command: str, *, cwd: Optional[str] = None, env: Optional[dict[str, str]] = None):
        self.command = command
        self.cwd = cwd or os.getcwd()
        self.env = {**os.environ, **(env or {})}

        self._pid: Optional[int] = None
        self._fd: Optional[int] = None

        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._reader_task: Optional[asyncio.Task[None]] = None

        # rolling buffer for tail/logging
        self._buffer: Deque[str] = deque(maxlen=4000)  # chunks, not chars
        self._closed = False

    @property
    def pid(self) -> Optional[int]:
        return self._pid

    @property
    def is_running(self) -> bool:
        return self._pid is not None and not self._closed

    def start(self) -> None:
        """Start the command in a PTY and begin reading output."""
        if self._pid is not None:
            return

        pid, fd = pty.fork()
        if pid == 0:
            # child
            try:
                os.chdir(self.cwd)
                os.execvpe("/bin/bash", ["/bin/bash", "-lc", self.command], self.env)
            except Exception:
                os._exit(1)

        # parent
        self._pid = pid
        self._fd = fd

        loop = asyncio.get_event_loop()
        loop.add_reader(fd, self._on_fd_readable)

    def _on_fd_readable(self) -> None:
        """Called by asyncio when PTY fd is readable."""
        if self._fd is None:
            return
        try:
            data = os.read(self._fd, 4096)
            if not data:
                self.close()
                return
            text = data.decode("utf-8", errors="replace")
            self._buffer.append(text)
            self._queue.put_nowait(text)
        except OSError:
            self.close()

    async def stream_output(self) -> AsyncGenerator[str, None]:
        """Async generator of PTY output chunks."""
        while not self._closed:
            chunk = await self._queue.get()
            yield chunk

    def write(self, data: str) -> None:
        """Write keystrokes to the PTY."""
        if self._fd is None or self._closed:
            return
        if not data:
            return
        try:
            os.write(self._fd, data.encode("utf-8"))
        except OSError:
            self.close()

    def tail(self, max_chars: int = 2000) -> str:
        """Return last max_chars of accumulated output."""
        joined = "".join(self._buffer)
        if len(joined) <= max_chars:
            return joined
        return joined[-max_chars:]

    def terminate(self) -> None:
        """Terminate the PTY child process."""
        if self._pid is None:
            return
        try:
            os.kill(self._pid, signal.SIGTERM)
        except Exception:
            pass

    def close(self) -> None:
        """Stop reading and close fd."""
        if self._closed:
            return
        self._closed = True
        if self._fd is not None:
            try:
                loop = asyncio.get_event_loop()
                loop.remove_reader(self._fd)
            except Exception:
                pass
            try:
                os.close(self._fd)
            except Exception:
                pass
        self._fd = None
