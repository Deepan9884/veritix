require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const Event = require("./models/Event");

const app = express();

const PORT = Number(process.env.BACKEND_PORT || 4000);
const HOST = process.env.BACKEND_HOST || "0.0.0.0";
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "1mb" }));

function toInt(value, fallback = undefined) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizePatchPayload(payload) {
  const result = {};

  if (payload.organizerAddress !== undefined) result.organizerAddress = String(payload.organizerAddress);
  if (payload.name !== undefined) result.name = String(payload.name);
  if (payload.date !== undefined) result.date = String(payload.date);
  if (payload.venue !== undefined) result.venue = String(payload.venue);

  if (payload.price !== undefined) {
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("Invalid price");
    }
    result.price = price;
  }

  if (payload.totalTickets !== undefined) {
    const totalTickets = toInt(payload.totalTickets);
    if (!Number.isInteger(totalTickets) || totalTickets < 0) {
      throw new Error("Invalid totalTickets");
    }
    result.totalTickets = totalTickets;
  }

  if (payload.soldTickets !== undefined) {
    const soldTickets = toInt(payload.soldTickets);
    if (!Number.isInteger(soldTickets) || soldTickets < 0) {
      throw new Error("Invalid soldTickets");
    }
    result.soldTickets = soldTickets;
  }

  if (payload.tokenIds !== undefined) {
    if (!Array.isArray(payload.tokenIds)) {
      throw new Error("Invalid tokenIds");
    }

    const tokenIds = payload.tokenIds
      .map((tokenId) => toInt(tokenId))
      .filter((tokenId) => Number.isInteger(tokenId) && tokenId >= 0);

    result.tokenIds = Array.from(new Set(tokenIds));
  }

  return result;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "veritix-backend"
  });
});

app.get("/api/events", async (_req, res) => {
  try {
    const events = await Event.find({}).sort({ date: 1, id: 1 }).lean();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: "Unable to fetch events" });
  }
});

app.post("/api/events", async (req, res) => {
  try {
    const incoming = req.body || {};
    const id = toInt(incoming.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid event id" });
    }

    if (!incoming.organizerAddress || !incoming.name || !incoming.date || !incoming.venue) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const event = new Event({
      id,
      organizerAddress: String(incoming.organizerAddress),
      name: String(incoming.name),
      date: String(incoming.date),
      venue: String(incoming.venue),
      price: toInt(incoming.price, 0),
      totalTickets: toInt(incoming.totalTickets, 0),
      soldTickets: toInt(incoming.soldTickets, 0),
      tokenIds: Array.isArray(incoming.tokenIds) ? incoming.tokenIds : []
    });

    await event.save();
    res.status(201).json(event.toObject());
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "Event already exists" });
    }

    return res.status(500).json({ error: err.message || "Unable to create event" });
  }
});

app.patch("/api/events/:eventId", async (req, res) => {
  const eventId = toInt(req.params.eventId);

  if (!Number.isInteger(eventId)) {
    return res.status(400).json({ error: "Invalid event id" });
  }

  let patch;
  try {
    patch = sanitizePatchPayload(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message || "Invalid payload" });
  }

  try {
    const event = await Event.findOne({ id: eventId });
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    Object.assign(event, patch);
    await event.save();

    return res.json(event.toObject());
  } catch (err) {
    return res.status(500).json({ error: "Unable to update event" });
  }
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled backend error:", error);
  res.status(500).json({ error: "Internal server error" });
});

async function startServer() {
  if (!MONGODB_URI) {
    throw new Error("Missing MONGODB_URI in environment variables");
  }

  await mongoose.connect(MONGODB_URI);
  console.log("MongoDB connected");

  app.listen(PORT, HOST, () => {
    console.log(`Backend running at http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start backend:", err.message);
  process.exit(1);
});
