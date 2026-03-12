const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    id: {
      type: Number,
      required: true,
      unique: true,
      index: true
    },
    organizerAddress: {
      type: String,
      required: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    date: {
      type: String,
      required: true,
      trim: true
    },
    venue: {
      type: String,
      required: true,
      trim: true
    },
    price: {
      type: Number,
      default: 0,
      min: 0
    },
    totalTickets: {
      type: Number,
      default: 0,
      min: 0
    },
    soldTickets: {
      type: Number,
      default: 0,
      min: 0
    },
    tokenIds: {
      type: [Number],
      default: []
    }
  },
  {
    timestamps: true
  }
);

eventSchema.pre("save", function normalizeEvent() {
  const safeTokenIds = Array.isArray(this.tokenIds)
    ? this.tokenIds
      .map((tokenId) => Number(tokenId))
      .filter((tokenId) => Number.isInteger(tokenId) && tokenId >= 0)
    : [];

  this.tokenIds = Array.from(new Set(safeTokenIds));

  if (!Number.isFinite(this.totalTickets) || this.totalTickets < this.tokenIds.length) {
    this.totalTickets = this.tokenIds.length;
  }

  if (!Number.isFinite(this.soldTickets) || this.soldTickets < 0) {
    this.soldTickets = 0;
  }

  if (this.soldTickets > this.totalTickets) {
    this.soldTickets = this.totalTickets;
  }

  if (!Number.isFinite(this.price) || this.price < 0) {
    this.price = 0;
  }

});

module.exports = mongoose.model("Event", eventSchema);
