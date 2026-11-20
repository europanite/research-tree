# Security Policy

Only the current `main` branch is supported.

## Reporting vulnerabilities

Report relevant issues through the GitHub repository's private vulnerability reporting feature if it is enabled; avoid publishing exploit details before resolution.

## Browser privacy

- Word lists and generated embeddings are processed locally; they are not sent to an inference API.
- The browser downloads JavaScript and ONNX model files from external CDN / Hugging Face hosts on first use.
- Review JavaScript supply-chain dependencies and CDN usage before processing sensitive vocabulary. For fully air-gapped deployments, vendor the model and runtime assets locally.
- No authentication, tokens, or application server are used.
