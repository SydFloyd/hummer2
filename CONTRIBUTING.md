# Contributing Guide

Thanks for contributing to Hummer.

## Workflow (Fork + PR)

1. Fork the repository on GitHub.
2. Clone your fork locally.
3. Add the original repo as `upstream`.
4. Create a feature branch from a synced `main`.
5. Make changes and commit in your branch.
6. Push your branch to your fork.
7. Open a Pull Request from your fork branch to `upstream/main`.

## Recommended Git Commands

```bash
# clone your fork
git clone https://github.com/<your-user>/hummer2.git
cd hummer2

# connect original repo as upstream
git remote add upstream https://github.com/SydFloyd/hummer2.git

# sync your local main
git checkout main
git fetch upstream
git rebase upstream/main
git push origin main

# create a feature branch
git checkout -b feature/<short-description>

# after changes
git add .
git commit -m "feat: short description"
git push -u origin feature/<short-description>
```

## Keep Branches Synced

Before opening or updating a PR, re-sync with upstream:

```bash
git checkout main
git fetch upstream
git rebase upstream/main
git push origin main

git checkout feature/<short-description>
git rebase main
git push --force-with-lease
```

## Pull Request Guidelines

- Keep PRs focused and reasonably small.
- Include a clear description of what changed and why.
- Include screenshots/GIFs for UI updates.
- Test manually before opening the PR.
- If your change touches behavior, include test steps in the PR description.

## Do Not Commit Directly to `main`

- Contributors should always work in branches and submit PRs.
- Repository maintainers should enforce this with branch protection rules on `main`:
  - Require pull requests before merging.
  - Restrict direct pushes.
  - Optional: require approvals and passing checks.
