import test from "node:test";
import assert from "node:assert/strict";
import {
  changeWorkday,
  workDay,
  workdayMilliseconds,
  taskMilliseconds,
  reportingRange,
} from "./work";
const time = (hour: number, minute = 0) =>
  Date.parse(
    `2026-11-01T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`,
  );
test("workday opens once, deducts recorded lunch, closes and can explicitly resume", () => {
  let day = changeWorkday(undefined, "ana", "open", time(8));
  day = changeWorkday(day, "ana", "open", time(9));
  assert.equal(Date.parse(day.startedAt), time(8));
  day = changeWorkday(day, "ana", "break", time(12));
  assert.deepEqual(changeWorkday(day, "ana", "break", time(12, 5)), day);
  day = changeWorkday(day, "ana", "return", time(13));
  day = changeWorkday(day, "ana", "close", time(17));
  assert.equal(workdayMilliseconds(day, time(18)), 8 * 3600000);
  assert.equal(
    taskMilliseconds(
      new Date(time(11, 30)).toISOString(),
      new Date(time(13, 30)).toISOString(),
      day,
    ),
    3600000,
  );
  assert.deepEqual(changeWorkday(day, "ana", "open", time(18)), day);
  day = changeWorkday(day, "ana", "resume", time(18));
  day = changeWorkday(day, "ana", "close", time(19));
  assert.equal(workdayMilliseconds(day, time(20)), 9 * 3600000);
  assert.equal(
    taskMilliseconds(
      new Date(time(16)).toISOString(),
      new Date(time(19)).toISOString(),
      day,
    ),
    2 * 3600000,
    "task time also excludes a closed shift before resuming",
  );
});
test("past unclosed workdays and cross-day tasks never fabricate overnight working time", () => {
  const day = changeWorkday(undefined, "ana", "open", time(8));
  assert.equal(workdayMilliseconds(day, time(8) + 86400000), null);
  assert.equal(
    taskMilliseconds(
      new Date(time(8)).toISOString(),
      new Date(time(8) + 86400000).toISOString(),
      day,
    ),
    null,
  );
  assert.equal(taskMilliseconds("invalid", "invalid"), null);
  assert.throws(
    () => changeWorkday(day, "other", "close", time(10)),
    /inválido/,
  );
  assert.throws(
    () => changeWorkday(undefined, "ana", "break", time(10)),
    /Inicie/,
  );
  assert.equal(workDay(Date.parse("2026-11-02T01:00:00Z")), "2026-11-01");
  assert.deepEqual(reportingRange("week", time(8)), {
    start: "2026-10-26",
    end: "2026-11-01",
  });
});
