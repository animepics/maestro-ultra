# CLAUDE.md - Behavioral Guidelines for Coding

This document establishes principles to minimize common LLM coding errors, prioritizing thoughtfulness over speed for non-trivial work.

## 1. Think Before Coding

State assumptions explicitly rather than proceeding silently. When unclear:

- Present multiple interpretations - don't pick silently
- Surface tradeoffs and simpler alternatives
- Ask clarifying questions rather than guessing

## 2. Simplicity First

Deliver minimal code solving the stated problem without speculative additions:

- No unrequested features or premature abstractions
- No error handling for impossible scenarios
- Rewrite if your solution exceeds reasonable length

Self-check: Would an experienced engineer call this overcomplicated?

## 3. Surgical Changes

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting
- Match the existing style conventions
- Only remove code YOUR changes rendered unnecessary
- Flag pre-existing dead code without deleting it

Each modified line should directly serve the user's request.

## 4. Goal-Driven Execution

Convert tasks into verifiable outcomes with clear success criteria:

- "Add validation" becomes writing tests for invalid inputs, then passing them
- "Fix the bug" means reproducing it in a test first
- Multi-step work benefits from explicit plans with verification checkpoints

Strong success criteria enable independent progress; vague ones ("make it work") require repeated clarification.

---

**Effectiveness indicators:** fewer unnecessary diff changes, reduced rewrites from overengineering, and clarifying questions preceding implementation.
