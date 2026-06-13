"""Real GPT-2 forward pass producing activations + attention for the scene.

Loads HuggingFace `gpt2` (124M) on CPU lazily on first use. Returns per-layer
residual-stream norms, per-head attention matrices, sampled hidden values (for the
0.2f drill-down) and top next-token predictions — all downsampled/rounded for transport.
"""

from __future__ import annotations

import threading
from typing import Any

from ..config import get_settings

_lock = threading.Lock()
_model = None
_tokenizer = None

MAX_TOKENS = 16  # cap sequence length so the scene stays legible and payloads stay small
SAMPLE_DIMS = 32  # hidden dims surfaced for the inspector
TOP_K = 6


def _ensure_loaded():
    global _model, _tokenizer
    if _model is not None:
        return
    with _lock:
        if _model is not None:
            return
        import torch
        from transformers import GPT2LMHeadModel, GPT2TokenizerFast

        name = get_settings().gpt2_model
        tok = GPT2TokenizerFast.from_pretrained(name)
        model = GPT2LMHeadModel.from_pretrained(name, output_attentions=True, output_hidden_states=True)
        model.eval()
        torch.set_grad_enabled(False)
        _tokenizer = tok
        _model = model


def forward(text: str) -> dict[str, Any]:
    import torch

    _ensure_loaded()
    assert _model is not None and _tokenizer is not None

    text = (text or "").strip() or "The quick brown fox"
    enc = _tokenizer(text, return_tensors="pt", truncation=True, max_length=MAX_TOKENS)
    input_ids = enc["input_ids"]
    tokens = [_tokenizer.decode([tid]) for tid in input_ids[0].tolist()]

    with torch.no_grad():
        out = _model(**enc)

    hidden_states = out.hidden_states  # tuple len n_layers+1, each [1, seq, d_model]
    attentions = out.attentions  # tuple len n_layers, each [1, n_heads, seq, seq]
    logits = out.logits  # [1, seq, vocab]

    n_layers = len(attentions)
    seq = input_ids.shape[1]
    n_heads = attentions[0].shape[1]

    # residual-stream norm per (layer, token): use hidden_states[1:] (post-block outputs)
    residual_norms: list[list[float]] = []
    sample_values: list[list[float]] = []
    for layer in range(n_layers):
        hs = hidden_states[layer + 1][0]  # [seq, d_model]
        norms = hs.norm(dim=-1).tolist()
        residual_norms.append([round(v, 4) for v in norms])
        sample_values.append([round(v, 4) for v in hs[0][:SAMPLE_DIMS].tolist()])

    # attention[layer][head][q][k]
    attention: list[list[list[list[float]]]] = []
    for layer in range(n_layers):
        att = attentions[layer][0]  # [n_heads, seq, seq]
        attention.append([[[round(w, 4) for w in row] for row in head.tolist()] for head in att])

    # top-k next-token predictions from the last position
    probs = torch.softmax(logits[0, -1], dim=-1)
    topk = torch.topk(probs, TOP_K)
    predictions = [
        {"token": _tokenizer.decode([idx.item()]), "prob": round(p.item(), 4)}
        for p, idx in zip(topk.values, topk.indices)
    ]

    return {
        "model": get_settings().gpt2_model,
        "tokens": tokens,
        "n_layers": n_layers,
        "n_heads": n_heads,
        "residual_norms": residual_norms,
        "attention": attention,
        "sample_values": sample_values,
        "predictions": predictions,
    }
