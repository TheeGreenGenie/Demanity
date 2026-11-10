# Contributing to Demanity

Thank you for helping build Demanity.

## Ground rules
- Read [docs/VISION.md](docs/VISION.md) first. It includes the requirement IDs (R1–R34) and the public roadmap.
- **Finding work:** pick an open GitHub Issue, or propose one that cites the requirement it serves. The core team keeps its detailed task list internal because parts of it track security-sensitive work in progress. It is not withheld for any other reason. Everything that ships is open source.
- **Every factual claim must cite a source.** This applies to code comments and docs as well as the product ([docs/SOURCES.md](docs/SOURCES.md)).
- **Document what actually exists.** Mark anything else clearly as "not implemented", "not tested", "unknown" or "out of scope".
- **Proposals that change scoring, taxonomy or sources** follow [docs/NONPARTISANSHIP.md §6](docs/NONPARTISANSHIP.md#6-changes-to-scoring-taxonomy-and-sources).
- **Only close an issue when the work is done and verified.** Reference the issue and its requirement ID (e.g. "Closes #12, R14") in your pull request, and describe how you verified the work.

## Sensitive documents
Some documents stay out of the public repository on purpose, because publishing them would help attackers:
- the abuse detection playbook;
- threat analyses of the identity, verification and ballot designs;
- the internal task list.

Everything else, including all code, is public.

If your work needs these documents, for example security or moderation tooling, ask the maintainers. They share them privately after vetting. Never commit them to the public repository or quote them in public issues.

## Developer Certificate of Origin (DCO)
Every commit must be signed off. Signing off certifies that you have the right to submit the work under the project's licenses ([developercertificate.org](https://developercertificate.org/)).

```
git commit -s -m "Your message"
```

There is no CLA.

## Licenses
- Code contributions are licensed under AGPL-3.0-or-later.
- Documentation contributions are licensed under CC BY 4.0.

## Pull requests
- Keep each pull request focused.
- Include tests where you can.
- Describe what you validated and how.
- Security issues go through [SECURITY.md](SECURITY.md), never through public issues.
