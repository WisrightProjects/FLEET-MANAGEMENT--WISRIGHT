"""Rule-based summary generator — used when no KIMI_API_KEY is set, the LLM
call fails after retries, or the request times out. Produces the same
{summary, notableEvents, recommendation} shape as the LLM path so the
frontend never needs to branch on which one produced the result."""

from __future__ import annotations


def fallback_historical_summary(stats: dict) -> dict:
    bus = stats["bus_number"]
    route = stats["route_name"]
    on_time = stats["on_time_pct"]
    avg_delay = stats["avg_delay_min"]
    worst = stats["worst_day"]

    reliability = "highly reliable" if on_time >= 85 else "generally reliable" if on_time >= 65 else "inconsistent"
    summary = (
        f"{bus} on \"{route}\" was {reliability} over the last {stats['days']} days, "
        f"running on time {on_time}% of trips with an average delay of {avg_delay} min."
    )

    events = []
    if worst.get("date") and worst.get("delay_min", 0) > 10:
        note = worst.get("scenario_note") or ""
        events.append(f"Worst day: {worst['date']} — {worst['delay_min']} min delay. {note}".strip())
    for scenario, count in sorted(stats.get("scenario_counts", {}).items(), key=lambda kv: -kv[1]):
        if scenario not in ("ON_TIME",) and count > 0:
            events.append(f"{scenario.replace('_', ' ').title()}: {count} occurrence(s)")
    events = events[:4]

    if on_time >= 85:
        recommendation = "No action needed — maintain current schedule and driver assignment."
    elif avg_delay > 10:
        recommendation = "Consider adjusting departure time earlier to absorb recurring delays."
    else:
        recommendation = "Monitor the next few days for recurring patterns before adjusting the schedule."

    return {"summary": summary, "notableEvents": events, "recommendation": recommendation}


def fallback_forecast_summary(stats: dict, pred_stats: dict) -> dict:
    bus = stats["bus_number"]
    route = stats["route_name"]
    delay_prob = pred_stats["avg_delay_probability"]
    confidence = pred_stats["avg_confidence"]

    outlook = "favorable" if delay_prob < 25 else "mixed" if delay_prob < 55 else "delay-prone"
    summary = (
        f"Forecast for {bus} on \"{route}\" over the next {pred_stats['days']} days looks {outlook}, "
        f"with an average delay probability of {delay_prob}% and {confidence}% route confidence."
    )

    events = [
        f"Projected average speed: {pred_stats['avg_speed_kmh']} km/h",
        f"Projected average distance: {pred_stats['avg_distance_km']} km",
    ]
    if stats.get("worst_day", {}).get("delay_min", 0) > 15:
        events.append(f"Historical worst day ({stats['worst_day']['date']}) suggests occasional major delays are possible.")

    if delay_prob < 25:
        recommendation = "Current schedule should hold — no changes recommended."
    elif delay_prob < 55:
        recommendation = "Add a small time buffer to the published ETA to manage passenger expectations."
    else:
        recommendation = "Review the route for recurring bottlenecks before the next scheduling cycle."

    return {"summary": summary, "notableEvents": events[:4], "recommendation": recommendation}
