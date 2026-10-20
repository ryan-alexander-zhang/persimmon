#!/bin/sh
# Starts the app, runs the Bruno collection with its JUnit reporter, stops the app.
go build -o bin/server ./cmd/server || exit 1
bin/server 3994 & app=$!
sleep 1
(cd api && bru run --env ci --reporter-junit ../junit-api.xml); code=$?
kill $app
exit $code
