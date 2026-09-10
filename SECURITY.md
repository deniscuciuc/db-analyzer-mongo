# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

Only the latest release receives security fixes.

## Reporting a Vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it through GitHub's private vulnerability reporting, which is the preferred channel:

<https://github.com/deniscuciuc/db-analyzer-mongo/security/advisories/new>

If you cannot use GitHub, email **denis.cuciuc@zelqonworks.com** instead.

Please include a description and impact, steps to reproduce, the affected version, and any
suggested mitigation.

## What to Expect

| Stage | Target |
|---|---|
| Acknowledgement | Within 48 hours |
| Initial assessment | Within 5 working days |
| Fix for a high or critical issue | Within 30 days of triage |
| Fix for a moderate or low issue | Next scheduled release |

## Responsible Disclosure

Please give us a reasonable opportunity to release a fix before disclosing publicly. We will
credit you in the advisory and the changelog unless you prefer otherwise.

## Scope

This tool connects to a MongoDB server with credentials you supply and can, for some
commands, change server state. In scope:

- Anything that could execute unintended commands against your database
- Credential handling, including anything that could write a password to a log, a report or
  the terminal
- Anything that could cause a destructive command to run without the confirmation it requires
- Output escaping in the generated HTML reports

Out of scope: vulnerabilities in MongoDB itself or in its client library — report those
upstream, though we would still like to know so we can pin or work around an affected
version.

## Operational Notes

- Prefer a read-only role. Only the `run-vacuum`-style commands and the profiler and
  extension commands need write access, and those require `--yes`.
- Passing a password on the command line puts it in your shell history and in `ps` output.
  Prefer the environment variables documented in the README, or a `.analyzerrc.json`
  profile with restrictive file permissions.
- `.analyzerrc.json` may contain credentials. It is listed in `.gitignore`, but that is
  the only thing protecting it — do not commit it.
