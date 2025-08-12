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
let pool;

const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");
require("isomorphic-fetch");
const { v4: uuidv4 } = require("uuid");

const app = express();

/* ----------------------------- CORS & middleware ---------------------------- */
// Allow the real caller (dev/preview) instead of only 8080
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
const dbConfig = {
  user: "SPOT_USER",
  password: "Marvik#72@",
  server: "10.0.40.10",
  port: 1433,
  database: "auditms",
  options: {
    trustServerCertificate: true,
    encrypt: false,
    connectionTimeout: 60000,
  },
};

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

async function sendEmail(toEmail, subject, htmlContent) {
  const message = {
    subject,
    body: { contentType: "HTML", content: htmlContent },
    toRecipients: [{ emailAddress: { address: toEmail } }],
  };
  await graphClient
    .api(`/users/${SENDER_EMAIL}/sendMail`)
    .post({ message, saveToSentItems: "true" });
}

/* ------------------------------ DB bootstrap ------------------------------- */
async function initDb() {
  try {
    pool = await sql.connect(dbConfig);

    // mysql2-ish shim for existing code style
    pool.getConnection = async () => ({
      execute: async (query, params) => {
        let sqlText = query;
        const req = pool.request();
        if (Array.isArray(params) && params.length) {
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
            approver NVARCHAR(1024) NOT NULL,       -- can store ; separated
            cxoResponsible NVARCHAR(1024) NOT NULL, -- can store ; separated
            coOwner NVARCHAR(512) NULL,             -- optional CXO co-owner(s) ; separated
            timeline DATE NULL,
            currentStatus VARCHAR(50) NOT NULL,
            evidenceReceived NVARCHAR(MAX) NULL,    -- JSON
            evidenceStatus VARCHAR(50) NULL,
            reviewComments NVARCHAR(MAX) NULL,
            risk NVARCHAR(MAX) NULL,                -- renamed usage
            actionRequired NVARCHAR(MAX) NULL,
            startMonth VARCHAR(20) NULL,
            endMonth VARCHAR(20) NULL,
            annexure NVARCHAR(MAX) NULL,            -- JSON: [{name,path,size,type,uploadedAt}]
            createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
            updatedAt DATETIME2 NOT NULL DEFAULT GETDATE()
        );
    END;

    -- Legacy clean-up: remove IA comments if present
    IF COL_LENGTH('dbo.AuditIssues','iaComments') IS NOT NULL
      ALTER TABLE dbo.AuditIssues DROP COLUMN iaComments;

    -- Legacy column riskAnnexure left as-is if exists; new code uses 'risk'.
    `;

    await pool.request().query(tableCheckQuery);
    console.log("✅ AuditIssues table is ready");
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
const normStatus = (s) => {
  if (Array.isArray(s)) s = s[0] ?? "";
  if (typeof s !== "string") s = String(s ?? "");
  const status = s.trim().toLowerCase();
  if (status.includes("partially")) return "Partially Received";
  if (status.includes("received")) return "Received";
  return "To Be Received";
};
const normRiskLevel = (r) => {
  const rl = (r || "").toString().toLowerCase();
  if (rl === "high") return "high";
  if (rl === "low") return "low";
  return "medium";
};

// Accepts array, JSON-stringified array, or delimited string and returns string[]
const toEmails = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);

  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return [];
    // Try JSON array first
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    // Fallback: split by ; or ,
    return s
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  return [String(val)];
};

/* ----------------------- CREATE (single, from UI modal) --------------------- */
/**
 * Matches CreateAuditModal.tsx which POSTs FormData to /api/audit-issues
 * - Multiple approver / cxoResponsible emails allowed (FormData repeating keys)
 * - Optional cxoCoOwner(s)
 * - Risk (text) separate from Annexure (files). Annexure stored as JSON array.
 * - Supports coverageStartMonth/coverageEndMonth -> startMonth/endMonth
 */
app.post("/api/audit-issues", memoryUpload.any(), async (req, res) => {
  try {
    const body = req.body;

    // Collect multi-value fields: if only one, multer gives string; else array
    const toList = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);
    const approvers = toList(body.approver);
    const cxoList = toList(body.cxoResponsible);
    const cxoCoOwners = toList(body["cxoCoOwner[]"]); // from UI when + Co-owner used

    // Annexure files (separate from evidence)
    const annexureFiles = (req.files || []).filter(
      (f) => f.fieldname === "annexure"
    );
    let annexureArr = [];
    if (annexureFiles.length) {
      // persist to disk
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
    const connection = await pool.getConnection();
    const insertQuery = `
      INSERT INTO AuditIssues (
        id, fiscalYear, date, process, entityCovered, observation, riskLevel,
        recommendation, managementComment, personResponsible, approver,
        cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived,
        reviewComments, risk, actionRequired, startMonth, endMonth, annexure, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
    `;

    // Map body fields
    const fiscalYear = body.fiscalYear || "";
    const date = formatDate(body.date) || formatDate(new Date());
    const process = body.process || "";
    const entityCovered = body.entityCovered || "";
    const observation = body.observation || "";
    const riskLevel = normRiskLevel(body.riskLevel);
    const recommendation = body.recommendation || "";
    const managementComment = body.managementComment || "";
    const personResponsible = body.personResponsible || "";
    const approver = approvers.join(";"); // store as joined list
    const cxoResponsible = cxoList.join(";");
    const coOwner = cxoCoOwners.join(";"); // optional
    const timeline = body.timeline ? formatDate(body.timeline) : null;
    const currentStatus = normStatus(body.currentStatus);
    const evidenceReceived = JSON.stringify([]); // none on create
    const reviewComments = body.reviewComments || "";
    const risk = body.risk || ""; // renamed usage
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

    // Return created record (basic fields)
    const [rows] = await connection.execute(
      `SELECT * FROM AuditIssues WHERE id = ?`,
      [id]
    );
    const created = rows[0] || { id };
    try {
      created.evidenceReceived = JSON.parse(created.evidenceReceived || "[]");
      created.annexure = JSON.parse(created.annexure || "[]");
    } catch {
      /* noop */
    }
    res.status(201).json(created);
  } catch (err) {
    console.error("⛔ Create issue error:", err);
    res.status(500).json({ error: "Failed to create audit issue" });
  }
});

/* --------------------------- BULK upload (Excel/CSV) ------------------------ */
// --------- BULK upload (Excel/CSV) — header-driven & schema-safe ----------
app.post(
  "/api/audit-issues/upload",
  memoryUpload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      let workbook;
      if (ext === ".csv") {
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

      // helper to find a header (support synonyms, case-insensitive)
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

      // Validate minimum headers (you can relax this if needed)
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
        return res.status(400).json({
          error: `Missing required columns: ${missing.join(", ")}`,
        });
      }

      const connection = await pool.getConnection();
      const insertQuery = `
      INSERT INTO AuditIssues (
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
          // Pull by header name (order-agnostic)
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
          const annexureRaw = val(row, "annexure", ""); // can be "a.pdf; b.docx"

          // Normalize values
          const id = uuidv4();
          const riskLevel = normRiskLevel(riskLevelRaw);
          const currentStatus = normStatus(currentStatusRaw);

          const safeTimeline =
            typeof timelineRaw === "number"
              ? convertExcelDate(timelineRaw)
              : formatDate(timelineRaw);

          // Allow multiple annexure names separated by ; or ,
          const annexureArr = String(annexureRaw || "")
            .split(/[;,]\s*/)
            .filter(Boolean)
            .map((name) => ({
              name,
              uploadedAt: new Date().toISOString(),
            }));

          // Allow multi emails for PR/Approver/CXO using ; or ,
          const joinMulti = (s) =>
            String(s || "")
              .split(/[;,]\s*/)
              .filter(Boolean)
              .join(";");

          const values = [
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
            JSON.stringify([]), // evidenceReceived
            reviewComments || "",
            risk || "",
            actionRequired || "",
            startMonth || "",
            endMonth || "",
            JSON.stringify(annexureArr), // annexure as JSON array
          ];

          await connection.execute(insertQuery, values);
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
// LIST: GET /api/audit-issues
app.get("/api/audit-issues", async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute(`
      SELECT 
        id, serialNumber, fiscalYear, date, process,
        entityCovered, observation, riskLevel, recommendation,
        managementComment, personResponsible, approver, cxoResponsible,
        coOwner, timeline, currentStatus, evidenceReceived, evidenceStatus,
        reviewComments, risk, actionRequired, startMonth, endMonth,
        annexure, createdAt, updatedAt
      FROM AuditIssues
      ORDER BY createdAt DESC;
    `);

    const issues = rows.map((r) => {
      let ev = [];
      try {
        ev = JSON.parse(r.evidenceReceived || "[]");
      } catch {}
      return { ...r, evidenceReceived: ev };
    });

    res.status(200).json(issues);
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
      const connection = await pool.getConnection();
      const [rows] = await connection.execute(
        `SELECT evidenceReceived, personResponsible, cxoResponsible, approver, serialNumber, process, entityCovered 
         FROM AuditIssues 
         WHERE id = ?`,
        [issueId]
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Audit issue not found" });

      const row = rows[0];
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

      await connection.execute(
        `UPDATE AuditIssues 
         SET evidenceReceived = ?, updatedAt = GETDATE() 
         WHERE id = ?`,
        [JSON.stringify(updatedEvidence), issueId]
      );

      // 5) Notifications
      const caption = `${row.serialNumber} – ${row.process} / ${row.entityCovered}`;

      const htmlForPerson = `
  Your Proof for ${caption} was submitted and is awaiting Auditor Response.
`;
      const htmlForCXO = `
  ${uploadedBy} has submitted proof for ${caption}.<br/>
  You were marked as CXO responsible for ${caption}.<br/>
  Please review: <a href="https://audit.premierenergies.com">audit.premierenergies.com</a>
`;
      const htmlForAuditor = `
  ${uploadedBy} has uploaded proof for ${caption}.<br/>
  Please review and comment as soon as possible.
`;

      // NEW: handle arrays / JSON / delimited strings
      const personEmails = toEmails(row.personResponsible);
      const cxoEmails = toEmails(row.cxoResponsible);
      const approverEmails = toEmails(row.approver);

      // send to everyone (noop if list is empty)
      await Promise.all([
        ...personEmails.map((e) =>
          sendEmail(e, "Proof Submitted", htmlForPerson)
        ),
        ...cxoEmails.map((e) =>
          sendEmail(e, `${uploadedBy} submitted proof`, htmlForCXO)
        ),
        ...approverEmails.map((e) =>
          sendEmail(e, "New Proof Uploaded", htmlForAuditor)
        ),
      ]);

      res.status(200).json({
        message: `Stored ${newEntries.length} file(s) and notified stakeholders.`,
      });
    } catch (err) {
      console.error("⛔ Evidence upload error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

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
    const connection = await pool.getConnection();
    const [lookupRows] = await connection.execute(
      `SELECT serialNumber, process, entityCovered, personResponsible, cxoResponsible
       FROM AuditIssues WHERE id = ?`,
      [issueId]
    );
    if (lookupRows.length === 0)
      return res.status(404).json({ error: "Audit issue not found" });

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
      `UPDATE AuditIssues SET ${updateFields.join(", ")} WHERE id = ?`,
      [evidenceStatus, reviewComments, issueId]
    );

    const [updatedRows] = await connection.execute(
      `SELECT * FROM AuditIssues WHERE id = ?`,
      [issueId]
    );
    const updated = updatedRows[0];

    try {
      updated.evidenceReceived = JSON.parse(updated.evidenceReceived || "[]");
    } catch {
      updated.evidenceReceived = [];
    }

    // notifications (keep basic)
    // notifications
    const caption = `${updated.serialNumber} – ${updated.process} / ${updated.entityCovered}`;
    const link = `<a href="https://audit.premierenergies.com">audit.premierenergies.com</a>`;

    // NEW: normalize recipients
    const personEmails = toEmails(updated.personResponsible);
    const cxoEmails = toEmails(updated.cxoResponsible);

    if (evidenceStatus === "Accepted") {
      await Promise.all([
        ...personEmails.map((e) =>
          sendEmail(
            e,
            `Proof Accepted for ${caption}`,
            `The proof for ${caption} has been accepted. ${link}`
          )
        ),
        ...cxoEmails.map((e) =>
          sendEmail(
            e,
            `Proof Accepted for ${caption}`,
            `The proof for ${caption} has been accepted. ${link}`
          )
        ),
      ]);
    } else if (evidenceStatus === "Partially Accepted") {
      await Promise.all([
        ...personEmails.map((e) =>
          sendEmail(
            e,
            `Proof Partially Accepted for ${caption}`,
            `The proof for ${caption} has been partially accepted. ${link}`
          )
        ),
        ...cxoEmails.map((e) =>
          sendEmail(
            e,
            `Proof Partially Accepted for ${caption}`,
            `The proof for ${caption} has been partially accepted. ${link}`
          )
        ),
      ]);
    } else {
      await Promise.all([
        ...personEmails.map((e) =>
          sendEmail(
            e,
            `Proof Marked as Not Sufficient for ${caption}`,
            `The proof for ${caption} is insufficient. ${link}`
          )
        ),
        ...cxoEmails.map((e) =>
          sendEmail(
            e,
            `Proof Marked as Not Sufficient for ${caption}`,
            `The proof for ${caption} is insufficient. ${link}`
          )
        ),
      ]);
    }

    res.status(200).json(updated);
  } catch (err) {
    console.error("⛔ Review endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------ Reports (XLSX) ------------------------------ */
app.get("/api/audit-issues/reports/:reportType", async (req, res) => {
  const { reportType } = req.params;

  let query;
  let sheetName;

  if (reportType === "next3") {
    sheetName = "Next_3_Months_Report";
    query = `
      SELECT * FROM AuditIssues
      WHERE timeline >= @p0
        AND timeline < DATEADD(MONTH, 3, @p0)
      ORDER BY timeline;
    `;
  } else if (reportType === "next6") {
    sheetName = "Next_6_Months_Report";
    query = `
      SELECT * FROM AuditIssues
      WHERE timeline >= @p0
        AND timeline < DATEADD(MONTH, 6, @p0)
      ORDER BY timeline;
    `;
  } else if (reportType === "overdue") {
    sheetName = "Overdue_Report";
    query = `
      SELECT * FROM AuditIssues
      WHERE timeline < @p0
      ORDER BY timeline;
    `;
  } else {
    return res
      .status(400)
      .json({ error: "Invalid reportType. Use next3, next6 or overdue." });
  }

  try {
    const connection = await pool.getConnection();
    const today = new Date();
    const dateParam = today.toISOString().split("T")[0];

    const [rows] =
      reportType === "overdue"
        ? await connection.execute(query, [dateParam])
        : await connection.execute(query, [dateParam]);

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
// MANUAL CLOSE: POST /api/audit-issues/:id/close
app.post("/api/audit-issues/:id/close", async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await pool.getConnection();
    await connection.execute(
      "UPDATE AuditIssues SET currentStatus = 'Closed', updatedAt = GETDATE() WHERE id = ?",
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

/* --------------------------------- Servers --------------------------------- */
const PORT = process.env.PORT || 12443;
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
