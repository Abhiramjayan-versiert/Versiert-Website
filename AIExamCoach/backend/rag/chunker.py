"""Token-approximate chunking with overlap that never crosses page boundaries
(so every chunk has exactly one real page number)."""
from __future__ import annotations

import re
from dataclasses import dataclass

from backend.rag.extract import Segment

_WS = re.compile(r"[ \t]+")


def estimate_tokens(text: str) -> int:
    # ~1.3 tokens per English word is a good approximation for Gemma/Qwen tokenizers.
    return int(len(text.split()) * 1.3) + 1


def clean(text: str) -> str:
    text = text.replace("\x00", "")
    text = _WS.sub(" ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


@dataclass
class ChunkData:
    text: str
    page: int | None
    section: str
    tokens: int


def _split_sentences(paragraph: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", paragraph)
    return [p for p in parts if p.strip()]


def chunk_segments(segments, target_tokens: int = 600, overlap_tokens: int = 80) -> list[ChunkData]:
    out: list[ChunkData] = []
    for seg in segments:
        text = clean(seg.text)
        if not text:
            continue
        units: list[str] = []
        for para in text.split("\n\n"):
            if estimate_tokens(para) > target_tokens:
                units.extend(_split_sentences(para))
            else:
                units.append(para)
        cur: list[str] = []
        cur_tok = 0
        for u in units:
            ut = estimate_tokens(u)
            if ut > target_tokens:  # one giant sentence/table: hard split by words
                words = u.split()
                step = max(50, int(target_tokens / 1.3))
                for i in range(0, len(words), step):
                    units_piece = " ".join(words[i : i + step])
                    if cur:
                        out.append(ChunkData("\n\n".join(cur), seg.page, seg.section, cur_tok))
                        cur, cur_tok = [], 0
                    out.append(ChunkData(units_piece, seg.page, seg.section, estimate_tokens(units_piece)))
                continue
            if cur_tok + ut > target_tokens and cur:
                out.append(ChunkData("\n\n".join(cur), seg.page, seg.section, cur_tok))
                # overlap: carry trailing units up to overlap_tokens
                carry, ct = [], 0
                for prev in reversed(cur):
                    pt = estimate_tokens(prev)
                    if ct + pt > overlap_tokens:
                        break
                    carry.insert(0, prev)
                    ct += pt
                cur, cur_tok = carry, ct
            cur.append(u)
            cur_tok += ut
        if cur:
            out.append(ChunkData("\n\n".join(cur), seg.page, seg.section, cur_tok))
    return out
