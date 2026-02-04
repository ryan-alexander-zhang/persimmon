# Skill Variables (Archetype-safe)

This scaffold is intended to be packaged as a Maven archetype. After generation:
- Maven module directory names will change (project-specific prefix), but **module suffixes remain**:
  - `*-domain`, `*-app`, `*-infra`, `*-adapter`, `*-start`
- Java root package will change (e.g., `com.acme.foo` instead of this scaffold's default).

To keep skills reusable, generator skills MUST use the variables below instead of hard-coded paths or packages.

## Module directories
These variables refer to the **module root directory** (where the module `pom.xml` lives).

- `{{domainModuleDir}}`: module with `artifactId` ending in `-domain`
- `{{appModuleDir}}`: module with `artifactId` ending in `-app`
- `{{infraModuleDir}}`: module with `artifactId` ending in `-infra`
- `{{adapterModuleDir}}`: module with `artifactId` ending in `-adapter`
- `{{startModuleDir}}`: module with `artifactId` ending in `-start`

## Java package variables
- `{{basePackage}}`: Java root package (e.g., `com.acme.persimmon`)
- `{{basePackagePath}}`: filesystem path form (e.g., `com/acme/persimmon`)

## How to resolve variables (router behavior)
`scaffold-router` should resolve variables in this order:
1) If the user provides explicit module dirs / base package, use them.
2) Otherwise infer module dirs by scanning `pom.xml` `artifactId` suffixes.
3) Infer `{{basePackage}}` from `src/main/java/**/package-info.java` by finding the first `package ...;`
   and stripping the layer segment (`.domain`, `.app`, `.infra`, `.adapter`, `.start`).
4) If still ambiguous, ask **one** question: “What is the root package?”.
