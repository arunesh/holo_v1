"""Load, validate, and persist Pod specs stored as JSON under app/pods/."""

from __future__ import annotations

import json
from pathlib import Path

from ..config import PODS_DIR
from ..schemas.pod import Pod, PodSummary


def list_pods() -> list[PodSummary]:
    out: list[PodSummary] = []
    for path in sorted(PODS_DIR.glob("*.json")):
        try:
            pod = load_pod(path.stem)
        except Exception:
            continue
        out.append(PodSummary(id=pod.id, title=pod.title, topic=pod.topic, description=pod.description))
    return out


def load_pod(pod_id: str) -> Pod:
    path = PODS_DIR / f"{pod_id}.json"
    if not path.exists():
        raise FileNotFoundError(pod_id)
    data = json.loads(path.read_text())
    return Pod.model_validate(data)


def save_pod(pod: Pod) -> Path:
    PODS_DIR.mkdir(parents=True, exist_ok=True)
    path = PODS_DIR / f"{pod.id}.json"
    path.write_text(json.dumps(pod.model_dump(), indent=2))
    return path
