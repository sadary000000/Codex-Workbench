# ARCH-V2-2 Map Regression

ARCH-V2-1 Map OFF/ON behavior remains unchanged. The Shared Host is used only for ordinary Main Native Thread runtimes with `mapToolEnabled=false`.

Existing real regressions retained:

```text
npm run test:real:map
npm run test:real:resumed-map
npm run test:real:project-map
```

Map-enabled resumed Threads continue through the bounded compatibility maintenance path because the tested Codex CLI ABI does not accept `dynamicTools` on `thread/resume`. No Map truth or Native identity is moved into the Shared Host.
