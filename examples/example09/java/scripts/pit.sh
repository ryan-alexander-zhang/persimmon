#!/bin/sh
# PIT over the changed source files persimmon passes, one argument each, as the class names PIT targets.
classes=$(for f in "$@"; do echo "$f"; done | sed -e 's#^src/main/java/##' -e 's#\.java$##' -e 's#/#.#g' | paste -sd, -)
exec mvn -q test-compile org.pitest:pitest-maven:mutationCoverage -DtargetClasses="$classes"
