"use client";
import { useEffect, useState } from "react";

/** A little calendar page showing today's weekday and date; it re-reads the clock once a minute. */
export default function TodayCalendar() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setToday(new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      className="todayCal"
      role="img"
      aria-label={today ? today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "Today"}
    >
      <span className="todayCalDay">{today ? today.toLocaleDateString(undefined, { weekday: "long" }) : ""}</span>
      <span className="todayCalNum">{today ? today.getDate() : ""}</span>
    </div>
  );
}
