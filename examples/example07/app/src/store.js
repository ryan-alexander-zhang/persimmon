// The Room Schedule's one transactional relational store (BB-1), on node:sqlite: the tables of the
// data-schema Design that Book a Room needs. Limits live in booking_limit_config, read on every command.
import { DatabaseSync } from 'node:sqlite'

export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE room (
      id               TEXT    NOT NULL PRIMARY KEY,
      seating_capacity INTEGER NOT NULL CHECK (seating_capacity > 0),
      video_capability INTEGER NOT NULL
    );
    CREATE TABLE booking (
      id             TEXT    NOT NULL PRIMARY KEY,
      room_id        TEXT    NOT NULL REFERENCES room (id),
      owner          TEXT    NOT NULL,
      date           TEXT    NOT NULL,
      created_date   TEXT    NOT NULL,
      start_time     TEXT    NOT NULL,
      end_time       TEXT    NOT NULL,
      attendee_count INTEGER NOT NULL CHECK (attendee_count > 0),
      video_need     INTEGER NOT NULL,
      CHECK (end_time > start_time)
    );
    CREATE TABLE booking_limit_config (
      id                        INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      slot_granularity_minutes  INTEGER NOT NULL DEFAULT 15,
      booking_window_start_time TEXT    NOT NULL DEFAULT '08:00',
      booking_window_end_time   TEXT    NOT NULL DEFAULT '20:00',
      max_duration_minutes      INTEGER NOT NULL DEFAULT 240,
      max_advance_days          INTEGER NOT NULL DEFAULT 30
    );
    INSERT INTO booking_limit_config (id) VALUES (1);
  `)
  return db
}

export function addRoom(db, { id, seatingCapacity, videoCapability }) {
  db.prepare('INSERT INTO room (id, seating_capacity, video_capability) VALUES (?, ?, ?)').run(id, seatingCapacity, videoCapability ? 1 : 0)
}
