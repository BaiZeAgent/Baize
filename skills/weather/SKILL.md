---
name: weather
version: 1.0.0
description: "Get current weather and forecasts (no API key required)"
capabilities:
  - weather
risk_level: low
input_schema:
  type: object
  properties:
    location:
      type: string
      description: "City name or location"
  required:
    - location
---

# Weather

Get current weather using wttr.in (no API key required).

## Usage

```bash
curl -s "wttr.in/London?format=3"
```

Output: London: ⛅️ +8°C

## Features

- No API key required
- Supports city names, airport codes
- Multiple output formats

## Examples

- `wttr.in/Beijing` - Full forecast
- `wttr.in/Shanghai?format=3` - One-line output
- `wttr.in/New+York?0` - Current weather only
