const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const XLSX = require("xlsx");
const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");
require("isomorphic-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// multer for Excel/CSV (in memory)
const upload = multer({ storage: multer.memoryStorage() });

// --- multer for any file attachment (including annexure) ---
const evidenceStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.random().toString(36).substr(2, 9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const uploadEvidence = multer({ storage: evidenceStorage });

// → MSSQL connection configuration
const dbConfig = {
  user: "SPOT_USER",
  password: "Premier#3801",
  server: "10.0.40.10",
  port: 1433,
  database: "SPOT_UAT",
  options: {
    trustServerCertificate: true,
    encrypt: false,
    connectionTimeout: 60000,
  },
};

// Microsoft Graph API credentials
const CLIENT_ID = "3d310826-2173-44e5-b9a2-b21e940b67f7";
const TENANT_ID = "1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1";
const CLIENT_SECRET = "2e78Q~yX92LfwTTOg4EYBjNQrXrZ2z5di1Kvebog";
const SENDER_EMAIL = "spot@premierenergies.com";

// Create credential and Graph client
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

// Helper to send email via Graph
async function sendEmail(toEmail, subject, htmlContent) {
  const message = {
    subject: subject,
    body: {
      contentType: "HTML",
      content: htmlContent,
    },
    toRecipients: [{ emailAddress: { address: toEmail } }],
  };

  await graphClient
    .api(`/users/${SENDER_EMAIL}/sendMail`)
    .post({ message, saveToSentItems: "true" });
}

// Initialize DB and ensure AuditIssues table exists
async function initDb() {
  try {
    const pool = await sql.connect(dbConfig);
    const tableCheckQuery = `
      IF NOT EXISTS (
        SELECT * FROM sys.objects 
        WHERE object_id = OBJECT_ID(N'[dbo].[AuditIssues]') AND type = N'U'
      )
      BEGIN
        CREATE TABLE [dbo].[AuditIssues] (
          [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
          [serialNumber] INT IDENTITY(1,1) NOT NULL,
          [fiscalYear] VARCHAR(9) NOT NULL,
          [date] DATE NOT NULL,
          [process] VARCHAR(100) NOT NULL,
          [entityCovered] VARCHAR(100) NOT NULL,
          [observation] NVARCHAR(MAX) NOT NULL,
          [riskLevel] VARCHAR(10) NOT NULL,
          [recommendation] NVARCHAR(MAX) NOT NULL,
          [managementComment] NVARCHAR(MAX) NULL,
          [personResponsible] VARCHAR(256) NOT NULL,
          [approver] VARCHAR(256) NOT NULL,
          [cxoResponsible] VARCHAR(256) NOT NULL,
          [timeline] DATE NULL,
          [currentStatus] VARCHAR(50) NOT NULL,
          [evidenceReceived] NVARCHAR(MAX) NULL,
          [evidenceStatus] VARCHAR(50) NULL,
          [reviewComments] NVARCHAR(MAX) NULL,
          [riskAnnexure] NVARCHAR(MAX) NULL,
          [actionRequired] NVARCHAR(MAX) NULL,
          [iaComments] NVARCHAR(MAX) NULL,
          [createdAt] DATETIME2 NOT NULL DEFAULT GETDATE(),
          [updatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
        );
      END
    `;
    await pool.request().query(tableCheckQuery);
    console.log("✅ AuditIssues table is ready");
  } catch (err) {
    console.error("⛔ Failed to initialize database:", err);
    process.exit(1);
  }
}
initDb();

// POST /api/audit-issues → insert & send emails
app.post(
  "/api/audit-issues",
  uploadEvidence.single("annexure"),
  async (req, res) => {
    const {
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
      timeline,
      currentStatus,
      actionRequired,
      iaComments,
    } = req.body;

    // join multiple entities if array
    const entityCoveredVal = Array.isArray(entityCovered)
      ? entityCovered.join(", ")
      : entityCovered;

    // build riskAnnexure JSON { text, fileMeta }
    const annexureText = req.body.riskAnnexure || "";
    let annexureFileMeta = null;
    if (req.file) {
      annexureFileMeta = {
        originalName: req.file.originalname,
        fileName: req.file.filename,
        path: path.relative(__dirname, req.file.path),
        mimetype: req.file.mimetype,
        size: req.file.size,
      };
    }
    const riskAnnexureValue = JSON.stringify({
      text: annexureText,
      file: annexureFileMeta,
    });

    try {
      const pool = await sql.connect(dbConfig);
      const insertQuery = `
        INSERT INTO [dbo].[AuditIssues]
          (fiscalYear, [date], [process], entityCovered, observation, riskLevel,
           recommendation, managementComment, personResponsible, approver,
           cxoResponsible, timeline, currentStatus, evidenceReceived,
           riskAnnexure, actionRequired, iaComments)
        OUTPUT INSERTED.*
        VALUES
          (@fiscalYear, @date, @process, @entityCovered, @observation, @riskLevel,
           @recommendation, @managementComment, @personResponsible, @approver,
           @cxoResponsible, @timeline, @currentStatus, @evidenceReceived,
           @riskAnnexure, @actionRequired, @iaComments);
      `;
      const reqDb = pool.request();
      reqDb.input("fiscalYear", sql.VarChar(9), fiscalYear);
      reqDb.input("date", sql.Date, date);
      reqDb.input("process", sql.VarChar(100), process);
      reqDb.input("entityCovered", sql.VarChar(200), entityCoveredVal);
      reqDb.input("observation", sql.NVarChar(sql.MAX), observation);
      reqDb.input("riskLevel", sql.VarChar(10), riskLevel);
      reqDb.input("recommendation", sql.NVarChar(sql.MAX), recommendation);
      reqDb.input(
        "managementComment",
        sql.NVarChar(sql.MAX),
        managementComment
      );
      reqDb.input("personResponsible", sql.VarChar(256), personResponsible);
      reqDb.input("approver", sql.VarChar(256), approver);
      reqDb.input("cxoResponsible", sql.VarChar(256), cxoResponsible);
      reqDb.input("timeline", sql.Date, timeline || null);
      reqDb.input("currentStatus", sql.VarChar(50), currentStatus);
      reqDb.input(
        "evidenceReceived",
        sql.NVarChar(sql.MAX),
        JSON.stringify([])
      );
      reqDb.input("riskAnnexure", sql.NVarChar(sql.MAX), riskAnnexureValue);
      reqDb.input("actionRequired", sql.NVarChar(sql.MAX), actionRequired);
      reqDb.input("iaComments", sql.NVarChar(sql.MAX), iaComments);

      const { recordset } = await reqDb.query(insertQuery);
      const newIssue = recordset[0];

      // send all three emails (serialNumber/fiscalYear rendering client-side)
      const caption = `${newIssue.serialNumber}/${newIssue.fiscalYear}`;
      const detailsHtml = `
        <h2>Audit Issue Details</h2>
        <ul>
          <li><strong>Serial #:</strong> ${caption}</li>
          <li><strong>Date:</strong> ${new Date(
            newIssue.date
          ).toLocaleDateString()}</li>
          <li><strong>Process:</strong> ${newIssue.process}</li>
          <li><strong>Entity:</strong> ${newIssue.entityCovered}</li>
          <li><strong>Observation:</strong> ${newIssue.observation}</li>
          <li><strong>Risk Level:</strong> ${newIssue.riskLevel}</li>
          <li><strong>Recommendation:</strong> ${newIssue.recommendation}</li>
          <li><strong>Management Comment:</strong> ${
            newIssue.managementComment || "–"
          }</li>
          <li><strong>Timeline:</strong> ${
            newIssue.timeline
              ? new Date(newIssue.timeline).toLocaleDateString()
              : "–"
          }</li>
          <li><strong>IA Comments:</strong> ${newIssue.iaComments || "–"}</li>
        </ul>
        <p>View in application: <a href="https://audit.premierenergies.com">audit.premierenergies.com</a></p>
      `;
      await Promise.all([
        sendEmail(
          newIssue.personResponsible,
          "New Audit Issue Assigned to you",
          detailsHtml
        ),
        sendEmail(
          newIssue.cxoResponsible,
          "You have been assigned as the CXO for a New Audit Issue",
          detailsHtml
        ),
        sendEmail(
          newIssue.approver,
          "You are the Approver for a new Audit Issue",
          detailsHtml
        ),
      ]);

      res.status(201).json(newIssue);
    } catch (err) {
      console.error("⛔ Error creating audit issue:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /api/audit-issues → fetch all (latest first)
app.get("/api/audit-issues", async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query(`
      SELECT 
        id, serialNumber, fiscalYear, [date], [process],
        entityCovered, observation, riskLevel, recommendation,
        managementComment, personResponsible, approver, cxoResponsible,
        timeline, currentStatus, evidenceReceived, evidenceStatus,
        reviewComments, riskAnnexure, actionRequired, iaComments,
        createdAt, updatedAt
      FROM [dbo].[AuditIssues]
      ORDER BY createdAt DESC;
    `);

    const issues = result.recordset.map((r) => {
      let ev = [];
      if (typeof r.evidenceReceived === "string") {
        try {
          ev = JSON.parse(r.evidenceReceived);
        } catch {
          ev = [];
        }
      }
      return { ...r, evidenceReceived: ev };
    });

    res.status(200).json(issues);
  } catch (err) {
    console.error("⛔ Error fetching audit issues:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// NEW: POST /api/audit-issues/upload → bulk insert from Excel/CSV
app.post(
  "/api/audit-issues/upload",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      // parse workbook
      const ext = path.extname(req.file.originalname).toLowerCase();
      let workbook;
      if (ext === ".csv") {
        const text = req.file.buffer.toString("utf8");
        workbook = XLSX.read(text, { type: "string" });
      } else {
        workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });

      if (rows.length < 2) {
        return res
          .status(400)
          .json({ error: "File must have header and at least one row" });
      }

      const dataRows = rows.slice(1);
      let successCount = 0;
      let errorCount = 0;

      const pool = await sql.connect(dbConfig);
      const insertQuery = `
        INSERT INTO [dbo].[AuditIssues]
          (fiscalYear, [date], [process], entityCovered, observation, riskLevel,
           recommendation, managementComment, personResponsible, approver,
           cxoResponsible, timeline, currentStatus, evidenceReceived,
           riskAnnexure, actionRequired, iaComments)
        VALUES
          (@fiscalYear, @date, @process, @entityCovered, @observation, @riskLevel,
           @recommendation, @managementComment, @personResponsible, @approver,
           @cxoResponsible, @timeline, @currentStatus, @evidenceReceived,
           @riskAnnexure, @actionRequired, @iaComments);
      `;

      for (const row of dataRows) {
        if (!row.some((cell) => cell.trim())) continue;

        try {
          const [
            ,
            fiscalYear,
            proc,
            entityCovered,
            observation,
            risk,
            recommendation,
            managementComment,
            personResponsible,
            approver,
            cxoResponsible,
            timeline,
            currentStatus,
            ,
            reviewComments,
            riskDup,
            riskAnnexure,
            actionRequired,
            managementComments2,
            iaComments,
          ] = row;

          const mapRiskLevel = (r) => {
            const rl = (r || "").toString().toLowerCase();
            if (rl === "high") return "high";
            if (rl === "low") return "low";
            return "medium";
          };
          const mapStatus = (s) =>
            (s || "").toString().toLowerCase().includes("received")
              ? "Received"
              : "To Be Received";

          const reqDb = pool.request();
          reqDb.input("fiscalYear", sql.VarChar(9), fiscalYear || "");
          reqDb.input("date", sql.Date, new Date().toISOString().split("T")[0]);
          reqDb.input("process", sql.VarChar(100), proc || "");
          reqDb.input("entityCovered", sql.VarChar(100), entityCovered || "");
          reqDb.input("observation", sql.NVarChar(sql.MAX), observation || "");
          reqDb.input("riskLevel", sql.VarChar(10), mapRiskLevel(risk));
          reqDb.input(
            "recommendation",
            sql.NVarChar(sql.MAX),
            recommendation || ""
          );
          reqDb.input(
            "managementComment",
            sql.NVarChar(sql.MAX),
            managementComment || ""
          );
          reqDb.input(
            "personResponsible",
            sql.VarChar(256),
            personResponsible || ""
          );
          reqDb.input("approver", sql.VarChar(256), approver || "");
          reqDb.input("cxoResponsible", sql.VarChar(256), cxoResponsible || "");
          reqDb.input("timeline", sql.Date, timeline || null);
          reqDb.input(
            "currentStatus",
            sql.VarChar(50),
            mapStatus(currentStatus)
          );
          reqDb.input(
            "evidenceReceived",
            sql.NVarChar(sql.MAX),
            JSON.stringify([])
          );
          reqDb.input(
            "riskAnnexure",
            sql.NVarChar(sql.MAX),
            riskAnnexure || ""
          );
          reqDb.input(
            "actionRequired",
            sql.NVarChar(sql.MAX),
            actionRequired || ""
          );
          reqDb.input("iaComments", sql.NVarChar(sql.MAX), iaComments || "");

          await reqDb.query(insertQuery);
          successCount++;
        } catch (error) {
          console.error("Row insert error:", error);
          errorCount++;
        }
      }

      res.status(200).json({
        message: `Imported ${successCount} rows${
          errorCount ? `, ${errorCount} failed` : ""
        }.`,
      });
    } catch (err) {
      console.error("Upload processing error:", err);
      res.status(500).json({ error: "Failed to process upload" });
    }
  }
);

// NEW: POST /api/audit-issues/:id/evidence → upload proof files & notify
app.post(
  "/api/audit-issues/:id/evidence",
  uploadEvidence.array("evidence"),
  async (req, res) => {
    const issueId = req.params.id;
    const uploadedBy = req.body.uploadedBy || "Unknown";
    const textEvidence = (req.body.textEvidence || "").trim();

    try {
      const pool = await sql.connect(dbConfig);

      // 1) fetch existing evidence & stakeholders
      const lookup = await pool
        .request()
        .input("id", sql.UniqueIdentifier, issueId).query(`
          SELECT 
            evidenceReceived, 
            personResponsible, 
            cxoResponsible, 
            approver,
            serialNumber, 
            [process], 
            entityCovered
          FROM [dbo].[AuditIssues]
          WHERE id = @id;
        `);

      if (!lookup.recordset.length) {
        return res.status(404).json({ error: "Audit issue not found" });
      }

      const row = lookup.recordset[0];
      let currentEvidence = [];
      if (row.evidenceReceived) {
        try {
          currentEvidence = JSON.parse(row.evidenceReceived);
        } catch {
          currentEvidence = [];
        }
      }

      // 2) save new files to disk & build metadata
      const newEntries = req.files.map((file) => ({
        id: Date.now() + "-" + Math.random().toString(36).substr(2, 9),
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy,
        path: path.relative(__dirname, file.path),
      }));

      // 2a) if there is text evidence, prepend it as its own entry
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

      const updatedEvidence = [...currentEvidence, ...newEntries];

      // 3) update only evidenceReceived (+ updatedAt), NOT currentStatus
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, issueId)
        .input(
          "evidenceReceived",
          sql.NVarChar(sql.MAX),
          JSON.stringify(updatedEvidence)
        ).query(`
          UPDATE [dbo].[AuditIssues]
          SET 
            evidenceReceived = @evidenceReceived,
            updatedAt = GETDATE()
          WHERE id = @id;
        `);

      // 4) send notifications
      const caption = `${row.serialNumber} – ${row.process} / ${row.entityCovered}`;
      const htmlForPerson = `
        Your Proof for ${caption} was submitted and is awaiting Auditor Response.
      `;
      const htmlForCXO = `
        ${uploadedBy} has submitted proof for ${caption}.<br/>
        You were marked as CXO responsible for ${caption} and they have added evidence.<br/>
        Please review: <a href="https://audit.premierenergies.com">audit.premierenergies.com</a>
      `;
      const htmlForAuditor = `
        ${uploadedBy} has uploaded proof for ${caption}.<br/>
        Please review and comment as soon as possible.
      `;

      await Promise.all([
        sendEmail(row.personResponsible, "Proof Submitted", htmlForPerson),
        sendEmail(
          row.cxoResponsible,
          `${uploadedBy} submitted proof for ${caption}`,
          htmlForCXO
        ),
        sendEmail(
          row.approver,
          `New Proof Uploaded for ${caption}`,
          htmlForAuditor
        ),
      ]);

      // 5) respond
      res.status(200).json({
        message: `Stored ${newEntries.length} files and notified stakeholders.`,
      });
    } catch (err) {
      console.error("⛔ Evidence upload error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── NEW: PUT /api/audit-issues/:id/review ─────────────────────────────────────
app.put("/api/audit-issues/:id/review", async (req, res) => {
  const issueId = req.params.id;
  const { evidenceStatus, reviewComments } = req.body;

  if (!["Accepted", "Insufficient"].includes(evidenceStatus)) {
    return res
      .status(400)
      .json({ error: 'evidenceStatus must be "Accepted" or "Insufficient"' });
  }

  try {
    const pool = await sql.connect(dbConfig);

    // Fetch current row for email recipients and details
    const lookup = await pool
      .request()
      .input("id", sql.UniqueIdentifier, issueId).query(`
        SELECT serialNumber, [process], entityCovered,
               personResponsible, cxoResponsible
        FROM [dbo].[AuditIssues]
        WHERE id = @id;
      `);
    if (!lookup.recordset.length) {
      return res.status(404).json({ error: "Audit issue not found" });
    }
    const {
      serialNumber,
      process,
      entityCovered,
      personResponsible,
      cxoResponsible,
    } = lookup.recordset[0];
    const caption = `${serialNumber} – ${process} / ${entityCovered}`;

    // Build update SQL
    let updateSql = `
      UPDATE [dbo].[AuditIssues]
      SET evidenceStatus   = @evidenceStatus,
          reviewComments   = @reviewComments,
          updatedAt        = GETDATE()`;
    if (evidenceStatus === "Accepted") {
      updateSql += `,
          currentStatus    = 'Received'`;
    }
    updateSql += `
      WHERE id = @id;
    `;

    // Execute update
    await pool
      .request()
      .input("evidenceStatus", sql.VarChar(50), evidenceStatus)
      .input("reviewComments", sql.NVarChar(sql.MAX), reviewComments)
      .input("id", sql.UniqueIdentifier, issueId)
      .query(updateSql);

    // Prepare email payloads
    if (evidenceStatus === "Accepted") {
      await Promise.all([
        sendEmail(
          personResponsible,
          `Proof Accepted for ${caption}`,
          `The proof you have uploaded for ${caption} has been accepted by the auditor. Please review here: <a href="https://audit.premierenergies.com">audit.premierenergies.com</a>`
        ),
        sendEmail(
          cxoResponsible,
          `Proof Accepted for ${caption}`,
          `The proof uploaded for ${caption} by ${personResponsible} has been accepted by the auditor. Please review here: <a href="https://audit.premierenergies.com">audit.premierenergies.com</a>`
        ),
      ]);
    } else {
      // Insufficient
      await Promise.all([
        sendEmail(
          personResponsible,
          `Proof Marked as Not Sufficient for ${caption}`,
          `The proof you have uploaded for ${caption} has been marked as insufficient by the auditor. Please review here: <a href="https://audit.premierenergies.com">audit.premierenergies.com</a>`
        ),
        sendEmail(
          cxoResponsible,
          `Proof Marked as Not Sufficient for ${caption}`,
          `The proof uploaded for ${caption} by ${personResponsible} has been marked as insufficient by the auditor. Please review here: <a href="https://audit.premierenergies.com">audit.premierenergies.com</a>`
        ),
      ]);
    }

    // Return updated record
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, issueId)
      .query(`SELECT * FROM [dbo].[AuditIssues] WHERE id = @id;`);
    let updated = result.recordset[0];
    try {
      updated.evidenceReceived = JSON.parse(updated.evidenceReceived || "[]");
    } catch {
      updated.evidenceReceived = [];
    }

    res.status(200).json(updated);
  } catch (err) {
    console.error("⛔ Review endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── NEW: GET /api/audit-issues/reports/:reportType ───────────────────────────────
app.get('/api/audit-issues/reports/:reportType', async (req, res) => {
  const { reportType } = req.params;
  const pool = await sql.connect(dbConfig);
  const today = new Date();
  let query;
  let sheetName;

  if (reportType === 'next3') {
    sheetName = 'Next_3_Months_Report';
    query = `
      SELECT * FROM [dbo].[AuditIssues]
      WHERE timeline >= @today
        AND timeline < DATEADD(month, 3, @today)
      ORDER BY timeline;
    `;
  } else if (reportType === 'next6') {
    sheetName = 'Next_6_Months_Report';
    query = `
      SELECT * FROM [dbo].[AuditIssues]
      WHERE timeline >= @today
        AND timeline < DATEADD(month, 6, @today)
      ORDER BY timeline;
    `;
  } else if (reportType === 'overdue') {
    sheetName = 'Overdue_Report';
    query = `
      SELECT * FROM [dbo].[AuditIssues]
      WHERE timeline < @today
      ORDER BY timeline;
    `;
  } else {
    return res.status(400).json({ error: 'Invalid reportType. Use next3, next6 or overdue.' });
  }

  try {
    const result = await pool.request()
      .input('today', sql.Date, today.toISOString().split('T')[0])
      .query(query);

    const issues = result.recordset;

    // Build Excel workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(issues);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename=${sheetName}.xlsx`
    );
    res.type(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buf);
  } catch (err) {
    console.error('⛔ Report generation error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

const clientDist = path.join(__dirname, "dist");

// Only if that folder exists, mount it:
if (fs.existsSync(clientDist)) {
  // 1) serve files (index.html, static/js/*.js, etc.)
  app.use(express.static(clientDist));

  // 2) any GET that doesn't start with /api → index.html
  //    (so React Router can handle client‐side routes)
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// start server
const PORT = process.env.PORT || 30443;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
