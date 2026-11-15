import { describe, expect, it } from 'vitest';
import { formatMeasureDistance, formatTravelDuration, measureRoute, METRES_PER_MILE, travelMarkers } from './measure';

const miles = (distance: number) => [{ x: 0, y: 0 }, { x: distance * METRES_PER_MILE, y: 0 }];

describe('route measurement', () => {
  it('sums the route segments rather than the straight line between its endpoints', () => {
    const result = measureRoute([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 14 }]);
    expect(result.metres).toBe(15);
    expect(result.feet).toBeCloseTo(49.2126);
    expect(result.durationSeconds).toBeNull();
    expect(result.arrival).toBeNull();
    expect(measureRoute([]).metres).toBe(0);
    expect(measureRoute([{ x: 1, y: 2 }]).metres).toBe(0);
  });
  it('converts miles and mph to duration and handles midnight and multi-day travel', () => {
    expect(measureRoute(miles(3), 3, '08:15')).toMatchObject({ miles: 3, durationSeconds: 3600, arrival: { time: '09:15', dayOffset: 0 } });
    expect(measureRoute(miles(1.5), 3, '23:30').arrival).toEqual({ time: '00:00', dayOffset: 1 });
    expect(measureRoute(miles(98), 2, '23:00').arrival).toEqual({ time: '00:00', dayOffset: 3 });
    expect(measureRoute(miles(3), 3).arrival).toBeNull();
    expect(measureRoute(miles(0), 3, '23:59').arrival).toEqual({ time: '23:59', dayOffset: 0 });
  });
  it('formats feet below a mile, miles above it, and readable travel durations', () => {
    expect(formatMeasureDistance(measureRoute(miles(0.5)))).toBe('2,640 ft');
    expect(formatMeasureDistance(measureRoute(miles(1)))).toBe('1.00 mi');
    expect(formatTravelDuration(0)).toBe('0 min');
    expect(formatTravelDuration(20)).toBe('<1 min');
    expect(formatTravelDuration(3660)).toBe('1 h 1 min');
    expect(formatTravelDuration(176400)).toBe('2 d 1 h');
  });
  it('rejects bad coordinates, zero/negative speed and invalid clock times', () => {
    for (const speed of [0, -1, Infinity, NaN]) expect(() => measureRoute(miles(1), speed)).toThrow('Speed');
    for (const time of ['24:00', '12:60', '8:00', 'garbage']) expect(() => measureRoute(miles(1), 3, time)).toThrow('Departure');
    expect(() => measureRoute([{ x: Infinity, y: 0 }])).toThrow('coordinates');
  });
  it('schedules rest, partial first days, waiting for departure, exact finishes and overnight travel windows', () => {
    const schedule = {startTime:'08:00',hoursPerDay:8};
    expect(measureRoute(miles(36),3,'08:00',schedule)).toMatchObject({durationSeconds:43200,elapsedSeconds:100800,restStops:1,arrival:{time:'12:00',dayOffset:1}});
    expect(measureRoute(miles(12),3,'15:00',schedule)).toMatchObject({restStops:1,arrival:{time:'11:00',dayOffset:1}});
    expect(measureRoute(miles(3),3,'17:00',schedule)).toMatchObject({restStops:0,arrival:{time:'09:00',dayOffset:1}});
    expect(measureRoute(miles(3),3,'06:00',schedule)).toMatchObject({elapsedSeconds:10800,arrival:{time:'09:00',dayOffset:0}});
    expect(measureRoute(miles(24),3,'08:00',schedule)).toMatchObject({restStops:0,arrival:{time:'16:00',dayOffset:0}});
    expect(measureRoute(miles(48),3,'08:00',schedule)).toMatchObject({restStops:1,arrival:{time:'16:00',dayOffset:1}});
    expect(measureRoute(miles(0),3,'17:00',schedule)).toMatchObject({elapsedSeconds:0,arrival:{time:'17:00',dayOffset:0}});
    expect(measureRoute(miles(9),3,'02:00',{startTime:'20:00',hoursPerDay:8})).toMatchObject({arrival:{time:'21:00',dayOffset:0},restStops:1});
    expect(measureRoute(miles(98),2,'23:00',{startTime:'08:00',hoursPerDay:24}).arrival).toEqual({time:'00:00',dayOffset:3});
    expect(() => measureRoute(miles(3),3,'08:00',{...schedule,hoursPerDay:0})).toThrow('schedule');
    expect(() => measureRoute(miles(3),3,undefined,schedule)).toThrow('departure');
  });
  it('places watch/camp annotations along bends and bounds annotations on very long routes', () => {
    const points = [{x:0,y:0},{x:12*METRES_PER_MILE,y:0},{x:12*METRES_PER_MILE,y:24*METRES_PER_MILE}];
    const marks = travelMarkers(points,3,'08:00',{startTime:'08:00',hoursPerDay:8});
    expect(marks.find(m=>m.kind==='watch')).toMatchObject({x:12*METRES_PER_MILE,y:0});
    expect(marks.find(m=>m.kind==='camp')).toMatchObject({x:12*METRES_PER_MILE,y:12*METRES_PER_MILE});
    expect(travelMarkers(miles(24),3,'08:00',{startTime:'08:00',hoursPerDay:8}).some(m=>m.kind==='camp')).toBe(false);
    expect(travelMarkers(miles(1000000),3,'08:00',{startTime:'08:00',hoursPerDay:8}).length).toBeLessThanOrEqual(256);
  });
});
