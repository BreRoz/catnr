---
name: catnr_foundation
description: Foundational product guardrails and engineering rules for the catnr site (Ari Rescue Assistant, an AI-powered cat TNR/rescue management tool). Reference this before making ANY change to the site — features, schema, APIs, AI behavior, UI, or fixes.
---

# Master Build Instructions
## Ari Rescue Assistant — Production Build

You are working on an existing MVP for an AI-powered cat TNR/rescue management tool.

The MVP already exists and is functional enough to inspect and extend. Your job is to turn it into a secure, reliable, production-ready tool that Ari can actually use every day.

Do NOT rebuild the application from scratch unless a specific architectural problem requires it.

First inspect the existing codebase, database schema, migrations, tests, configuration, and application structure before making changes.

## Product principle

The primary user is Ari.

Ari is a highly active TNR/rescue volunteer who is frequently:

- driving
- transporting cats
- visiting vets
- picking up cats
- coordinating fosters
- talking with adopters
- collecting donations
- purchasing supplies

She should be able to use the application primarily through voice, photos, and natural language.

Do not turn this into a traditional shelter-management application requiring forms and data entry.

The product should feel like:

"I tell the rescue what happened, and it remembers."

The application must remain useful even when AI functionality is unavailable.

## Important development rule

You will receive implementation work in numbered stages.

ONLY work on the current stage.

Do not implement future stages unless a dependency makes a tiny change absolutely necessary.

Before modifying anything:

1. Inspect the existing implementation.
2. Identify relevant files, tables, migrations, APIs, and tests.
3. Explain your proposed approach briefly.
4. Implement the current stage.
5. Run appropriate tests/checks.
6. Inspect the resulting code/database behavior.
7. Fix failures.
8. Report exactly what changed.
9. Report tests/checks run and their results.
10. Report any remaining risks or limitations.

Then STOP.

Do not automatically continue to the next stage.

Do not declare something "production-ready" merely because the code compiles.

## Non-negotiable engineering principles

### Security

- Never trust client-supplied ownership IDs.
- Never allow an unauthenticated request to access or modify rescue data.
- Never rely solely on application-level authorization when database-level enforcement is appropriate.

### Data integrity

- Prefer atomic database operations.
- Do not leave partial records after failed operations.
- Never silently destroy historical data.
- Never silently overwrite important records.

### AI safety

- Treat LLM/provider output as untrusted input.
- Validate every AI operation before applying it.
- The AI must never directly execute arbitrary database operations.
- Questions must never mutate records.
- Ambiguous or consequential operations should require clarification or review.

### Auditability

Preserve enough history to understand:

- what Ari originally said
- what the AI interpreted
- what records were changed
- when they changed
- who/what made the change

### User experience

- Ari should not need to understand the database.
- Ari should not need to understand internal IDs.
- Ari should be able to recover gracefully from errors.
- Never discard unsaved user input unnecessarily.

### Maintainability

- Do not keep compressing the application into giant files.
- Use clear components/modules.
- Use migrations for schema changes.
- Do not create or alter database tables dynamically during normal user requests.

## Core product data

The system tracks:

### Cats

- permanent internal ID
- optional name
- sex
- age class
- appearance
- distinguishing characteristics
- health observations
- reproductive significance
- origin/colony
- current status
- current location
- microchip if available
- historical events
- photos

### Colonies/locations

- name
- general location
- geographic information where appropriate
- notes
- status

### Events

Examples:

- first seen
- captured
- transport
- vet visit
- spay
- neuter
- vaccination
- testing
- medication
- illness
- injury
- foster
- adoption interest
- application
- meet and greet
- adoption
- return to colony
- lost
- deceased

### People

Examples:

- donor
- adopter
- foster
- volunteer
- veterinarian

### Financial/resource transactions

Track both money and in-kind resources.

Examples:

- Sarah Yunker donated $100.
- $129 came from a collection at Harrington's Market.
- We made $300 selling stickers.
- Sarah Yunker donated two 12-pound bags of Friskies.
- I spent $45 on brand stickers.

Transactions should distinguish:

- cash inflow
- cash outflow
- in-kind donation
- fundraiser/merchandise income
- operating expense

Do not treat this as formal accounting or tax software.

The purpose is operational visibility:

resources received → resources spent → cats helped → outcomes

### Photos

Photos should be first-class records and associated with cats/events where appropriate.

### AI input/audit records

Preserve original voice/photo input and the resulting AI interpretation.

## Required implementation order

Implement the stages in exactly the order the user gives them, one stage at a time.
