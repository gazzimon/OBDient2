# vLLM 0.31.0 (the same digest as llm-chat) + the audio libraries Voxtral needs:
# the stock image has no `soundfile` (mistral-common[audio]), and the engine
# fails at startup with "ImportError: soundfile is not installed".
FROM vllm/vllm-openai@sha256:c1c9f6fd5c109ba7f0546a59f5b2f15fb87f64c77782e90a27b648b42a8e67c3
RUN pip install --no-cache-dir "mistral-common[audio]>=1.9.0" && python3 -c "import soundfile, soxr; print('audio ok')"
