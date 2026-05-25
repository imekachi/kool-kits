
## Implementation Guidelines

### Specification Updates (Required)

**ALWAYS update the relevant spec when making changes to the code.** When you modify the extension:

1. Update the relevant sections in the spec to reflect the new behavior or implementation
2. Add rationale or reasons for each change—explain *why* the change was made, not just *what* changed
3. Keep the specs as the single source of truth; they should remain accurate and in sync with the codebase

**Spec writing principle:** Specs document **behaviors, decisions, and architecture** — not implementation details that duplicate the code. Do NOT add specific constant values (e.g., max limits), API inventories, DOM selector tables, function name lists, or manifest JSON to the specs. These belong in the code and go stale when copied into docs. If a detail is trivially discoverable from the code, it doesn't belong in the spec.

### Naming Conventions

- **Reserve `is`/`has`/`was` prefixes for boolean variables.** Functions that return booleans should use a `check` prefix (e.g., `checkIsSomething()` not `isSomething()`).
