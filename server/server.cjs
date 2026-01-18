// server.cjs
const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const XLSX = require("xlsx");
const morgan = require("morgan");
const https = require("https");
const http = require("http");
const dotenv = require("dotenv");
dotenv.config();
const EMAILS_DISABLED =
  String(process.env.AUDIT_DISABLE_EMAILS || "").toLowerCase() === "true";

let auditPool; // auditms DB (AuditIssues, reports, etc.)
let spotPool; // SPOT DB (EMP, OTP storage)

const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");
require("isomorphic-fetch");
const { v4: uuidv4 } = require("uuid");

const app = express();

/* ----------------------------- CORS & middleware ---------------------------- */
app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.options(/.*/, cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

/* ------------------------------ Static hosting ------------------------------ */
app.use((req, res, next) => {
  if (req.path === "/" || req.path.endsWith("index.html")) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

app.use(express.static(path.join(__dirname, "../dist")));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

/* --------------------------------- Multer ---------------------------------- */
const memoryUpload = multer({ storage: multer.memoryStorage() });
const evidenceStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.random().toString(36).substr(2, 9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const diskUpload = multer({ storage: evidenceStorage });

/* ------------------------------- DB (MSSQL) -------------------------------- */
const AUDIT_DB_NAME = process.env.AUDIT_DB_NAME || "auditms";
const SPOT_DB_NAME = process.env.SPOT_DB_NAME || "SPOT";
const OTP_TABLE = process.env.OTP_TABLE || "AuditPortalLogin"; // <— new table name

const commonDb = {
  user: process.env.DB_USER || "SPOT_USER",
  password: process.env.DB_PASS || "Marvik#72@",
  server: process.env.DB_HOST || "10.0.40.10",
  port: Number(process.env.DB_PORT || 1433),
  options: {
    trustServerCertificate: true,
    encrypt: false,
    connectionTimeout: 60000,
  },
};

const auditDbConfig = { ...commonDb, database: AUDIT_DB_NAME }; // for AuditIssues
const spotDbConfig = { ...commonDb, database: SPOT_DB_NAME }; // for EMP + OTPs

/* --------------------------- Microsoft Graph setup -------------------------- */
const CLIENT_ID = "3d310826-2173-44e5-b9a2-b21e940b67f7";
const TENANT_ID = "1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1";
const CLIENT_SECRET = "2e78Q~yX92LfwTTOg4EYBjNQrXrZ2z5di1Kvebog";
const SENDER_EMAIL = "spot@premierenergies.com";

const credential = new ClientSecretCredential(
  TENANT_ID,
  CLIENT_ID,
  CLIENT_SECRET
);
const graphClient = Client.initWithMiddleware({
  authProvider: {
    getAccessToken: async () => {
      const tokenResponse = await credential.getToken(
        "https://graph.microsoft.com/.default"
      );
      return tokenResponse.token;
    },
  },
});

async function sendEmail(toEmail, subject, htmlContent, ccEmail = []) {
  const toList = Array.isArray(toEmail)
    ? toEmail
    : String(toEmail || "")
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);

  const ccList = Array.isArray(ccEmail)
    ? ccEmail
    : String(ccEmail || "")
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);

  const normalize = (x) => {
    if (!x) return null;
    const s = String(x).trim();
    return s.includes("@") ? s : `${s}@premierenergies.com`;
  };
  const normalizedTo = toList.map(normalize).filter(Boolean);
  const normalizedCc = ccList.map(normalize).filter(Boolean);

  const message = {
    subject,
    body: { contentType: "HTML", content: htmlContent },
    toRecipients: normalizedTo.map((addr) => ({
      emailAddress: { address: addr },
    })),
    ccRecipients: normalizedCc.map((addr) => ({
      emailAddress: { address: addr },
    })),
  };

  // 🔇 SHORT-CIRCUIT WHEN EMAILS DISABLED
  if (EMAILS_DISABLED) {
    console.log("[EMAIL DISABLED] Would send email:", {
      to: normalizedTo,
      cc: normalizedCc,
      subject,
    });
    return; // pretend success, all callers continue as normal
  }

  try {
    await graphClient
      .api(`/users/${SENDER_EMAIL}/sendMail`)
      .post({ message, saveToSentItems: true });
  } catch (err) {
    const status = err?.statusCode || err?.status;
    const body = err?.body || err?.message;
    console.error("Graph sendMail failed:", status, body);
    throw err;
  }
}

// normalize “Accepted” checks everywhere
const isAccepted = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase() === "accepted";

/* ------------------------------ Mail templating ------------------------------ */
const APP_NAME = process.env.APP_NAME || "CAM: Comprehensive Audit Management";
const getAuditorList = () => [
  ...new Set([...AUDITOR_EMAILS, ...STATIC_AUDITORS]),
];

function emailTemplate({
  title,
  paragraphs = [],
  highlight = "",
  footerNote = "",
}) {
  // paragraphs: array of HTML-safe strings (<b>, <br> OK)
  return `
<div style="font-family:Arial,sans-serif;color:#333;line-height:1.45;background:#f6f7f9;padding:24px;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e6e8eb;border-radius:8px;overflow:hidden;">
    <div style="background:#0b5fff;color:#fff;padding:14px 18px;font-weight:600;">
      ${title}
    </div>
    <div style="padding:20px;">
      ${paragraphs.map((p) => `<p style="margin:0 0 12px;">${p}</p>`).join("")}
      ${
        highlight
          ? `
      <div style="font-size:16px;letter-spacing:0.5px;font-weight:700;background:#f0f4ff;border:1px dashed #b9c7ff;border-radius:8px;padding:12px 16px;text-align:center;margin-top:10px;">
        ${highlight}
      </div>`
          : ""
      }
      ${
        footerNote
          ? `<p style="margin:14px 0 0;font-size:12px;color:#666;">${footerNote}</p>`
          : ""
      }
      <p style="margin:18px 0 0;">Regards,<br/><b>Team ${APP_NAME}</b></p>
    </div>
  </div>
  <div style="max-width:720px;margin:10px auto 0;text-align:center;color:#99a1ab;font-size:12px;">
    This is an automated message from ${APP_NAME}.
  </div>
</div>`;
}

function uniqEmails(...lists) {
  const flat = lists.flat().filter(Boolean).join(";");
  return [
    ...new Set(
      flat
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

function buildCaption(row) {
  return `${row.serialNumber ?? ""} – ${row.process ?? ""} / ${
    row.entityCovered ?? ""
  }`;
}

/* ------------------------------ DB bootstrap ------------------------------- */
async function initDb() {
  try {
    // Connect to both databases
    auditPool = await new sql.ConnectionPool(auditDbConfig).connect();
    spotPool = await new sql.ConnectionPool(spotDbConfig).connect();

    // mysql2-ish shim (only for audit pool where we use connection.execute)
    auditPool.getConnection = async () => ({
      execute: async (query, params) => {
        let sqlText = query;
        const req = auditPool.request();
        if (Array.isArray(params) && params.length) {
          // Replace each "?" with @pN and bind
          params.forEach((val, i) => {
            const name = `p${i}`;
            sqlText = sqlText.replace(/\?/, `@${name}`);
            req.input(name, val);
          });
        }
        const result = await req.query(sqlText);
        return [result.recordset];
      },
    });

    // Ensure AuditIssues table exists in AUDIT DB
    const tableCheckQuery = `
    IF NOT EXISTS (
        SELECT 1
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE t.name = 'AuditIssues'
           AND s.name = 'dbo'
    )
    BEGIN
        CREATE TABLE dbo.AuditIssues (
            id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
            serialNumber INT IDENTITY(1,1) NOT NULL,
            fiscalYear VARCHAR(20) NOT NULL,
            date DATE NOT NULL,
            process VARCHAR(100) NOT NULL,
            entityCovered VARCHAR(100) NOT NULL,
            observation NVARCHAR(MAX) NOT NULL,
            riskLevel VARCHAR(10) NOT NULL,
            recommendation NVARCHAR(MAX) NOT NULL,
            managementComment NVARCHAR(MAX) NULL,
            personResponsible NVARCHAR(512) NOT NULL,
            approver NVARCHAR(1024) NOT NULL,
            cxoResponsible NVARCHAR(1024) NOT NULL,
            coOwner NVARCHAR(512) NULL,
            timeline DATE NULL,
            currentStatus VARCHAR(50) NOT NULL,
            evidenceReceived NVARCHAR(MAX) NULL,
            evidenceStatus VARCHAR(50) NULL,
            reviewComments NVARCHAR(MAX) NULL,
            risk NVARCHAR(MAX) NULL,
            actionRequired NVARCHAR(MAX) NULL,
            startMonth VARCHAR(20) NULL,
            endMonth VARCHAR(20) NULL,
            annexure NVARCHAR(MAX) NULL,
            createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
            updatedAt DATETIME2 NOT NULL DEFAULT GETDATE()
        );
    END;

    IF COL_LENGTH('dbo.AuditIssues','iaComments') IS NOT NULL
      ALTER TABLE dbo.AuditIssues DROP COLUMN iaComments;
    `;
    await auditPool.request().query(tableCheckQuery);
    console.log("✅ AuditIssues table is ready (AUDIT DB)");

    // ⬇️ Add this after table creation checks
    await auditPool.request().query(`
  IF COL_LENGTH('dbo.AuditIssues','quarter') IS NULL
  BEGIN
    ALTER TABLE dbo.AuditIssues ADD quarter VARCHAR(10) NULL;
    -- One-time backfill for existing rows: serialNumber >= 52 => Q2, else Q4
    UPDATE dbo.AuditIssues
      SET quarter = CASE WHEN serialNumber >= 52 THEN 'Q2' ELSE 'Q4' END
      WHERE quarter IS NULL;
  END
`);

    // Ensure Auditors table exists (email + processes JSON or delimited; "*" => all)
    const auditorsTableCheck = `
    IF NOT EXISTS (
        SELECT 1
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE t.name = 'Auditors'
           AND s.name = 'dbo'
    )
    BEGIN
        CREATE TABLE dbo.Auditors (
            id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
            email NVARCHAR(255) NOT NULL,
            processes NVARCHAR(MAX) NULL,  -- JSON array OR "a;b;c" OR "*"
            createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
            updatedAt DATETIME2 NOT NULL DEFAULT GETDATE()
        );
    END;
    `;
    await auditPool.request().query(auditorsTableCheck);

    // Ensure OTP table exists in SPOT DB (distinct from other apps' Login table)
    const loginTableCheck = `
    IF NOT EXISTS (
        SELECT 1
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE t.name = '${OTP_TABLE}'
           AND s.name = 'dbo'
    )
    BEGIN
        CREATE TABLE dbo.${OTP_TABLE} (
          Username    NVARCHAR(255) NOT NULL PRIMARY KEY,
          OTP         NVARCHAR(10)  NULL,
          OTP_Expiry  DATETIME2     NULL,
          LEmpID      NVARCHAR(50)  NULL
        );
    END;
`;

    await spotPool.request().query(loginTableCheck);
    console.log(`✅ ${OTP_TABLE} table present (SPOT DB)`);
  } catch (err) {
    console.error("⛔ Failed to initialize database:", err);
    process.exit(1);
  }
}
initDb();

/* -------------------------------- Utilities -------------------------------- */
const formatDate = (val) => {
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
};
const convertExcelDate = (excelDate) => {
  if (!excelDate || typeof excelDate !== "number") return null;
  const jsDate = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  return jsDate.toISOString().split("T")[0];
};

// Reset identity to 1 when the table is empty (next insert becomes 1)
async function reseedSerialIfEmpty() {
  try {
    await auditPool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.AuditIssues)
      BEGIN
        DBCC CHECKIDENT ('dbo.AuditIssues', RESEED, 0) WITH NO_INFOMSGS;
      END
    `);
  } catch (e) {
    console.warn("reseedSerialIfEmpty warning:", e?.message || e);
  }
}

const normStatus = (s) => {
  if (Array.isArray(s)) s = s[0] ?? "";
  const status = String(s ?? "")
    .trim()
    .toLowerCase();
  if (!status) return "To Be Received";
  if (status === "to be received" || status.includes("to be"))
    return "To Be Received";
  if (status === "partially received" || status.includes("partially"))
    return "Partially Received";
  if (
    status === "received" ||
    (status.includes("received") && !status.includes("to be"))
  )
    return "Received";
  if (status === "closed") return "Closed";
  if (status.includes("progress")) return "In Progress";
  if (status.includes("resolv")) return "Resolved";
  return "To Be Received";
};

const normRiskLevel = (r) => {
  if (Array.isArray(r)) r = r[0];
  const s = String(r ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "medium";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  if (s === "low") return "low";
  if (s.includes("high")) return "high";
  if (s.includes("low")) return "low";
  if (s.includes("med")) return "medium";
  if (/^(3|h)$/.test(s)) return "high";
  if (/^(2|m)$/.test(s)) return "medium";
  if (/^(1|l)$/.test(s)) return "low";
  return "medium";
};

const normQuarter = (q) => {
  const s = String(q || "")
    .trim()
    .toUpperCase();
  return ["Q1", "Q2", "Q3", "Q4"].includes(s) ? s : null;
};

// Accepts array, JSON-stringified array, or delimited string and returns string[]
const toEmails = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    return s
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [String(val)];
};

const normalizeToEmail = (raw) => {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return s;
  return s.includes("@") ? s : `${s}@premierenergies.com`;
};

// Validate that all provided emails exist in EMP (ActiveFlag=1)
async function findMissingEmployees(rawList) {
  const list = Array.from(
    new Set((rawList || []).map((e) => normalizeToEmail(e)).filter(Boolean))
  );
  if (!list.length) return [];
  const req = spotPool.request(); // EMP lives in SPOT
  const clauses = [];
  list.forEach((e, i) => {
    req.input(`e${i}`, sql.NVarChar(255), e);
    clauses.push(`LOWER(EmpEmail) = LOWER(@e${i})`);
  });
  const q = `
    SELECT LOWER(EmpEmail) AS email
    FROM dbo.EMP
    WHERE ActiveFlag = 1 AND (${clauses.join(" OR ")})
  `;
  const rs = await req.query(q);
  const found = new Set(
    (rs.recordset || []).map((r) => String(r.email || "").toLowerCase())
  );
  return list.filter((e) => !found.has(e.toLowerCase()));
}

// near top of server.cjs
const AUDITOR_EMAILS = String(process.env.AUDITOR_EMAILS || "")
  .toLowerCase()
  .split(/[,\s;]+/)
  .filter(Boolean);
const STATIC_AUDITORS = [
  "santosh.kumar@protivitiglobal.in",
  "aarnav.singh@premierenergies.com",
  "borra.prasanna@protivitiglobal.in",
  "aman.shah@protivitiglobal.in",
];

function parseProcesses(val) {
  if (!val) return [];
  if (Array.isArray(val))
    return val.map((x) => String(x).trim()).filter(Boolean);
  const s = String(val || "").trim();
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr))
      return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch (_) {}
  return s
    .split(/[;,]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const getStaticAuditors = () =>
  [...new Set([...AUDITOR_EMAILS, ...STATIC_AUDITORS])].map((x) =>
    x.toLowerCase()
  );

async function listAuditorsFromDb() {
  const connection = await auditPool.getConnection();
  const [rows] = await connection.execute(
    `SELECT id, email, processes, createdAt, updatedAt FROM dbo.Auditors ORDER BY createdAt DESC`
  );
  return (rows || []).map((r) => ({
    id: r.id,
    email: String(r.email || "").toLowerCase(),
    processes: parseProcesses(r.processes),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

function processesMatch(allowedList, proc) {
  if (!allowedList?.length) return false;
  return allowedList.some(
    (p) =>
      p === "*" ||
      /^all$/i.test(p) ||
      (proc && String(p).toLowerCase() === String(proc).toLowerCase())
  );
}

async function isGlobalAuditor(email) {
  const em = String(email || "").toLowerCase();
  if (!em) return false;
  if (getStaticAuditors().includes(em)) return true;
  const dyn = await listAuditorsFromDb();
  return dyn.some((r) => r.email === em && processesMatch(r.processes, "*"));
}

async function isAuditorEmail(email, processOpt = null) {
  const em = String(email || "").toLowerCase();
  if (!em) return false;
  const statics = getStaticAuditors();
  if (statics.includes(em)) return true;
  const dyn = await listAuditorsFromDb();
  if (!processOpt) return dyn.some((r) => r.email === em); // any DB row qualifies as "auditor"
  return dyn.some(
    (r) => r.email === em && processesMatch(r.processes, processOpt)
  );
}

async function getAuditorsForProcess(procOpt = null) {
  const out = new Set(getStaticAuditors());
  const dyn = await listAuditorsFromDb();
  for (const r of dyn) {
    if (!procOpt || processesMatch(r.processes, procOpt)) out.add(r.email);
  }
  return [...out];
}

// 🔓 Single privileged unlocker (can bypass "Accepted" locks)
const SPECIAL_UNLOCKER = "santosh.kumar@protivitiglobal.in";
const isPrivilegedUnlocker = (em) =>
  String(em || "").toLowerCase() === SPECIAL_UNLOCKER;
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

/* ---------------------------- Unlock (Accepted → open) ---------------------------- */
app.post("/api/audit-issues/:id/unlock", async (req, res) => {
  const { id } = req.params;
  const actorRaw = (req.body?.actor || req.query?.actor || "")
    .toString()
    .trim();
  const actor = normalizeToEmail(actorRaw);

  const reason = (req.body?.reason || req.query?.reason || "")
    .toString()
    .trim();

  if (!actor) return res.status(400).json({ error: "Missing actor" });
  if (!isPrivilegedUnlocker(actor))
    return res
      .status(403)
      .json({ error: "Only the designated unlocker can unlock." });

  if (!reason) {
    return res.status(400).json({ error: "Unlock reason is required" });
  }

  try {
    const connection = await auditPool.getConnection();
    const [rows] = await connection.execute(
      `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
      [id]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Audit issue not found" });
    const row = rows[0];

    if (!isAccepted(row.evidenceStatus)) {
      return res.status(409).json({ error: "Issue is not in Accepted state." });
    }

    let currentEvidence = [];
    try {
      currentEvidence = JSON.parse(row.evidenceReceived || "[]");
    } catch {}
    const unlockEntry = {
      id: Date.now() + "-unlock-" + Math.random().toString(36).substr(2, 9),
      fileName: "System",
      fileType: "text/plain",
      fileSize: String(reason || "").length,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor,
      content: `Issue unlocked by auditor for further edits/review. Reason: ${reason}`,
    };
    const updatedEvidence = [...currentEvidence, unlockEntry];

    const nextStatus =
      row.currentStatus === "Closed" ? "Closed" : "To Be Received";
    await connection.execute(
      `UPDATE dbo.AuditIssues
           SET evidenceStatus = ?, currentStatus = ?, evidenceReceived = ?, updatedAt = GETDATE()
         WHERE id = ?`,
      ["Submitted", nextStatus, JSON.stringify(updatedEvidence), id]
    );

    // Reload
    const [after] = await connection.execute(
      `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
      [id]
    );
    const updated = after[0];
    try {
      updated.evidenceReceived = JSON.parse(updated.evidenceReceived || "[]");
    } catch {}
    updated.evidenceStatus =
      updated.evidenceStatus ||
      (updated.evidenceReceived?.length ? "Submitted" : undefined);
    updated.isLocked = isAccepted(updated.evidenceStatus);

    // Notify
    const cc = getAuditorList();
    const to = uniqEmails(
      updated.personResponsible,
      updated.approver,
      updated.cxoResponsible
    );
    const subject = `${APP_NAME}, Unlocked (${updated.serialNumber})`;
    const caption = `${updated.serialNumber} – ${updated.process} / ${updated.entityCovered}`;
    const html = emailTemplate({
      title: `🔓 ${APP_NAME}: Issue Unlocked`,
      paragraphs: [
        `<b>Issue:</b> ${caption}`,
        `<b>Observation:</b> ${updated.observation || "—"}`,
        `Unlocked by: ${actor}`,
        `<b>Unlock Reason:</b> ${reason}`,
        `Status set to: <b>Submitted</b> / ${nextStatus}`,
        `Visit <a href="https://audit.premierenergies.com">audit.premierenergies.com</a> to review.`,
      ],
    });

    try {
      await sendEmail(to, subject, html, cc);
    } catch (e) {
      console.warn("mail(unlock) failed:", e?.message || e);
    }

    return res.json(updated);
  } catch (err) {
    console.error("⛔ Unlock error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// server.cjs (near other /api routes)
/* ------------------------------- Auditors CRUD ------------------------------ */
// List all auditors (env/static + DB)
app.get("/api/auditors", async (_req, res) => {
  try {
    const envRows = AUDITOR_EMAILS.map((email) => ({
      id: null,
      email,
      processes: ["*"],
      source: "env",
    }));
    const staticRows = STATIC_AUDITORS.map((email) => ({
      id: null,
      email,
      processes: ["*"],
      source: "static",
    }));
    const dbRowsRaw = await listAuditorsFromDb();
    const dbRows = dbRowsRaw.map((r) => ({
      id: r.id,
      email: r.email,
      processes: r.processes?.length ? r.processes : ["*"],
      source: "db",
    }));
    // de-dup on email, prefer DB rows over env/static
    const merged = new Map();
    [...dbRows, ...envRows, ...staticRows].forEach((r) => {
      if (!merged.has(r.email)) merged.set(r.email, r);
    });
    res.json(
      [...merged.values()].sort((a, b) => a.email.localeCompare(b.email))
    );
  } catch (e) {
    console.error("auditors:list", e);
    res.status(500).json({ error: "Failed to load auditors" });
  }
});

// Create
app.post("/api/auditors", async (req, res) => {
  try {
    const actor = normalizeToEmail(req.body?.actor || req.query?.actor || "");
    if (!actor || !(await isGlobalAuditor(actor))) {
      return res
        .status(403)
        .json({ error: "Only global auditors can modify auditors list." });
    }
    const email = normalizeToEmail(req.body?.email || "");
    const processes = parseProcesses(req.body?.processes || ["*"]);
    if (!email) return res.status(400).json({ error: "email required" });
    const procs = processes.length ? processes : ["*"];
    const connection = await auditPool.getConnection();
    await connection.execute(
      `INSERT INTO dbo.Auditors (email, processes, createdAt, updatedAt)
        VALUES (?, ?, GETDATE(), GETDATE())`,
      [email.toLowerCase(), JSON.stringify(procs)]
    );
    res.status(201).json({ success: true });
  } catch (e) {
    console.error("auditors:create", e);
    res.status(500).json({ error: "Failed to create auditor" });
  }
});

// Update
app.put("/api/auditors/:id", async (req, res) => {
  try {
    const actor = normalizeToEmail(req.body?.actor || req.query?.actor || "");
    if (!actor || !(await isGlobalAuditor(actor))) {
      return res
        .status(403)
        .json({ error: "Only global auditors can modify auditors list." });
    }
    const id = req.params.id;
    const email = normalizeToEmail(req.body?.email || "");
    const processes = parseProcesses(req.body?.processes || ["*"]);
    if (!id) return res.status(400).json({ error: "id required" });
    if (!email) return res.status(400).json({ error: "email required" });
    const procs = processes.length ? processes : ["*"];
    const connection = await auditPool.getConnection();
    await connection.execute(
      `UPDATE dbo.Auditors SET email = ?, processes = ?, updatedAt = GETDATE() WHERE id = ?`,
      [email.toLowerCase(), JSON.stringify(procs), id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error("auditors:update", e);
    res.status(500).json({ error: "Failed to update auditor" });
  }
});

// Delete
app.delete("/api/auditors/:id", async (req, res) => {
  try {
    const actor = normalizeToEmail(req.body?.actor || req.query?.actor || "");
    if (!actor || !(await isGlobalAuditor(actor))) {
      return res
        .status(403)
        .json({ error: "Only global auditors can modify auditors list." });
    }
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "id required" });
    const connection = await auditPool.getConnection();
    await connection.execute(`DELETE FROM dbo.Auditors WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (e) {
    console.error("auditors:delete", e);
    res.status(500).json({ error: "Failed to delete auditor" });
  }
});

/* ======================= OTP AUTH (SPOT: EMP + OTPs) ======================= */

// Request OTP (EMP-validated, OTP stored in dbo.AuditPortalLogin)
// Request OTP (EMP-validated, OTP stored in dbo.AuditPortalLogin)
app.post("/api/send-otp", async (req, res) => {
  try {
    const rawEmail = (req.body.email || "").trim();
    const fullEmail = normalizeToEmail(rawEmail);

    const empQ = await spotPool
      .request()
      .input("em", sql.NVarChar(255), fullEmail).query(`
        SELECT EmpID, EmpName 
        FROM dbo.EMP
        WHERE EmpEmail = @em AND ActiveFlag = 1
      `);

    // EMP users OR whitelisted auditors can get OTP
    let empID = null;
    if (empQ.recordset.length) {
      empID = String(empQ.recordset[0].EmpID ?? "");
    } else if (!(await isAuditorEmail(fullEmail))) {
      return res.status(404).json({
        message:
          "We do not have this email registered in EMP. If you have a company email ID, please contact HR.",
      });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Upsert OTP into dbo.AuditPortalLogin (SPOT)
    await spotPool
      .request()
      .input("u", sql.NVarChar(255), fullEmail)
      .input("o", sql.NVarChar(10), otp)
      .input("exp", sql.DateTime2, expiry)
      .input("emp", sql.NVarChar(50), empID).query(`
        IF EXISTS (SELECT 1 FROM dbo.${OTP_TABLE} WHERE Username = @u)
          UPDATE dbo.${OTP_TABLE} SET OTP = @o, OTP_Expiry = @exp, LEmpID = @emp WHERE Username = @u;
        ELSE
          INSERT INTO dbo.${OTP_TABLE} (Username, OTP, OTP_Expiry, LEmpID) VALUES (@u, @o, @exp, @emp);
      `);

    const subject = `${APP_NAME}, OTP`;
    const minutesValid = 5;

    const html = emailTemplate({
      title: `🔐 ${APP_NAME}, OTP`,
      paragraphs: [
        "Hello,",
        `Use the following code to continue signing in to <b>${APP_NAME}</b>:`,
        `Open <a href="https://audit.premierenergies.com">audit.premierenergies.com</a> and enter this OTP.`,
      ],
      highlight: `<span style="font-size:22px;letter-spacing:3px;">${otp}</span>`,
      footerNote: `This code is valid for ${minutesValid} minutes.`,
    });

    // 🔑 TEST MODE: if emails are disabled, just return the OTP in response
    if (EMAILS_DISABLED) {
      console.warn("[EMAIL DISABLED] OTP generated:", otp);
      return res
        .status(200)
        .json({ message: "OTP generated (email disabled)", devOtp: otp });
    }

    try {
      await sendEmail(fullEmail, subject, html);
      return res.status(200).json({ message: "OTP sent successfully" });
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[DEV] Email failed, using inline OTP:", otp);
        return res
          .status(200)
          .json({ message: "OTP generated (dev)", devOtp: otp });
      }
      return res.status(502).json({
        message:
          "OTP generated, but email service failed. Please try again shortly.",
      });
    }
  } catch (error) {
    console.error("Error in /api/send-otp:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Verify OTP (reads dbo.AuditPortalLogin in SPOT)
app.post("/api/verify-otp", async (req, res) => {
  try {
    const rawEmail = (req.body.email || "").trim();
    const fullEmail = normalizeToEmail(rawEmail);
    const otp = (req.body.otp || "").trim();

    const rs = await spotPool
      .request()
      .input("u", sql.NVarChar(255), fullEmail)
      .input("o", sql.NVarChar(10), otp).query(`
        SELECT OTP, OTP_Expiry, LEmpID
        FROM dbo.${OTP_TABLE}
        WHERE Username = @u AND OTP = @o
      `);

    if (!rs.recordset.length) {
      return res.status(400).json({ message: "Invalid OTP" });
    }
    const row = rs.recordset[0];
    if (new Date() > new Date(row.OTP_Expiry)) {
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });
    }

    // Optional: fetch name for convenience
    const emp = await spotPool
      .request()
      .input("id", sql.NVarChar(50), String(row.LEmpID ?? "")).query(`
        SELECT TOP 1 EmpName FROM dbo.EMP WHERE EmpID = @id
      `);
    const empName = emp.recordset.length ? emp.recordset[0].EmpName : fullEmail;

    res.status(200).json({
      message: "OTP verified successfully",
      empID: row.LEmpID,
      empName,
    });
  } catch (error) {
    console.error("Error in /api/verify-otp:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------- Role resolution ------------------------------ */
// 'approver' if email appears in approver or cxoResponsible in ANY issue; else 'user'
app.get("/api/resolve-role", async (req, res) => {
  try {
    const fullEmail = normalizeToEmail(req.query.email || "");
    if (!fullEmail) return res.status(400).json({ role: "user" });

    // ✅ auditors first — even if not present in any issue lists
    // auditors first — even if not present in any issue lists
    if (await isAuditorEmail(fullEmail)) {
      return res.json({ role: "auditor" });
    }

    const rq = auditPool.request().input("em", sql.NVarChar(255), fullEmail);

    const approverQ = await rq.query(`
      SELECT TOP 1 id FROM dbo.AuditIssues 
      WHERE (',' + LOWER(REPLACE(approver,'; ',','))
              + ',' + LOWER(REPLACE(cxoResponsible,'; ',','))
            ) LIKE '%,' + LOWER(@em) + ',%'
    `);
    if (approverQ.recordset.length) {
      return res.json({ role: "approver" });
    }

    const userQ = await auditPool
      .request()
      .input("em", sql.NVarChar(255), fullEmail).query(`
        SELECT TOP 1 id FROM dbo.AuditIssues
        WHERE (',' + LOWER(REPLACE(personResponsible,'; ',','))
              ) LIKE '%,' + LOWER(@em) + ',%'
      `);
    if (userQ.recordset.length) {
      return res.json({ role: "user" });
    }

    return res.json({ role: "user" });
  } catch (err) {
    console.error("resolve-role error:", err);
    return res.json({ role: "user" });
  }
});

/* ----------------------- CREATE (single, from UI modal) --------------------- */
app.post("/api/audit-issues", memoryUpload.any(), async (req, res) => {
  try {
    await reseedSerialIfEmpty();
    const body = req.body;

    const toList = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);
    const approvers = toList(body.approver);
    const cxoList = toList(body.cxoResponsible);
    const cxoCoOwners = toList(body["cxoCoOwner[]"]);

    // ✅ EMP validation for PR/Approver/CXO (per requirement)
    const prList = toEmails(body.personResponsible).map(normalizeToEmail);
    const apprList = approvers.flatMap((x) =>
      toEmails(x).map(normalizeToEmail)
    );
    const cxoNormalized = cxoList.flatMap((x) =>
      toEmails(x).map(normalizeToEmail)
    );
    const coOwnerList = cxoCoOwners.flatMap((x) =>
      toEmails(x).map(normalizeToEmail)
    );

    const missing = await findMissingEmployees([
      ...prList,
      ...apprList,
      ...cxoNormalized,
      ...coOwnerList,
    ]);
    if (missing.length) {
      return res
        .status(400)
        .json({ error: `Unknown employee email(s): ${missing.join(", ")}` });
    }

    // Annexure files (separate from evidence)
    const annexureFiles = (req.files || []).filter(
      (f) => f.fieldname === "annexure"
    );
    let annexureArr = [];
    if (annexureFiles.length) {
      const saved = [];
      for (const f of annexureFiles) {
        const unique =
          Date.now() +
          "-" +
          Math.random().toString(36).substr(2, 9) +
          path.extname(f.originalname);
        const dest = path.join(uploadsDir, unique);
        fs.writeFileSync(dest, f.buffer);
        saved.push({
          name: f.originalname,
          path: path.relative(__dirname, dest),
          size: f.size,
          type: f.mimetype,
          uploadedAt: new Date().toISOString(),
        });
      }
      annexureArr = saved;
    }

    const id = uuidv4();
    const connection = await auditPool.getConnection();
    const quarter = normQuarter(body.quarter) || null;
    const insertQuery = `
      INSERT INTO dbo.AuditIssues (
        id, fiscalYear, quarter, date, process, entityCovered, observation, riskLevel,
        recommendation, managementComment, personResponsible, approver,
        cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived,
        reviewComments, risk, actionRequired, startMonth, endMonth, annexure, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
    `;

    const fiscalYear = body.fiscalYear || "";
    const date = formatDate(body.date) || formatDate(new Date());
    const process = body.process || "";
    const entityCovered = body.entityCovered || "";
    const observation = body.observation || "";
    const riskLevel = normRiskLevel(body.riskLevel);
    const recommendation = body.recommendation || "";
    const managementComment = body.managementComment || "";
    const personResponsible = prList.join(";"); // already normalized
    const approver = apprList.join(";");
    const cxoResponsible = cxoNormalized.join(";");
    const coOwner = coOwnerList.join(";");
    const timeline = body.timeline ? formatDate(body.timeline) : null;
    const currentStatus = normStatus(body.currentStatus);
    const evidenceReceived = JSON.stringify([]);
    const reviewComments = body.reviewComments || "";
    const risk = body.risk || "";
    const actionRequired = body.actionRequired || "";
    const startMonth = body.coverageStartMonth || body.startMonth || "";
    const endMonth = body.coverageEndMonth || body.endMonth || "";
    const annexure = JSON.stringify(annexureArr);

    const values = [
      id,
      fiscalYear,
      quarter,
      date,
      process,
      entityCovered,
      observation,
      riskLevel,
      recommendation,
      managementComment,
      personResponsible,
      approver,
      cxoResponsible,
      coOwner,
      timeline,
      currentStatus,
      evidenceReceived,
      reviewComments,
      risk,
      actionRequired,
      startMonth,
      endMonth,
      annexure,
    ];

    await connection.execute(insertQuery, values);

    const [rows] = await connection.execute(
      `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
      [id]
    );
    const created = rows[0] || { id };
    try {
      created.evidenceReceived = JSON.parse(created.evidenceReceived || "[]");
      created.annexure = JSON.parse(created.annexure || "[]");
    } catch {}
    // 📧 New Issue created — notify auditors (CC PR/Approver/CXO)
    try {
      const cc = getAuditorList();
      const to = uniqEmails(personResponsible, approver, cxoResponsible);
      const subject = `${APP_NAME}, New Audit Issue Created (${created.serialNumber})`;
      const html = emailTemplate({
        title: `🆕 ${APP_NAME}: New Audit Issue Created`,
        paragraphs: [
          `<b>Issue:</b> ${buildCaption(created)}`,
          `<b>Observation:</b> ${created.observation || "—"}`,
          `<b>Risk:</b> ${created.riskLevel || "medium"}`,
          `<b>Due Date:</b> ${created.timeline || "—"}`,
          `Visit <a href="https://audit.premierenergies.com">audit.premierenergies.com</a> to review.`,
        ],
        footerNote: `You were included as Auditor (To) or Stakeholder (CC).`,
      });
      await sendEmail(to, subject, html, cc);
    } catch (e) {
      console.warn("mail(new issue) failed:", e?.message || e);
    }

    res.status(201).json(created);
  } catch (err) {
    console.error("⛔ Create issue error:", err);
    res.status(500).json({ error: "Failed to create audit issue" });
  }
});

// ======================= Export Audit Issues (XLSX) =======================
app.get("/api/audit-issues/export", async (req, res) => {
  try {
    const viewerRaw = String(req.query.viewer || "")
      .trim()
      .toLowerCase();
    const scope = String(req.query.scope || "mine"); // "mine" | "all"
    const viewer = normalizeToEmail(viewerRaw);

    const connection = await auditPool.getConnection();
    const [rows] = await connection.execute(`
      SELECT 
        id, serialNumber, fiscalYear, quarter, date, process, entityCovered, observation,
        riskLevel, recommendation, managementComment, personResponsible, approver,
        cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived, evidenceStatus,
        reviewComments, risk, actionRequired, startMonth, endMonth, annexure,
        createdAt, updatedAt
      FROM dbo.AuditIssues
      ORDER BY createdAt DESC;
    `);

    const issues = rows.map((r) => {
      let ev = [],
        ax = [];
      try {
        ev = JSON.parse(r.evidenceReceived || "[]");
      } catch {}
      try {
        ax = JSON.parse(r.annexure || "[]");
      } catch {}
      const effectiveEvidenceStatus =
        r.evidenceStatus || (ev.length ? "Submitted" : null);
      return {
        ...r,
        evidenceReceived: ev,
        annexure: ax,
        evidenceStatus: effectiveEvidenceStatus,
      };
    });

    // 🔐 Enforce same visibility rules as the JSON list route
    let filtered = issues;

    if (scope === "all") {
      if (!viewer) return res.status(400).json({ error: "viewer required" });
      const isGlobal = await isGlobalAuditor(viewer);
      if (!isGlobal) {
        const dyn = await listAuditorsFromDb();
        const me = dyn.find((r) => r.email === viewer.toLowerCase());
        if (!me) return res.status(403).json({ error: "forbidden" });
        const allowed = new Set(
          me.processes.map((p) => String(p || "").toLowerCase())
        );
        filtered = issues.filter((r) => {
          const proc = String(r.process || "").toLowerCase();
          return allowed.has("*") || allowed.has("all") || allowed.has(proc);
        });
      }
    } else {
      if (!viewer) return res.status(400).json({ error: "viewer required" });
      filtered = issues.filter((r) => {
        const toks = [
          r.personResponsible,
          r.approver,
          r.cxoResponsible,
        ].flatMap((s) =>
          String(s || "")
            .toLowerCase()
            .split(/[;,]\s*/)
            .map((x) => x.trim())
            .filter(Boolean)
        );
        return toks.includes(viewer.toLowerCase());
      });
    }

    // Shape clean export rows (friendly headers, counts instead of blobs)
    const exportRows = filtered.map((r) => ({
      "Serial #": r.serialNumber,
      "Fiscal Year": r.fiscalYear,
      Quarter: r.quarter || "",
      Date: r.date ? new Date(r.date).toISOString().slice(0, 10) : "",
      Process: r.process,
      "Entity Covered": r.entityCovered,
      Observation: r.observation,
      "Risk Level": r.riskLevel,
      Recommendation: r.recommendation,
      "Management Comment": r.managementComment,
      "Person Responsible": r.personResponsible,
      Approver: r.approver,
      "CXO Responsible": r.cxoResponsible,
      "Co-Owner": r.coOwner,
      "Due Date": r.timeline
        ? new Date(r.timeline).toISOString().slice(0, 10)
        : "",
      "Current Status": r.currentStatus,
      "Evidence Status": r.evidenceStatus || "",
      "Review Comments": r.reviewComments,
      Risk: r.risk,
      "Action Required": r.actionRequired,
      "Coverage Start Month": r.startMonth,
      "Coverage End Month": r.endMonth,
      "Evidence Count": Array.isArray(r.evidenceReceived)
        ? r.evidenceReceived.length
        : 0,
      "Annexure Count": Array.isArray(r.annexure) ? r.annexure.length : 0,
      "Created At": r.createdAt,
      "Updated At": r.updatedAt,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, "Audit_Issues");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `Audit_Issues_${scope}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(buf);
  } catch (err) {
    console.error("⛔ Export generation error:", err);
    res.status(500).json({ error: "Failed to export audit issues" });
  }
});

// ======================= Export filtered (XLSX, by Analytics filters) =======================
app.get("/api/audit-issues/export-filtered", async (req, res) => {
  try {
    const viewerRaw = String(req.query.viewer || "")
      .trim()
      .toLowerCase();
    const scope = String(req.query.scope || "mine"); // "mine" | "all"
    const mode = String(req.query.mode || "upcoming"); // "upcoming" | "recent" | "overdue"
    const days = Math.max(1, Number(req.query.days || 90)); // 30/60/90 (default 90)
    const viewer = normalizeToEmail(viewerRaw);

    const connection = await auditPool.getConnection();
    const [rows] = await connection.execute(`
      SELECT 
        id, serialNumber, fiscalYear, quarter, date, process, entityCovered, observation,
        riskLevel, recommendation, managementComment, personResponsible, approver,
        cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived, evidenceStatus,
        reviewComments, risk, actionRequired, startMonth, endMonth, annexure,
        createdAt, updatedAt
      FROM dbo.AuditIssues
      ORDER BY createdAt DESC;
    `);

    // normalize like the JSON list route
    const issues = rows.map((r) => {
      let ev = [],
        ax = [];
      try {
        ev = JSON.parse(r.evidenceReceived || "[]");
      } catch {}
      try {
        ax = JSON.parse(r.annexure || "[]");
      } catch {}
      const effectiveEvidenceStatus =
        r.evidenceStatus || (ev.length ? "Submitted" : null);
      return {
        ...r,
        evidenceReceived: ev,
        annexure: ax,
        evidenceStatus: effectiveEvidenceStatus,
      };
    });

    // scope enforcement (same as the other export)
    let scoped = issues;
    if (scope === "all") {
      if (!viewer) return res.status(400).json({ error: "viewer required" });
      const isGlobal = await isGlobalAuditor(viewer);
      if (!isGlobal) {
        const dyn = await listAuditorsFromDb();
        const me = dyn.find((r) => r.email === viewer.toLowerCase());
        if (!me) return res.status(403).json({ error: "forbidden" });
        const allowed = new Set(
          me.processes.map((p) => String(p || "").toLowerCase())
        );
        scoped = issues.filter((r) => {
          const proc = String(r.process || "").toLowerCase();
          return allowed.has("*") || allowed.has("all") || allowed.has(proc);
        });
      }
    } else {
      if (!viewer) return res.status(400).json({ error: "viewer required" });
      scoped = issues.filter((r) => {
        const toks = [
          r.personResponsible,
          r.approver,
          r.cxoResponsible,
        ].flatMap((s) =>
          String(s || "")
            .toLowerCase()
            .split(/[;,]\s*/)
            .map((x) => x.trim())
            .filter(Boolean)
        );
        return toks.includes(viewer.toLowerCase());
      });
    }

    // helper: what's "closed/accepted" and "due date"
    const isClosedEq = (r) =>
      String(r.currentStatus || "").toLowerCase() === "closed" ||
      String(r.evidenceStatus || "").toLowerCase() === "accepted";
    const dueDateOf = (r) => (r.timeline ? new Date(r.timeline) : null);

    // time window
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - days);
    const end = new Date(today);
    end.setDate(end.getDate() + days);
    const startDateOnly = new Date(start.toISOString().slice(0, 10));
    const endDateOnly = new Date(end.toISOString().slice(0, 10));
    const todayDateOnly = new Date(today.toISOString().slice(0, 10));

    // filter based on Analytics' modes
    let filtered = [];
    if (mode === "recent") {
      // accepted/closed within last N days — approximate using updatedAt when closed/accepted
      filtered = scoped
        .filter((r) => {
          if (!isClosedEq(r)) return false;
          const upd = r.updatedAt ? new Date(r.updatedAt) : null;
          if (!upd) return false;
          const d = new Date(upd.toISOString().slice(0, 10));
          return d >= startDateOnly && d <= todayDateOnly;
        })
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    } else if (mode === "overdue") {
      // overdue in the last N days: timeline < today AND >= start (and not closed)
      filtered = scoped
        .filter((r) => {
          if (isClosedEq(r)) return false;
          const d = dueDateOf(r);
          if (!d) return false;
          const dd = new Date(d.toISOString().slice(0, 10));
          return dd < todayDateOnly && dd >= startDateOnly;
        })
        .sort((a, b) => new Date(a.timeline || 0) - new Date(b.timeline || 0));
    } else {
      // upcoming: due between today and end (inclusive), not closed
      filtered = scoped
        .filter((r) => {
          if (isClosedEq(r)) return false;
          const d = dueDateOf(r);
          if (!d) return false;
          const dd = new Date(d.toISOString().slice(0, 10));
          return dd >= todayDateOnly && dd <= endDateOnly;
        })
        .sort((a, b) => new Date(a.timeline || 0) - new Date(b.timeline || 0));
    }

    // shape friendly rows (detailed)
    const daysBetween = (a, b) => Math.floor((a - b) / 86400000);
    const agingText = (r) => {
      const d = dueDateOf(r);
      if (!d) return "";
      const dd = new Date(d.toISOString().slice(0, 10));
      const t0 = todayDateOnly;
      const diff = daysBetween(t0, dd);
      if (diff > 0) return `${diff} day(s) overdue`;
      if (diff === 0) return `due today`;
      return `in ${Math.abs(diff)} day(s)`;
    };

    const exportRows = filtered.map((r) => ({
      "Serial #": r.serialNumber,
      "Fiscal Year": r.fiscalYear,
      Quarter: r.quarter || "",
      Date: r.date ? new Date(r.date).toISOString().slice(0, 10) : "",
      Process: r.process,
      "Entity Covered": r.entityCovered,
      Observation: r.observation,
      "Risk Level": r.riskLevel,
      Recommendation: r.recommendation,
      "Management Comment": r.managementComment,
      "Person Responsible": r.personResponsible,
      Approver: r.approver,
      "CXO Responsible": r.cxoResponsible,
      "Co-Owner": r.coOwner,
      "Due Date": r.timeline
        ? new Date(r.timeline).toISOString().slice(0, 10)
        : "",
      "Current Status": r.currentStatus,
      "Evidence Status": r.evidenceStatus || "",
      "Review Comments": r.reviewComments,
      Risk: r.risk,
      "Action Required": r.actionRequired,
      "Coverage Start Month": r.startMonth,
      "Coverage End Month": r.endMonth,
      "Accepted/Updated On": r.updatedAt
        ? new Date(r.updatedAt).toISOString().slice(0, 10)
        : "",
      Aging: agingText(r),
      "Created At": r.createdAt,
      "Updated At": r.updatedAt,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, "Filtered_Report");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `Audit_Report_${mode}_${days}d_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    return res.send(buf);
  } catch (err) {
    console.error("⛔ Export filtered error:", err);
    return res.status(500).json({ error: "Failed to export filtered report" });
  }
});

/* --------------------------- BULK upload (Excel/CSV) ------------------------ */
app.post(
  "/api/audit-issues/upload",
  memoryUpload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
      await reseedSerialIfEmpty();
      const ext = path.extname(req.file.originalname).toLowerCase();
      let workbook;
      if (ext === ".csv" || ext === ".tsv") {
        const text = req.file.buffer.toString("utf8");
        workbook = XLSX.read(text, { type: "string" });
      } else {
        workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      if (!rows.length) {
        return res.status(400).json({ error: "File is empty." });
      }

      const headerRowRaw = rows[0];
      const header = headerRowRaw.map((h) =>
        String(h || "")
          .trim()
          .toLowerCase()
      );
      const dataRows = rows
        .slice(1)
        .filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

      const idx = (name) => header.indexOf(name.toLowerCase());
      const idxAny = (...names) => {
        for (const n of names) {
          const i = idx(n);
          if (i !== -1) return i;
        }
        return -1;
      };
      const val = (row, name, def = "") => {
        const i = idx(name);
        return i === -1 ? def : row[i];
      };
      const valAny = (row, names, def = "") => {
        const i = idxAny(...names);
        return i === -1 ? def : row[i];
      };

      const mustHave = [
        "fiscalyear",
        "process",
        "entitycovered",
        "observation",
        "risklevel",
        "recommendation",
        "personresponsible",
        "currentstatus",
      ];
      const missing = mustHave.filter((h) => !header.includes(h));
      if (missing.length) {
        return res
          .status(400)
          .json({ error: `Missing required columns: ${missing.join(", ")}` });
      }

      const connection = await auditPool.getConnection();
      // ✅ FIXED version in /api/audit-issues/upload
      const insertQuery = `
  INSERT INTO dbo.AuditIssues (
    id, fiscalYear, quarter, date, process, entityCovered, observation, riskLevel,
    recommendation, managementComment, personResponsible, approver,
    cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived,
    reviewComments, risk, actionRequired, startMonth, endMonth, annexure, createdAt, updatedAt
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
`;

      let successCount = 0;
      let errorCount = 0;

      for (const row of dataRows) {
        try {
          const fiscalYear = val(row, "fiscalyear", "");
          const process = val(row, "process", "");
          const entityCovered = val(row, "entitycovered", "");
          const observation = val(row, "observation", "");
          const riskLevelRaw = val(row, "risklevel", "");
          const recommendation = val(row, "recommendation", "");
          const managementComment = val(row, "managementcomment", "");
          const personResponsible = valAny(
            row,
            ["personresponsible", "person responsible"],
            ""
          );
          const approver = val(row, "approver", "");
          const cxoResponsible = valAny(
            row,
            ["cxoresponsible", "cxo responsible"],
            ""
          );
          const coOwner = valAny(row, ["coowner", "co-owner", "co owner"], "");
          const timelineRaw = val(row, "timeline", "");
          const currentStatusRaw = valAny(
            row,
            ["currentstatus", "current status"],
            ""
          );
          const startMonth = valAny(
            row,
            ["startmonth", "coverage start month", "coveragestartmonth"],
            ""
          );
          const endMonth = valAny(
            row,
            ["endmonth", "coverage end month", "coverageendmonth"],
            ""
          );
          const reviewComments = valAny(
            row,
            ["reviewcomments", "review comments"],
            ""
          );
          const risk = val(row, "risk", "");
          const actionRequired = valAny(
            row,
            ["actionrequired", "action required"],
            ""
          );
          const annexureRaw = val(row, "annexure", "");
          // read from sheet if present and normalize
          const quarterRaw = valAny(row, ["quarter", "qtr"], "");
          const quarter = normQuarter(quarterRaw) || null;

          // NEW: optional comment columns from the latest template
          const cxoFurther = valAny(
            row,
            [
              "further comment by management",
              "further comment by cxo",
              "cxo comment",
            ],
            ""
          );
          const auditorFurther = valAny(
            row,
            ["further comment by auditor", "auditor comment"],
            ""
          );

          const id = uuidv4();
          const riskLevel = normRiskLevel(riskLevelRaw);
          const currentStatus = normStatus(currentStatusRaw);

          const safeTimeline =
            typeof timelineRaw === "number"
              ? convertExcelDate(timelineRaw)
              : formatDate(timelineRaw);

          const annexureArr = String(annexureRaw || "")
            .split(/[;,]\s*/)
            .filter(Boolean)
            .map((name) => ({ name, uploadedAt: new Date().toISOString() }));

          const joinMulti = (s) =>
            String(s || "")
              .split(/[;,]\s*/)
              .filter(Boolean)
              .join(";");

          // Seed evidence trail with these comments (chronological: CXO then Auditor)
          const makeTextEntry = (label, text, by) => ({
            id: Date.now() + "-" + Math.random().toString(36).substr(2, 9),
            fileName: label,
            fileType: "text/plain",
            fileSize: String(text || "").length,
            uploadedAt: new Date().toISOString(),
            uploadedBy: by, // shows clearly in UI who it's from
            content: String(text || "").trim(),
          });
          const evidenceSeed = [];
          if (cxoFurther && String(cxoFurther).trim()) {
            evidenceSeed.push(
              makeTextEntry("CXO Comment", cxoFurther, "CXO (import)")
            );
          }
          if (auditorFurther && String(auditorFurther).trim()) {
            evidenceSeed.push(
              makeTextEntry(
                "Auditor Comment",
                auditorFurther,
                "Auditor (import)"
              )
            );
          }

          await connection.execute(insertQuery, [
            id,
            fiscalYear,
            quarter,
            formatDate(new Date()),
            process,
            entityCovered,
            observation,
            riskLevel,
            recommendation,
            managementComment,
            joinMulti(personResponsible),
            joinMulti(approver),
            joinMulti(cxoResponsible),
            joinMulti(coOwner),
            safeTimeline,
            currentStatus,
            JSON.stringify(evidenceSeed),
            reviewComments || "",
            risk || "",
            actionRequired || "",
            startMonth || "",
            endMonth || "",
            JSON.stringify(annexureArr),
          ]);
          successCount++;
        } catch (err) {
          console.error("❌ Row insert error:", err);
          errorCount++;
        }
      }

      res.status(200).json({
        message: `✅ Imported ${successCount} row(s)${
          errorCount ? `, ❌ ${errorCount} failed.` : "."
        }`,
      });
    } catch (err) {
      console.error("⛔ Upload processing error:", err);
      res.status(500).json({ error: "Failed to process upload" });
    }
  }
);

/* ------------------------------- LIST all ---------------------------------- */
app.get("/api/audit-issues", async (req, res) => {
  try {
    const viewerRaw = String(req.query.viewer || "")
      .trim()
      .toLowerCase();
    const scope = String(req.query.scope || "mine"); // "mine" | "all"
    const viewer = normalizeToEmail(viewerRaw); // adds @premierenergies.com if missing

    const connection = await auditPool.getConnection();
    const [rows] = await connection.execute(`
      SELECT 
        id, serialNumber, fiscalYear, quarter, date, process,
        entityCovered, observation, riskLevel, recommendation,
        managementComment, personResponsible, approver, cxoResponsible,
        coOwner, timeline, currentStatus, evidenceReceived, evidenceStatus,
        reviewComments, risk, actionRequired, startMonth, endMonth,
        annexure, createdAt, updatedAt
      FROM dbo.AuditIssues
      ORDER BY createdAt DESC;
    `);

    const issues = rows.map((r) => {
      let ev = [],
        ax = [];
      try {
        ev = JSON.parse(r.evidenceReceived || "[]");
      } catch {}
      try {
        ax = JSON.parse(r.annexure || "[]");
      } catch {}
      // derive a useful transient status for display if DB is NULL but evidence exists
      const effectiveEvidenceStatus =
        r.evidenceStatus || (ev.length ? "Submitted" : null);
      const isLocked = isAccepted(effectiveEvidenceStatus);
      return {
        ...r,
        evidenceReceived: ev,
        annexure: ax,
        evidenceStatus: effectiveEvidenceStatus,
        isLocked,
      };
    });

    // 🔐 enforce scope
    if (scope === "all") {
      if (!viewer) return res.status(400).json({ error: "viewer required" });
      const isGlobal = await isGlobalAuditor(viewer);
      if (!isGlobal) {
        // process-scoped auditor: return only issues they’re allowed to see
        const dyn = await listAuditorsFromDb();
        const me = dyn.find((r) => r.email === viewer.toLowerCase());
        if (!me) return res.status(403).json({ error: "forbidden" });
        const allowed = new Set(me.processes.map((p) => p.toLowerCase()));
        const filtered = issues.filter((r) => {
          const proc = String(r.process || "").toLowerCase();
          return allowed.has("*") || allowed.has("all") || allowed.has(proc);
        });
        return res.status(200).json(filtered);
      }
      return res.status(200).json(issues);
    }
    // Default: "mine" — require viewer and filter
    if (!viewer) return res.status(400).json({ error: "viewer required" });

    const filtered = issues.filter((r) => {
      const toks = [r.personResponsible, r.approver, r.cxoResponsible].flatMap(
        (s) =>
          String(s || "")
            .toLowerCase()
            .split(/[;,]\s*/)
            .map((x) => x.trim())
            .filter(Boolean)
      );
      // exact match on normalized email
      return toks.includes(viewer.toLowerCase());
    });

    res.status(200).json(filtered);
  } catch (err) {
    console.error("⛔ Error fetching audit issues:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
/* ------------------------ Evidence upload (multiple) ------------------------ */
/* ------------------------ Evidence upload (multiple) ------------------------ */
// CMD-F ANCHOR: /api/audit-issues/:id/evidence
app.post(
  "/api/audit-issues/:id/evidence",
  diskUpload.array("evidence"),
  async (req, res) => {
    const issueId = req.params.id;
    const uploadedByRaw = req.body.uploadedBy || "Unknown";
    const uploadedBy = normalizeToEmail(uploadedByRaw);
    const textEvidence = (req.body.textEvidence || "").trim();
    const justification = (req.body.justification || "").trim();

    if (!uploadedBy) {
      return res.status(400).json({ error: "Missing uploadedBy" });
    }

    try {
      const connection = await auditPool.getConnection();
      const [rows] = await connection.execute(
        `SELECT evidenceReceived, evidenceStatus, currentStatus,
                personResponsible, cxoResponsible, approver,
                serialNumber, process, entityCovered, observation
           FROM dbo.AuditIssues
          WHERE id = ?`,
        [issueId]
      );

      if (!rows.length)
        return res.status(404).json({ error: "Audit issue not found" });

      const row = rows[0];

      // Hard lock: when Accepted, uploads are blocked for everyone until unlocked
      if (isAccepted(row.evidenceStatus)) {
        return res.status(423).json({ error: "Issue is locked (Accepted)." });
      }

      // ✅ Server-side permission: only PR or auditors can upload evidence
      const prList = toEmails(row.personResponsible).map((e) =>
        normalizeToEmail(e).toLowerCase()
      );
      const isPR = prList.includes(uploadedBy.toLowerCase());
      const isAud = await isAuditorEmail(uploadedBy);

      if (!isPR && !isAud) {
        return res.status(403).json({
          error: "Only Person Responsible or auditors can upload evidence.",
        });
      }

      let currentEvidence = [];
      try {
        currentEvidence = JSON.parse(row.evidenceReceived || "[]");
      } catch {}

      const newEntries = (req.files || []).map((file) => ({
        id: Date.now() + "-" + Math.random().toString(36).substr(2, 9),
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy,
        path: path.relative(__dirname, file.path),
      }));

      // Still allow PR/auditor to attach a text note alongside files
      if (textEvidence) {
        newEntries.unshift({
          id: Date.now() + "-txt-" + Math.random().toString(36).substr(2, 9),
          fileName: "Comment with Evidence",
          fileType: "text/plain",
          fileSize: textEvidence.length,
          uploadedAt: new Date().toISOString(),
          uploadedBy,
          content: textEvidence,
        });
      }
      if (justification) {
        newEntries.unshift({
          id: Date.now() + "-just-" + Math.random().toString(36).substr(2, 9),
          fileName: "Justification for Extension of Due Date",
          fileType: "text/plain",
          fileSize: justification.length,
          uploadedAt: new Date().toISOString(),
          uploadedBy,
          content: justification,
        });
      }

      const updatedEvidence = [...currentEvidence, ...newEntries];

      const nextEvidenceStatus = "Submitted";
      const nextCurrentStatus =
        row.currentStatus === "Closed" ? "Closed" : "To Be Received";

      await connection.execute(
        `UPDATE dbo.AuditIssues
            SET evidenceReceived = ?,
                evidenceStatus   = ?,
                currentStatus    = ?,
                updatedAt        = GETDATE()
          WHERE id = ?`,
        [
          JSON.stringify(updatedEvidence),
          nextEvidenceStatus,
          nextCurrentStatus,
          issueId,
        ]
      );

      const caption = `${row.serialNumber} – ${row.process} / ${row.entityCovered}`;
      const attachmentsCount = (req.files || []).length;
      const cc = getAuditorList();
      const to = uniqEmails(
        row.personResponsible,
        row.approver,
        row.cxoResponsible
      );

      const subject = `${APP_NAME}, Evidence Uploaded (${row.serialNumber})`;
      const parts = [
        `${uploadedBy} uploaded ${attachmentsCount} file(s)${
          textEvidence ? " and added a comment" : ""
        } for <b>${caption}</b>.`,
        `Please review in <a href="https://audit.premierenergies.com">audit.premierenergies.com</a>.`,
        `<b>Observation:</b> ${row.observation || "—"}`,
      ];
      const highlight = textEvidence
        ? `<div style="text-align:left;"><div style="font-weight:600;margin-bottom:6px;">Comment:</div>${textEvidence.replace(
            /\n/g,
            "<br/>"
          )}</div>`
        : "";

      const html = emailTemplate({
        title: `📎 ${APP_NAME}: Evidence Uploaded`,
        paragraphs: parts,
        highlight,
      });

      try {
        await sendEmail(to, subject, html, cc);
      } catch (e) {
        console.warn("mail(evidence) failed:", e?.message || e);
      }
      res.json({ success: true, newEvidence: newEntries });
    } catch (err) {
      console.error("⛔ Evidence upload error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/* -------------------------- Annexure upload (files) ------------------------- */
// POST /api/audit-issues/:id/annexure
// Field name: "annexure" (matches EditAuditModal.tsx)
app.post(
  "/api/audit-issues/:id/annexure",
  diskUpload.array("annexure"),
  async (req, res) => {
    const issueId = req.params.id;

    try {
      const connection = await auditPool.getConnection();
      const [rows] = await connection.execute(
        `SELECT annexure FROM dbo.AuditIssues WHERE id = ?`,
        [issueId]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Audit issue not found" });
      }

      // Parse current annexure JSON (if any)
      let currentAnnexure = [];
      try {
        currentAnnexure = JSON.parse(rows[0].annexure || "[]");
        if (!Array.isArray(currentAnnexure)) currentAnnexure = [];
      } catch {
        currentAnnexure = [];
      }

      // Map uploaded files into annexure entries
      const newEntries = (req.files || []).map((file) => ({
        name: file.originalname,
        path: path.relative(__dirname, file.path),
        size: file.size,
        type: file.mimetype,
        uploadedAt: new Date().toISOString(),
      }));

      const updatedAnnexure = [...currentAnnexure, ...newEntries];

      await connection.execute(
        `UPDATE dbo.AuditIssues
           SET annexure = ?, updatedAt = GETDATE()
         WHERE id = ?`,
        [JSON.stringify(updatedAnnexure), issueId]
      );

      // Return JSON so EditAuditModal's upRes.json() works
      return res.json({
        success: true,
        annexure: updatedAnnexure,
      });
    } catch (err) {
      console.error("⛔ Annexure upload error:", err);
      return res
        .status(500)
        .json({ error: "Failed to upload annexure attachments" });
    }
  }
);

/* --------------------------------- Comments --------------------------------- */
// POST /api/comments
// Body: { issueId: string, content: string, actor: string }
app.post("/api/comments", async (req, res) => {
  const { issueId, content } = req.body || {};
  const actorRaw = (req.body?.actor || "").toString().trim();
  const actor = normalizeToEmail(actorRaw);

  if (!issueId || !content || !actor) {
    return res
      .status(400)
      .json({ error: "issueId, content, and actor are required" });
  }

  try {
    const connection = await auditPool.getConnection();

    const [rows] = await connection.execute(
      `SELECT id, serialNumber, process, entityCovered, observation, evidenceReceived, evidenceStatus,
              personResponsible, approver, cxoResponsible, currentStatus
         FROM dbo.AuditIssues
        WHERE id = ?`,
      [issueId]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Audit issue not found" });

    const row = rows[0];

    // (Same lock policy as evidence uploads. If you prefer to allow comments after acceptance, remove this.)
    if (isAccepted(row.evidenceStatus)) {
      return res.status(423).json({ error: "Issue is locked (Accepted)." });
    }

    // Only allow comments by Auditor / PR / Approver / CXO on this issue
    const prList = toEmails(row.personResponsible).map((e) => e.toLowerCase());
    const apprList = toEmails(row.approver).map((e) => e.toLowerCase());
    const cxoList = toEmails(row.cxoResponsible).map((e) => e.toLowerCase());
    const isPR = prList.includes(actor.toLowerCase());
    const isAppr = apprList.includes(actor.toLowerCase());
    const isCXO = cxoList.includes(actor.toLowerCase());
    const isAud = await isAuditorEmail(actor);

    if (!(isPR || isAppr || isCXO || isAud)) {
      return res
        .status(403)
        .json({ error: "Not permitted to comment on this issue" });
    }

    // Append comment to evidenceReceived
    let current = [];
    try {
      current = JSON.parse(row.evidenceReceived || "[]");
    } catch {}
    const newEntry = {
      id: Date.now() + "-cmt-" + Math.random().toString(36).substr(2, 9),
      fileName: "Comment",
      fileType: "text/plain",
      fileSize: String(content || "").length,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor,
      content: String(content || "").trim(),
    };
    const updatedEvidence = [...current, newEntry];

    await connection.execute(
      `UPDATE dbo.AuditIssues
          SET evidenceReceived = ?, updatedAt = GETDATE()
        WHERE id = ?`,
      [JSON.stringify(updatedEvidence), issueId]
    );

    // Email (TO auditors, CC stakeholders)
    const cc = getAuditorList();
    const to = uniqEmails(
      row.personResponsible,
      row.approver,
      row.cxoResponsible
    );
    const caption = `${row.serialNumber} – ${row.process} / ${row.entityCovered}`;

    // Figure out actor role label (for clarity in the email)
    const actorRole = isAud
      ? "Auditor"
      : isCXO
      ? "CXO"
      : isAppr
      ? "Approver"
      : "Person Responsible";

    const subject = `${APP_NAME}, New Comment (${row.serialNumber})`;
    const html = emailTemplate({
      title: `💬 ${APP_NAME}: New Comment`,
      paragraphs: [
        `<b>Issue:</b> ${caption}`,
        `<b>Observation:</b> ${row.observation || "—"}`,
        `<b>By:</b> ${actor} (${actorRole})`,
        `Visit <a href="https://audit.premierenergies.com">audit.premierenergies.com</a> to review.`,
      ],
      highlight: `<div style="text-align:left;">${String(content || "").replace(
        /\n/g,
        "<br/>"
      )}</div>`,
    });

    try {
      await sendEmail(to, subject, html, cc);
    } catch (e) {
      console.warn("mail(comment) failed:", e?.message || e);
    }

    return res.json({ success: true, comment: newEntry });
  } catch (err) {
    console.error("⛔ /api/comments error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* --------------------------- Evidence delete (PR only) --------------------------- */
// DELETE /api/audit-issues/:id/evidence/:evid
// Body or query must include { actor: "<viewerEmail>" }.
app.delete("/api/audit-issues/:id/evidence/:evid", async (req, res) => {
  const issueId = req.params.id;
  const evidId = String(req.params.evid || "");
  const actorRaw = (req.body?.actor || req.query?.actor || "")
    .toString()
    .trim();
  const actor = normalizeToEmail(actorRaw);
  if (!actor) return res.status(400).json({ error: "Missing actor" });

  try {
    const connection = await auditPool.getConnection();
    const [rows] = await connection.execute(
      `SELECT evidenceReceived, personResponsible, evidenceStatus
           FROM dbo.AuditIssues
          WHERE id = ?`,
      [issueId]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Audit issue not found" });

    const row = rows[0];
    if (isAccepted(row.evidenceStatus)) {
      return res.status(423).json({ error: "Issue is locked (Accepted)." });
    }

    const prList = String(row.personResponsible || "")
      .toLowerCase()
      .split(/[;,]\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!prList.includes(actor.toLowerCase())) {
      return res
        .status(403)
        .json({ error: "Only personResponsible can remove evidence." });
    }

    let current = [];
    try {
      current = JSON.parse(row.evidenceReceived || "[]");
    } catch {}
    const beforeLen = current.length;
    const filtered = current.filter((e) => String(e?.id || "") !== evidId);
    if (filtered.length === beforeLen) {
      return res.status(404).json({ error: "Evidence item not found" });
    }

    await connection.execute(
      `UPDATE dbo.AuditIssues
            SET evidenceReceived = ?, updatedAt = GETDATE()
          WHERE id = ?`,
      [JSON.stringify(filtered), issueId]
    );
    res.json({ success: true, removedId: evidId });
  } catch (err) {
    console.error("⛔ Evidence delete error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ---------------------- Nudge: pending (not accepted) ---------------------- */
// POST /api/audit-issues/notify-pending
// Body or query must include { actor: "<auditor email>" }
// Optional: ?dryRun=true to preview recipients (no emails sent)
// ---- consolidated notifier (works for GET and POST) ----
async function notifyPendingHandler(req, res) {
  const actorRaw = (req.body?.actor || req.query?.actor || "")
    .toString()
    .trim();
  const actor = normalizeToEmail(actorRaw);
  const dryRun =
    String(req.query?.dryRun || req.body?.dryRun || "")
      .toLowerCase()
      .trim() === "true";

  try {
    if (!actor) {
      return res.status(400).json({ error: "actor is required" });
    }
    if (!(await isAuditorEmail(actor))) {
      return res.status(403).json({ error: "Only auditors can send nudges." });
    }

    // Load all "pending" issues (not Accepted, not Closed)
    const connection = await auditPool.getConnection();
    const [rows] = await connection.execute(`
      SELECT id, serialNumber, process, entityCovered, observation, timeline,
             currentStatus, evidenceStatus,
             personResponsible, approver, cxoResponsible
        FROM dbo.AuditIssues
       WHERE (evidenceStatus IS NULL OR evidenceStatus <> 'Accepted')
         AND (currentStatus  IS NULL OR currentStatus  <> 'Closed')
       ORDER BY timeline ASC, createdAt DESC;
    `);

    // Process-scope guard: a non-global auditor only nudges within allowed processes
    const isGlobal = await isGlobalAuditor(actor);
    let allowed = null;
    if (!isGlobal) {
      const dyn = await listAuditorsFromDb();
      const me = dyn.find((r) => r.email === actor.toLowerCase());
      const set = new Set(
        (me?.processes || []).map((p) => String(p || "").toLowerCase())
      );
      allowed = (proc) =>
        set.has("*") ||
        set.has("all") ||
        set.has(String(proc || "").toLowerCase());
    } else {
      allowed = () => true;
    }

    // Group per-person with role tagging
    const recipients = new Map(); // email -> { email, items: Map(issueId -> item) }
    const add = (recEmail, row, role) => {
      const em = normalizeToEmail(recEmail);
      if (!em || !allowed(row.process)) return;
      let bucket = recipients.get(em);
      if (!bucket) {
        bucket = { email: em, items: new Map() };
        recipients.set(em, bucket);
      }
      const existing = bucket.items.get(row.id);
      if (existing) {
        existing.roles.add(role);
      } else {
        bucket.items.set(row.id, {
          id: row.id,
          serialNumber: row.serialNumber,
          process: row.process,
          entityCovered: row.entityCovered,
          observation: row.observation,
          timeline: row.timeline,
          currentStatus: row.currentStatus,
          evidenceStatus: row.evidenceStatus,
          roles: new Set([role]),
        });
      }
    };

    for (const r of rows) {
      toEmails(r.personResponsible).forEach((e) => add(e, r, "PR"));
      toEmails(r.approver).forEach((e) => add(e, r, "Approver"));
      toEmails(r.cxoResponsible).forEach((e) => add(e, r, "CXO"));
    }

    if (!recipients.size) {
      return res.json({
        message: "No pending issues to nudge.",
        recipients: [],
      });
    }

    const ccAuditors = getAuditorList();
    const todayDateOnly = new Date(new Date().toISOString().slice(0, 10));

    const dateStr = (d) => {
      if (!d) return "—";
      try {
        const dt = new Date(d);
        return isNaN(dt) ? "—" : dt.toISOString().slice(0, 10);
      } catch {
        return "—";
      }
    };
    const aging = (d) => {
      if (!d) return "";
      const due = new Date(new Date(d).toISOString().slice(0, 10));
      const diffDays = Math.floor((due - todayDateOnly) / 86400000);
      if (diffDays > 0) return `in ${diffDays} day(s)`;
      if (diffDays === 0) return `due today`;
      return `${Math.abs(diffDays)} day(s) overdue`;
    };

    const makeTable = (items) => {
      const sorted = items.slice().sort((a, b) => {
        const ta = a.timeline ? new Date(a.timeline).getTime() : Infinity;
        const tb = b.timeline ? new Date(b.timeline).getTime() : Infinity;
        return ta - tb || (a.serialNumber || 0) - (b.serialNumber || 0);
      });

      const rowsHtml = sorted
        .map((it, idx) => {
          const zebra = idx % 2 ? "background:#fafbff;" : "";
          const roleTxt = [...it.roles].join(", ");
          return `
          <tr style="${zebra}">
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;"><b>${
              it.serialNumber || ""
            }</b></td>
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;">${
              it.process || ""
            } / ${it.entityCovered || ""}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;">${roleTxt}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;">${dateStr(
              it.timeline
            )}<div style="color:#6b7280;font-size:12px;">${aging(
            it.timeline
          )}</div></td>
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;">${
              it.currentStatus || "To Be Received"
            }</td>
          </tr>`;
        })
        .join("");

      return `
      <table style="width:100%;border-collapse:collapse;border:1px solid #e6e8eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f4f6ff;">
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Serial #</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Process / Entity</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Your Role</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Due</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    };

    const results = [];
    for (const [, rec] of recipients) {
      const items = [...rec.items.values()];
      const count = items.length;

      const table = makeTable(items);
      const subject = `${APP_NAME}, Pending Actions — ${count} issue(s)`;
      const html = emailTemplate({
        title: `📝 ${APP_NAME}: Pending Audit Actions`,
        paragraphs: [
          `You are listed as <b>Person Responsible</b>, <b>Approver</b>, or <b>CXO</b> on the following <b>${count}</b> open issue(s) that are <b>not accepted</b>.`,
          `Please review and take action in the portal.`,
          table,
        ],
        highlight: `<a href="https://audit.premierenergies.com" style="text-decoration:none;display:inline-block;padding:10px 14px;border:1px solid #0b5fff;border-radius:6px;font-weight:600;">Open CAM Portal</a>`,
        footerNote: `This message consolidates all of your pending items across roles. Auditors are CC’d.`,
      });

      results.push({ email: rec.email, count });

      if (!dryRun) {
        try {
          await sendEmail(rec.email, subject, html, ccAuditors);
        } catch (e) {
          console.warn(
            "mail(nudge-pending) failed:",
            rec.email,
            e?.message || e
          );
        }
      }
    }

    return res.json({
      message: dryRun ? "Dry run complete (no emails sent)" : "Nudges sent",
      recipients: results.sort((a, b) => b.count - a.count),
      totalRecipients: results.length,
      totalIssuesCovered: rows.length,
      scope: isGlobal ? "global" : "process-scoped",
    });
  } catch (err) {
    console.error("⛔ notify-pending error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Wire up both verbs so a plain browser GET works too
app.post("/api/audit-issues/notify-pending", notifyPendingHandler);
app.get("/api/audit-issues/notify-pending", notifyPendingHandler);

/* --------------------------- Auditor review (PUT) --------------------------- */
app.put("/api/audit-issues/:id/review", async (req, res) => {
  const issueId = req.params.id;
  const { evidenceStatus, reviewComments } = req.body;

  if (
    !["Accepted", "Insufficient", "Partially Accepted"].includes(evidenceStatus)
  ) {
    return res.status(400).json({
      error:
        'evidenceStatus must be "Accepted", "Insufficient", or "Partially Accepted"',
    });
  }

  try {
    const connection = await auditPool.getConnection();

    // adjust currentStatus based on evidenceStatus
    const updateFields = [
      "evidenceStatus = ?",
      "reviewComments = ?",
      "updatedAt = GETDATE()",
    ];
    if (evidenceStatus === "Accepted") {
      updateFields.push("currentStatus = 'Received'");
    } else if (evidenceStatus === "Partially Accepted") {
      updateFields.push("currentStatus = 'Partially Received'");
    } else {
      updateFields.push("currentStatus = 'To Be Received'");
    }

    await connection.execute(
      `UPDATE dbo.AuditIssues SET ${updateFields.join(", ")} WHERE id = ?`,
      [evidenceStatus, reviewComments, issueId]
    );

    const [updatedRows] = await connection.execute(
      `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
      [issueId]
    );
    if (!updatedRows.length) {
      return res.status(404).json({ error: "Audit issue not found" });
    }
    const updated = updatedRows[0];

    // mail — TO auditors, CC stakeholders
    const cc = getAuditorList();
    const to = uniqEmails(
      updated.personResponsible,
      updated.approver,
      updated.cxoResponsible
    );
    const caption = `${updated.serialNumber} – ${updated.process} / ${updated.entityCovered}`;

    const icon =
      evidenceStatus === "Accepted"
        ? "✅"
        : evidenceStatus === "Partially Accepted"
        ? "🟨"
        : "⚠️";
    const subject = `${APP_NAME}, ${evidenceStatus} (${updated.serialNumber})`;

    const html = emailTemplate({
      title: `${icon} ${APP_NAME}: ${evidenceStatus}`,
      paragraphs: [
        `<b>Issue:</b> ${caption}`,
        `<b>Observation:</b> ${updated.observation || "—"}`,
        `<b>Status:</b> ${evidenceStatus}`,
        `Visit <a href="https://audit.premierenergies.com">audit.premierenergies.com</a> to review.`,
      ],
      highlight: reviewComments
        ? `<div style="text-align:left;"><div style="font-weight:600;margin-bottom:6px;">Auditor Comment:</div>${String(
            reviewComments || ""
          ).replace(/\n/g, "<br/>")}</div>`
        : "",
    });

    try {
      await sendEmail(to, subject, html, cc);
    } catch (e) {
      console.warn("mail(review) failed:", e?.message || e);
    }

    // normalize client-friendly fields like before
    try {
      updated.evidenceReceived = JSON.parse(updated.evidenceReceived || "[]");
    } catch {}
    updated.evidenceStatus =
      updated.evidenceStatus ||
      (Array.isArray(updated.evidenceReceived) &&
      updated.evidenceReceived.length
        ? "Submitted"
        : undefined);
    updated.isLocked = isAccepted(updated.evidenceStatus);

    res.status(200).json(updated);
  } catch (err) {
    console.error("⛔ Review endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------ Update an issue ----------------------------- */
// Safeguard: if evidenceStatus === 'Accepted', block changes to 'observation'
// Safeguard: if evidenceStatus === 'Accepted', block changes to 'observation'
app.put(
  "/api/audit-issues/:id",
  diskUpload.any(), // ⬅️ changed from memoryUpload.none()
  async (req, res) => {
    const { id } = req.params;
    const actorRaw = (req.body?.actor || req.query?.actor || "")
      .toString()
      .trim();
    const actor = normalizeToEmail(actorRaw);

    const fields = req.body || {};

    const row = await getIssueRow(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (isLocked(row)) return lockedRes(res);

    const connection = await auditPool.getConnection();
    const [rows] = await connection.execute(
      `SELECT evidenceStatus FROM dbo.AuditIssues WHERE id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    const accepted = isAccepted(rows[0].evidenceStatus);
    if (accepted && typeof fields.observation === "string") {
      return res
        .status(400)
        .json({ error: "Observation cannot be edited after acceptance." });
    }

    // ✅ EMP validation if any of these fields are being updated
    const candidateLists = [];
    if (typeof fields.personResponsible === "string") {
      candidateLists.push(
        ...toEmails(fields.personResponsible).map(normalizeToEmail)
      );
    }
    if (typeof fields.approver === "string") {
      candidateLists.push(...toEmails(fields.approver).map(normalizeToEmail));
    }
    if (typeof fields.cxoResponsible === "string") {
      candidateLists.push(
        ...toEmails(fields.cxoResponsible).map(normalizeToEmail)
      );
    }
    if (typeof fields.coOwner === "string") {
      candidateLists.push(...toEmails(fields.coOwner).map(normalizeToEmail));
    }
    if (candidateLists.length) {
      const missing = await findMissingEmployees(candidateLists);
      if (missing.length) {
        return res.status(400).json({
          error: `Unknown employee email(s): ${missing.join(", ")}`,
        });
      }
    }

    /* ---------- NEW: handle annexure file uploads on edit ---------- */
    let annexureUpdated = false;
    let annexureList = [];
    try {
      annexureList = JSON.parse(row.annexure || "[]");
      if (!Array.isArray(annexureList)) annexureList = [];
    } catch {
      annexureList = [];
    }

    const annexureFiles = (req.files || []).filter(
      (f) => f.fieldname === "annexure"
    );
    if (annexureFiles.length) {
      const nowIso = new Date().toISOString();
      const newAnnexures = annexureFiles.map((file) => ({
        name: file.originalname,
        path: path.relative(__dirname, file.path),
        size: file.size,
        type: file.mimetype,
        uploadedAt: nowIso,
      }));
      annexureList = [...annexureList, ...newAnnexures];
      annexureUpdated = true;
    }
    /* --------------------------------------------------------------- */

    const up = [];
    const vals = [];
    const set = (col, v) => {
      up.push(`${col} = ?`);
      vals.push(v);
    };

    const allowed = [
      "fiscalYear",
      "quarter",
      "date",
      "process",
      "entityCovered",
      "observation",
      "riskLevel",
      "recommendation",
      "managementComment",
      "personResponsible",
      "approver",
      "cxoResponsible",
      "coOwner",
      "timeline",
      "currentStatus",
      "reviewComments",
      "risk",
      "actionRequired",
      "startMonth",
      "endMonth",
    ];
    for (const k of allowed) if (k in fields) set(k, fields[k]);

    // ⬅️ if we actually appended annexures, persist them
    if (annexureUpdated) {
      set("annexure", JSON.stringify(annexureList));
    }

    if (!up.length) return res.json({ message: "No changes" });

    await connection.execute(
      `UPDATE dbo.AuditIssues SET ${up.join(
        ", "
      )}, updatedAt = GETDATE() WHERE id = ?`,
      [...vals, id]
    );

    const [updated] = await connection.execute(
      `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
      [id]
    );

    try {
      if (actor && (await isAuditorEmail(actor))) {
        const before = row; // pre-update row (already fetched at top via getIssueRow)
        const after = updated[0]; // post-update row

        const changed = [];
        const fieldsToShow = [
          "fiscalYear",
          "quarter",
          "date",
          "process",
          "entityCovered",
          "observation",
          "riskLevel",
          "recommendation",
          "managementComment",
          "personResponsible",
          "approver",
          "cxoResponsible",
          "coOwner",
          "timeline",
          "currentStatus",
          "reviewComments",
          "risk",
          "actionRequired",
          "startMonth",
          "endMonth",
        ];
        fieldsToShow.forEach((k) => {
          const a = String(before?.[k] ?? "");
          const b = String(after?.[k] ?? "");
          if (a !== b)
            changed.push(`<b>${k}</b>: “${a || "—"}” → “${b || "—"}”`);
        });

        if (changed.length) {
          const cc = getAuditorList();
          const to = uniqEmails(
            after.personResponsible,
            after.approver,
            after.cxoResponsible
          );
          const subject = `${APP_NAME}, Issue Edited by Auditor (${after.serialNumber})`;
          const html = emailTemplate({
            title: `✏️ ${APP_NAME}: Issue Edited by Auditor`,
            paragraphs: [
              `<b>Issue:</b> ${buildCaption(after)}`,
              `<b>Observation:</b> ${after.observation || "—"}`,
              `Edited by: ${actor}`,
              `Visit <a href="https://audit.premierenergies.com">audit.premierenergies.com</a> to review.`,
            ],
            highlight: `<div style="text-align:left;">${changed.join(
              "<br/>"
            )}</div>`,
          });
          await sendEmail(to, subject, html, cc);
        }
      }
    } catch (e) {
      console.warn("mail(auditor edit) failed:", e?.message || e);
    }

    res.json(updated[0]);
  }
);

// helpers required by PUT route
async function getIssueRow(id) {
  const connection = await auditPool.getConnection();
  const [rows] = await connection.execute(
    `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}
function isLocked(row) {
  return isAccepted(row?.evidenceStatus);
}
function lockedRes(res) {
  return res
    .status(423)
    .json({ error: "Issue is locked (Accepted). Viewing only." });
}

/* ------------------------------ Reports (XLSX) ------------------------------ */
app.get("/api/audit-issues/reports/:reportType", async (req, res) => {
  const { reportType } = req.params;

  let query;
  let sheetName;

  if (reportType === "next3") {
    sheetName = "Next_3_Months_Report";
    query = `
      SELECT * FROM dbo.AuditIssues
      WHERE timeline >= ?
        AND timeline < DATEADD(MONTH, 3, ?)
      ORDER BY timeline;
    `;
  } else if (reportType === "next6") {
    sheetName = "Next_6_Months_Report";
    query = `
      SELECT * FROM dbo.AuditIssues
      WHERE timeline >= ?
        AND timeline < DATEADD(MONTH, 6, ?)
      ORDER BY timeline;
    `;
  } else if (reportType === "overdue") {
    sheetName = "Overdue_Report";
    query = `
      SELECT * FROM dbo.AuditIssues
      WHERE timeline < ?
      ORDER BY timeline;
    `;
  } else {
    return res
      .status(400)
      .json({ error: "Invalid reportType. Use next3, next6 or overdue." });
  }

  try {
    const connection = await auditPool.getConnection();
    const today = new Date();
    const dateParam = today.toISOString().split("T")[0];

    const [rows] =
      reportType === "overdue"
        ? await connection.execute(query, [dateParam])
        : await connection.execute(query, [dateParam, dateParam]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${sheetName}.xlsx`
    );
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(buf);
  } catch (err) {
    console.error("⛔ Report generation error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

/* --------------------------- Manual closure (POST) -------------------------- */
app.post("/api/audit-issues/:id/close", async (req, res) => {
  const { id } = req.params;
  const actorRaw = (req.body?.actor || req.query?.actor || "")
    .toString()
    .trim();
  const actor = normalizeToEmail(actorRaw);
  if (!actor) return res.status(400).json({ error: "Missing actor" });
  if (!(await isAuditorEmail(actor))) {
    return res.status(403).json({ error: "Only auditors can close issues." });
  }

  try {
    const connection = await auditPool.getConnection();
    await connection.execute(
      "UPDATE dbo.AuditIssues SET currentStatus = 'Closed', updatedAt = GETDATE() WHERE id = ?",
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("⛔ Close issue error:", err);
    res.status(500).json({ error: "Failed to close audit issue" });
  }
});

// ======================= Export unique stakeholders (XLSX) =======================
// GET /api/audit-issues/export-stakeholders
// Outputs all UNIQUE emails from personResponsible / approver / cxoResponsible
app.get("/api/audit-issues/export-stakeholders", async (req, res) => {
  try {
    const connection = await auditPool.getConnection();

    const [rows] = await connection.execute(`
      SELECT personResponsible, approver, cxoResponsible
      FROM dbo.AuditIssues;
    `);

    // emailKey -> { Email, Roles: Set<string> }
    const stakeholders = new Map();

    const addRole = (rawVal, roleLabel) => {
      const emails = toEmails(rawVal); // existing helper: handles arrays/JSON/";," strings
      emails.forEach((e) => {
        const em = normalizeToEmail(e); // existing helper: adds @premierenergies.com if missing
        if (!em) return;
        const key = em.toLowerCase();
        let entry = stakeholders.get(key);
        if (!entry) {
          entry = { Email: em, Roles: new Set() };
          stakeholders.set(key, entry);
        }
        entry.Roles.add(roleLabel);
      });
    };

    for (const r of rows) {
      addRole(r.personResponsible, "Person Responsible");
      addRole(r.approver, "Approver");
      addRole(r.cxoResponsible, "CXO");
    }

    const exportRows = Array.from(stakeholders.values())
      .sort((a, b) => a.Email.localeCompare(b.Email))
      .map((e) => ({
        Email: e.Email,
        Roles: Array.from(e.Roles).join(", "),
      }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, "Stakeholders");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `Audit_Stakeholders_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    return res.send(buf);
  } catch (err) {
    console.error("⛔ Export stakeholders error:", err);
    return res
      .status(500)
      .json({ error: "Failed to export unique stakeholders" });
  }
});

/* --------------------------------- SPA fallthrough -------------------------- */
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../dist", "index.html"));
});
/* ------------------------------- Daily reminders ---------------------------- */
const reminderSentOn = new Map(); // id -> 'YYYY-MM-DD' (resets on restart – OK for now)
const overdueSentOn = new Map();

async function runDailyReminders() {
  try {
    const connection = await auditPool.getConnection();
    // due between today and +3 days inclusive, and not Closed
    const [rows] = await connection.execute(`
            SELECT id, serialNumber, process, entityCovered, observation, timeline,
                   personResponsible, approver, cxoResponsible, currentStatus
      FROM dbo.AuditIssues
      WHERE timeline IS NOT NULL
        AND DATEDIFF(DAY, CONVERT(date, GETDATE()), timeline) BETWEEN 0 AND 3
    `);
    // Logic to send reminders...
  } catch (err) {
    console.error("⛔ Daily reminder error:", err);
  }
}

function startDailyReminderTimer() {
  const now = new Date();
  const targetTime = new Date(now);

  // Set target time to 10:00 AM IST
  targetTime.setUTCHours(4, 30, 0, 0); // 10:00 AM IST = 4:30 AM UTC

  // If the target time has already passed today, schedule for tomorrow
  if (now > targetTime) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  const delay = targetTime - now; // Time until the next 10:00 AM IST

  // Schedule the first execution
  setTimeout(() => {
    runDailyReminders(); // Run the reminders at 10:00 AM IST
    setInterval(runDailyReminders, 24 * 60 * 60 * 1000); // Schedule subsequent executions every 24 hours
  }, delay);
}

// Start the daily reminder timer
startDailyReminderTimer();
/* ------------------------------- Daily reminders ---------------------------- */

async function runDailyReminders() {
  try {
    const connection = await auditPool.getConnection();
    // due between today and +3 days inclusive, and not Closed
    const [rows] = await connection.execute(`
            SELECT id, serialNumber, process, entityCovered, observation, timeline,
                   personResponsible, approver, cxoResponsible, currentStatus
      FROM dbo.AuditIssues
      WHERE timeline IS NOT NULL
        AND DATEDIFF(DAY, CONVERT(date, GETDATE()), timeline) BETWEEN 0 AND 3
        AND (currentStatus IS NULL OR currentStatus <> 'Closed')
      ORDER BY timeline ASC
    `);

    const todayStr = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
      if (reminderSentOn.get(r.id) === todayStr) continue;

      const daysLeft = Math.max(
        0,
        Math.ceil((new Date(r.timeline) - new Date()) / 86400000)
      );
      const to = uniqEmails(r.personResponsible, r.approver, r.cxoResponsible);

      const subject = `${APP_NAME}, Reminder (${
        r.serialNumber
      } due in ${daysLeft} day${daysLeft === 1 ? "" : "s"})`;
      const html = emailTemplate({
        title: `⏰ ${APP_NAME}: Due Soon`,
        paragraphs: [
          `<b>Issue:</b> ${buildCaption(r)}`,
          `<b>Observation:</b> ${r.observation || "—"}`,
          `<b>Due Date:</b> ${r.timeline || "—"}`,
          `<b>Current Status:</b> ${r.currentStatus || "To Be Received"}`,
          `Visit <a href="https://audit.premierenergies.com">audit.premierenergies.com</a> to review.`,
        ],
        highlight: `Due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      });

      try {
        await sendEmail(to, subject, html);
      } catch (e) {
        console.warn("mail(reminder) failed:", e?.message || e);
      }
      reminderSentOn.set(r.id, todayStr);
    }
  } catch (e) {
    console.warn("runDailyReminders error:", e?.message || e);
  }
}

function startDailyReminderTimer() {
  // run now, then every 24h
  if (auditPool) {
    runDailyReminders();
    runDailyOverdues();
  }
  setInterval(runDailyReminders, 24 * 60 * 60 * 1000);
  setInterval(runDailyOverdues, 24 * 60 * 60 * 1000);
}

async function runDailyOverdues() {
  try {
    const connection = await auditPool.getConnection();

    // Only overdue, not closed, and NOT Accepted
    const [rows] = await connection.execute(`
      SELECT id, serialNumber, process, entityCovered, observation, timeline,
             personResponsible, approver, cxoResponsible, currentStatus, evidenceStatus
      FROM dbo.AuditIssues
      WHERE timeline IS NOT NULL
        AND CONVERT(date, timeline) < CONVERT(date, GETDATE())
        AND (currentStatus IS NULL OR currentStatus <> 'Closed')
        AND (evidenceStatus IS NULL OR evidenceStatus <> 'Accepted')
      ORDER BY timeline ASC
    `);

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayDateOnly = new Date(todayStr);

    // Skip issues we already sent an overdue mail for today
    const pendingRows = rows.filter(
      (r) => overdueSentOn.get(r.id) !== todayStr
    );
    if (!pendingRows.length) {
      return;
    }

    const daysOver = (timeline) => {
      if (!timeline) return 0;
      const due = new Date(new Date(timeline).toISOString().slice(0, 10));
      const diff = Math.floor((todayDateOnly - due) / 86400000);
      return diff <= 0 ? 1 : diff; // at least 1 day overdue if already past
    };

    const dateStr = (d) => {
      if (!d) return "—";
      try {
        const dt = new Date(d);
        return isNaN(dt) ? "—" : dt.toISOString().slice(0, 10);
      } catch {
        return "—";
      }
    };

    // Group overdue issues per user (PR / Approver / CXO)
    const recipients = new Map(); // email -> { email, items: [] }

    const addFor = (rawEmail, row, role) => {
      const em = normalizeToEmail(rawEmail);
      if (!em) return;

      let bucket = recipients.get(em);
      if (!bucket) {
        bucket = { email: em, items: [] };
        recipients.set(em, bucket);
      }

      // Same issue can appear for multiple roles for same user
      bucket.items.push({
        id: row.id,
        serialNumber: row.serialNumber,
        process: row.process,
        entityCovered: row.entityCovered,
        observation: row.observation,
        timeline: row.timeline,
        currentStatus: row.currentStatus,
        role,
        daysOver: daysOver(row.timeline),
      });
    };

    for (const r of pendingRows) {
      // Primary: PR, but also notify Approver/CXO (one consolidated mail each)
      toEmails(r.personResponsible).forEach((e) =>
        addFor(e, r, "Person Responsible")
      );
      toEmails(r.approver).forEach((e) => addFor(e, r, "Approver"));
      toEmails(r.cxoResponsible).forEach((e) => addFor(e, r, "CXO"));

      // Mark this issue as "handled" for today (prevents duplicates if function re-runs)
      overdueSentOn.set(r.id, todayStr);
    }

    if (!recipients.size) {
      return;
    }

    const makeTable = (items) => {
      const sorted = items.slice().sort((a, b) => {
        const ta = a.timeline ? new Date(a.timeline).getTime() : Infinity;
        const tb = b.timeline ? new Date(b.timeline).getTime() : Infinity;
        return ta - tb || (a.serialNumber || 0) - (b.serialNumber || 0);
      });

      const rowsHtml = sorted
        .map((it, idx) => {
          const zebra = idx % 2 ? "background:#fafbff;" : "";
          return `
          <tr style="${zebra}">
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;"><b>${
              it.serialNumber || ""
            }</b></td>
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;">${
              it.process || ""
            } / ${it.entityCovered || ""}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;">${
              it.role
            }</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;">
              ${dateStr(it.timeline)}
              <div style="color:#b91c1c;font-size:12px;">Overdue by ${
                it.daysOver
              } day${it.daysOver === 1 ? "" : "s"}</div>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #eef1f6;">${
              it.currentStatus || "To Be Received"
            }</td>
          </tr>`;
        })
        .join("");

      return `
      <table style="width:100%;border-collapse:collapse;border:1px solid #e6e8eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f4f6ff;">
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Serial #</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Process / Entity</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Your Role</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Due / Pending</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8eb;">Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    };

    // Send one consolidated email per user (no auditors in CC)
    for (const [, rec] of recipients) {
      const items = rec.items;
      if (!items.length) continue;

      const count = items.length;
      const table = makeTable(items);

      const subject = `${APP_NAME}, Overdue Actions — ${count} observation${
        count === 1 ? "" : "s"
      }`;
      const html = emailTemplate({
        title: `⛔ ${APP_NAME}: Overdue Observations`,
        paragraphs: [
          `You have <b>${count}</b> overdue audit observation${
            count === 1 ? "" : "s"
          } where you are marked as <b>Person Responsible</b>, <b>Approver</b> or <b>CXO</b>.`,
          `Please review the details below and update the status / upload evidence in the portal.`,
          table,
        ],
        highlight: `<a href="https://audit.premierenergies.com" style="text-decoration:none;display:inline-block;padding:10px 14px;border:1px solid #b91c1c;border-radius:6px;font-weight:600;">Open CAM Portal</a>`,
        footerNote: `This email consolidates all your overdue observations into a single daily reminder. Accepted points are excluded automatically.`,
      });

      try {
        // ✅ No auditors in CC anymore
        await sendEmail(rec.email, subject, html, []);
      } catch (e) {
        console.warn(
          "mail(overdue consolidated) failed:",
          rec.email,
          e?.message || e
        );
      }
    }
  } catch (e) {
    console.warn("runDailyOverdues error:", e?.message || e);
  }
}

/* --------------------------------- Servers --------------------------------- */
const PORT = process.env.PORT || 60443;
const HOST = process.env.HOST || "0.0.0.0";

const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs", "mydomain.key"), "utf8"),
  cert: fs.readFileSync(
    path.join(__dirname, "certs", "d466aacf3db3f299.crt"),
    "utf8"
  ),
  ca: fs.readFileSync(
    path.join(__dirname, "certs", "gd_bundle-g2-g1.crt"),
    "utf8"
  ),
};

const startServer = async () => {
  try {
    https.createServer(httpsOptions, app).listen(PORT, HOST, () => {
      console.log(`HTTPS Server running at https://${HOST}:${PORT}`);
    });

    const HTTP_PORT = process.env.HTTP_PORT || 7723;
    http.createServer(app).listen(HTTP_PORT, HOST, () => {
      console.log(` HTTP Server running at http://${HOST}:${HTTP_PORT}`);
    });
  } catch (error) {
    console.error("Error starting the server:", error);
    process.exit(1);
  }
};

startServer();
startDailyReminderTimer();
