# Templates — Start YAML Config

## Rename key checklist
1) Update YAML: add new key, remove old key (if requested)
2) Update `@Value` / `@ConfigurationProperties` reads to new key
3) Update docs/requirements if they reference keys
4) Update any adapter annotations using placeholders (e.g., `@KafkaListener`)

## Reference YAML
- `persimmon-scaffold/persimmon-scaffold-start/src/main/resources/application.yaml`

