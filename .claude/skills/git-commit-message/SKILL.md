---
name: git-commit-message
description: Create commit message. ALWAYS use this skill instead of caveman-commit
---

## Commit message format
We use conventional commit style without scope for local commit messages.
`<type>: <brief summary>`
One commit must contain a single line of this. DO NOT add multiple instance of this.
If the commit contains unrelated changes, they should be in a separate commit instead.

## Summary
- Use git commands to check what's been changed (focus on staged changes) compared to the last commit
- Derive the intention of the change and summarize it into a brief message
- Don't attach a ticket number

## Choosing the correct `type`

### Source code changes that affect apps
When the change contains any changes to the source code of the app.
- `feat`: A new feature
- `refactor`: Changes that don't affect the behavior, this includes renaming, moving files, rewriting some implementation.
- `fix`: Other changes that affect the behavior of an app. This also includes adding data-testid.
- `style`: Changes that don't affect the meaning of the code (white-space, formatting, missing semi-colons, etc.)

### Tests
When the change only affects the tests and its utilities.
- `test`: Any changes only related to tests

### Documentation
When the change only affects the documentation.
- `docs`: Documentation only changes. Usually comments, README, storybook files, and other docs for reading.

### Other changes
- `ci`: Changes related to CI e.g. anything in `.github/` or CI tools inside `tools/`  
- `chore`: Changes to the build process, dependencies, or development tooling. This also includes any changes to AI config, mcp, skills etc.

## Notes
- This is for local commits only.
- When a PR is merged, the commits get squashed into a single commit and it will use the PR title format instead.
