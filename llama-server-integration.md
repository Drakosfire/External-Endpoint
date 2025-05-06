# Connecting LibreChat to llama.cpp Server

## 1. Update your `librechat.yaml`

```yaml
endpoints:
  custom:
    - name: 'llamacpp'
      baseURL: "http://host.docker.internal:8081/completion"
      apiKey: 'not-needed'
      models:
        default: ['BitAgent-8B.Q8_0.gguf', 'Llama-xLAM-2-8B-fc-r-Q8_0.gguf', 'watt-tool-8B.Q8_0.gguf']
        fetch: false
      titleConvo: false
      titleModel: 'BitAgent-8B.Q8_0.gguf'
      modelDisplayLabel: 'LlamaCPP'
      forcePrompt: true
      directEndpoint: true
      addParams:
        stream: false
      dropParams: ["stop", "user", "frequency_penalty", "presence_penalty"]
      headers:
        Authorization: "Bearer no-key"
```

## 2. Run llama.cpp Server

Launch the llama.cpp server with the following command:

```bash
./llama-server \
  --host 0.0.0.0 \
  --port 8081 \
  -m /models/YourModel.gguf
```

Or using Docker Compose:

```yaml
services:
  llama-server:
    image: ghcr.io/ggml-org/llama.cpp:server
    command: ["--host", "0.0.0.0", "--port", "8081", "-m", "/models/YourModel.gguf"]
    ports:
      - "8081:8081"
```

## 3. Verify Connection

Test the connection using curl:

```bash
curl -X POST http://host.docker.internal:8081/completion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer no-key" \
  -d '{"model":"Llama-xLAM-2-8B-fc-r-Q8_0.gguf","messages":[{"role":"user","content":"ping"}]}'
```

## Important Notes

1. The `baseURL` must include `/completion` at the end
2. The `baseURL` should NOT have a trailing slash
3. The server must be configured to listen on `0.0.0.0` to accept connections from other containers
4. The `Authorization` header is required with the value `Bearer no-key`
5. Set `directEndpoint: true` to bypass additional processing
6. Set `stream: false` in `addParams` as llama.cpp doesn't support streaming
7. The model file must be accessible to the llama.cpp server at the specified path 