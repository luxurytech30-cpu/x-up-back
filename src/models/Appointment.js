const mongoose = require("mongoose");

const AppointmentSchema = new mongoose.Schema(
  {
    barberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Barber",
      required: true,
      index: true,
    },

    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },

    customerName: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },

    service: { type: String, default: "" },
    notes: { type: String, default: "" },

    status: {
      type: String,
      enum: [
        "booked",
        "checked_in",
        "in_service",
        "done",
        "cancelled",
        "no_show",
      ],
      default: "booked",
      index: true,
    },

    // session user who created it (if logged in)
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    clientEditCutoffMinutes: { type: Number, default: 60 },

    cancelledAt: { type: Date, default: null },
    cancelledByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

AppointmentSchema.index({ barberId: 1, startAt: 1 });
AppointmentSchema.index({ barberId: 1, startAt: 1, endAt: 1 });

module.exports = mongoose.model("Appointment", AppointmentSchema);
