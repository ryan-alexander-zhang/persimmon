import { beforeEach, describe, expect, it } from 'vitest'
import { addRoom, openStore } from '../src/store.js'
import { bookRoom, roomStatus } from '../src/room-schedule.js'

const now = { date: '2026-10-19', time: '09:00' }
const request = (over = {}) => ({ date: '2026-10-20', startTime: '10:00', endTime: '11:00', attendeeCount: 6, videoNeed: false, ...over })

describe('Book Room', () => {
  let db
  beforeEach(() => {
    db = openStore()
    addRoom(db, { id: 'room-a', seatingCapacity: 8, videoCapability: false })
  })

  it('books a fitting, free room (AC-1)', () => {
    expect(bookRoom(db, request(), { owner: 'priya', now }).booked).toMatchObject({ roomId: 'room-a', date: '2026-10-20', startTime: '10:00', endTime: '11:00', attendeeCount: 6 })
  })

  it('refuses a room too small (AC-2)', () => {
    expect(bookRoom(db, request({ attendeeCount: 9 }), { owner: 'priya', now }).refused.brokenRules).toEqual(['BR-1'])
  })

  it('refuses a slot off the 15-minute boundary (AC-4)', () => {
    expect(bookRoom(db, request({ startTime: '10:05' }), { owner: 'priya', now }).refused.brokenRules).toEqual(['BR-3'])
  })

  it('refuses a slot overlapping an active booking (BR-7)', () => {
    bookRoom(db, request(), { owner: 'priya', now })
    expect(bookRoom(db, request({ startTime: '10:30', endTime: '11:30' }), { owner: 'dev', now }).refused.brokenRules).toEqual(['BR-7'])
  })

  it('books a slot that starts when the last one ends (BR-7)', () => {
    bookRoom(db, request(), { owner: 'priya', now })
    expect(bookRoom(db, request({ startTime: '11:00', endTime: '12:00' }), { owner: 'dev', now }).booked).toMatchObject({ roomId: 'room-a', startTime: '11:00' })
  })
})

describe('Room Status View', () => {
  it('shows a booked room with its holder, and free once the booking ends', () => {
    const db = openStore()
    addRoom(db, { id: 'room-a', seatingCapacity: 8, videoCapability: false })
    bookRoom(db, request(), { owner: 'priya', now })
    expect(roomStatus(db, 'room-a', { date: '2026-10-20', time: '10:30' })).toEqual({ roomId: 'room-a', status: 'booked', holder: 'priya', heldUntil: '11:00' })
    expect(roomStatus(db, 'room-a', { date: '2026-10-20', time: '11:00' })).toEqual({ roomId: 'room-a', status: 'free' })
  })
})
