"""producer-side/.env (git-ignored) holds secrets such as the A1 mini's LAN access code."""
from __future__ import annotations

import os
from pathlib import Path

DOTENV = Path(__file__).parents[1] / ".env"


def load_dotenv(path: Path = DOTENV) -> None:
    """KEY=VALUE lines into os.environ, without overriding what is already set."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))
