# Bronzeman — Alt1 RuneScape 3

A Bronzeman Mode tracker for RuneScape 3. **Earn items before you can buy them on the Grand Exchange.**

## Installation

1. **Open the Alt1 browser** (click the Alt1 icon in your system tray → "Browser")
2. **Go to** [https://dyluminous.github.io/alt1-bronzeman/](https://dyluminous.github.io/alt1-bronzeman/)
3. **Click "Add App"** — the plugin will install and appear in your Alt1 sidebar

That's it. The tracker runs automatically whenever you're logged into RuneScape.

## What It Does

- Scans your inventory and spots any item you haven't earned yet (marked with a gold dot)
- Click the gold dot to look up the item on the wiki and unlock it
- Once unlocked, the item can be freely bought and sold on the GE — but not before
- If the GE is open, buy/sell buttons are highlighted green (unlocked) or red (not yet earned)
- Your unlocks are saved locally and persist across game sessions

## Tips

- **Search tab** — browse and search everything you've unlocked
- **Backup** — use the backup/restore buttons in Settings to export or restore your unlock data
- **Stackable items** — tracked properly; quantity changes don't reset unlock status
- **Developer mode** (in Settings) — enables overlay debugging and detailed logs

## Development

```bash
npm install
npm run build    # webpack → dist/
npm run watch    # auto-rebuild on changes
```

Pull requests welcome. Built with TypeScript and the Alt1 SDK.

## License

MIT
