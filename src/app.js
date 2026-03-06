require("dotenv").config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const authRoutes = require("./routes/auth.routes");
const productRoutes = require("./routes/product.routes");
const cartRoutes = require("./routes/cart.routes");
const orderRoutes = require("./routes/order.routes");
const barberRoutes = require("./routes/barber.routes");
const queueRoutes = require("./routes/queue.routes");
const courseRoutes = require("./routes/course.routes");
const appointmentsRoutes = require("./routes/appointments");
const barberScheduleRoutes = require("./routes/barberSchedule");
const servicesRoutes = require("./routes/services.routes");

const app = express();

const allowedOrigins = [
  "https://barbershop-front.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "sid",
    secret: process.env.SESSION_SECRET || "dev_secret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    },
  }),
);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/barbers", barberRoutes);
app.use("/api/queues", queueRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/barbers-schedule", require("./routes/barberSchedule"));
app.use("/api/appointments", appointmentsRoutes);
app.use("/api/availability", require("./routes/availability.routes"));
app.use("/api/services", servicesRoutes);
console.log("✅ mounted /api/appointments");
module.exports = app;
