// src/routes/appointments.js
const router = require("express").Router();
const Appointment = require("../models/Appointment");
const { requireAuth, requireAdmin } = require("../middleware/auth");
console.log("✅ appointments routes file loaded");
// helper: admin from session
const isAdmin = (req) => req.session?.user?.role === "admin";

// GET /api/appointments?date=YYYY-MM-DD&barberId=...
router.get("/", async (req, res) => {
  try {
    const q = {};
    const { barberId, date } = req.query;

    if (barberId) q.barberId = barberId;

    if (date) {
      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(`${date}T23:59:59.999`);
      q.startAt = { $gte: dayStart, $lte: dayEnd };
    }

    // admin sees all, user sees only own
    if (!isAdmin(req)) {
      q.createdByUserId = req.session.user?._id;
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

// POST /api/appointments (admin OR logged-in user)
router.post("/", requireAuth, async (req, res) => {
  try {
    const { barberId, startAt, endAt, customerName, phone, service, notes } =
      req.body;

    if (!barberId || !startAt || !endAt || !customerName)
      return res.status(400).json({ message: "Missing fields" });

    const s = new Date(startAt);
    const e = new Date(endAt);
    if (!(s < e))
      return res.status(400).json({ message: "Invalid time range" });

    // overlap check
    const overlap = await Appointment.findOne({
      barberId,
      status: { $ne: "cancelled" },
      startAt: { $lt: e },
      endAt: { $gt: s },
    }).lean();

    if (overlap)
      return res.status(409).json({ message: "Time already booked" });

    const appt = await Appointment.create({
      barberId,
      startAt: s,
      endAt: e,
      customerName: String(customerName).trim(),
      phone: (phone || "").trim(),
      service: service || "",
      notes: notes || "",
      status: "booked",
      createdByUserId: req.session.user?._id || null,
      clientEditCutoffMinutes: 60,
    });

    res.json(appt);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PATCH /api/appointments/:id (admin always, user only own & before cutoff)
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ message: "Not found" });

    const admin = isAdmin(req);

    if (!admin) {
      if (String(appt.createdByUserId) !== String(req.session.user?._id))
        return res.status(403).json({ message: "Forbidden" });

      const cutoffMin = appt.clientEditCutoffMinutes ?? 60;
      const cutoffTime = new Date(
        new Date(appt.startAt).getTime() - cutoffMin * 60000,
      );
      if (new Date() >= cutoffTime)
        return res.status(403).json({ message: "Too late (1 hour cutoff)" });
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

    // cast dates if changed
    appt.startAt = new Date(appt.startAt);
    appt.endAt = new Date(appt.endAt);
    if (!(appt.startAt < appt.endAt))
      return res.status(400).json({ message: "Invalid time range" });

    // overlap check (unless cancelled)
    if (appt.status !== "cancelled") {
      const overlap = await Appointment.findOne({
        _id: { $ne: appt._id },
        barberId: appt.barberId,
        status: { $ne: "cancelled" },
        startAt: { $lt: appt.endAt },
        endAt: { $gt: appt.startAt },
      }).lean();

      if (overlap)
        return res.status(409).json({ message: "Time already booked" });
    }

    await appt.save();
    res.json(appt);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// DELETE /api/appointments/:id (cancel) (admin always, user only own & before cutoff)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ message: "Not found" });

    const admin = isAdmin(req);

    if (!admin) {
      if (String(appt.createdByUserId) !== String(req.session.user?._id))
        return res.status(403).json({ message: "Forbidden" });

      const cutoffMin = appt.clientEditCutoffMinutes ?? 60;
      const cutoffTime = new Date(
        new Date(appt.startAt).getTime() - cutoffMin * 60000,
      );
      if (new Date() >= cutoffTime)
        return res.status(403).json({ message: "Too late (1 hour cutoff)" });
    }

    appt.status = "cancelled";
    appt.cancelledAt = new Date();
    appt.cancelledByUserId = req.session.user?._id || null;
    await appt.save();

    res.json({ cancelled: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
