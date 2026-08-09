# Temporary dependency security exception

Owner: application engineering lead  
Review by: 2026-09-09  
Scope: `@huggingface/transformers` optional Node dependency advisories (`onnxruntime-node`, `adm-zip`, and `sharp`).

The browser build uses the Web/WASM transformer path. The affected Node-only packages must not be copied into a production server image or imported by Edge Functions. CI runs the production audit on every change and verifies that the transformer remains isolated in a lazy chunk. Remove this exception when an upstream release clears the advisories, or replace the browser model before the review date.

The exception does not permit access tokens, task content, invite credentials, or personal data in logs.
