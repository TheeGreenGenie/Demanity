# ADR 0003: Licensing and contribution model

- **Status:** Accepted (2026-11-09). Counsel to confirm.
- **Requirements:** R20

## Decision
| Asset | License |
|---|---|
| Code | **AGPL-3.0-or-later** ([GNU](https://www.gnu.org/licenses/agpl-3.0.html)) |
| Docs | CC BY 4.0 |
| Open data exports | CC BY-SA 4.0 |
| Contributions | **DCO** sign-off ([developercertificate.org](https://developercertificate.org/)), not a CLA |
| Name and logo | Trademark policy ([TRADEMARK.md](../../TRADEMARK.md)) |

## Rationale
- **AGPL closes the hosted-service loophole.** Plain GPL obligations apply only when software is distributed. AGPL also applies when users interact with the software over a network, so anyone running a modified Demanity as a hosted service must publish their changes. A closed fork therefore cannot secretly alter poll or score logic. Mastodon and Lemmy, two comparable platforms, both use AGPL-3.0.
- **DCO instead of a CLA.** A CLA would let the organization relicense the code. That would undermine the trust the platform depends on.
- **Trademark policy.** Forks may reuse the code, but must rename themselves. This prevents impostor "official" instances.
