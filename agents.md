# AGENTS.md

## 1. Model Selection Gate

- Before planning, investigation, implementation, review, debugging, testing, or any other task activity, assess the task's complexity, ambiguity, risk, context size, and reasoning requirements.
- Determine whether the currently selected model and reasoning level are appropriate for the task.
- Prefer the fastest and least expensive model or reasoning level that can reliably complete the task without materially reducing correctness, safety, or implementation quality.
- If another available model or reasoning level would materially improve correctness, reliability, context handling, architectural reasoning, debugging capability, or efficiency, recommend the change before starting the task and briefly explain why.
- Do not recommend changing models when the current model is already appropriate.
- Model selection assessment is read-only and does not count as planning, investigation, or implementation.
- Never claim that a model change occurred unless the environment explicitly confirms it.
- If the environment does not allow the agent to change models directly, recommend the appropriate model or reasoning level to the user instead of assuming the change.
- After the model assessment, continue under the normal investigation, planning, approval, and implementation rules.

### Model Selection Heuristic

Use the following categories as guidance rather than rigid thresholds.

#### Low Complexity

Typical examples:

- Small text or configuration corrections.
- Localized renames.
- Simple styling adjustments.
- Small queries or isolated logic changes.
- Straightforward repository navigation.

Prefer a fast model with low or standard reasoning when it can perform the task reliably.

#### Moderate Complexity

Typical examples:

- Localized bug fixes.
- API endpoint changes.
- Component or service implementation.
- SQL involving multiple joins or business rules.
- Focused refactors.
- Integration with an existing repository pattern.
- Debugging involving several directly related files.

Prefer a balanced model with standard or medium reasoning.

#### High Complexity

Typical examples:

- Architectural decisions.
- Cross-layer or cross-service changes.
- Concurrency or race conditions.
- Security-sensitive changes.
- Performance investigations.
- Complex migrations.
- Large or risky refactors.
- Distributed-system behavior.
- Problems requiring broad repository understanding.

Prefer a strong reasoning model or higher reasoning level.

---

## 2. Core Engineering Principles

- Reuse existing code, patterns, utilities, abstractions, and dependencies before creating new ones.
- Make the smallest change that fully solves the approved requirement.
- Do not add features, abstractions, dependencies, refactors, or cleanup outside the requested and approved scope.
- Keep changes atomic, focused, reviewable, testable, and easy to revert.
- Preserve existing behavior unless the approved requirement explicitly requires changing it.
- Follow the repository's existing architecture, naming, formatting, conventions, and established patterns.
- Prefer simple, readable, explicit solutions over clever, overly generic, or speculative abstractions.
- Apply KISS and YAGNI. Do not design for hypothetical requirements that are not part of the current task.
- Keep functions, classes, modules, and components focused on a clear responsibility.
- Remove code made unused directly by the approved change, but do not perform unrelated cleanup.
- Use meaningful names.
- Avoid comments that merely restate what the code does.
- Comment non-obvious business rules, constraints, invariants, compatibility requirements, or architectural decisions when the code alone cannot communicate them clearly.
- Do not leave commented-out implementation code in the repository.

---

## 3. Investigation and Context Management

- Read only the files required to understand and complete the current task reliably.
- Start with the file, component, module, error, endpoint, or symbol directly referenced by the request.
- Search incrementally.
- Follow direct dependencies first and expand the investigation only when evidence shows additional context is necessary.
- Prefer targeted searches for symbols, references, call sites, imports, types, routes, tests, configuration keys, and related identifiers instead of browsing directories broadly.
- Read only relevant sections of large files when the available tooling supports targeted reads.
- Do not reread files already inspected unless:
  - the file changed;
  - new evidence requires reevaluation;
  - a previously unseen interaction becomes relevant.
- Limit investigation to one likely path at a time and expand only when evidence disproves the current hypothesis.
- Stop investigating once enough evidence exists to produce a reliable plan or complete the approved implementation.
- Prefer repository tools, static analysis, tests, type checkers, linters, logs, and runtime evidence over manually guessing generated behavior.
- Summarize large command outputs, logs, stack traces, and test results instead of reproducing them verbatim.

---

## 4. Requirements and Ambiguity

- Ask questions only when missing information materially blocks a safe, correct, or scope-compliant implementation.
- Ask the minimum number of concise questions required to unblock the task, preferably one at a time.
- Do not ask for information that can be determined safely from the repository, tests, schemas, documentation, configuration, or existing implementation.
- Do not guess business rules, destructive behavior, public contracts, security requirements, or architectural intent when multiple materially different interpretations remain plausible.
- For small, localized, and unambiguous tasks, do not produce unnecessary planning overhead beyond what is required by the Mandatory Approval Gate.

