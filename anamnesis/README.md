# ANAMNESIS OS · Build 001

A local-first, iPad-first narrative engineering workstation for Mainframe 58.
Plain HTML + ES modules. No dependencies, no build step, no network calls, no AI calls.

## Run

```sh
cd anamnesis
python3 -m http.server 8058 --bind 127.0.0.1   # then open http://127.0.0.1:8058/
npm test                                        # 15 core unit tests (node --test)
npm run smoke                                   # 24 browser checks at iPad Pro 11 size (needs Playwright + the server)
```

ES modules need an HTTP origin; opening `index.html` from `file://` will not work.

## Modules

| Module | What works in Build 001 |
|---|---|
| Library | Manuscripts/references with text, tags; jump to Analyzer |
| Research Inbox | Structured findings: source, URL, claim, excerpt, notes, evidence status, triage (NEW/TRIAGED/FILED/REJECTED), links to entities |
| Analyzer | Words, sentences, Flesch, dialogue %, question %, dread-lexicon tension per paragraph, top words, character mentions |
| Characters | Big Five traits, 8 weighted values, goals, fears, beliefs, memory traces with ACT-R activation; **Decision Lab** |
| Worlds | Summary, rules, places, residents |
| Plots | Beats with characters, themes, tension; reorder; tension arc |
| Themes | Statement, dramatic question, motifs; which beats carry it |
| Simulator | Run one situation across a cast; records every decision trace; divergence label; run history |
| Intelligence | Counts, health checks (broken links, untriaged research, unverified decisions…), evidence mix, notes, event log |
| Terminal | `help`, `ls`, `show`, `new`, `decide … --record`, `analyze`, `triage`, `intel`, `log`, `go`, `export` |

## Architecture

- **Append-only event log** (`js/core/store.mjs`) is the single source of truth. State is a pure replay.
  Nothing is edited in place; archive is a tombstone; invalid events are recorded as rejected, never thrown.
- **Persistence** (`js/core/db.mjs`): one IndexedDB database `anamnesis-os`, store `events` keyed by `seq`,
  `add()` only (no silent overwrite). Memory fallback is announced loudly. Export/Import of the full log as JSON
  (`anamnesis-os-export-v1`), with sequence-gap checks on import.
- **Inspectable decisions** (`js/core/cognition.mjs`): each option's score is a sum of named terms
  (value, goal, fear, trait, memory, noise), each with a written reason. Noise is a hashed deterministic draw.
  Every decision stores its full inputs and a digest; **Verify by replay** recomputes and must match.
  Status: *simulation technique*, not a validated psychological model.
- **Memory activation**: ACT-R base-level `ln Σ t^-0.5` + cue overlap; recall is logged as a rehearsal event.
- Evidence labels follow NUE-CR-001: Established, Supported, Contested, Simulation technique, Fictional license.

Isolated from the reader prototype in the repository root; nothing outside `anamnesis/` is changed.
