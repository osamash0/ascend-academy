
"""Offline embedding cache for the Deck Lab semantic grounding run (Arc 8).

Vectors live in one JSON file keyed by sha256(model id + text), so the file holds no
slide text. The file records model and dimensions; loading it for another
model or dimension is refused rather than mixing vectors.

``embedder(fetch)`` serves cached vectors and sends only misses to
``fetch``. With ``fetch=None`` (offline, the default) a miss raises
EmbeddingCacheMiss, so a rerun can never reach the network by accident.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from backend.services.parser.semantic_grounding import Embedder, EmbeddingShapeError

ALLOW_API_ENV = "DECK_LAB_ALLOW_EMBEDDING_API"
DEFAULT_EMBEDDING_CACHE = Path(__file__).resolve().parent / "data" / "grounding_embeddings.json"


class EmbeddingCacheMiss(RuntimeError):
    """Texts are missing from the cache and fetching them was not allowed."""


def text_key(text: str, model: str) -> str:
    """sha256 over the embedding model id and the text: vectors from one model
    are never served for another."""
    return hashlib.sha256(f"{model}\n{text}".encode("utf-8")).hexdigest()


@dataclass
class EmbeddingCache:
    path: Path
    model: str
    dims: int
    vectors: Dict[str, List[float]] = field(default_factory=dict)
    fetched: int = 0

    @classmethod
    def load(cls, path: Path, model: str, dims: int) -> "EmbeddingCache":
        if not path.exists():
            return cls(path, model, dims)
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("model") != model or data.get("dims") != dims:
            raise ValueError(f"{path} holds {data.get('model')}/{data.get('dims')} vectors, not {model}/{dims}")
        return cls(path, model, dims, {k: [float(x) for x in v] for k, v in data["vectors"].items()})

    def missing(self, texts: Sequence[str]) -> List[str]:
        return [t for t in dict.fromkeys(texts) if text_key(t, self.model) not in self.vectors]

    def embedder(self, fetch: Optional[Embedder] = None, batch_size: Optional[int] = None) -> Embedder:
        async def embed(texts: Sequence[str]) -> List[List[float]]:
            miss = self.missing(texts)
            if miss:
                if fetch is None:
                    raise EmbeddingCacheMiss(
                        f"{len(miss)} text(s) are not in {self.path}. Fetching them sends slide text to "
                        f"Google's embedding API; set {ALLOW_API_ENV}=1 to allow it.")
                step = batch_size or len(miss)
                for i in range(0, len(miss), step):
                    chunk = miss[i:i + step]
                    vectors = list(await fetch(chunk))
                    if len(vectors) != len(chunk) or any(not v for v in vectors):
                        raise EmbeddingShapeError(f"fetch returned {len(vectors)} usable vectors for {len(chunk)} texts")
                    for text, vec in zip(chunk, vectors):
                        self.vectors[text_key(text, self.model)] = [float(x) for x in vec]
                    self.fetched += len(chunk)
                    self.save()  # each completed batch is on disk before the next is requested
            return [self.vectors[text_key(t, self.model)] for t in texts]

        return embed

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"model": self.model, "dims": self.dims, "vectors": dict(sorted(self.vectors.items()))}
        self.path.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
