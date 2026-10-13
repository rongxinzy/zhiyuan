# Archived workflows

The inherited workflows were moved here on 2026-10-13 at the repository owner's
request. GitHub only discovers workflows under `.github/workflows`, so these
files no longer run on pushes, pull requests, schedules, manual dispatch, or
workflow calls in this repository.

The active workflow is `../workflows/lightweight-ci.yml`. It checks source types,
renderer/shared tests, and the renderer build with Node 24 and the repository's
pinned Bun version. It does not install desktop runtimes, package installers,
sign binaries, publish releases, or require repository secrets. It does not
change branch protection or make this check a required merge gate.

These files retain the previous configuration for reference and recovery. Before
restoring a workflow to the active directory, review its triggers, permissions,
repository names, dependencies on other workflows, credentials, and release
destinations. Restoring a scheduled or push-triggered file enables automation.
Archiving does not cancel a run that was already queued or executing.
