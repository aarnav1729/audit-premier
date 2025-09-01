import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Download, FileSpreadsheet, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

const API_BASE_URL = `${window.location.origin}/api`;

export const ExcelUpload: React.FC = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep lowercase headers (server is case-insensitive)
  const requiredColumns = [
    "fiscalYear",
    "process",
    "entityCovered",
    "observation",
    "riskLevel",
    "recommendation",
    "managementComment",
    "personResponsible", // allow multiple: "a@x.com; b@y.com"
    "approver", // allow multiple
    "cxoResponsible", // allow multiple
    "coOwner", // optional, allow multiple
    "timeline", // ISO (YYYY-MM-DD) or Excel date
    "currentStatus", // Received | Partially Received | To Be Received
    "startMonth", // coverage start (e.g., Jan)
    "endMonth", // coverage end (e.g., Mar)
    "reviewComments",
    "risk",
    "actionRequired",
    "annexure", // "file1.pdf; file2.docx" (names only)
  ];

  const downloadTemplate = () => {
    const header = requiredColumns.join("\t") + "\n";
    const example =
      [
        "2024-25",
        "ITGC",
        "PEL",
        "Observation content",
        "High",
        "Recommendation content",
        "Management comments",
        "person@example.com; second@company.com",
        "approver@example.com",
        "cxo@example.com",
        "co-owner@example.com",
        "2024-12-01",
        "Partially Received",
        "Jan",
        "Mar",
        "Reviewed and verified",
        "Medium operational risk",
        "Follow-up required",
        "evidence.pdf; policy.docx",
      ].join("\t") + "\n";

    const tsv = header + example;
    const blob = new Blob([tsv], {
      type: "text/tab-separated-values;charset=utf-8;",
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit_issues_template.tsv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Template Downloaded",
      description: "Template (TSV) downloaded with a sample row.",
    });
  };

  const toLower = (s: any) =>
    String(s ?? "")
      .trim()
      .toLowerCase();

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);

    try {
      // --- PRE-FLIGHT: parse locally and warn on empty required fields ---
      // match server's "mustHave" list
      const coreRequired = [
        "fiscalyear",
        "process",
        "entitycovered",
        "observation",
        "risklevel",
        "recommendation",
        "personresponsible",
        "currentstatus",
        "cxoresponsible",
      ];

      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
      let workbook: XLSX.WorkBook;
      if (ext === ".csv" || ext === ".tsv") {
        const text = await file.text();
        workbook = XLSX.read(text, { type: "string" });
      } else {
        const buf = await file.arrayBuffer();
        workbook = XLSX.read(buf, { type: "array" });
      }
      const ws = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: "",
      });
      if (!rows.length) {
        throw new Error("File is empty.");
      }

      const headerRow = rows[0].map(toLower);
      const dataRows = rows
        .slice(1)
        .filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

      // collect fields with any empty cells
      const emptyFields = new Set<string>();
      for (const req of coreRequired) {
        const idx = headerRow.indexOf(req);
        if (idx === -1) continue; // missing header already handled server-side
        for (const r of dataRows) {
          if (idx >= r.length || String(r[idx] ?? "").trim() === "") {
            emptyFields.add(req);
            break;
          }
        }
      }

      if (emptyFields.size) {
        const msg =
          `The following required field(s) have empty value(s):\n\n` +
          Array.from(emptyFields).join(", ") +
          `\n\nDo you want to continue with incomplete rows?`;
        const ok = window.confirm(msg);
        if (!ok) {
          // Reset and bail out (no server call)
          if (fileInputRef.current) fileInputRef.current.value = "";
          setIsProcessing(false);
          return;
        }
      }
      // --- END PRE-FLIGHT ---

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE_URL}/audit-issues/upload`, {
        method: "POST",
        body: formData,
      });

      // try to parse JSON even on errors
      let result: any = {};
      try {
        result = await response.json();
      } catch {}

      if (!response.ok) {
        throw new Error(
          result.error ||
            result.message ||
            `Upload failed (HTTP ${response.status})`
        );
      }

      toast({
        title: "Upload Complete",
        description: result.message,
      });

      // reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error: any) {
      console.error("Upload error:", error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Excel Upload</h2>
          <p className="text-gray-600 mt-1">
            Bulk import audit issues from CSV/Excel files
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Upload className="h-5 w-5" />
              <span>Upload File</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <FileSpreadsheet className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">
                Upload your CSV/TSV or Excel (.xlsx/.xls) file
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isProcessing}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="bg-gradient-to-r from-blue-500 to-green-500"
              >
                {isProcessing ? "Processing..." : "Choose File"}
              </Button>
            </div>

            <div className="flex items-start space-x-2 p-3 bg-blue-50 rounded-lg">
              <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
              <div className="text-sm text-blue-700">
                <p className="font-medium">Important Notes:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>
                    Headers are case-insensitive and order doesn’t matter.
                  </li>
                  <li>Use tab-separated (TSV), CSV, or Excel format.</li>
                  <li>
                    Date format for "timeline": YYYY-MM-DD (or Excel date
                    serial).
                  </li>
                  <li>Use “;” or “,” to separate multiple emails/files.</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Download className="h-5 w-5" />
              <span>Download Template</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600">
              Download a TSV template with headers and one example row.
            </p>
            <Button
              onClick={downloadTemplate}
              variant="outline"
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Required Headers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {requiredColumns.map((column, index) => (
                    <TableHead key={index} className="whitespace-nowrap">
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>2024-25</TableCell>
                  <TableCell>ITGC</TableCell>
                  <TableCell>PEL</TableCell>
                  <TableCell>Observation content</TableCell>
                  <TableCell>High</TableCell>
                  <TableCell>Recommendation content</TableCell>
                  <TableCell>Management comments</TableCell>
                  <TableCell>person@example.com</TableCell>
                  <TableCell>approver@example.com</TableCell>
                  <TableCell>cxo@example.com</TableCell>
                  <TableCell>co-owner@example.com</TableCell>
                  <TableCell>2024-12-01</TableCell>
                  <TableCell>Partially Received</TableCell>
                  <TableCell>Jan</TableCell>
                  <TableCell>Mar</TableCell>
                  <TableCell>Reviewed and verified</TableCell>
                  <TableCell>Medium operational risk</TableCell>
                  <TableCell>Follow-up required</TableCell>
                  <TableCell>evidence.pdf; policy.docx</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
