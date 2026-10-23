# Scaffold

status: draft · layer: cross-cutting (`08-store.md` verbs, `20-pack.md` init) · schema: none

A Scaffold is a complete, buildable project for one language and one framework, kept in that
framework's own repository and copied by `persimmon new`. The verb copies it, renames its Maven
coordinates and root package to the developer's, then runs `persimmon init` inside it, so one
command yields a project whose code and SDLC pack are both in place. A Scaffold is a modular
monolith: one sample bounded context beside an empty context template, and `persimmon new
--context <name>` adds a context to a project made so.

```text
developer: persimmon new <dir> --lang java --framework ddd [--group <groupId>] [--from <path>]
  ─▶ the Scaffold for (lang, framework) from the registry: a git repository and a path inside it
       `--from <path>`: a local directory holding the Scaffold's files instead (development, offline)
  ─▶ every file copied into <dir>, `target/` and `.git/` left out
       the Scaffold's groupId      → --group, default com.example
       the Scaffold's artifactId   → basename of <dir> (so <artifactId>-start follows)
       the Scaffold's root package → <group>.<artifact with non-alphanumerics removed>, directories moved to match
       the context template directory is not copied; the sample context keeps its name
  ─▶ persimmon init in <dir>: .persimmon/, persimmon.yaml, the SDLC pack, AGENTS.md

developer, inside such a project: persimmon new --context <name> [--from <path>]
  ─▶ the Scaffold's context template copied to <name>/: __context__ → <name>, __group__, __artifact__
       and __package__ → the project's own, read from pom.xml and start/**/Application.java
  ─▶ <module><name></module> before the `<!-- contexts -->` marker of pom.xml; <name>-infrastructure and
       <name>-adapter as dependencies before the same marker in start/pom.xml
```

## Registry

| `--lang` | `--framework` | Repository | Path | groupId | artifactId | root package | context template |
|---|---|---|---|---|---|---|---|
| `java` | `ddd` | `https://github.com/ryan-alexander-zhang/persimmon-java-ddd.git` | `scaffold` | `com.example` | `example-app` | `com.example.app` | `_context` |

The Java DDD Scaffold: `ordering/` holds the sample context as five modules (`ordering-domain`,
`-api`, `-application`, `-infrastructure`, `-adapter`), `start/` the deployable, `_context/` the
empty context with `__context__`, `__group__`, `__artifact__` and `__package__` placeholders.

The registry is a table in `src/cli/new.ts`; a Scaffold's coordinates are the strings `new`
replaces, so a Scaffold repository changes them only together with this table.

## Rules

| Rule | Where |
|---|---|
| an unknown `--lang`/`--framework` pair is refused with the known pairs listed; both flags are required | `persimmon new` |
| `<dir>` must not exist or must be empty; nothing is written otherwise | `persimmon new` |
| `--group` is a Java package name (`[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*`); the artifactId is `<dir>`'s basename and must match `[a-z0-9][a-z0-9-]*` | `persimmon new` |
| replacement is textual, longest string first (package, group, artifactId), in every copied file; a file under the Scaffold's package directory moves to the new package directory | `persimmon new` |
| the sample bounded context (`ordering` as a package segment and module prefix, its classes and tables) is kept: it is the developer's to rewrite, and the ArchUnit and flow tests keep passing on the renamed copy; one module per layer, so the module graph enforces the layer and context dependencies at compile time | `persimmon new` |
| `--context <name>`: `name` matches `[a-z][a-z0-9]*`; the project must carry the `<!-- contexts -->` marker in `pom.xml` and `start/pom.xml` and have no `<name>/` yet; nothing is written otherwise; `--lang` and `--framework` default to `java` and `ddd` | `persimmon new --context` |
| without `--from`, the repository is cloned with `git clone --depth 1` into a temporary directory that is removed afterwards; no git on the PATH or no network is reported as such | `persimmon new` |
| `init` runs with the new directory as its project directory, after the copy succeeded | `persimmon new` |

## Decisions

- A new verb, not `persimmon create`: `create` stores a revisioned Resource (`05-revisioned-kind.md`)
  and the design documents use the word that way throughout; overloading it on flags would give one
  verb two unrelated meanings.
- The Scaffold lives in the framework's repository, not under `packs/`: it is built and tested with
  that framework's modules on every change there, and a pack's `files/` is copied verbatim, with no
  renaming. The registry in the binary is the one coupling.
- Only coordinates are renamed. Renaming the sample domain (`Order`, `ordering`) would need a
  model of Java identifiers for little gain; a developer replaces the sample context with theirs.
- A second context comes from a template with placeholders, not from the sample: a sample copied
  under a new name would carry `Order` into `inventory`. The template holds the five poms and a
  `package-info` per layer, so the module graph exists before the first class.
- Two comment markers in the poms are the registration points. A pom parser would be heavier and
  would reformat the developer's file; a developer who removes the markers adds contexts by hand.
