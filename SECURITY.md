# Security Policy

## Supported versions

Security fixes are provided for the latest released minor version. Users
should reproduce a report against the latest release before submitting it.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| Older versions | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
private security-reporting channel or private vulnerability-reporting feature
and include:

- the affected plugin and DSH versions;
- the operating system and relevant profile configuration, with secrets
  removed;
- clear reproduction steps or a minimal proof of concept;
- the expected and observed security boundary;
- any known impact or workaround.

Do not attach real prompts, credentials, encoded images, workspace files, or
`.multi-version` run directories. Use synthetic data.

Maintainers will acknowledge a complete report as soon as practical, assess
its severity, coordinate a fix and disclosure timeline, and credit the
reporter when requested and appropriate.

## Security scope

Reports are especially useful when they involve path traversal, symlink
escape, cross-session access, unsafe browser-to-Host authority, request replay,
exposed rich-input data, permission widening, or incorrect success handling
for interrupted child agents.
