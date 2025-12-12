from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List

# Simple prompt recognition patterns (v1)
PROMPT_RE = re.compile(
    r"(Selection\s*\[\d+\]\s*:|Select .*?:|Enter .*?:|Proceed .*?\[Y/n\]|Install .*?\[Y/n\])",
    re.IGNORECASE,
)

ERROR_RE = re.compile(r"(^|\n)ERROR:\s*(.+)", re.IGNORECASE)


@dataclass
class StepDetector:
    buffer: str = ""
    last_update: float = field(default_factory=time.time)

    phase: str = "starting"
    waiting: bool = False
    prompt: str = ""
    choices: List[str] = field(default_factory=list)
    last_error: str = ""
    completed: bool = False

    def ingest(self, text: str) -> None:
        self.buffer += text
        self.buffer = self.buffer[-20000:]
        self.last_update = time.time()

        buf_low = self.buffer.lower()

        # Phase detection (IBM v1)
        if "ibm cloud container registry" in buf_low:
            self.phase = "icr_prepare"
        if "ibm cloud code engine deployment" in buf_low:
            self.phase = "code_engine"
        if "all done!" in buf_low:
            self.phase = "done"
            self.completed = True

        # Error detection
        m = ERROR_RE.search(self.buffer)
        if m:
            self.last_error = (m.group(2) or "").strip()

        # Prompt detection (near end)
        tail = self.buffer[-2000:]
        prompts = PROMPT_RE.findall(tail)

        self.waiting = False
        self.prompt = ""
        self.choices = []

        if prompts:
            self.waiting = True
            self.prompt = prompts[-1].strip()

        # Choices detection (script-specific hint)
        if "choose how you want to obtain the container image" in tail.lower():
            self.choices = [
                "1) Build from local Dockerfile and push",
                "2) Use existing local image and push",
                "3) Use existing image already in ICR (no push)",
            ]

    def snapshot(self) -> Dict[str, Any]:
        return {
            "provider": "ibm_cloud",
            "phase": self.phase,
            "waiting_for_input": self.waiting,
            "prompt": self.prompt,
            "choices": self.choices,
            "last_error": self.last_error,
            "completed": self.completed,
            "updated_at": self.last_update,
        }
