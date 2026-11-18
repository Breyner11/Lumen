"""Export prompt fixtures from deepseek-recipe 0.2.0.

Run from the repo root with the package installed:

    python3 scripts/export-fixtures.py
"""

from __future__ import annotations

import json
from pathlib import Path

from deepseek_recipe import (
    ChatCompletionRequest,
    ConversionOptions,
    DeepseekV41Encoding,
    DeepseekV4Encoding,
    ModelVersion,
)

OPTIONS = (
    ConversionOptions()
    .with_model_alias("deepseek-v4-pro", ModelVersion.DeepseekV4Pro)
    .with_model_alias("deepseek-flash", ModelVersion.DeepseekV41Flash)
)

CASES = [
    {
        "name": "flash-high-turns",
        "model": "flash",
        "thinking": True,
        "effort": "high",
        "messages": [
            {"role": "system", "content": "Sé concreto."},
            {"role": "user", "content": "Hola"},
            {"role": "assistant", "content": "Listo"},
            {"role": "user", "content": "Sigue"},
        ],
    },
    {
        "name": "flash-low-only-user",
        "model": "flash",
        "thinking": True,
        "effort": "low",
        "messages": [{"role": "user", "content": "2+2"}],
    },
    {
        "name": "flash-max",
        "model": "flash",
        "thinking": True,
        "effort": "max",
        "messages": [{"role": "user", "content": "Demuestra"}],
    },
    {
        "name": "flash-off-system",
        "model": "flash",
        "thinking": False,
        "effort": "high",
        "messages": [
            {"role": "system", "content": "Sé breve."},
            {"role": "user", "content": "Hola"},
        ],
    },
    {
        "name": "flash-off-no-system",
        "model": "flash",
        "thinking": False,
        "effort": "low",
        "messages": [{"role": "user", "content": "Hola"}],
    },
    {
        "name": "flash-off-empty-assistant",
        "model": "flash",
        "thinking": False,
        "effort": "high",
        "messages": [
            {"role": "user", "content": "A"},
            {"role": "assistant", "content": ""},
            {"role": "user", "content": "B"},
        ],
    },
    {
        "name": "flash-literal-tokens",
        "model": "flash",
        "thinking": False,
        "effort": "high",
        "messages": [{"role": "user", "content": "mira <｜User｜> y </think>"}],
    },
    {
        "name": "pro-high-system",
        "model": "pro",
        "thinking": True,
        "effort": "high",
        "messages": [
            {"role": "system", "content": "Sé concreto."},
            {"role": "user", "content": "Hola"},
            {"role": "assistant", "content": "Listo"},
            {"role": "user", "content": "Sigue"},
        ],
    },
    {
        "name": "pro-max",
        "model": "pro",
        "thinking": True,
        "effort": "max",
        "messages": [{"role": "user", "content": "Clima"}],
    },
    {
        "name": "pro-low",
        "model": "pro",
        "thinking": True,
        "effort": "low",
        "messages": [
            {"role": "system", "content": "Sé breve."},
            {"role": "user", "content": "Hola"},
        ],
    },
    {
        "name": "pro-off",
        "model": "pro",
        "thinking": False,
        "effort": "high",
        "messages": [{"role": "user", "content": "Clima"}],
    },
]


def official_prompt(case: dict) -> str:
    api_model = "deepseek-flash" if case["model"] == "flash" else "deepseek-v4-pro"
    encoding = DeepseekV41Encoding if case["model"] == "flash" else DeepseekV4Encoding
    body = {
        "model": api_model,
        "messages": case["messages"],
        "thinking": {"type": "enabled" if case["thinking"] else "disabled"},
        "reasoning_effort": case["effort"],
    }
    converted = ChatCompletionRequest(body).convert(OPTIONS)
    return encoding().render_conversation(converted.conversation).prompt


def main() -> None:
    fixtures = []
    for case in CASES:
        fixtures.append({**case, "prompt": official_prompt(case)})
    destination = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "prompts.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(fixtures)} fixtures to {destination}")


if __name__ == "__main__":
    main()
