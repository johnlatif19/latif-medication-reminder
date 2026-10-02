"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const admin = require("firebase-admin");

const REQUIRED_ENV = [
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD_HASH",
    "JWT_SECRET",
    "FIREBASE_CONFIG"
];

const missing = REQUIRED_ENV.filter(function (k) {
    return !process.env[k] || String(process.env[k]).trim() === "";
});

if (missing.length > 0) {
    console.error("[config] missing env vars: " + missing.join(", "));
    process.exit(1);
}

const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME);
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH);
const JWT_SECRET = String(process.env.JWT_SECRET);
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
} catch (err) {
    console.error("[config] FIREBASE_CONFIG is not valid JSON");
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const MEDICATIONS = [
    { id: "isapril",   name: "إيزابريل",  time: "12:50", dosesPerDay: 1, order: 1 },
    { id: "pantobi",   name: "بانتوبي",   time: "01:07", dosesPerDay: 1, order: 2 },
    { id: "concor",    name: "كونكور",    time: "03:57", dosesPerDay: 1, order: 3 },
    { id: "juspirin",  name: "جوسبرين",   time: "05:08", dosesPerDay: 1, order: 4 },
    { id: "ator",      name: "اتور",      time: "1:35",  dosesPerDay: 1, order: 5 },
    { id: "plavix",    name: "بلافيكس",   time: "1:42",  dosesPerDay: 1, order: 6 },
    { id: "alventern", name: "ألفينترن",  time: null,    dosesPerDay: 2, order: 7 },
    { id: "calciton",  name: "كالسيترون", time: null,    dosesPerDay: 1, order: 8 }
];

const MEDICATIONS_BY_ID = {};
MEDICATIONS.forEach(function (m) { MEDICATIONS_BY_ID[m.id] = m; });

function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
}

function isValidMedicationId(id) {
    return typeof id === "string" && Object.prototype.hasOwnProperty.call(MEDICATIONS_BY_ID, id);
}

function nowIso() {
    return new Date().toISOString();
}

function logSafe(label, err) {
    if (NODE_ENV === "production") {
        console.error("[" + label + "]", err && err.message ? err.message : "error");
    } else {
        console.error("[" + label + "]", err);
    }
}

async function ensureMedicationsSeeded() {
    const col = db.collection("medications");
    const snapshot = await col.get();
    if (!snapshot.empty) return;

    const batch = db.batch();
    MEDICATIONS.forEach(function (med) {
        const ref = col.doc(med.id);
        batch.set(ref, {
            name: med.name,
            time: med.time,
            dosesPerDay: med.dosesPerDay,
            order: med.order
        });
    });
    await batch.commit();
}

async function getMedications() {
    try {
        await ensureMedicationsSeeded();
        const snapshot = await db.collection("medications").get();
        const list = [];
        snapshot.forEach(function (doc) {
            const data = doc.data() || {};
            list.push({
                id: doc.id,
                name: data.name || doc.id,
                time: data.time || null,
                dosesPerDay: typeof data.dosesPerDay === "number" ? data.dosesPerDay : 1,
                order: typeof data.order === "number" ? data.order : 999
            });
        });
        list.sort(function (a, b) { return a.order - b.order; });
        return list;
    } catch (err) {
        logSafe("getMedications", err);
        return MEDICATIONS.slice();
    }
}

async function getOrCreateTodaySession() {
    const dateKey = todayKey();
    const ref = db.collection("dailySessions").doc(dateKey);
    const snap = await ref.get();

    if (snap.exists) {
        const data = snap.data() || {};
        return {
            date: dateKey,
            ref: ref,
            medications: data.medications || {},
            updatedAt: data.updatedAt || null,
            lastAction: data.lastAction || null
        };
    }

    const initialMeds = {};
    MEDICATIONS.forEach(function (med) {
        initialMeds[med.id] = {
            completed: false,
            dosesCompleted: 0,
            dosesPerDay: med.dosesPerDay,
            updatedAt: null,
            takenAt: null
        };
    });

    const initial = {
        date: dateKey,
        medications: initialMeds,
        updatedAt: nowIso(),
        lastAction: "init"
    };

    await ref.set(initial, { merge: true });

    return {
        date: dateKey,
        ref: ref,
        medications: initial.medications,
        updatedAt: initial.updatedAt,
        lastAction: initial.lastAction
    };
}

