# STAGE-K0 Domain Versioning

## Current schema

`AUTOMATION_SCHEMA_VERSION = 4`.

The v4 addition is the explicit `requirementOrigins` collection and the
`RequirementVersion.originRef` field. The rest of the Automation domain keeps
its existing table ownership and identity fields.

## Version chain invariant

For each project, the valid chain is:

```text
v1 (no predecessor)
  → v2 (supersedes v1)
  → v3 (supersedes v2)
  → ...
```

The schema validator and store writer both enforce the invariant. Duplicate
version, missing predecessor, non-adjacent predecessor, and cross-project
predecessor paths fail closed.

## Origin invariant

Every version resolves to one persisted origin in the same project. Service
paths use explicit `DISCOVERY/WEBGPT` or `REVISION/SYSTEM` origins; generic
store callers must provide an explicit origin or origin reference. There is no
implicit origin creation at the low-level Requirement writer boundary.
`sourceRef` is bounded opaque metadata and URL-shaped sources are rejected.

The schema also rejects duplicate `(projectId, version)` rows, multiple
version-1 roots, orphan origins, and origins from another project.

## Identity

Migration identity coverage includes `requirementOrigins`, version links,
payload hashes, canonical payload hashes, and the origin reference. The full
document comparator detects changed, missing, duplicate, or reordered records
rather than silently replacing them.

## Compatibility

The v0/v1/v2/v3 compatibility paths produce a v4 document before validation.
Legacy origin records are deterministic where the source has no origin record;
safe existing origin references are retained and materialized when needed.
