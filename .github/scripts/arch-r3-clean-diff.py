from pathlib import Path
import re
import subprocess

BASE = "36477bcd75e7c43c3704575eb06fcd31da7a1bb3"
FILES = [
    "src/features/webgpt/runtime/webgpt-request-manager.ts",
    "src/features/webgpt/automation/webgpt-provider-port.ts",
    "src/main/main.ts",
    "tests/arch-v2-6-provider-boundary.test.ts",
]
subprocess.run(["git", "checkout", BASE, "--", *FILES], check=True)

manager = Path(FILES[0])
data = manager.read_bytes()
old_line = b"  async requestStatus(requestId: string, reconcile = false): Promise<WebGptRequestRecord> {\r\n"
new_line = b"  async requestStatus(requestId: string): Promise<WebGptRequestRecord> {\n"
if data.count(old_line) != 1:
    old_line = old_line.replace(b"\r\n", b"\n")
if data.count(old_line) != 1:
    raise SystemExit("unexpected requestStatus signature count")
data = data.replace(old_line, new_line, 1)
branch = re.compile(br'^[ \t]*if \(reconcile && \(record\.state === "RECOVERY_REQUIRED" \|\| record\.state === "INDETERMINATE"\)\) return this\.reconcileRequest\(record\.requestId\);\r?\n', re.M)
data, count = branch.subn(b"", data, count=1)
if count != 1:
    raise SystemExit("hidden reconcile branch not uniquely found")
manager.write_bytes(data)

for name in FILES[1:3]:
    path = Path(name)
    value = path.read_bytes()
    pattern = re.compile(br'(^[^\r\n]*requestStatus\([^\r\n,()]+),\s*false\)[^\r\n]*)(?:\r\n|\n)', re.M)
    value, _ = pattern.subn(lambda match: re.sub(br',\s*false\)', b')', match.group(1)) + b'\n', value)
    if re.search(br'requestStatus\([^\r\n]*,\s*(?:true|false)\)', value):
        raise SystemExit(f"boolean requestStatus caller remains in {name}")
    path.write_bytes(value)

legacy = Path(FILES[3])
value = legacy.read_bytes()
pattern = re.compile(br'(^[ \t]*requestStatus: async \(requestId: string), reconcile\?: boolean(\) => \{)(?:\r\n|\n)', re.M)
value, count = pattern.subn(br'\1\2\n', value, count=1)
if count != 1:
    raise SystemExit("legacy fake signature not uniquely found")
value, count = re.subn(br'^[ \t]*assert\.equal\(reconcile, false\);\r?\n', b"", value, count=1, flags=re.M)
if count != 1:
    raise SystemExit("legacy reconcile assertion not uniquely found")
legacy.write_bytes(value)