function signToken() {
    return jwt.sign(
        { sub: ADMIN_USERNAME, role: "admin" },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function authMiddleware(req, res, next) {
    const header = req.headers.authorization || "";
    const parts = header.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
        return res.status(401).json({ error: "authentication required" });
    }

    const token = parts[1];
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (!payload || payload.role !== "admin") {
            return res.status(401).json({ error: "invalid token" });
        }
        req.user = payload;
        next();
    } catch (err) {
        return res.status(401).json({ error: "session expired or invalid token" });
    }
}

const app = express();
app.disable("x-powered-by");

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
        return callback(null, false);
    },
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "32kb" }));

app.get("/api/health", function (req, res) {
    res.json({ ok: true, time: nowIso() });
});

app.get("/api/firebase-config", function (req, res) {
    const config = {
        apiKey: process.env.FIREBASE_WEB_API_KEY || "",
        authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN || "",
        projectId: process.env.FIREBASE_WEB_PROJECT_ID || "",
        storageBucket: process.env.FIREBASE_WEB_STORAGE_BUCKET || "",
        messagingSenderId: process.env.FIREBASE_WEB_MESSAGING_SENDER_ID || "",
        appId: process.env.FIREBASE_WEB_APP_ID || ""
    };

    if (!config.apiKey || !config.projectId) {
        return res.status(503).json({ error: "firebase web config not set" });
    }

    res.json({ config: config });
});

app.post("/api/auth/login", async function (req, res) {
    try {
        const body = req.body || {};
        const username = typeof body.username === "string" ? body.username.trim() : "";
        const password = typeof body.password === "string" ? body.password : "";

        if (!username || !password) {
            return res.status(400).json({ error: "username and password required" });
        }

        const usernameOk = username === ADMIN_USERNAME;
        const passwordOk = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

        if (!usernameOk || !passwordOk) {
            return res.status(401).json({ error: "invalid credentials" });
        }

        const token = signToken();
        res.json({ token: token });
    } catch (err) {
        logSafe("login", err);
        res.status(500).json({ error: "internal error" });
    }
});

app.get("/api/medications", authMiddleware, async function (req, res) {
    try {
        const list = await getMedications();
        res.json({ medications: list });
    } catch (err) {
        logSafe("getMedications", err);
        res.status(500).json({ error: "failed to load medications" });
    }
});

app.get("/api/medications/today", authMiddleware, async function (req, res) {
    try {
        const session = await getOrCreateTodaySession();
        res.json({
            date: session.date,
            session: {
                medications: session.medications,
                updatedAt: session.updatedAt,
                lastAction: session.lastAction
            }
        });
    } catch (err) {
        logSafe("today", err);
        res.status(500).json({ error: "failed to load today session" });
    }
});

