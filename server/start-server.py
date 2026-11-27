#!/usr/bin/env python3
"""Run the GlanceTrade server with the vault Groq key via an hsurr surrogate.

Mints a fresh surrogate from authd and execs node server.js with
GROQ_API_KEY set to the surrogate. Sentinel/authd swap the surrogate for
the real credential on approved outbound requests to api.groq.com.
Never prints the surrogate or the key.

User decision 27 Nov 2026 ~09:05: Groq Whisper (whisper-large-v3-turbo,
free tier, verified end-to-end) — NOT OpenAI, whose account holds $0
credits and refuses Whisper calls.

Usage: start-server.py   (run from server/ ; logs go to stdout)
"""
import os
import sys

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import dynamic_credential_entry


def main() -> int:
    entry = dynamic_credential_entry("custom.groq", "access_token")
    env = dict(os.environ)
    env["GROQ_API_KEY"] = entry["surrogate"]
    server_js = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.js")
    os.execvpe("node", ["node", server_js], env)


if __name__ == "__main__":
    raise SystemExit(main())
