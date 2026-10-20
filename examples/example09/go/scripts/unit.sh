#!/bin/sh
# The unit tests as JUnit XML, and their coverage as Cobertura XML.
gotestsum --junitfile junit.xml -- -coverprofile=cover.out ./claims/...; code=$?
[ -f cover.out ] && gocover-cobertura < cover.out > coverage.xml
exit $code