app.post("/api/medications/:id/take", authMiddleware, async function (req, res) {
    try {
        const medId = req.params.id;
        if (!isValidMedicationId(medId)) {
            return res.status(400).json({ error: "invalid medication id" });
        }

        const med = MEDICATIONS_BY_ID[medId];
        const dosesPerDay = med.dosesPerDay;
        const source = (req.body && req.body.source === "mobile") ? "mobile" : "dashboard";

        const dateKey = todayKey();
        const sessionRef = db.collection("dailySessions").doc(dateKey);

        let result = null;

        await db.runTransaction(async function (tx) {
            const snap = await tx.get(sessionRef);

            let meds;
            if (snap.exists) {
                const data = snap.data() || {};
                meds = data.medications || {};
            } else {
                meds = {};
                MEDICATIONS.forEach(function (m) {
                    meds[m.id] = {
                        completed: false,
                        dosesCompleted: 0,
                        dosesPerDay: m.dosesPerDay,
                        updatedAt: null,
                        takenAt: null
                    };
                });
            }

            const current = meds[medId] || {
                completed: false,
                dosesCompleted: 0,
                dosesPerDay: dosesPerDay,
                updatedAt: null,
                takenAt: null
            };

            const alreadyCompleted = current.dosesCompleted || 0;

            if (alreadyCompleted >= dosesPerDay) {
                result = { status: "already_completed", doseNumber: alreadyCompleted };
                return;
            }

            const newCompleted = alreadyCompleted + 1;
            const isFullyCompleted = newCompleted >= dosesPerDay;
            const ts = nowIso();

            meds[medId] = {
                completed: isFullyCompleted,
                dosesCompleted: newCompleted,
                dosesPerDay: dosesPerDay,
                updatedAt: ts,
                takenAt: ts
            };

            const sessionPayload = {
                date: dateKey,
                medications: meds,
                updatedAt: ts,
                lastAction: "take:" + medId
            };

            if (snap.exists) {
                tx.set(sessionRef, sessionPayload, { merge: true });
            } else {
                tx.set(sessionRef, sessionPayload);
            }

            const eventRef = db.collection("events").doc();
            tx.set(eventRef, {
                type: "take",
                medicationId: medId,
                medicationName: med.name,
                scheduledTime: med.time || null,
                doseNumber: newCompleted,
                dosesPerDay: dosesPerDay,
                source: source,
                actor: ADMIN_USERNAME,
                createdAt: ts
            });

            result = {
                status: "ok",
                doseNumber: newCompleted,
                dosesCompleted: newCompleted,
                dosesPerDay: dosesPerDay,
                completed: isFullyCompleted,
                updatedAt: ts
            };
        });

        if (!result) {
            return res.status(500).json({ error: "transaction failed" });
        }

        if (result.status === "already_completed") {
            return res.status(409).json({
                error: "dose already recorded",
                dosesCompleted: result.doseNumber
            });
        }

        res.json({
            ok: true,
            medicationId: medId,
            doseNumber: result.doseNumber,
            dosesCompleted: result.dosesCompleted,
            dosesPerDay: result.dosesPerDay,
            completed: result.completed,
            updatedAt: result.updatedAt
        });
    } catch (err) {
        logSafe("take", err);
        res.status(500).json({ error: "failed to record dose" });
    }
});

app.post("/api/reset", authMiddleware, async function (req, res) {
    try {
        const dateKey = todayKey();
        const sessionRef = db.collection("dailySessions").doc(dateKey);
        const ts = nowIso();

        const resetMeds = {};
        MEDICATIONS.forEach(function (m) {
            resetMeds[m.id] = {
                completed: false,
                dosesCompleted: 0,
                dosesPerDay: m.dosesPerDay,
                updatedAt: ts,
                takenAt: null
            };
        });

        await db.runTransaction(async function (tx) {
            tx.set(sessionRef, {
                date: dateKey,
                medications: resetMeds,
                updatedAt: ts,
                lastAction: "reset"
            }, { merge: true });

            const eventRef = db.collection("events").doc();
            tx.set(eventRef, {
                type: "reset",
                actor: ADMIN_USERNAME,
                source: "dashboard",
                createdAt: ts
            });
        });

        res.json({ ok: true, date: dateKey, updatedAt: ts });
    } catch (err) {
        logSafe("reset", err);
        res.status(500).json({ error: "failed to reset" });
    }
});

app.get("/api/events", authMiddleware, async function (req, res) {
    try {
        const limitRaw = parseInt(req.query.limit, 10);
        const limit = (!isNaN(limitRaw) && limitRaw > 0 && limitRaw <= 100) ? limitRaw : 20;

        const snapshot = await db.collection("events")
            .orderBy("createdAt", "desc")
            .limit(limit)
            .get();

        const events = [];
        snapshot.forEach(function (doc) {
            const d = doc.data() || {};
            d.id = doc.id;
            events.push(d);
        });

        res.json({ events: events });
    } catch (err) {
        logSafe("events", err);
        res.status(500).json({ error: "failed to load events" });
    }
});

app.use(express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    setHeaders: function (res, filePath) {
        if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache");
        }
    }
}));

app.get("/", function (req, res) {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use("/api", function (req, res) {
    res.status(404).json({ error: "route not found" });
});

app.use(function (err, req, res, next) {
    logSafe("unhandled", err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "internal error" });
});

if (require.main === module) {
    ensureMedicationsSeeded()
        .catch(function (err) { logSafe("seed", err); })
        .finally(function () {
            app.listen(PORT, function () {
                console.log("Server running on port " + PORT);
            });
        });
}

module.exports = app;
