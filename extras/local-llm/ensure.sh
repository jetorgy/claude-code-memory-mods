#!/usr/bin/env bash
# Makes sure a private local Ollama is running on 127.0.0.1:11435 (this machine only). It is a SECOND
# server on its own port, so it never touches an Ollama you already run on 11434 (native or Docker).
# Prints ONE word on its last line: up | started | failed:<why>
#
# Optional settings, in <this folder>/config.env (plain KEY=value lines):
#   OLLAMA_BIN=/path/to/ollama      default: the ollama on your PATH, else ~/.local/bin/ollama, else /usr/local/bin/ollama
#   OLLAMA_MODELS=/path/to/models   default: Ollama's own default folder (~/.ollama/models)
#   LOCAL_MODEL=gemma4:e4b          the model the mods use
# It never installs anything and never downloads a model: that is done once by the setup, with your permission.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/config.env" ] && . "$HERE/config.env"

HOST=127.0.0.1:11435
MODEL="${LOCAL_MODEL:-gemma4:e4b}"
OLLAMA="${OLLAMA_BIN:-$(command -v ollama || true)}"
for c in "$HOME/.local/bin/ollama" /usr/local/bin/ollama /usr/bin/ollama; do
  [ -n "$OLLAMA" ] && [ -x "$OLLAMA" ] && break
  [ -x "$c" ] && OLLAMA="$c"
done

up() { curl -s -m 2 "http://$HOST/api/tags" >/dev/null 2>&1; }

if up; then echo up; exit 0; fi
[ -n "$OLLAMA" ] && [ -x "$OLLAMA" ] || { echo "failed:ollama is not installed (the mods fall back to Haiku)"; exit 0; }
if [ -n "$OLLAMA_MODELS" ] && [ ! -d "$OLLAMA_MODELS" ]; then echo "failed:models folder not available ($OLLAMA_MODELS)"; exit 0; fi

# A GPU is optional: with none, Ollama still runs the model on the CPU (slower; the mods then prefer Haiku).
LOG="$HERE/server.log"
if [ -n "$OLLAMA_MODELS" ]; then
  env "OLLAMA_HOST=$HOST" "OLLAMA_MODELS=$OLLAMA_MODELS" OLLAMA_KEEP_ALIVE=30m \
    setsid nohup "$OLLAMA" serve >"$LOG" 2>&1 </dev/null &
else
  env "OLLAMA_HOST=$HOST" OLLAMA_KEEP_ALIVE=30m \
    setsid nohup "$OLLAMA" serve >"$LOG" 2>&1 </dev/null &
fi

for _ in $(seq 1 24); do up && break; sleep 0.5; done
if up; then
  # Warm the model in the background so the first real call is fast. Only if it is already downloaded.
  if curl -s -m 2 "http://$HOST/api/tags" | grep -q "\"$MODEL\""; then
    ( curl -s -m 90 "http://$HOST/api/generate" \
        -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"think\":false,\"keep_alive\":\"30m\",\"options\":{\"num_ctx\":4096,\"num_predict\":1}}" \
        >/dev/null 2>&1 & )
  fi
  echo started
else
  echo "failed:server did not answer (see $HERE/server.log)"
fi
