// The Room Schedule aggregate (AG-1): Book Room and the Room Status View. Times are 'HH:MM', dates 'YYYY-MM-DD';
// `now` is {date, time}, given by the caller so a test can fix it.
import { randomUUID } from 'node:crypto'

const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86_400_000

// BR-3 to BR-6: the slot itself, against the configured limits
function slotRefusals(limits, { date, startTime, endTime }, now) {
  const broken = []
  const g = limits.slot_granularity_minutes
  if (minutes(startTime) % g || minutes(endTime) % g) broken.push(['BR-3', `${minutes(startTime) % g ? startTime : endTime} is not on a ${g}-minute boundary`])
  if (startTime < limits.booking_window_start_time) broken.push(['BR-4', `${startTime} is before the ${limits.booking_window_start_time} opening time`])
  if (endTime > limits.booking_window_end_time) broken.push(['BR-4', `${endTime} is after the ${limits.booking_window_end_time} closing time`])
  if (minutes(endTime) - minutes(startTime) > limits.max_duration_minutes) broken.push(['BR-5', `the booking is longer than ${limits.max_duration_minutes / 60} hours`])
  if (days(now.date, date) > limits.max_advance_days) broken.push(['BR-6', `${date} is more than ${limits.max_advance_days} days ahead`])
  return broken
}

/** Book Room: the first room that fits (BR-1, BR-2) and is free for the slot (BR-7). Room Booked, or a refusal. */
export function bookRoom(db, request, { owner, now }) {
  const limits = db.prepare('SELECT * FROM booking_limit_config WHERE id = 1').get()
  const slot = slotRefusals(limits, request, now)
  if (slot.length) return refusal(slot)
  const fits = db.prepare('SELECT * FROM room WHERE seating_capacity >= ? AND (video_capability = 1 OR ? = 0) ORDER BY id').all(request.attendeeCount, request.videoNeed ? 1 : 0)
  if (!fits.length) return refusal([['BR-1', `no room seats ${request.attendeeCount}${request.videoNeed ? ' with video conferencing (BR-2)' : ''}`]])
  const overlapping = db.prepare('SELECT 1 FROM booking WHERE room_id = ? AND date = ? AND start_time <= ? AND end_time >= ?')
  const room = fits.find((r) => !overlapping.get(r.id, request.date, request.endTime, request.startTime))
  if (!room) return refusal([['BR-7', `every fitting room is booked on ${request.date} between ${request.startTime} and ${request.endTime}`]])
  const booking = { id: randomUUID(), roomId: room.id, owner, date: request.date, createdDate: now.date, startTime: request.startTime, endTime: request.endTime, attendeeCount: request.attendeeCount, videoNeed: !!request.videoNeed }
  db.prepare('INSERT INTO booking (id, room_id, owner, date, created_date, start_time, end_time, attendee_count, video_need) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(booking.id, booking.roomId, owner, booking.date, booking.createdDate, booking.startTime, booking.endTime, booking.attendeeCount, booking.videoNeed ? 1 : 0)
  return { booked: booking }
}

const refusal = (broken) => ({ refused: { brokenRules: [...new Set(broken.map(([rule]) => rule))], message: broken.map(([rule, why]) => `${rule}: ${why}`).join('; ') } })

/** Room Status View: free, or booked with its holder until the booking ends; `next` is the room's next booking today. */
export function roomStatus(db, roomId, now) {
  const current = db.prepare('SELECT * FROM booking WHERE room_id = ? AND date = ? AND start_time <= ? AND end_time > ?').get(roomId, now.date, now.time, now.time)
  const next = db.prepare('SELECT start_time FROM booking WHERE room_id = ? AND date = ? AND start_time > ? ORDER BY start_time LIMIT 1').get(roomId, now.date, now.time)
  return {
    roomId,
    status: current ? 'booked' : 'free',
    ...(current ? { holder: current.owner, heldUntil: current.end_time } : {}),
    ...(next ? { next: next.start_time } : {}),
  }
}
