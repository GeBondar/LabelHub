# Security Policy

## Supported versions

LabelHub is in Beta. Security fixes are applied to the latest released version only.

| Version          | Supported |
|------------------|-----------|
| Latest `-beta.N` | ✅        |
| Older Betas      | ❌        |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead, email **ge.bondar.robot@gmail.com** with:
- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible),
- the LabelHub version and your OS.

You can expect an acknowledgement within a few days. Once a fix is available,
the issue will be disclosed in the release notes.

## Scope notes

LabelHub is a local-first, single-user desktop application. The backend binds to
`127.0.0.1` only and is not intended to be exposed to a network. Reports that
require deliberately exposing the backend to other machines are out of scope, but
local privilege/path-handling issues are very much in scope.
