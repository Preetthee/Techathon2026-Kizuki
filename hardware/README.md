# Hardware Schematic

This folder contains the representative hardware/electrical schematic required
for the preliminary round.

The office has 3 rooms with the same pattern: 2 fans and 3 lights per room. The
schematic models one room because the same circuit can be repeated for Drawing
Room, Work Room 1, and Work Room 2.

## Files

| File | Purpose |
| --- | --- |
| `one-room-schematic.svg` | Visual schematic for one room |
| `wokwi/diagram.json` | Wokwi-style wiring starter for ESP32 simulation |
| `wokwi/sketch.ino` | Example firmware that reads device state pins and current sensor |

## Circuit Concept

- ESP32 reads five device state signals: 2 fans and 3 lights.
- Each AC load is controlled through a relay module.
- An ACS712-style current sensor represents room-level current draw.
- State inputs are isolated through optocouplers or low-voltage relay feedback.
- The backend simulator mirrors these readings in software for the hackathon
  demo, so no real mains hardware is required.

Safety note: the relay/load side represents mains wiring conceptually only. In
real hardware, mains wiring must be isolated, fused, enclosed, and handled by a
qualified person.