---

## 5. Source of Truth and Conflict Resolution

Treat repository evidence according to its authority and relevance to the current task.

A useful default order is:

1. Explicit current user requirement.
2. Explicitly approved implementation plan.
3. Formal external or repository contracts, including:

   - API specifications;
   - schemas;
   - protocol definitions;
   - architecture decision records;
   - documented invariants;
   - compatibility requirements.

4. Existing tests.
5. Existing implementation.
6. Informal comments, examples, or outdated documentation.

This order is guidance, not permission to silently override contradictions.

- When two authoritative sources materially conflict, identify the conflict instead of silently choosing one.
- Do not change production behavior merely because an implementation differs from an informal example.
- Do not change tests merely because production code currently fails them.

- Explicitly surface conflicts that affect:
  - observable behavior;
  - public interfaces;
  - data compatibility;
  - security;
  - persistence;
  - architecture;
  - approved scope.

---

## 6. Architecture and Dependency Boundaries

- Preserve the repository's established architectural boundaries.
- Place logic in the layer or module responsible for that concern.
- Keep domain or Core logic independent from UI frameworks, databases, transport protocols, persistence implementations, infrastructure libraries, and framework-specific concerns unless the repository's established architecture explicitly defines otherwise.
- Dependencies should point toward more stable business rules rather than forcing business rules to depend on implementation details.
- Do not bypass established layers merely because doing so produces a shorter implementation.
- Do not move business logic into controllers, UI components, database adapters, route handlers, or infrastructure code when an appropriate domain or application layer exists.
- Do not introduce a new architectural pattern, layer, service boundary, repository abstraction, event system, queue, cache, persistence mechanism, framework, or integration style unless the existing architecture cannot reasonably satisfy the approved requirement.

- Any new architectural mechanism must be explicitly justified during planning with:
  - the problem it solves;
  - why the existing architecture is insufficient;
  - the added complexity;
  - the affected boundaries;
  - operational consequences;
  - testing implications.

- Prefer extending an established architectural pattern over introducing a competing one.

---

## 7. Scope and Change Control

- Modify only the files and behavior necessary for the approved requirement.
- Do not perform opportunistic refactors.
- Do not combine functional changes with unrelated formatting, cleanup, dependency upgrades, or architectural restructuring.
- Do not rewrite an entire file when a localized change is sufficient.
- Avoid multiple implementation alternatives once a safe and appropriate approach is established.
- If the requested approach is unsafe, architecturally incompatible, or infeasible, explain the issue and propose the smallest viable alternative.
- Once acceptance criteria are met and validation is sufficient for the change's risk and blast radius, stop.

---

## 8. Type Safety and Error Handling

### TypeScript

- Do not use `any`.
- Prefer explicit types whenever practical.
- Use `unknown` for untrusted or structurally uncertain data and validate or narrow it before use.
- Preserve or improve existing type guarantees when modifying code.
- Do not weaken types merely to satisfy the compiler.

### Errors

- Prefer explicit exceptions, typed errors, discriminated unions, result types, or another repository-established error mechanism over silent failure.
- Avoid ambiguous `null`, `undefined`, boolean flags, or empty values when they cannot clearly communicate failure semantics.
- Preserve established error contracts unless an approved requirement changes them.
- Do not swallow errors without an explicit and justified reason.

---

## 9. Tests as Behavioral Evidence

- Treat existing tests as strong evidence of the current behavioral contract.
- Prefer changing production code to satisfy valid existing tests when the approved requirement does not change that behavior.
- Do not modify tests merely to make a failing implementation pass.
- Tests may be incorrect, outdated, flaky, overly coupled to implementation details, or inconsistent with a more authoritative contract.

- If a test conflicts with:
  - an explicit approved requirement;
  - an API or schema contract;
  - a documented invariant;
  - verified expected behavior;

  identify the conflict before changing either the test or production code.

- When approved behavior changes, update or add tests that represent the new contract.
- Prefer tests that verify externally meaningful behavior rather than unnecessary implementation details.

---

## 10. Validation Strategy

- Start with the narrowest validation relevant to the changed behavior.
- Expand validation according to the dependency impact, architectural importance, and blast radius of the change.

A typical progression is:

