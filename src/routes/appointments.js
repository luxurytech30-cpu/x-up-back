// src/routes/appointments.js
const router = require("express").Router();
const crypto = require("crypto");
const Appointment = require("../models/Appointment");
const { requireAuth } = require("../middleware/auth");

console.log("✅ appointments routes file loaded");

// helper: admin from session
const isAdmin = (req) => req.session?.user?.role === "admin";

function generateManageToken() {
  return crypto.randomBytes(32).toString("hex");
}

function generateBookingCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function canClientManageAppointment(appointment) {
  if (!appointment) return false;
  if (!appointment.clientCanEdit) return false;
  if (appointment.status === "cancelled") return false;
  if (appointment.status === "done") return false;
  if (appointment.status === "no_show") return false;

  const cutoffMinutes = Number(appointment.clientEditCutoffMinutes || 120);
  const now = new Date();
  const diffMs = new Date(appointment.startAt).getTime() - now.getTime();
  const diffMinutes = diffMs / (1000 * 60);

  return diffMinutes >= cutoffMinutes;
}

function buildDayRange(date) {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59.999`);
  return { dayStart, dayEnd };
}

// GET /api/appointments?date=YYYY-MM-DD&barberId=...
// admin sees all
// logged-in non-admin sees only own appointments
router.get("/", async (req, res) => {
  try {
    const q = {};
    const { barberId, date } = req.query;

    if (barberId) q.barberId = barberId;

    if (date) {
      const { dayStart, dayEnd } = buildDayRange(date);
      q.startAt = { $gte: dayStart, $lte: dayEnd };
    }

    if (!isAdmin(req)) {
      if (!req.session?.user?._id) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      q.createdByUserId = req.session.user._id;
    }

    const list = await Appointment.find(q)
      .sort({ startAt: 1 })
      .populate("barberId", "name")
      .lean();

    res.json(list);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/appointments
// public booking: no login required
router.post("/", async (req, res) => {
  try {
    const { barberId, startAt, endAt, customerName, phone, service, notes } =
      req.body;

    if (!barberId || !startAt || !endAt || !customerName) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const s = new Date(startAt);
    const e = new Date(endAt);

    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    if (!(s < e)) {
      return res.status(400).json({ message: "Invalid time range" });
    }

    const overlap = await Appointment.findOne({
      barberId,
      status: { $ne: "cancelled" },
      startAt: { $lt: e },
      endAt: { $gt: s },
    }).lean();

    if (overlap) {
      return res.status(409).json({ message: "Time already booked" });
    }

    const appointment = await Appointment.create({
      barberId,
      startAt: s,
      endAt: e,
      customerName: String(customerName).trim(),
      phone: phone ? String(phone).trim() : "",
      service: service || "",
      notes: notes || "",
      status: "booked",
      manageToken: generateManageToken(),
      bookingCode: generateBookingCode(),
      clientCanEdit: true,
      clientEditCutoffMinutes: 120,
      createdByUserId: req.session?.user?._id || null,
    });

    return res.status(201).json({
      appointmentId: appointment._id,
      bookingCode: appointment.bookingCode,
      manageToken: appointment.manageToken,
      message: "Appointment booked successfully",
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/appointments/public/:token
// public view by manage token
router.get("/public/:token", async (req, res) => {
  try {
    const appointment = await Appointment.findOne({
      manageToken: req.params.token,
    }).populate("barberId", "name");

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    return res.json({
      _id: appointment._id,
      barberId: appointment.barberId,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      customerName: appointment.customerName,
      phone: appointment.phone,
      service: appointment.service,
      notes: appointment.notes,
      status: appointment.status,
      bookingCode: appointment.bookingCode,
      canManage: canClientManageAppointment(appointment),
      cutoffMinutes: appointment.clientEditCutoffMinutes,
    });
  } catch (err) {
    console.error("GET PUBLIC APPOINTMENT ERROR:", err);
    res.status(500).json({ message: "Failed to load appointment" });
  }
});

// DELETE /api/appointments/public/:token
// public cancel by manage token
router.delete("/public/:token", async (req, res) => {
  try {
    const appointment = await Appointment.findOne({
      manageToken: req.params.token,
    });

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (!canClientManageAppointment(appointment)) {
      return res.status(403).json({
        message: "You can only cancel at least 2 hours before the appointment",
      });
    }

    appointment.status = "cancelled";
    appointment.cancelledAt = new Date();
    appointment.cancelledByUserId = null;

    await appointment.save();

    return res.json({ message: "Appointment cancelled successfully" });
  } catch (err) {
    console.error("DELETE PUBLIC APPOINTMENT ERROR:", err);
    res.status(500).json({ message: "Failed to cancel appointment" });
  }
});

// PATCH /api/appointments/public/:token
// public edit by manage token
router.patch("/public/:token", async (req, res) => {
  try {
    const appointment = await Appointment.findOne({
      manageToken: req.params.token,
    });

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (!canClientManageAppointment(appointment)) {
      return res.status(403).json({
        message: "You can only change at least 2 hours before the appointment",
      });
    }

    const { barberId, startAt, endAt, service, notes, customerName, phone } =
      req.body;

    const nextBarberId = barberId ?? appointment.barberId;
    const nextStartAt = startAt
      ? new Date(startAt)
      : new Date(appointment.startAt);
    const nextEndAt = endAt ? new Date(endAt) : new Date(appointment.endAt);

    if (
      Number.isNaN(nextStartAt.getTime()) ||
      Number.isNaN(nextEndAt.getTime())
    ) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    if (!(nextStartAt < nextEndAt)) {
      return res.status(400).json({ message: "Invalid time range" });
    }

    const overlap = await Appointment.findOne({
      _id: { $ne: appointment._id },
      barberId: nextBarberId,
      status: { $ne: "cancelled" },
      startAt: { $lt: nextEndAt },
      endAt: { $gt: nextStartAt },
    }).lean();

    if (overlap) {
      return res.status(409).json({ message: "Time already booked" });
    }

    appointment.barberId = nextBarberId;
    appointment.startAt = nextStartAt;
    appointment.endAt = nextEndAt;
    appointment.service = service ?? appointment.service;
    appointment.notes = notes ?? appointment.notes;
    appointment.customerName = customerName ?? appointment.customerName;
    appointment.phone = phone ?? appointment.phone;

    await appointment.save();

    return res.json({
      message: "Appointment updated successfully",
      appointmentId: appointment._id,
      bookingCode: appointment.bookingCode,
      manageToken: appointment.manageToken,
      manageUrl: `${process.env.CLIENT_URL}/manage-appointment?token=${appointment.manageToken}`,
    });
  } catch (err) {
    console.error("PATCH PUBLIC APPOINTMENT ERROR:", err);
    res.status(500).json({ message: "Failed to update appointment" });
  }
});

// PATCH /api/appointments/:id
// admin always
// logged-in non-admin only own appointment and before cutoff
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ message: "Not found" });

    const admin = isAdmin(req);

    if (!admin) {
      if (String(appt.createdByUserId) !== String(req.session?.user?._id)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const cutoffMin = appt.clientEditCutoffMinutes ?? 120;
      const cutoffTime = new Date(
        new Date(appt.startAt).getTime() - cutoffMin * 60000,
      );

      if (new Date() >= cutoffTime) {
        return res.status(403).json({ message: "Too late (2 hour cutoff)" });
      }
    }

    const allowed = [
      "barberId",
      "customerName",
      "phone",
      "service",
      "notes",
      "status",
      "startAt",
      "endAt",
    ];

    for (const k of Object.keys(req.body)) {
      if (!allowed.includes(k)) continue;
      appt[k] = req.body[k];
    }

    appt.startAt = new Date(appt.startAt);
    appt.endAt = new Date(appt.endAt);

    if (
      Number.isNaN(appt.startAt.getTime()) ||
      Number.isNaN(appt.endAt.getTime())
    ) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    if (!(appt.startAt < appt.endAt)) {
      return res.status(400).json({ message: "Invalid time range" });
    }

    if (appt.status !== "cancelled") {
      const overlap = await Appointment.findOne({
        _id: { $ne: appt._id },
        barberId: appt.barberId,
        status: { $ne: "cancelled" },
        startAt: { $lt: appt.endAt },
        endAt: { $gt: appt.startAt },
      }).lean();

      if (overlap) {
        return res.status(409).json({ message: "Time already booked" });
      }
    }

    await appt.save();
    res.json(appt);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DELETE /api/appointments/:id
// admin always
// logged-in non-admin only own appointment and before cutoff
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ message: "Not found" });

    const admin = isAdmin(req);

    if (!admin) {
      if (String(appt.createdByUserId) !== String(req.session?.user?._id)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const cutoffMin = appt.clientEditCutoffMinutes ?? 120;
      const cutoffTime = new Date(
        new Date(appt.startAt).getTime() - cutoffMin * 60000,
      );

      if (new Date() >= cutoffTime) {
        return res.status(403).json({ message: "Too late (2 hour cutoff)" });
      }
    }

    appt.status = "cancelled";
    appt.cancelledAt = new Date();
    appt.cancelledByUserId = req.session?.user?._id || null;

    await appt.save();

    res.json({ cancelled: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
