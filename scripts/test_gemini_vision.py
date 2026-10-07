#!/usr/bin/env python3
"""Gửi một ảnh thử nghiệm tới Vilao bằng model có hỗ trợ vision."""

import base64
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


ENDPOINT = "https://api.vilao.ai/v1/chat/completions"
MODEL = "gemini-3.8-flash"
PROMPT = "Hãy mô tả ngắn gọn nội dung ảnh và trả lời bằng tiếng Việt."
PROJECT_ROOT = Path(__file__).resolve().parents[1]

# Đổi dòng này nếu muốn thử một ảnh câu hỏi khác.
IMAGE_PATH = PROJECT_ROOT / "public" / "popup-home.png"


def image_as_data_url(path: Path) -> str:
    if not path.is_file():
        raise ValueError(f"Không tìm thấy ảnh: {path}")

    mime_type, _ = mimetypes.guess_type(path.name)
    if not mime_type or not mime_type.startswith("image/"):
        raise ValueError("Chỉ nhận tệp ảnh (PNG, JPEG, WebP, GIF, ...).")

    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def main() -> int:
    api_key = ""
    if not api_key:
        print("Thiếu VILAO_API_KEY. Hãy đặt biến môi trường trước khi chạy.", file=sys.stderr)
        return 2

    try:
        data_url = image_as_data_url(IMAGE_PATH)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2

    payload = {
        "model": MODEL,
        "max_tokens": 256,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    }
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code}: {error.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print(f"Không kết nối được API: {error.reason}", file=sys.stderr)
        return 1

    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    print(f"Model: {MODEL}")
    print(f"Kết quả: {content}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
