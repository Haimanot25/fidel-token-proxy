# Security Policy

## Supported versions
Only the latest release on the default branch is supported.

## Reporting a vulnerability
Please open a private security advisory on GitHub or email the maintainers. Do not open public issues for security vulnerabilities.

## Notes
- API keys are stored in the local SQLite database (`data/fidel.db`) in plaintext. Protect this file with filesystem permissions; do not commit it.
- The gateway listens on localhost by default. Do not expose it to the public internet without adding authentication and TLS.