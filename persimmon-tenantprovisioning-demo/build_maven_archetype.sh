#!/usr/bin/env bash
set -euo pipefail

mvn archetype:create-from-project -Darchetype.properties=./archetype.properties

mvn -f ./target/generated-sources/archetype/pom.xml install