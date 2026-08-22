# ARCH-V2-2 Crash/Restart Evidence

## Real smoke

Command:

```bash
npm run test:real:shared-host-recovery
```

Observed:

```yaml
first_process_id: 34456
restarted_process_id: 41152
same_native_thread_ids: true
states_after_resume: [READY, READY]
replacement_thread: false
```

The original Host process was terminated after both Threads completed. Both Runtime handles observed `DISCONNECTED`; a new Host transport initialized; explicit `resume/read` returned the original IDs. No prompt was replayed during recovery.
