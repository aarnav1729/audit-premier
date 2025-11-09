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
  "aarnavsingh836@gmail.com",
  "borra.prasanna@protivitiglobal.in",
  "aman.shah@protivitiglobal.in",
];

const isAuditorEmail = (em) => {
  const email = String(em || "").toLowerCase();
  const allowed = new Set([...AUDITOR_EMAILS, ...STATIC_AUDITORS]);
  return allowed.has(email);
};
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

/* ======================= OTP AUTH (SPOT: EMP + OTPs) ======================= */

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
    } else if (!isAuditorEmail(fullEmail)) {
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
    const minutesValid = 5; // keep your current 5-minute policy
    const html = emailTemplate({
      title: `🔐 ${APP_NAME}, OTP`,
      paragraphs: [
        "Hello,",
        `Use the following code to continue signing in to <b>${APP_NAME}</b>:`,
      ],
      highlight: `<span style="font-size:22px;letter-spacing:3px;">${otp}</span>`,
      footerNote: `This code is valid for ${minutesValid} minutes.`,
    });

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
    if (isAuditorEmail(fullEmail)) {
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
    const insertQuery = `
      INSERT INTO dbo.AuditIssues (
        id, fiscalYear, date, process, entityCovered, observation, riskLevel,
        recommendation, managementComment, personResponsible, approver,
        cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived,
        reviewComments, risk, actionRequired, startMonth, endMonth, annexure, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
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
      const to = getAuditorList();
      const cc = uniqEmails(personResponsible, approver, cxoResponsible);
      const subject = `${APP_NAME}, New Audit Issue Created (${created.serialNumber})`;
      const html = emailTemplate({
        title: `🆕 ${APP_NAME} — New Audit Issue Created`,
        paragraphs: [
          `<b>Issue:</b> ${buildCaption(created)}`,
          `<b>Risk:</b> ${created.riskLevel || "medium"}`,
          `<b>Due Date:</b> ${created.timeline || "—"}`,
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
      const insertQuery = `
      INSERT INTO dbo.AuditIssues (
        id, fiscalYear, date, process, entityCovered, observation, riskLevel,
        recommendation, managementComment, personResponsible, approver,
        cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived,
        reviewComments, risk, actionRequired, startMonth, endMonth, annexure, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
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
        id, serialNumber, fiscalYear, date, process,
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
      const isLocked = String(effectiveEvidenceStatus || "") === "Accepted";
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
      // Require a viewer and ensure that viewer is an auditor
      if (!viewer) return res.status(400).json({ error: "viewer required" });
      if (!isAuditorEmail(viewer))
        return res.status(403).json({ error: "forbidden" });
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
app.post(
  "/api/audit-issues/:id/evidence",
  diskUpload.array("evidence"),
  async (req, res) => {
    const issueId = req.params.id;
    const uploadedBy = req.body.uploadedBy || "Unknown";
    const textEvidence = (req.body.textEvidence || "").trim();
    const justification = (req.body.justification || "").trim();

    try {
      const connection = await auditPool.getConnection();
      const [rows] = await connection.execute(
        `SELECT evidenceReceived, evidenceStatus, currentStatus,
                        personResponsible, cxoResponsible, approver,
                        serialNumber, process, entityCovered
                 FROM dbo.AuditIssues
                  WHERE id = ?`,
        [issueId]
      );

      if (rows.length === 0)
        return res.status(404).json({ error: "Audit issue not found" });

      const row = rows[0];
      // hard-lock guard (kept server-side even though UI blocks)
      if (String(row.evidenceStatus || "") === "Accepted") {
        return res.status(423).json({ error: "Issue is locked (Accepted)." });
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

      if (textEvidence) {
        newEntries.unshift({
          id: Date.now() + "-txt-" + Math.random().toString(36).substr(2, 9),
          fileName: "Comment",
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
      const to = getAuditorList();
      const cc = uniqEmails(
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
      ];
      const highlight = textEvidence
        ? `<div style="text-align:left;"><div style="font-weight:600;margin-bottom:6px;">Comment:</div>${textEvidence.replace(
            /\n/g,
            "<br/>"
          )}</div>`
        : "";

      const html = emailTemplate({
        title: `📎 ${APP_NAME} — Evidence Uploaded`,
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
      `SELECT id, serialNumber, process, entityCovered, evidenceReceived, evidenceStatus,
              personResponsible, approver, cxoResponsible, currentStatus
         FROM dbo.AuditIssues
        WHERE id = ?`,
      [issueId]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Audit issue not found" });

    const row = rows[0];

    // (Same lock policy as evidence uploads. If you prefer to allow comments after acceptance, remove this.)
    if (String(row.evidenceStatus || "") === "Accepted") {
      return res.status(423).json({ error: "Issue is locked (Accepted)." });
    }

    // Only allow comments by Auditor / PR / Approver / CXO on this issue
    const prList = toEmails(row.personResponsible).map((e) => e.toLowerCase());
    const apprList = toEmails(row.approver).map((e) => e.toLowerCase());
    const cxoList = toEmails(row.cxoResponsible).map((e) => e.toLowerCase());
    const isPR = prList.includes(actor.toLowerCase());
    const isAppr = apprList.includes(actor.toLowerCase());
    const isCXO = cxoList.includes(actor.toLowerCase());
    const isAud = isAuditorEmail(actor);

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
    const to = getAuditorList();
    const cc = uniqEmails(
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
      title: `💬 ${APP_NAME} — New Comment`,
      paragraphs: [
        `<b>Issue:</b> ${caption}`,
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
    if (String(row.evidenceStatus || "") === "Accepted") {
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
    const to = getAuditorList();
    const cc = uniqEmails(
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
      title: `${icon} ${APP_NAME} — ${evidenceStatus}`,
      paragraphs: [
        `<b>Issue:</b> ${caption}`,
        `<b>Status:</b> ${evidenceStatus}`,
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
    updated.isLocked = String(updated.evidenceStatus || "") === "Accepted";

    res.status(200).json(updated);
  } catch (err) {
    console.error("⛔ Review endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------ Update an issue ----------------------------- */
// Safeguard: if evidenceStatus === 'Accepted', block changes to 'observation'
app.put("/api/audit-issues/:id", memoryUpload.none(), async (req, res) => {
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

  const accepted = rows[0].evidenceStatus === "Accepted";
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
      return res
        .status(400)
        .json({ error: `Unknown employee email(s): ${missing.join(", ")}` });
    }
  }

  const up = [];
  const vals = [];
  const set = (col, v) => {
    up.push(`${col} = ?`);
    vals.push(v);
  };

  const allowed = [
    "fiscalYear",
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
    if (actor && isAuditorEmail(actor)) {
      const before = row; // pre-update row (already fetched at top via getIssueRow)
      const after = updated[0]; // post-update row

      const changed = [];
      const fieldsToShow = [
        "fiscalYear",
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
        if (a !== b) changed.push(`<b>${k}</b>: “${a || "—"}” → “${b || "—"}”`);
      });

      if (changed.length) {
        const to = getAuditorList();
        const cc = uniqEmails(
          after.personResponsible,
          after.approver,
          after.cxoResponsible
        );
        const subject = `${APP_NAME}, Issue Edited by Auditor (${after.serialNumber})`;
        const html = emailTemplate({
          title: `✏️ ${APP_NAME} — Issue Edited by Auditor`,
          paragraphs: [
            `<b>Issue:</b> ${buildCaption(after)}`,
            `Edited by: ${actor}`,
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
});

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
  return String(row?.evidenceStatus || "") === "Accepted";
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
  if (!isAuditorEmail(actor)) {
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

/* --------------------------------- SPA fallthrough -------------------------- */
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../dist", "index.html"));
});

/* ------------------------------- Daily reminders ---------------------------- */
const reminderSentOn = new Map(); // id -> 'YYYY-MM-DD' (resets on restart – OK for now)

async function runDailyReminders() {
  try {
    const connection = await auditPool.getConnection();
    // due between today and +3 days inclusive, and not Closed
    const [rows] = await connection.execute(`
      SELECT id, serialNumber, process, entityCovered, timeline,
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
      const to = getAuditorList();
      const cc = uniqEmails(r.personResponsible, r.approver, r.cxoResponsible);

      const subject = `${APP_NAME}, Reminder (${
        r.serialNumber
      } due in ${daysLeft} day${daysLeft === 1 ? "" : "s"})`;
      const html = emailTemplate({
        title: `⏰ ${APP_NAME} — Due Soon`,
        paragraphs: [
          `<b>Issue:</b> ${buildCaption(r)}`,
          `<b>Due Date:</b> ${r.timeline || "—"}`,
          `<b>Current Status:</b> ${r.currentStatus || "To Be Received"}`,
        ],
        highlight: `Due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      });

      try {
        await sendEmail(to, subject, html, cc);
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
  runDailyReminders();
  setInterval(runDailyReminders, 24 * 60 * 60 * 1000);
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
