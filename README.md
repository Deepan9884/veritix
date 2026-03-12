# Veritix Event Ticket System

NFT-based event ticketing with:
- Solidity contract on Sepolia
- Organizer / attendee / scanner frontend
- MongoDB backend for shared event inventory across devices

## 1) Install dependencies

```bash
npm install
```

## 2) Configure environment

Copy `.env.example` to `.env` and fill your values:

```bash
copy .env.example .env
```

Required for backend:
- `MONGODB_URI`

Required for contract deploy/testing:
- `SEPOLIA_RPC_URL`
- `PRIVATE_KEY`

## 3) Run backend (Mongo API)

```bash
npm run start:backend
```

Backend starts on:
- `http://0.0.0.0:4000`

## 4) Run frontend

```bash
npm run start:frontend
```

Frontend starts on:
- `http://localhost:8080`

## 5) Multi-device usage

If frontend is opened from another device (same Wi-Fi), use your LAN IP:
- `http://<YOUR_LAN_IP>:8080`

Frontend automatically calls backend at:
- `http://<CURRENT_HOSTNAME>:4000/api`

So events/tickets created by organizer are persisted in MongoDB and visible on other devices.

## API endpoints used

- `GET /api/health`
- `GET /api/events`
- `POST /api/events`
- `PATCH /api/events/:eventId`

