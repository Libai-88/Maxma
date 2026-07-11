# Maxma Capability Matrix

This is the execution index for reference designs in `FIND.md`. `PLAN-1.md`
defines the order; this document gives every item one owner and one delivery
phase, preventing duplicate persistence, event, or security work.

## Rules

- New behaviour is off by default and needs focused disabled and enabled tests.
- Persistent work follows the LTM outbox identity/lease/fencing rules or an
  equivalent documented contract.
- API and browser events use `api.runtime_status`; they do not contain keys,
  authorization values, raw upstream stacks, or sensitive URL query values.

## Delivered and Protected

| FIND IDs | Capability group | Owner | State |
| --- | --- | --- | --- |
| 1-3, 5, 7-13, 17-18 | Startup, lifecycle, event, transcript, stream, memory, provider foundations | platform/agent/api | protected |
| F1-F10 | Theme, motion, Markdown, tool bubbles, plan, layout, errors, stickers, workbench | web | protected |
| 4, 6, 14-16 | Credential masking, scheduler, approval, delegation, MCP foundations | api/agent/tools | partial |

## Planned Reference Designs

| FIND IDs | Design group | Phase | Gate | Owner |
| --- | --- | --- | --- | --- |
| A1-A2 | Credential envelope and recovery | 1.3 | OS-backed key source required | api/security |
| A3-A4 | Scheduler anchor grid and stuck-job recovery | 1 | scheduler rollout | agent/autonomy |
| A5 | Renderer crash recovery | 1 | desktop smoke test | desktop |
| A6 | Mid-turn message injection | 4 | event contract | agent/api |
| A7 | MCP telemetry redaction | 1.4 | lifecycle flag | tools/mcp |
| B1, C8, O3 | Deferred sub-agent execution and isolated streams | 2 | `async_subagent_enabled` | tools/sub_agent |
| B2, O8 | Permission modes and approval escalation | 2 | `permission_modes_enabled` | agent/api/web |
| B3 | Cache-preserving compaction | 3 | `cache_preserving_compaction_enabled` | agent/api |
| B4-B5 | Memory ticker and FactStore hybrid retrieval | 3 | `memory_ticker_enabled` | memory |
| B6 | Application and Windows process sandbox | 1.5 | restricted-process flag | tools/system |
| B7, B10-B11 | Hub, remote lease and IM bridge | out of scope | explicit product consumer | product |
| B8, C4, A3 | Provider/role routing and ThinkPath | 6 | separate flags | agent/api/web |
| B9, O10 | Durable workflow and layered view | 5 | `workflow_enabled` | tools/api/web |
| B12 | Decorrelated jitter retry | 1.1 | `ltm_retry_policy_enabled` | memory |
| C1-C2, O4-O5, A1-A2 | Registered interactive artifacts and confirmations | 5 | `interactive_artifacts_enabled` | api/web |
| C3 | Heuristic fallback when LLM is unavailable | 1 | component test | agent/tools |
| C5-C7, O9 | Limited autonomy, audit, activity grouping | 6 | `autonomy_*` remains off | agent/api/web |
| H1-H2, O1-O2, H4-H5, H7, A5-A7 | Chat performance, summaries, errors, shortcuts, loading | 4 | compact/cache flags | web |
| H3, O11 | Pulse and onboarding | 4 | `onboarding_enabled` | web/api |
| H6, O6-O7, O12, A4 | Canvas, mood/note, texture, visual refinements | 5 / review | independently gated | web |

## Feature Flag Trial Matrix

| Flag | Default | Owner | Disabled proof | Enabled proof | Rollback signal |
| --- | --- | --- | --- | --- | --- |
| `stream_repair_enabled` | false | agent/stream_repair | original response | repair pipeline tests | malformed stream regression |
| `coordinator_enabled` | false | agent/graph | planner entry remains | coordinator tests | latency/route regression |
| `verifier_enabled` | false | agent/graph | direct end route | verifier retry tests | duplicate/slow reply |
| `delegation_scope_enforced` | false | tools/sub_agent | original tools preserved | scope intersection tests | unexpected denial |
| `crag_enabled` | false | memory/kb | normal retrieval | correction tests | relevance/latency regression |
| `autonomy_enabled` | false | agent/autonomy | scheduler absent | scheduler E2E | unbounded work |
| `autonomy_self_improve_enabled` | false | agent/autonomy | no skill mutation | allowlist tests | unreviewed file change |

Manual trial order is stream repair, then coordinator, then verifier. Only one
high-risk flag is on in a trial; `autonomy_*` remains off until phase 6.
