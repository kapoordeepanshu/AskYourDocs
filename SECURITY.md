# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Report privately through
[GitHub Security Advisories](https://github.com/kapoordeepanshu/AskYourDocs/security/advisories/new).
You should get an acknowledgement within 72 hours.

## Scope

AskYourDocs is self-hosted, so the operator controls the deployment. Reports are most valuable when
they concern:

- **Cross-tenant data access** — any path where one user can read another user's documents, chunks,
  conversations, or citations. This is the highest-severity class in this project.
- **SSRF via URL ingestion** — bypassing the private-network, redirect, scheme, or size guards in the
  URL fetcher.
- **Authentication and session handling** — session fixation, token leakage, privilege escalation to
  the admin role.
- **Prompt injection with real consequences** — content in an uploaded document that causes the system
  to disclose another user's data or take a privileged action. Injection that merely produces a silly
  answer is a quality bug, not a vulnerability.
- **Stored XSS** through document content or filenames rendered in the interface.
- **Path traversal** in the local storage driver.
- **Website widget isolation** — a widget answering from documents outside its configured scope, a
  visitor reading or continuing another visitor's or the owner's conversation, or a widget loading on
  an origin its allowlist excludes.
- **XSS through the widget** — model output or document text executing as markup on a host site.

## Out of scope

- Missing rate limits on a deployment the reporter controls
- Calling a widget's public API directly from a script. The key is public by design; the rate limits
  bound this, not the allowlist
- Vulnerabilities in a self-hosted instance exposed to the internet without TLS or a reverse proxy
- Findings that require the operator to set `ALLOW_PRIVATE_NETWORK_FETCH=true`, which is documented
  as unsafe outside trusted networks
- The LLM producing an incorrect answer

## Hardening notes for operators

- Always set a unique `SESSION_SECRET`. Never ship the example value.
- Change the default Postgres credentials before exposing anything publicly.
- Terminate TLS at a reverse proxy; the app does not do it for you.
- Leave `ALLOW_PRIVATE_NETWORK_FETCH=false` unless you fully control the network.
- Set `ALLOW_PUBLIC_REGISTRATION=false` on any instance reachable from the internet.
- Give every public widget an allowed-websites list, and scope it to public documents only.
- Size `WIDGET_DAILY_LIMIT` to the model spend you are willing to accept per widget per day.
