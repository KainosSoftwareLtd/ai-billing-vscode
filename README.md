# Kainos AI Billing Plugin

![vscode-shield] ![version-shield]

## Overview

AI Billing is a local-first VS Code extension for tracking AI usage, estimating spend, and comparing editor activity with GitHub Copilot billing.

The extension builds a billing view from data already available on your machine. It reads local VS Code chat history, Copilot session data, and related logs, then turns that into a dashboard for day-to-day visibility and reconciliation work.

AI Billing is intended for people who want to understand:

- which models are driving most of the cost
- how usage has changed over time
- how much activity came from auto-routed model selection
- how closely local data aligns with GitHub billing

## Technologies

| Language             |
| -------------------- |
| ![typescript-shield] |

## Features

- Status bar summary for quick visibility
- Dashboard with 5-hour, 7-day, current billing period, and all-time views
- Per-model cost breakdown with auto/explicit routing split
- Per-vendor (provider) cost breakdown and comparison
- Monthly Billing Summary tab for cycle-by-cycle reconciliation
- GitHub-style model comparison view
- Discount tracking per vendor
- Local rebuild and resync commands for re-importing history
- Debug View import support for deeper reconciliation work

## Getting started

### Install dependencies

```bash
npm install
```

### Compile the extension

```bash
npm run compile
```

### Package the VSIX

```bash
npm run package
```

## Commands

- `AI Billing: Show Usage`
- `AI Billing: Sync VS Code Chat Usage`
- `AI Billing: Rebuild Usage from Copilot History`

## Configuration

The extension uses the `AI Billing` settings group in VS Code.

The main setting surface is `aiBilling.modelPricing`, which allows model-specific pricing overrides where needed. For working examples and reference payloads, use the linked documents below rather than this README.

Billing period behaviour is controlled by:

- `aiBilling.billing.periodStartDay`: cycle start day when no explicit license anchor is configured
- `aiBilling.billing.licenseStart`: optional `YYYY-MM-DD` anchor for license-aligned cycles and monthly summary grouping

Local VS Code data discovery is controlled by:

- `aiBilling.vscodeDataPath`: optional VS Code data directory override. Leave empty to use the platform default. The path should contain `User/workspaceStorage`, not point directly at `workspaceStorage` or `chatSessions`. Windows-style paths such as `C:\Users\{userName}\AppData\Roaming\Code` are automatically converted to `/mnt/c/...` when running in WSL.
- `aiBilling.additionalVscodeDataPaths`: optional list of extra VS Code data directories to scan. This is useful for Remote-WSL, where recent transcripts and debug logs may live under `~/.vscode-server/data` while credit-bearing chat sessions live under the Windows host Code directory. In that case, set `aiBilling.vscodeDataPath` to `~/.vscode-server/data` and add `/mnt/c/Users/{userName}/AppData/Roaming/Code` here.

## Documentation

This README is the repository entry point. Use the documents below for detailed guidance.

- Architecture overview: [architecture/overview.md](architecture/overview.md)
- Architecture decision Index: [adr/index.md](adr/index.md)

## Anatomy of Project

```bash
/
├── .adrs                               - contains architecture decision records
├── .architecture                       - contains higher-level design material
├── .docs                               - contains operational and support documentation
├── .github                             - containing pipeline configuration
├── .src                                - contains the extension source code
└── .gitignore
```

## Notes

- The extension is local-first and does not require a back-end service.
- It reads local VS Code artefacts but does not modify the original chat history files.

## Contact

![dc-shield]

## Licence

Copyright © Kainos – All Rights Reserved. See LICENSE.txt for more information.

<!-- header -->

[components-shield]: https://img.shields.io/badge/Components-1-lightgrey?style=flat
[maintained-shield]: https://img.shields.io/maintenance/yes/2027?style=flat
[version-shield]: https://img.shields.io/badge/Version-1.0.0-blue?style=flat

<!-- Team -->

[dc-shield]: https://img.shields.io/badge/Solution%20Architect-Damiano%20Curreri-purplue?style=flat

<!-- Application Type -->

[worker-service-shield]: https://img.shields.io/badge/Window%20Service-239120?labelColor=grey&style=flat&logo=windowsterminal
[api-shield]: https://img.shields.io/badge/Api-512BD4?labelColor=grey&style=flat&logo=openapiinitiative
[graphql-shield]: https://img.shields.io/badge/GraphQL-E10098?labelColor=grey&style=flat&logo=graphql
[web-application-shield]: https://img.shields.io/badge/Web%20Application-239120?labelColor=grey&style=flat&logo=googlechrome
[nuget-package-shield]: https://img.shields.io/badge/Nuget%20Package-004880?labelColor=grey&style=flat&logo=nuget
[maven-package-shield]: https://img.shields.io/badge/Maven%20Library-C71A36?labelColor=grey&style=flat&logo=apachemaven
[pypi-package-shield]: https://img.shields.io/badge/Python%20Library-3776AB?labelColor=grey&style=flat&logo=python
[lambda-shield]: https://img.shields.io/badge/Lambda-FF9900?labelColor=grey&style=flat&logo=awslambda
[ai-shield]: https://img.shields.io/badge/AI-000000?labelColor=grey&style=flat&logo=githubcopilot
[ml-shield]: https://img.shields.io/badge/Machine%20Learning-0194E2?labelColor=grey&style=flat&logo=mlflow
[vscode-shield]: https://img.shields.io/badge/VSCode-EAB300?labelColor=grey&style=flat&logo=vscode

<!-- Languages -->

[c#-shield]: https://img.shields.io/badge/CSharp-239120?labelColor=grey&=flat&logo=csharp
[net-shield]: https://img.shields.io/badge/.Net-512BD4?labelColor=grey&=flat&logo=dotnet
[javascript-shield]: https://img.shields.io/badge/Javascript-007396?labelColor=grey&=flat&logo=javascript
[groovy-shield]: https://img.shields.io/badge/Groovy-4298B8?labelColor=grey&style=flat&logo=apachegroovy
[json-shield]: https://img.shields.io/badge/JSon-4298B8?labelColor=grey&style=flat&logo=json
[yaml-shield]: https://img.shields.io/badge/Yaml-CB171E?labelColor=grey&style=flat&logo=yaml
[vue-shield]: https://img.shields.io/badge/Vue.js-4FC08D?labelColor=grey&style=flat&logo=vuedotjs
[node-shield]: https://img.shields.io/badge/Node.js-339933?labelColor=grey&style=flat&logo=nodedotjs
[typescript-shield]: https://img.shields.io/badge/Typescript-3178C6?labelColor=grey&style=flat&logo=typescript
[bash-shield]: https://img.shields.io/badge/Bash-3178C6?labelColor=grey&style=flat&logo=gnubash
[swagger-shield]: https://img.shields.io/badge/OpenApi-green?labelColor=grey&=flat&logo=openapi-initiative
[env-shield]: https://img.shields.io/badge/Env-ECD53F?labelColor=grey&=flat&logo=dotenv
[terraform-shield]: https://img.shields.io/badge/Terraform-844FBA?labelColor=grey&style=flat&logo=terraform
[react-shield]: https://img.shields.io/badge/React-61DAFB?labelColor=grey&style=flat&logo=react
