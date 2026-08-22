# ARCH-V2-2 Multi-Thread Evidence

## Real smoke

Command:

```bash
npm run test:real:multi-thread
```

Observed:

```yaml
host_process_id: 47568
thread_ids:
  - 01a029cd-8268-7ea1-b352-0f31dd7a7d2a
  - 01a029cd-8258-77e3-bb1e-ed6557a5cd6c
cwd_count: 2
turn_statuses: [completed, completed]
event_routing: PASS
```

The two cwd values were independent temporary directories. Every `turn/started` and `turn/completed` marker ended with the matching Native Thread ID; no cross-thread event was observed.

## Unit evidence

`tests/app-server-host.test.ts` verifies one initialize for two handles, per-thread event routing, per-thread server-request callback routing, handle close without host close, and rejection of an unverified method.
