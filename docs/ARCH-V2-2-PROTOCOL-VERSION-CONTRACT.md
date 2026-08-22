# ARCH-V2-2 Protocol Version Contract

## Tested binary

```yaml
codex_version: codex-cli 0.147.0
binary_sha256: 935A1911ED5564FFCEC995F4886AC2AC425863BA26FED264DF62E30272AD9D
generation_mode: stable
```

## Generation commands

```bash
codex app-server generate-ts --out <dir>
codex app-server generate-json-schema --out <dir>
```

Both commands were executed twice against the same binary. Stable output was repeatable:

```yaml
typescript_files: 642
typescript_tree_sha256: 3D23B8E14F3AFAAB404DA59BBF8F7541720EEBF75E7549940BDBF9808F09D152
json_schema_files: 285
json_schema_tree_sha256: 0D2DDF85138073D0EA0A6828804349B65F18BF88F8B2FF7AEF62C9262B39390F
```

The generated TypeScript is type-only and is not treated as a runtime serializer. The production Shared Host therefore uses a small, explicit method allowlist and the existing bounded JSON-RPC parser. A future binary/version mismatch must fail closed at the verification step rather than silently changing the production contract.

## Shared Host method allowlist

```text
initialize
thread/start
thread/resume
thread/read
turn/start
turn/interrupt
model/list
```

The allowlist is intentionally narrower than the full generated protocol and does not authorize new product capabilities.
