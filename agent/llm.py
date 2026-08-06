"""LLM client interface. Swap point — change this file to switch models.

The Agent class in orchestrator.py only talks to LLMClient. To swap models,
implement a new LLMClient and wire it in orchestrator.Agent.__init__.
"""
import os
from typing import Any
from abc import ABC, abstractmethod

from core import config


class LLMClient(ABC):
    """Minimal interface the agent needs.

    send() takes the full conversation history and returns one of:
      {"text": "..."}                            -> final text response
      {"function_calls": [{"id", "name", "args"}, ...]}  -> LLM wants to call tools
    """

    @abstractmethod
    def send(self, history: list[dict], system_instruction: str, tools: list[dict]) -> dict:
        ...


class GeminiLLM(LLMClient):
    """google-genai implementation. Model name comes from MODEL_NAME env."""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        from google import genai
        self.client = genai.Client(api_key=api_key or os.getenv("GOOGLE_API_KEY") or "")
        if not (api_key or os.getenv("GOOGLE_API_KEY")):
            raise RuntimeError("GOOGLE_API_KEY not set in .env")
        self.model = model or config.MODEL_NAME

    def send(self, history: list[dict], system_instruction: str, tools: list[dict]) -> dict:
        from google.genai import types

        # Convert our plain-dict history into genai Content/Part objects.
        contents = []
        for msg in history:
            role = msg["role"]
            parts = []
            for p in msg["parts"]:
                if "text" in p:
                    parts.append(types.Part(text=p["text"]))
                elif "function_call" in p:
                    fc = p["function_call"]
                    parts.append(types.Part(function_call=types.FunctionCall(
                        id=fc.get("id"), name=fc["name"], args=fc.get("args", {}),
                    )))
                elif "function_response" in p:
                    fr = p["function_response"]
                    parts.append(types.Part.from_function_response(
                        name=fr["name"], response=fr.get("response", {}),
                    ))
            contents.append(types.Content(role=role, parts=parts))

        # Build tool list.
        declarations = []
        for t in tools:
            declarations.append(types.FunctionDeclaration(
                name=t["name"],
                description=t.get("description", ""),
                parameters=t.get("parameters", {"type": "object", "properties": {}}),
            ))
        genai_tools = [types.Tool(function_declarations=declarations)] if declarations else None

        config_obj = types.GenerateContentConfig(
            system_instruction=system_instruction,
            tools=genai_tools,
        )

        response = self.client.models.generate_content(
            model=self.model,
            contents=contents,
            config=config_obj,
        )

        # Parse the response: pull text + function_calls from the first candidate.
        text_parts: list[str] = []
        function_calls: list[dict] = []
        if response.candidates:
            for part in (response.candidates[0].content.parts or []):
                if part.text:
                    text_parts.append(part.text)
                if part.function_call:
                    fc = part.function_call
                    function_calls.append({
                        "id": fc.id,
                        "name": fc.name,
                        "args": dict(fc.args) if fc.args else {},
                    })

        result: dict[str, Any] = {}
        if text_parts:
            result["text"] = "\n".join(text_parts)
        if function_calls:
            result["function_calls"] = function_calls
        return result or {"text": ""}


def default_client() -> LLMClient:
    """Return the production LLM client."""
    return GeminiLLM()
