# STAGE-K1-B Dependency Validation

Stage dependencies are explicit references to a Stage ID or Stage key. During normalization they are resolved to the unique `stageSpecId`; unresolved or ambiguous references fail closed.

Rules:

1. Every dependency target must exist in the same candidate Plan.
2. A Stage cannot depend on itself.
3. Duplicate references are rejected both before and after ID/key normalization.
4. The graph is checked with DFS colors; any back edge returns `STAGE_DEPENDENCY_CYCLE`.
5. Explicit forward references are allowed when the target exists and the graph remains acyclic. The Validator never guesses a missing dependency from ordinal order.
6. Stage IDs, keys and ordinals are unique; declarations must be strictly ordered by ordinal.
7. Steps must reference a stage in the same candidate and, under JIT, only the current Stage.

The graph check is pure and operates on bounded arrays. It does not inspect or infer external project state, and it does not persist a repaired graph.
