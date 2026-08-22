# ARCH-V2-2 Test Summary

## Passed during implementation

```text
npm run check                                      PASS
node --experimental-strip-types --test tests/app-server-host.test.ts  2/2 PASS
npm run test:protocol:arch-v2-2                    PASS
npm run test:real:multi-thread                    PASS
npm run test:real:shared-host-recovery             PASS
```

## Final Gate commands

```text
npm run check                                  PASS
npm test                                       304/304 PASS
npm run build                                  PASS
npm run package:win                            PASS
npm audit --omit=dev                           0 vulnerabilities
git diff --check                               PASS (line-ending warnings only)
scoped secret scan                             PASS
```

## Real regressions

```text
npm run test:real:navigation                   PASS
npm run test:real:workspace                    PASS
npm run test:real:multi-thread                 PASS
npm run test:real:map                          PASS
npm run test:real:resumed-map                  PASS
npm run test:real:project-map                  PASS
npm run test:real:shared-host-recovery         PASS
```

The package was rebuilt after the source integration. The packaged outer EXE SHA-256 is `31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC`; packaged app resource hashes are recorded in the stage report.