1. Targeted test for the changed behavior.
2. Tests for the changed module or package.
3. Relevant type checks or static analysis.
4. Relevant linting.
5. Tests for directly affected consumers.
6. Broader regression tests when the dependency impact justifies them.

- A localized change does not automatically require the entire repository test suite.
- A change to widely shared code, public contracts, schemas, Core logic, authentication, persistence, infrastructure, or cross-cutting utilities may require broader validation.
- Run only checks that are relevant to establishing confidence in the approved change.
- Do not claim that a command, test, lint, build, migration, or validation passed unless it was actually executed successfully.
- If a validation step cannot be executed, state that clearly and report the resulting residual risk.

---

## 11. Destructive and High-Risk Operations

Treat the following as high-risk operations:

- database writes against shared or production environments;
- destructive migrations;
- schema deletion or irreversible transformation;
- data deletion;
- infrastructure changes;
- deployments;
- production configuration changes;
- credential or secret changes;
- permission or access-control changes;
- dependency upgrades with material compatibility impact;
- force pushes or destructive Git operations;
- external API actions with irreversible effects.
- Do not execute a high-risk or destructive operation unless it is explicitly included in the approved implementation plan.
- Prefer reversible and idempotent operations when possible.
- When an operation has meaningful rollback requirements, include the rollback strategy in the plan.
- Never imply that a destructive operation is safe solely because the command itself succeeds.

---

## 12. Mandatory Approval Gate

### Read-Only Phase

- Never modify code, files, dependencies, configurations, schemas, tests, data, infrastructure, or external systems before explicit approval.
- Before implementation, inspect only the context required to produce a reliable plan.
- Planning, investigation, analysis, code examples, proposed code, and proposed diffs are read-only activities and do not authorize file changes.

### Required Plan

Before implementation, present a concise but complete implementation plan containing:

- problem or root cause;
- proposed solution;
- rationale;
- affected files;
- step-by-step changes;
- architectural impact, when relevant;
- risks;
- validation strategy;
- exact code, patch, or diff to be applied when practical.

For large changes, the proposed diff may be represented by precise code sections or file-level modifications when a literal full diff would create unnecessary noise.

### Authorization

Wait for the exact authorization:

`planejamento aprovado, pode implementar`

Do not treat responses such as:

- `ok`
- `certo`
- `continue`
- `pode seguir`
- `parece bom`
- `entendi`

or similar messages as implementation approval.

### Implementation

After approval:

- Implement only the approved scope, files, behavior, and steps.
- Do not repeat the full plan before implementation.
- Do not include unrelated refactors, cleanup, features, abstractions, or dependency changes.
- If implementation reveals that a material change to the approved plan is required, stop before making that change and request approval for the revised plan.

A material change includes changes to:

- scope;
- observable behavior;
- architecture;
- affected files outside the approved set;
- dependencies;
- public interfaces;
- schemas;
- persistence;
- security;
- tests representing a changed behavioral contract;
- high-risk operations.

Mechanical or non-semantic changes inside approved files generally do not require reapproval, including:

- formatter output;
- import ordering;
- equivalent whitespace changes;
- generated syntax adjustments required by repository tooling.

---

## 13. Implementation Discipline

- Implement the approved solution directly.
- Prefer localized edits.
- Preserve nearby conventions.
- Avoid speculative improvements.
- Keep newly introduced functions and modules no broader than required.
- Do not output unchanged code or full files unless requested.
- Do not introduce TODOs for work that is required to satisfy the approved acceptance criteria.
- Do not leave the repository in an intentionally intermediate state unless the approved plan explicitly defines incremental steps.

---

## 14. Completion Criteria

A task is complete when:

- the approved requirement is implemented;
- acceptance criteria are satisfied;
- architectural boundaries remain valid;
- relevant validation has passed or unresolved validation limitations are reported;
- no known implementation work remains inside the approved scope.

Once these conditions are met, stop.
Do not continue with optional improvements unless the user explicitly requests another task.

---

## 15. Final Response

After implementation, report only information useful for review.

Include:

### Cause

The root cause or reason for the change, when applicable.

### Changed Files

The files changed and the purpose of each change.

### Validation

The tests, type checks, linters, builds, or other validations actually executed and their results.

### Remaining Risks

Known limitations, validation gaps, assumptions, migration concerns, or residual risks.
Do not:

- restate the original request;
- repeat the approved plan;
- reproduce large diffs;
- output unchanged code;
- include long explanations unless specifically requested.
