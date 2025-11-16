# WhatsApp Funbot (Baileys v7)

This project uses Baileys v7 (ESM-only) and Bun as the runtime/package manager.

Quick start:

- Copy `.env.example` to `.env` and fill values (Mongo URI, etc.)
- Install deps with Bun
- Run in dev (hot reload) or build and start

Dev:

```bash
bun install
bun run dev
```

Build and run:

```bash
bun run build
bun run start
```

Notes on Baileys v7 migration:

- ESM only: `type: module` and TS `module: NodeNext` are configured.
- LIDs: project treats user IDs as JIDs agnostic; Baileys may return LID JIDs. Avoid relying on phone-number JIDs.
- Proto changes: auth Mongo adapter uses `BufferJSON` and `proto.Message.AppStateSyncKeyData.create`.
- ACKs: do not manually ACK on delivery; existing code does not send extra acks.
- Contact/Group types changed: code uses `groupMetadata()` at runtime and does not rely on stored types.

Troubleshooting:

- If you changed major deps, clear cached auth by calling the logout flow or deleting the `auth_*` collections in Mongo.
- For QR pairing issues, ensure time sync and that ports are open.
