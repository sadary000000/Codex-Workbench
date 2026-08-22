# ARCH-V2-2 Approval/Server-Request Routing Evidence

`tests/app-server-host.test.ts` uses a high-fidelity App Server transport fixture with two Native Thread handles. The first handle receives a server request carrying its `threadId` and returns `allow`; the second callback is not invoked. The test also verifies that closing the first handle does not close the Host or prevent the second handle from reading its Thread.

Real destructive approval execution was not needed for this transport-routing contract. Existing Native approval and real App Server regression evidence remains in the ARCH-V2-1 and V1 stage records.
