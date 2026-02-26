# ChatML Open Source Licensing Strategy: Research & Recommendation

**Document Status:** Internal Reference for Founders & Legal Counsel
**Last Updated:** February 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Competitive Landscape](#2-competitive-landscape)
3. [License Comparison Matrix](#3-license-comparison-matrix)
4. [Why GPL v3 (Not AGPL, Not BSL, Not MIT)](#4-why-gpl-v3-not-agpl-not-bsl-not-mit)
5. [CLA Strategy](#5-cla-strategy)
6. [AGPL vs GPL for Desktop Apps (Detailed Analysis)](#6-agpl-vs-gpl-for-desktop-apps-detailed-analysis)
7. [BSL and FSL Deep Dive (For Reference)](#7-bsl-and-fsl-deep-dive-for-reference)
8. [Dependency Compatibility](#8-dependency-compatibility)
9. [Future Options (Preserved by CLA)](#9-future-options-preserved-by-cla)
10. [Recommendations for Legal Counsel](#10-recommendations-for-legal-counsel)

---

## 1. Executive Summary

After evaluating six major licensing approaches -- MIT, Apache 2.0, GPL v3, AGPL v3, BSL (Business Source License), and FSL (Functional Source License) -- ChatML has selected **GPL v3 combined with a Contributor License Agreement (CLA)** as its open source licensing strategy.

### Key conclusions:

- **ChatML's primary competitive moat is execution speed and hosted service quality, not the codebase itself.** Open-sourcing the code under a copyleft license strengthens community trust without surrendering competitive advantage.

- **GPL v3 provides genuine open source credibility while preventing proprietary forks.** Any entity that forks ChatML must keep their modifications open source under the same GPL v3 terms. This eliminates the Cline/Kilo Code scenario, where a permissive license enabled a competitor to raise $8M on top of someone else's open codebase.

- **A CLA preserves maximum future flexibility.** By requiring contributors to assign or broadly license their copyright, ChatML retains the ability to relicense (e.g., upgrade to AGPL v3), offer commercial dual-licenses to enterprises, or adapt strategy as the competitive landscape evolves.

- **GPL v3 avoids the enterprise stigma of AGPL** and the community backlash associated with non-OSI-approved licenses like BSL and FSL. For a desktop application (not a hosted service), GPL v3 provides functionally equivalent protection to AGPL without the additional friction.

---

## 2. Competitive Landscape

### 2.1 Permissive License Projects (Cautionary Tales)

#### Cline (Apache 2.0)

Cline is the canonical cautionary tale for permissive licensing in the AI developer tools space. Licensed under Apache 2.0, Cline was forked into two significant competitors:

- **Roo Code** -- a community-driven fork that continued development in a different direction.
- **Kilo Code** -- a commercially-backed fork that raised an **$8M seed round** built primarily on Cline's open codebase.

The result is a "circular dependency nightmare" where all three projects pull updates from each other, feature sets converge, and differentiation erodes. By Q2 2026, these three products may be functionally identical -- a scenario that destroys value for the original creators while rewarding the forks that contributed minimal novel code.

**Lesson:** Apache 2.0 offers zero protection against well-funded competitors extracting value from your codebase. The permissive license that attracts early contributors can also attract late-stage extractors.

#### Continue.dev (Apache 2.0)

Continue.dev is an open-source AI IDE assistant also licensed under Apache 2.0. While it has not yet faced the same fork-and-commercialize problem as Cline, it remains structurally vulnerable to the same scenario. The difference is likely market timing rather than licensing wisdom.

### 2.2 Proprietary Projects

| Product | License | Pricing | Funding | Notes |
|---------|---------|---------|---------|-------|
| **Cursor** | Closed-source (VS Code fork) | $20-40/month | ~$400M+ | Leading market position; proprietary codebase is the moat |
| **Claude Code** | Rights reserved (public repo, all rights retained by Anthropic) | Usage-based via API | Backed by billions (Anthropic) | Code is visible but not open source; Anthropic retains full control |
| **Windsurf** | Closed-source | $15/month Pro tier | Funded by Codeium | Competing on price point; fully proprietary |

**Observation:** The well-funded competitors in this space are uniformly proprietary. None of them have chosen permissive open source, which validates the concern that permissive licensing exposes a codebase to commercial exploitation.

### 2.3 Copyleft Success Stories

#### Grafana (AGPL v3)

Grafana is the gold standard for copyleft licensing in commercial open source. Licensed under AGPL v3, Grafana successfully leveraged copyleft to create a revenue stream from cloud providers. Rather than comply with AGPL's source disclosure requirements, **AWS and Azure chose to pay Grafana Labs licensing fees** to offer managed Grafana services. This demonstrates that copyleft can function as a commercial lever, not just a philosophical commitment.

#### Redis (AGPL v3, as of 2025)

Redis experimented with multiple licensing strategies before returning to AGPL v3 in 2025. The progression was instructive:

1. **BSD (original)** -- fully permissive, allowed AWS ElastiCache to compete directly.
2. **SSPL (Server Side Public License)** -- attempted to close the cloud loophole, but SSPL is not OSI-approved and drew community criticism.
3. **AGPL v3 (2025)** -- returned to a recognized open source copyleft license that provides meaningful cloud-provider protection.

**Lesson:** Redis's journey validates that AGPL is often the right eventual destination for infrastructure software. Starting with GPL v3 and upgrading to AGPL via CLA is a viable strategy.

#### MongoDB (AGPL to SSPL)

MongoDB used AGPL successfully for years until cloud providers (particularly AWS with DocumentDB) found ways to offer MongoDB-compatible services without triggering AGPL obligations. MongoDB responded by moving to SSPL, which is more restrictive but not OSI-approved. The transition was controversial and fractured community goodwill.

**Lesson:** AGPL is strong but not bulletproof against determined cloud providers. However, for a desktop application like ChatML, the cloud exploitation vector is less relevant than it is for database software.

---

## 3. License Comparison Matrix

| Criterion | MIT | Apache 2.0 | GPL v3 | AGPL v3 | BSL | FSL |
|-----------|-----|-----------|--------|---------|-----|-----|
| **Fork protection** | None | None | Strong (copyleft) | Strong (copyleft + network) | Strong (commercial restriction) | Strong (competing use restriction) |
| **Enterprise-friendly** | High | High | Moderate | Low | Moderate | Moderate |
| **Community goodwill** | High | High | High | Moderate | Low | Low-Moderate |
| **SaaS loophole closed** | No | No | No | Yes (Section 13) | Depends on grant | Depends on terms |
| **Complexity** | Minimal | Low | Moderate | Moderate-High | High (custom terms) | Moderate |
| **OSI-approved** | Yes | Yes | Yes | Yes | No | No |
| **Patent grant** | No | Yes (explicit) | Yes (Section 11) | Yes (Section 11) | Varies | Varies |
| **Contributor friction** | Lowest | Low | Moderate | Higher | Moderate | Moderate |
| **Commercial dual-license viable** | N/A (already permissive) | N/A (already permissive) | Yes (with CLA) | Yes (with CLA) | Built-in | Built-in |
| **Prevents proprietary forks** | No | No | Yes | Yes | Yes (during restriction period) | Yes (during restriction period) |
| **Known enterprise bans** | None | None | Some (linking concerns) | Many (Google, others) | Few (too new) | Few (too new) |

### Summary of tradeoffs:

- **MIT / Apache 2.0:** Maximum adoption, zero protection. Best for projects where the code itself is not the business (e.g., libraries, frameworks).
- **GPL v3:** Strong copyleft protection, real open source credibility, moderate enterprise acceptance. Best for applications where you want to prevent proprietary forks while maintaining community trust.
- **AGPL v3:** Strongest copyleft, but triggers enterprise policy alarms disproportionate to its actual impact on desktop software. Best for hosted services.
- **BSL:** Commercial protection with eventual open source conversion. Not OSI-approved; community perception is negative. Every BSL license is effectively unique due to custom Additional Use Grant parameters.
- **FSL:** Standardized version of BSL concept. Not OSI-approved; still too new to have established track record.

---

## 4. Why GPL v3 (Not AGPL, Not BSL, Not MIT)

### 4.1 Why not MIT / Apache 2.0

The case against permissive licensing for ChatML is straightforward and empirically validated by the Cline debacle.

**The Cline scenario in detail:**

1. Cline builds a popular open-source AI coding assistant under Apache 2.0.
2. Kilo Code forks Cline's codebase with minimal modifications.
3. Kilo Code raises an **$8M seed round** built primarily on code they did not write.
4. Three near-identical products now compete, with the original creator having no licensing leverage.
5. Feature convergence means differentiation approaches zero over time.

Under MIT or Apache 2.0, ChatML would be structurally exposed to the exact same scenario. Any well-funded competitor could fork ChatML, close the source, build proprietary features on top, and compete directly -- all while ChatML's own contributors effectively built the competitor's foundation for free.

**The argument that "permissive licenses attract more contributors" is empirically weak for application-level software.** The contribution patterns for IDEs and developer tools show that the vast majority of meaningful contributions come from a small core team, not from a broad community of drive-by contributors. The marginal contributors lost to copyleft friction are rarely the ones building critical features.

### 4.2 Why not AGPL v3

AGPL v3 is functionally identical to GPL v3 for desktop software, with one critical addition: **Section 13 (Remote Network Interaction)** requires that if someone modifies the software and makes it available over a network, they must provide the source code to users interacting with it remotely.

For ChatML -- a Tauri desktop application -- Section 13 is irrelevant:

- ChatML runs locally on the user's machine.
- ChatML calls external APIs (LLM providers) but does not itself provide a network service.
- The AGPL network copyleft clause would only trigger if someone forked ChatML and turned it into a hosted web service.

Despite being functionally equivalent for our use case, AGPL carries significantly more enterprise baggage:

- **Google bans AGPL entirely** from their codebase and development environment. This is a blanket policy with no exceptions process.
- **Many enterprises have blanket "no copyleft" or "no AGPL" policies.** Legal departments that can evaluate GPL v3 on a case-by-case basis will automatically reject AGPL without review.
- **The perception gap is real.** AGPL is seen as "aggressive open source" even when its additional provisions are irrelevant. GPL v3 is seen as "standard copyleft" and receives less reflexive pushback.

**Bottom line:** AGPL adds enterprise friction without adding meaningful protection for a desktop application. GPL v3 provides the same copyleft benefits with less stigma.

### 4.3 Why not BSL / FSL

BSL and FSL are "source available" licenses designed to solve the same problem as copyleft -- preventing commercial exploitation of open code -- but through a fundamentally different mechanism: **time-limited commercial restriction** rather than copyleft obligation.

The problems with BSL/FSL for ChatML:

1. **Not recognized as "true open source" by OSI.** This is not merely a semantic distinction. The open source community actively penalizes projects that claim to be open source while using non-OSI-approved licenses. The reputational cost is real.

2. **Community backlash is documented.** HashiCorp's 2023 switch from MPL 2.0 to BSL triggered the **OpenTofu fork**, backed by multiple companies and the Linux Foundation. The BSL label alone is sufficient to galvanize organized opposition.

3. **BSL is not a single license.** Every BSL implementation has a custom "Additional Use Grant" that defines what commercial use is permitted. This means lawyers cannot rely on precedent or standard interpretations -- every BSL project requires individual legal review. For potential enterprise customers, this is a significant barrier.

4. **FSL (Sentry's Functional Source License) is newer and less battle-tested.** While FSL standardizes the BSL concept (fixed 2-year conversion, converts to Apache 2.0 or MIT, restricts only "Competing Use"), it was introduced in 2023 and has limited adoption outside of Sentry's own projects (Sentry, Codecov, Liquibase). There is insufficient legal precedent to assess its enforceability or court interpretation.

5. **GPL v3 achieves the same fork protection while being genuinely open source.** The core goal -- preventing proprietary forks -- is fully addressed by GPL v3's copyleft requirement. There is no additional protection that BSL or FSL provides that GPL v3 does not, for ChatML's specific use case.

### 4.4 Why GPL v3 is the right fit

GPL v3 is the optimal license for ChatML because it satisfies all four strategic requirements:

1. **Copyleft ensures all forks must remain open source.** Anyone who forks ChatML and distributes a modified version must do so under GPL v3 terms, including making source code available. This eliminates the Cline/Kilo Code scenario entirely.

2. **OSI-approved -- real open source credibility.** GPL v3 is one of the most widely used and legally tested open source licenses in existence. It carries no "source available" stigma and is universally recognized as genuine open source.

3. **Less enterprise friction than AGPL.** While some enterprises have blanket copyleft restrictions, GPL v3 is routinely evaluated and approved for use in contexts where AGPL is categorically rejected. For potential enterprise customers or partners, GPL v3 is a more navigable conversation.

4. **Patent protection built in.** GPL v3 Section 11 includes an explicit patent grant from contributors, protecting both ChatML and its users from patent claims related to contributed code. This is a meaningful improvement over GPL v2 and provides protection comparable to Apache 2.0's patent grant.

5. **Dependency compatibility confirmed.** All current ChatML dependencies (Radix UI, Zustand, Next.js, Shiki, Tauri framework) are licensed under MIT or Apache 2.0, both of which are forward-compatible with GPL v3. There are no compatibility conflicts.

---

## 5. CLA Strategy

### 5.1 Why a CLA is required

A Contributor License Agreement is essential for any copyleft project that wants to preserve commercial flexibility. Without a CLA, copyright in the codebase is distributed across every contributor, and **any licensing change requires unanimous consent from all copyright holders** -- a practical impossibility once a project has more than a handful of contributors.

**The CLA enables ChatML to:**

- **Relicense the codebase.** If the competitive landscape changes and AGPL v3 becomes necessary, a CLA allows ChatML to upgrade from GPL v3 to AGPL v3 without seeking permission from every past contributor.
- **Offer commercial dual-licenses.** Enterprise customers who cannot accept GPL v3 terms can be offered a separate commercial license. This is only possible if ChatML controls 100% of the copyright.
- **Adapt strategy over time.** The licensing landscape for AI developer tools is evolving rapidly. A CLA ensures that ChatML is never locked into a licensing decision that becomes strategically disadvantageous.

**CLAs are standard practice in major open source projects:**

| Organization | CLA Type | Notable Projects |
|-------------|----------|-----------------|
| Apache Software Foundation | ICLA (Individual Contributor License Agreement) | All ASF projects (Kafka, Spark, etc.) |
| Meta (Facebook) | CLA | React, PyTorch |
| Google | CLA | Android, Kubernetes, Go |
| Canonical | CLA | Ubuntu |
| MongoDB | CLA (contributor agreement) | MongoDB (pre-SSPL era) |
| Grafana Labs | CLA | Grafana |

### 5.2 CLA implementation

**Tooling: CLA Assistant (GitHub bot)**

ChatML will use [CLA Assistant](https://github.com/cla-assistant/cla-assistant), a widely-adopted GitHub bot that automates CLA checking on pull requests:

- When a new contributor opens a PR, CLA Assistant prompts them to sign the CLA.
- Signing is done via GitHub OAuth -- a single click to acknowledge the agreement.
- The bot tracks which contributors have signed and blocks merging for unsigned PRs.
- Signed CLAs are stored and auditable.

**CLA Template: Based on Apache Individual CLA**

The CLA will be based on the Apache Individual Contributor License Agreement (ICLA), adapted with the following provisions:

1. **Copyright assignment or broad license grant.** Contributors either assign copyright to ChatML or grant an irrevocable, worldwide, royalty-free license that permits relicensing.
2. **Explicit relicensing provision.** The CLA clearly states that ChatML may relicense contributed code under different terms, including proprietary licenses.
3. **Patent grant.** Contributors grant a patent license for any patents they hold that are necessarily infringed by their contributions.
4. **Representation of authority.** Contributors represent that they have the right to make the contribution and sign the CLA (important for contributors who may be employed and subject to IP assignment clauses).

**Tradeoffs acknowledged:**

- **Contributor friction is real but manageable.** Some potential contributors will decline to sign a CLA, particularly those who object to the relicensing provisions on principle. This is a known cost. However, evidence from major CLA-using projects (React, Kubernetes, all ASF projects) suggests that the contributor loss is minimal for actively maintained projects with a clear value proposition.
- **Corporate contributors may require additional process.** Employees of companies with IP assignment policies may need their employer to sign a Corporate CLA (CCLA) in addition to the individual CLA. This adds friction but is standard practice.

---

## 6. AGPL vs GPL for Desktop Apps (Detailed Analysis)

This section provides a detailed technical analysis of why AGPL v3's additional provisions are irrelevant for ChatML's use case, and how the "GPL now, AGPL later" strategy provides an optimal path.

### 6.1 What AGPL Section 13 actually says

AGPL v3 Section 13 ("Remote Network Interaction") states:

> Notwithstanding any other provision of this License, if you modify the Program, your modified version must prominently offer all users interacting with it remotely through a computer network [...] an opportunity to receive the Corresponding Source of your version.

The key trigger conditions are:

1. The software must be **modified** (not merely used as-is).
2. The modified software must **support remote interaction through a computer network**.
3. Users must be **interacting with it remotely**.

### 6.2 Why Section 13 does not apply to ChatML

ChatML is a Tauri desktop application. Its architecture:

- Runs **locally** on the user's machine as a native desktop application.
- The Tauri backend (Rust) and frontend (webview) both execute on the local machine.
- ChatML **calls external APIs** (LLM providers like Anthropic, OpenAI, etc.) as a client. It does not provide a network-accessible service.
- Users interact with ChatML through their local desktop, not through a computer network.

Under this architecture, AGPL Section 13 is **never triggered**, even if someone forks and modifies ChatML, as long as the fork remains a desktop application. The modified version is not "supporting remote interaction through a computer network" -- it is making outbound API calls, which is fundamentally different.

### 6.3 When AGPL Section 13 would matter

Section 13 would only become relevant if a third party:

1. Forked ChatML's codebase.
2. Modified it to run as a **hosted web service** (e.g., a browser-based IDE).
3. Offered that hosted service to users who interact with it remotely.

In this scenario -- and only this scenario -- AGPL Section 13 would require the fork to provide source code to its remote users. Under GPL v3, this same scenario would not trigger source disclosure obligations because GPL v3's copyleft only applies to distribution, not to running software as a service.

### 6.4 The "GPL v3 now, AGPL later" strategy

Given the analysis above, the recommended strategy is:

1. **Launch under GPL v3.** This provides copyleft protection against proprietary forks with minimal enterprise friction. For a desktop application, GPL v3 and AGPL v3 are functionally identical.

2. **Require a CLA from all contributors.** This preserves the legal right to relicense.

3. **Monitor the competitive landscape.** If a competitor forks ChatML and offers it as a hosted web service (the one scenario where AGPL provides additional protection), ChatML can relicense to AGPL v3 using the CLA.

4. **The relicense to AGPL is a one-way escalation.** It can be done at any time, applies to all future releases, and does not require consent from past contributors (because the CLA already provides that authority).

This strategy provides the strongest protection available at each stage while minimizing unnecessary friction.

---

## 7. BSL and FSL Deep Dive (For Reference)

This section provides detailed reference material on BSL and FSL for completeness, though neither is recommended for ChatML.

### 7.1 BSL (Business Source License)

**Origin:** Created by MariaDB Corporation in 2013 as a compromise between proprietary and open source licensing.

**Mechanism:** BSL is a source-available license that converts to a true open source license after a specified period. It has three customizable parameters:

| Parameter | Description | Constraints |
|-----------|-------------|-------------|
| **Additional Use Grant** | Defines what commercial use is permitted during the restriction period | Custom text; varies per project |
| **Change Date** | Date when the license converts to the Change License | Maximum 4 years from each release |
| **Change License** | The open source license that applies after the Change Date | Typically GPL v2 or later |

**The fundamental problem with BSL:** Because the Additional Use Grant is custom text, **every BSL license is effectively a different license.** There is no standardized understanding of what is permitted. Legal teams must individually evaluate each BSL project's specific terms, which creates significant adoption friction.

**Notable BSL adopters:**

| Company | Product | Additional Use Grant | Change Date | Change License |
|---------|---------|---------------------|-------------|----------------|
| HashiCorp | Terraform, Vault, etc. | Non-competitive use | 4 years | MPL 2.0 |
| Couchbase | Couchbase Server | Up to 5 nodes | 4 years | Apache 2.0 |
| MariaDB | MaxScale | 3 server instances | 4 years | GPL v2+ |
| CockroachDB | CockroachDB | Non-enterprise use | 3 years | Apache 2.0 |
| EMQX | EMQX | Non-commercial use | 4 years | Apache 2.0 |

**Community reception:** BSL is broadly viewed with suspicion by the open source community. HashiCorp's 2023 switch from MPL 2.0 to BSL triggered:

- The **OpenTofu fork**, which received Linux Foundation backing within weeks.
- Widespread criticism from the open source community and industry analysts.
- A lasting reputational cost that HashiCorp continues to carry.

### 7.2 FSL (Functional Source License)

**Origin:** Created by Sentry in 2023 as a standardized alternative to BSL, addressing BSL's customization problem.

**Mechanism:** FSL is a fixed, non-customizable source-available license with the following properties:

| Property | FSL Term |
|----------|----------|
| **Restriction period** | 2 years (fixed, not customizable) |
| **Restriction type** | "Competing Use" -- cannot use the software to build a product or service that competes with the licensor |
| **Change License** | Apache 2.0 or MIT (chosen at license time) |
| **Conversion** | Automatic after 2 years; code becomes permissively licensed |

**Advantages over BSL:**

- **Standardized.** Every FSL license is identical except for the choice of Apache 2.0 or MIT as the Change License. Lawyers can evaluate FSL once and apply that evaluation to all FSL projects.
- **Shorter restriction period.** 2 years vs BSL's maximum 4 years.
- **Narrower restriction.** Only "Competing Use" is restricted, not all commercial use. Non-competing commercial use is explicitly permitted.

**Adopters:**

| Company | Products |
|---------|----------|
| Sentry | Sentry, Relay, Snuba |
| Codecov | Codecov |
| Liquibase | Liquibase |

**Limitations:**

- **Not OSI-approved.** Like BSL, FSL is not recognized as open source by the Open Source Initiative. It is "source available."
- **Limited legal precedent.** FSL was introduced in 2023 and has not been tested in court. The definition of "Competing Use" has not been judicially interpreted.
- **Community perception is mixed.** While FSL is viewed more favorably than BSL (due to its standardization and shorter restriction period), it still carries the "not truly open source" stigma.

### 7.3 Why neither BSL nor FSL is appropriate for ChatML

For ChatML's specific situation, GPL v3 achieves the same protective outcome as BSL or FSL -- preventing proprietary commercial exploitation of the codebase -- while being:

- **Genuinely open source** (OSI-approved).
- **Battle-tested** (decades of legal precedent and enforcement history).
- **Community-approved** (no risk of OpenTofu-style backlash).
- **Stronger in some respects** (copyleft is perpetual; BSL/FSL restrictions are time-limited).

The only scenario where BSL or FSL would provide protection that GPL v3 does not is the SaaS loophole (someone running ChatML as a hosted service without distributing the code). This scenario is better addressed by upgrading to AGPL v3 via the CLA, which provides the SaaS protection while remaining OSI-approved.

---

## 8. Dependency Compatibility

GPL v3 compatibility with ChatML's dependency stack has been verified. All current dependencies use licenses that are forward-compatible with GPL v3.

### 8.1 License compatibility rules

| Dependency License | Compatible with GPL v3? | Notes |
|-------------------|------------------------|-------|
| MIT | Yes | MIT code can be included in GPL v3 projects |
| Apache 2.0 | Yes | Compatible with GPL v3 (not GPL v2) |
| BSD 2-Clause | Yes | Permissive; no conflicts |
| BSD 3-Clause | Yes | Permissive; no conflicts |
| ISC | Yes | Functionally equivalent to MIT |
| LGPL v2.1+ | Yes | LGPL is designed for GPL compatibility |
| LGPL v3 | Yes | Fully compatible |
| GPL v2-only | **No** | GPL v2-only (without "or later") is NOT compatible with GPL v3 |
| Proprietary | **No** | Cannot be combined with GPL v3 |

### 8.2 ChatML's dependency audit

| Category | Key Dependencies | License | GPL v3 Compatible |
|----------|-----------------|---------|-------------------|
| **Framework** | Tauri | MIT / Apache 2.0 | Yes |
| **UI Components** | Radix UI | MIT | Yes |
| **State Management** | Zustand | MIT | Yes |
| **Build/Framework** | Next.js | MIT | Yes |
| **Syntax Highlighting** | Shiki | MIT | Yes |
| **Rust Ecosystem** | Tokio, Serde, etc. | MIT / Apache 2.0 | Yes |

### 8.3 Key finding

- **No GPL v2-only dependencies detected.** All GPL-family dependencies (if any) use "GPL v2 or later" language, which permits use under GPL v3.
- **No proprietary dependencies detected.** All dependencies are under OSI-approved permissive or copyleft licenses.
- **Tauri framework itself is MIT/Apache 2.0.** This is critical -- the core framework ChatML is built on is fully GPL-compatible with no restrictions.
- **Tauri plugins should be individually verified.** While the Tauri framework is MIT/Apache 2.0, individual Tauri plugins may have different licenses. Legal counsel should confirm the license of each Tauri plugin used by ChatML.

---

## 9. Future Options (Preserved by CLA)

The combination of GPL v3 + CLA preserves maximum strategic flexibility. The following table outlines potential future scenarios and the licensing responses available:

| Scenario | Response | CLA Required? |
|----------|----------|---------------|
| **A competitor forks ChatML and offers it as a hosted web service** (SaaS loophole) | Relicense future releases to AGPL v3, closing the SaaS loophole | Yes -- CLA grants relicensing authority |
| **Enterprise customers need a non-copyleft license** for integration into proprietary products | Offer commercial dual-licensing: GPL v3 (free, open source) + proprietary license (paid) | Yes -- CLA grants authority to offer proprietary license |
| **The competitive landscape shifts** and a more restrictive or more permissive license becomes strategically optimal | Change license for future releases (existing releases remain under their original license) | Yes -- CLA grants authority to relicense contributions |
| **A major contributor demands removal of their code** due to licensing disagreement | CLA's irrevocable license grant means contributed code can continue to be used under any license ChatML chooses | Yes -- CLA provides irrevocable rights |
| **Patent troll targets ChatML or its users** | GPL v3 Section 11 patent grant from contributors provides defensive protection; CLA may include additional patent provisions | Partially -- GPL v3 provides base protection; CLA strengthens it |

### 9.1 Detailed future paths

**Path A: Upgrade to AGPL v3**

- **Trigger:** A competitor forks ChatML and offers it as a hosted web service without contributing back.
- **Action:** Release all future versions under AGPL v3 instead of GPL v3.
- **Effect:** Future forks must comply with AGPL Section 13, requiring source disclosure for hosted versions.
- **Risk:** Minimal. AGPL is a natural escalation from GPL and does not change terms for desktop users.

**Path B: Commercial dual-licensing**

- **Trigger:** Enterprise customers want to integrate ChatML components into proprietary products.
- **Action:** Offer a commercial license (separate from GPL v3) for a fee.
- **Effect:** Enterprises get proprietary rights; ChatML gains a revenue stream; open source version continues unchanged.
- **Precedent:** Qt, MySQL (pre-Oracle), Grafana all use or have used this model successfully.

**Path C: Strategic flexibility**

- **Trigger:** Unforeseen changes in the competitive landscape, legal environment, or business model.
- **Action:** Any licensing change is possible for future releases, subject to CLA terms.
- **Effect:** ChatML is never locked into a strategy that becomes disadvantageous.

---

## 10. Recommendations for Legal Counsel

The following items require review and action by legal counsel before finalizing the licensing strategy:

### 10.1 CLA document review

- **Review the CLA document for legal sufficiency** in the relevant jurisdiction(s).
- Confirm that the CLA's copyright assignment or license grant is broad enough to support:
  - Relicensing to AGPL v3.
  - Offering proprietary commercial licenses.
  - Any future licensing change.
- Verify that the CLA's representations (contributor authority, employer consent) are appropriate.
- Consider whether separate Individual and Corporate CLA documents are needed.

### 10.2 Dependency license audit

- **Confirm GPL v3 compatibility with all dependencies**, including:
  - All Tauri plugins used by ChatML (verify each plugin's license individually).
  - Any transitive dependencies that may have restrictive licenses.
  - Any binary dependencies or assets (fonts, icons, etc.) that may have separate licensing terms.
- Establish a process for ongoing dependency license monitoring as new dependencies are added.

### 10.3 Trademark protection

- **"ChatML" trademark protection should be pursued separately from the open source license.** GPL v3 does not address trademarks. A registered trademark would:
  - Prevent forks from using the "ChatML" name.
  - Protect brand identity even if the code is forked and modified.
  - Provide a separate enforcement mechanism independent of copyright.
- Consider filing for trademark registration in the relevant jurisdiction(s).
- Draft a trademark usage policy that defines acceptable use of the ChatML name by forks and community projects.

### 10.4 Source file headers

- **Evaluate whether copyright notices and license headers are needed in individual source files.** While GPL v3 does not strictly require per-file headers, they serve as:
  - Clear notice to anyone reading the code.
  - Evidence of copyright ownership in enforcement proceedings.
  - Standard practice for GPL projects.
- Recommended header format:

  ```
  // Copyright (c) [year] ChatML, Inc.
  // Licensed under the GNU General Public License v3.0.
  // See LICENSE file in the project root for full license text.
  ```

### 10.5 Additional considerations

- **DMCA agent registration.** If ChatML hosts any user-generated content or plugin marketplace, register a DMCA agent with the U.S. Copyright Office.
- **Export control.** If ChatML includes any encryption functionality (e.g., for API key storage), assess export control obligations under EAR/ITAR.
- **Third-party notices.** Prepare a THIRD-PARTY-NOTICES or ATTRIBUTION file listing all dependencies, their licenses, and required attribution text. This is both a legal requirement for some licenses (Apache 2.0 requires NOTICE preservation) and a best practice.

---

## Appendix A: Key References

- [GNU General Public License v3.0 (Full Text)](https://www.gnu.org/licenses/gpl-3.0.html)
- [GNU Affero General Public License v3.0 (Full Text)](https://www.gnu.org/licenses/agpl-3.0.html)
- [Apache Individual Contributor License Agreement](https://www.apache.org/licenses/icla.pdf)
- [CLA Assistant (GitHub)](https://github.com/cla-assistant/cla-assistant)
- [Business Source License 1.1 (Template)](https://mariadb.com/bsl11/)
- [Functional Source License (Sentry)](https://fsl.software/)
- [OSI Approved Licenses List](https://opensource.org/licenses/)
- [GPL v3 License Compatibility (GNU Project)](https://www.gnu.org/licenses/license-compatibility.html)

---

*This document is intended for internal use by ChatML's founders and legal counsel. It does not constitute legal advice. All licensing decisions should be reviewed by qualified legal counsel before implementation.*
