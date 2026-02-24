---
name: weather
version: 1.0.0
description: Get current weather and forecasts (no API key required).
capabilities:
  - weather
risk_level: low
input_schema:
  type: object
  properties:
    city:
      type: string
      description: The name of the city for which to fetch the weather. Can be a city name, airport code, or any other location identifier.
    format:
      type: string
      description: A string containing format codes to customize the output. Use %c for condition, %t for temperature, %h for humidity, %w for wind, %l for location, and %m for moon phase.
    units:
      type: string
      description: Specify the unit system. Use ?m for metric (default) or ?u for USCS.
    forecastType:
      type: string
      description: Specify the type of forecast. Use ?T for full forecast, ?1 for today only, or ?0 for current conditions only.
    outputFormat:
      type: string
      description: Specify the output format. Use .png to get a PNG image of the weather.
  required:
    - city
---

# Weather

Two free services, no API keys needed.

## wttr.in (primary)

Quick one-liner:
```bash
curl -s "wttr.in/London?format=3"
# Output: London: ⛅️ +8°C
```

Compact format:
```bash
curl -s "wttr.in/London?format=%l:+%c+%t+%h+%w"
# Output: London: ⛅️ +8°C 71% ↙5km/h
```

Full forecast:
```bash
curl -s "wttr.in/London?T"
```

Format codes: `%c` condition · `%t` temp · `%h` humidity · `%w` wind · `%l` location · `%m` moon

Tips:
- URL-encode spaces: `wttr.in/New+York`
- Airport codes: `wttr.in/JFK`
- Units: `?m` (metric) `?u` (USCS)
- Today only: `?1` · Current only: `?0`
- PNG: `curl -s "wttr.in/Berlin.png" -o /tmp/weather.png`

## Open-Meteo (fallback, JSON)

Free, no key, good for programmatic use:
```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true"
```

Find coordinates for a city, then query. Returns JSON with temp, windspeed, weathercode.

Docs: https://open-meteo.com/en/docs
