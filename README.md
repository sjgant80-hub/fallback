# ◊ FallBack

> **The money comes back to you.**
> Drop your bank statement. The AI finds what's being taken. The AI drafts the letters. You press send.

A sovereign, single-file rights & refund engine. Free forever. MIT. Runs entirely on your device. No server. No telemetry. No upload.

[**Live tool →**](https://sjgant80-hub.github.io/fallback/) · [Estate](https://ai-nativesolutions.com)

---

## What it does

1. You drop a bank or credit-card statement (PDF or CSV) — or paste lines directly.
2. A pattern engine scans for: forgotten subscriptions, silent price hikes, refundable bank fees, gym/streaming/SaaS recurring charges, duplicate services in the same category.
3. For every finding, FallBack drafts the right letter for your jurisdiction (**UK · EU · US · AU**) citing the actual law — Consumer Rights Act, Omnibus Directive, FTC Click-to-Cancel, Australian Consumer Law.
4. Each letter is Ed25519-signed with your local Konomi keypair (generated on device, private key never transmitted). The recipient can verify the letter came from you.
5. You copy, edit, decide. The tool drafts. You press send.

## What it does NOT do

- Never sends letters on your behalf (agency stays with you · the tool assists)
- Never uploads your data anywhere
- Never asks for your bank login
- Never gives legal or financial advice (it drafts; you decide; consider a professional for amounts above a few hundred pounds/dollars)
- Never costs money · forever · MIT licence

## How disruptive is this?

Average household overpayment from extraction-economy practices:
- **UK**: £600–£2,000/year per household
- **US**: $1,000–$3,000/year per household

If FallBack reaches 5% of UK households, that's **~£840M/year returned from corporate balance sheets back to people**. If it reaches 5% of US households, that's **~$9.75B/year**. Those numbers move the dial in a way most "AI for good" projects don't.

## Letter templates included (v0.1)

| Pattern type | Jurisdictions |
|---|---|
| Subscription cancellation | UK · EU · US · AU |
| Bank fee refund request | UK · EU · US · AU |
| Price hike dispute | UK · EU · US · AU |
| GDPR / CCPA / Privacy Act DSAR | UK · EU · US · AU |
| Generic account review | All |

Each letter cites the real legislation:
- **UK** · Consumer Rights Act 2015, Consumer Contracts Regs 2013, FCA Consumer Duty (PRIN 2A), CMA169 (2023 subscription guidance), UK GDPR Article 15
- **EU** · CRD 2011/83/EU as amended by Omnibus 2019/2161, Payment Accounts Directive 2014/92, PSD2, GDPR
- **US** · FTC Click-to-Cancel (16 CFR Part 425, 2024), Fair Credit Billing Act, CFPB enforcement, CCPA/CPRA
- **AU** · Australian Consumer Law (Sch 2, CCA 2010), ASIC RG165, Privacy Act 1988, APP 12

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  index.html · single file · sovereign · MIT             │
│                                                         │
│  ├── PDF.js (lazy CDN load) ─── parse PDF statements    │
│  ├── CSV parser (native)     ─── parse CSV exports      │
│  ├── Pattern engine (heuristic + 70+ known vendors)     │
│  │     ├── recurring same-amount detection              │
│  │     ├── bank fee regex catalogue                     │
│  │     ├── price hike (median vs max)                   │
│  │     └── duplicate-category detection                 │
│  ├── Letter template library (UK/EU/US/AU)              │
│  ├── Web Crypto Ed25519 (Konomi signing)                │
│  ├── IndexedDB persistence (findings + letters + audit) │
│  ├── prevHash audit chain (every action signed)         │
│  └── nas-shim integration (NiceAssOS fork-aware)        │
│                                                         │
│  Optional: WebLLM Llama-3.2-3B for smart enrichment     │
└─────────────────────────────────────────────────────────┘
```

## Run locally / fork it

```bash
git clone https://github.com/sjgant80-hub/fallback.git
cd fallback
# open index.html in any modern browser · works from file://
```

Or fork it on GitHub and enable Pages. No build step, no dependencies, no API keys required.

## Privacy

- All parsing happens in your browser. PDF.js and Web Crypto run on-device.
- Statements never leave your device. There is no server endpoint to leak to.
- Verify this yourself: open DevTools → Network tab, drop a statement, watch nothing happen.
- If FallBack detects a NiceAssOS fork via `nas-shim`, anonymised summary metrics (count of findings, not content) may be ingested to your own local cube — but only locally, on your device.
- Konomi private key is non-extractable in Web Crypto (browser-enforced).

## Licence

MIT. Forever. Fork it. Modify it. Sell a service built on it. Just don't paywall the core tool — the whole point is the loop breaks the extraction.

## Estate context

FallBack is part of the [AI Native Solutions estate](https://ai-nativesolutions.com) · a sovereign substrate of 140+ MIT-licensed tools, each one a single-file wedge against a corporate SaaS rent-extraction pattern.

Architectural lineage: [Thomas Frumkin's MianoCube](https://github.com/teslasolar/MianoCube) — the on-device cube memory pattern that makes this whole substrate run without a server.

Sister organs you may also want:
- **[GroundLevel](https://sjgant80-hub.github.io/groundlevel/)** · sovereign UK legal research + 50+ letter templates + AI weave engine
- **[ExitEngine](https://sjgant80-hub.github.io/exitengine/)** · sovereign business OS for people who just got laid off
- **[Botler](https://sjgant80-hub.github.io/botler/)** · personal on-device AI assistant · WebLLM + OAuth
- **[FallList](https://sjgant80-hub.github.io/falllist/)** · sovereign email list manager · obsoletes Mailchimp

## Doctrine

> "An agent with agency means you have none." — Thomas Frumkin

FallBack is built on a sovereignty rule: the tool assists, you decide. It draws no letters in your name without showing you. It sends no letters without you pressing the button. It records no provenance you cannot inspect. It owns no data it has not let you export.

> "For the people. Not the few."

---

*prime 1307 · ◊·κ=φ⁴ · MIT · sovereign · single-file · forever*
