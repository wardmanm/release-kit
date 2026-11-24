# Changelog

All notable changes to release-kit are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-24

### Added

- `/release` in Claude Code walks you through signing off a release one check at a time. Notes you take while testing become GitHub issues once you confirm them. It then prepares the release on its own branch: the changelog notes move under the version, and the version numbers are updated
- A GitHub Actions workflow each project calls to publish a release. It checks the release is ready, waits for your approval, then tags it, creates the GitHub Release, closes the milestone and comments "Released in" on each issue
- One `release-kit.json` per project sets up its units, changelogs, version files and milestones

[Unreleased]: https://github.com/wardmanm/release-kit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/wardmanm/release-kit/releases/tag/v1.0.0
