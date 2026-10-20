#!/bin/sh
# Starts the app, runs the Bruno collection with its JUnit reporter, stops the app.
mvn -q compile || exit 1
java -cp target/classes claims.Server 3996 & app=$!
sleep 1
(cd api && bru run --env ci --reporter-junit ../target/junit-api.xml); code=$?
kill $app
exit $code
