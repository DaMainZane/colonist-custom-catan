# S0.15 Bot Memory & Player Profile Schema (`Service 19`)

## Host Decision: Render Free Tier (`https://cuh-tan.onrender.com`)

The production server runs on **Render Free Tier**, where the container filesystem is ephemeral across deploys and spin-downs. To support both local/self-hosted persistence and zero-cost cloud hosting on Render:

1. **Primary Runtime Store**: Structured JSON files under `data/bots/<botId>.json` and `data/players/<playerId>.json` (cached in memory and flushed atomically to disk).
2. **Render Ephemeral Disk Continuity**: Portable `CTMEM1.<base64url>` memory bundle codes (`exportMemoryCode` / `importMemoryCode` and HTTP endpoints `GET /api/memory/export` / `POST /api/memory/import`) allow the host or client `localStorage` to back up and restore cross-game bot grudges and player profiles after a Render spin-down.

---

## Hard Caps & Privacy Rules

| Limit | Value | Enforcement |
| :--- | :--- | :--- |
| `CURRENT_SCHEMA_VERSION` | `2` | Older `v0` / `v1` files are migrated automatically on load. |
| `MAX_MEMORY_EVENTS` | `50` | Ring buffer of most recent public cross-game events. |
| `MAX_RELATIONSHIPS` | `24` | Capped to top 24 players by most recent interaction (`lastSeenAt`). |
| `MAX_FILE_BYTES` | `16384` (16 KB) | Oldest events are trimmed until UTF-8 byte length is `<= 16384`. |
| **Public-Only Rule** | Strict | Only public table actions may be stored. Private fields (`resources`, `hand`, `devCards`, `newDevCards`, `secret`, `deck`, `private`) are rejected. |

---

## `BotMemoryFile` (v2)

```json
{
  "schemaVersion": 2,
  "botId": "overload_alpha",
  "tier": "overload",
  "updatedAt": 1730000000000,
  "gamesPlayed": 12,
  "wins": 5,
  "relationships": {
    "player_zane": {
      "playerId": "player_zane",
      "playerName": "Zane",
      "trust": -2.5,
      "grudge": 4.0,
      "gamesTogether": 6,
      "robbedMe": 5,
      "tradedWithMe": 2,
      "brokeDeal": 0,
      "lastSeenAt": 1730000000000
    }
  },
  "events": [
    {
      "type": "robbed",
      "actorId": "player_zane",
      "actorName": "Zane",
      "turn": 14,
      "at": 1730000000000,
      "note": "Blocked 8-ore city hex"
    }
  ]
}
```

## `PlayerProfileFile` (v2)

```json
{
  "schemaVersion": 2,
  "playerId": "player_zane",
  "name": "Zane",
  "updatedAt": 1730000000000,
  "gamesPlayed": 18,
  "wins": 7,
  "favoriteDlc": "seafarers",
  "badges": ["road_builder", "island_hopper"]
}
```
