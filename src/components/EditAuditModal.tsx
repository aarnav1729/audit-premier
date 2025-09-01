import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AuditIssue } from "@/types/audit";
import { DocumentViewer, DocItem } from "@/components/DocumentViewer";

const API_BASE_URL = `${window.location.origin}/api`;

type Props = {
  open: boolean;
  onClose: () => void;
  issue: AuditIssue | null;
  onSaved?: (updated: AuditIssue) => void; // callback to refresh parent state
};

function toAbsUrl(p?: string | null) {
  if (!p) return null;
  const cleaned = p.replace(/^\.*\/?/, "");
  return `${window.location.origin}/${cleaned}`;
}

export const EditAuditModal: React.FC<Props> = ({ open, onClose, issue, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);

  // Local form state (clone from issue)
  const [form, setForm] = useState({
    fiscalYear: "",
    date: "",
    process: "",
    entityCovered: "",
    observation: "",
    riskLevel: "medium",
    recommendation: "",
    managementComment: "",
    personResponsible: "",
    approver: "",
    cxoResponsible: "",
    coOwner: "",
    timeline: "",
    currentStatus: "To Be Received",
    reviewComments: "",
    risk: "",
    actionRequired: "",
    startMonth: "",
    endMonth: "",
  });

  const observationLocked = useMemo(
    () => (issue?.evidenceStatus || "") === "Accepted",
    [issue]
  );

  // Normalize annexure/evidence for the viewer
  const allFiles: DocItem[] = useMemo(() => {
    const annRaw = (issue as any)?.annexure;
    let annexure: any[] = [];
    try {
      annexure = Array.isArray(annRaw) ? annRaw : JSON.parse(annRaw || "[]");
    } catch {
      annexure = [];
    }
    const ev = Array.isArray(issue?.evidenceReceived) ? issue!.evidenceReceived : [];

    const annDocs: DocItem[] = (annexure || []).map((a, i) => ({
      id: `ann-${i}`,
      name: a?.name || `Annexure ${i + 1}`,
      path: a?.path || null,
      type: a?.type || null,
      size: a?.size || null,
      uploadedAt: a?.uploadedAt || null,
    }));

    const evDocs: DocItem[] = (ev || []).map((e, i) => ({
      id: e?.id || `ev-${i}`,
      name: e?.fileName || e?.name || `Evidence ${i + 1}`,
      path: e?.path || null,
      type: e?.fileType || e?.type || null,
      size: e?.fileSize || e?.size || null,
      uploadedAt: e?.uploadedAt || null,
      content: e?.content || null,
      fileName: e?.fileName || null,
      fileType: e?.fileType || null,
    }));

    return [...annDocs, ...evDocs];
  }, [issue]);

  useEffect(() => {
    if (!issue) return;
    setForm({
      fiscalYear: issue.fiscalYear || "",
      date: issue.date ? new Date(issue.date).toISOString().split("T")[0] : "",
      process: issue.process || "",
      entityCovered: issue.entityCovered || "",
      observation: issue.observation || "",
      riskLevel: issue.riskLevel || "medium",
      recommendation: issue.recommendation || "",
      managementComment: issue.managementComment || "",
      personResponsible: String(issue.personResponsible || ""),
      approver: String(issue.approver || ""),
      cxoResponsible: String(issue.cxoResponsible || ""),
      coOwner: String(issue.coOwner || ""),
      timeline: issue.timeline ? new Date(issue.timeline).toISOString().split("T")[0] : "",
      currentStatus: issue.currentStatus || "To Be Received",
      reviewComments: issue.reviewComments || "",
      risk: (issue as any).risk || "",
      actionRequired: (issue as any).actionRequired || "",
      startMonth: (issue as any).startMonth || "",
      endMonth: (issue as any).endMonth || "",
    });
    setFiles([]);
  }, [issue]);

  const setField = (k: keyof typeof form, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    if (!e.currentTarget.files) return;
    setFiles(Array.from(e.currentTarget.files));
  };

  const submit = async () => {
    if (!issue) return;
    setSaving(true);
    try {
      // 1) Update base fields (JSON)
      const res = await fetch(`${API_BASE_URL}/audit-issues/${issue.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const updated = await res.json();
      if (!res.ok) {
        throw new Error(updated?.error || "Failed to update audit issue");
      }

      // 2) If files selected, upload as annexure
      if (files.length > 0) {
        const fd = new FormData();
        files.forEach((f) => fd.append("annexure", f, f.name));
        const upRes = await fetch(`${API_BASE_URL}/audit-issues/${issue.id}/annexure`, {
          method: "POST",
          body: fd,
        });
        const upJson = await upRes.json();
        if (!upRes.ok) {
          throw new Error(upJson?.error || "Failed to upload attachments");
        }
      }

      // 3) Notify parent + close
      if (onSaved) onSaved(updated as AuditIssue);
      onClose();
    } catch (err: any) {
      alert(err?.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  if (!issue) return null;

  return (
    <Dialog open={open} onOpenChange={(val) => (!val ? onClose() : null)}>
      {/* Match Create modal sizing rules: responsive width & scrollable max height */}
      <DialogContent className="w-[95vw] sm:max-w-[900px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Audit Issue</DialogTitle>
        </DialogHeader>

        {/* Existing Files (Annexure + Evidence quick links) */}
        <div className="border rounded-lg p-3 mb-4 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Existing Attachments</div>
            <Button variant="outline" size="sm" onClick={() => setViewerOpen(true)}>
              View All ({allFiles.length})
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {allFiles.length === 0 && (
              <div className="text-sm text-gray-500">No attachments yet.</div>
            )}
            {allFiles.slice(0, 6).map((f, idx) => {
              const url = toAbsUrl(f.path || undefined);
              return (
                <div key={`${f.id ?? idx}-${f.name}`} className="text-xs">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="text-blue-600 underline"
                      title={f.name}
                    >
                      {f.name}
                    </a>
                  ) : f.content ? (
                    <span className="text-gray-700" title={f.name}>
                      {f.name} (note)
                    </span>
                  ) : (
                    <span className="text-gray-400" title={f.name}>
                      {f.name}
                    </span>
                  )}
                </div>
              );
            })}
            {allFiles.length > 6 && (
              <span className="text-xs text-gray-500">+{allFiles.length - 6} more</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          <div>
            <Label>Fiscal Year</Label>
            <Input value={form.fiscalYear} onChange={(e) => setField("fiscalYear", e.target.value)} />
          </div>

          <div>
            <Label>Date</Label>
            <Input type="date" value={form.date} onChange={(e) => setField("date", e.target.value)} />
          </div>

          <div>
            <Label>Process</Label>
            <Input value={form.process} onChange={(e) => setField("process", e.target.value)} />
          </div>

          <div>
            <Label>Entity</Label>
            <Input value={form.entityCovered} onChange={(e) => setField("entityCovered", e.target.value)} />
          </div>

          <div className="md:col-span-2">
            <div className="flex items-center justify-between">
              <Label>Observation</Label>
              {observationLocked && (
                <Badge className="bg-gray-600">Locked (evidence accepted)</Badge>
              )}
            </div>
            <Textarea
              value={form.observation}
              onChange={(e) => setField("observation", e.target.value)}
              rows={4}
              disabled={observationLocked}
              placeholder={
                observationLocked ? "Cannot edit after evidence is accepted" : ""
              }
            />
          </div>

          <div>
            <Label>Risk Level</Label>
            <Select
              value={form.riskLevel}
              onValueChange={(v) => setField("riskLevel", v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Current Status</Label>
            <Select
              value={form.currentStatus}
              onValueChange={(v) => setField("currentStatus", v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="To Be Received">To Be Received</SelectItem>
                <SelectItem value="Partially Received">Partially Received</SelectItem>
                <SelectItem value="Received">Received</SelectItem>
                <SelectItem value="Closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2">
            <Label>Recommendation</Label>
            <Textarea
              value={form.recommendation}
              onChange={(e) => setField("recommendation", e.target.value)}
              rows={3}
            />
          </div>

          <div className="md:col-span-2">
            <Label>Management Comment</Label>
            <Textarea
              value={form.managementComment}
              onChange={(e) => setField("managementComment", e.target.value)}
              rows={3}
            />
          </div>

          <div className="md:col-span-2">
            <Label>Person Responsible (semicolon or comma separated emails)</Label>
            <Input
              value={form.personResponsible}
              onChange={(e) => setField("personResponsible", e.target.value)}
              placeholder="user1@company.com; user2@company.com"
            />
          </div>

          <div className="md:col-span-2">
            <Label>Approver (semicolon or comma separated emails)</Label>
            <Input
              value={form.approver}
              onChange={(e) => setField("approver", e.target.value)}
              placeholder="approver@company.com"
            />
          </div>

          <div className="md:col-span-2">
            <Label>CXO Responsible (semicolon or comma separated emails)</Label>
            <Input
              value={form.cxoResponsible}
              onChange={(e) => setField("cxoResponsible", e.target.value)}
              placeholder="cxo@company.com"
            />
          </div>

          <div className="md:col-span-2">
            <Label>Co-Owner (optional; semicolon or comma separated emails)</Label>
            <Input
              value={form.coOwner}
              onChange={(e) => setField("coOwner", e.target.value)}
              placeholder="coowner@company.com"
            />
          </div>

          <div>
            <Label>Timeline (Due Date)</Label>
            <Input
              type="date"
              value={form.timeline}
              onChange={(e) => setField("timeline", e.target.value)}
            />
          </div>

          <div>
            <Label>Review Comments</Label>
            <Input
              value={form.reviewComments}
              onChange={(e) => setField("reviewComments", e.target.value)}
            />
          </div>

          <div>
            <Label>Risk (details)</Label>
            <Input
              value={form.risk}
              onChange={(e) => setField("risk", e.target.value)}
            />
          </div>

          <div>
            <Label>Action Required</Label>
            <Input
              value={form.actionRequired}
              onChange={(e) => setField("actionRequired", e.target.value)}
            />
          </div>

          <div>
            <Label>Coverage Start Month</Label>
            <Input
              value={form.startMonth}
              onChange={(e) => setField("startMonth", e.target.value)}
              placeholder="e.g. Apr-2025"
            />
          </div>

          <div>
            <Label>Coverage End Month</Label>
            <Input
              value={form.endMonth}
              onChange={(e) => setField("endMonth", e.target.value)}
              placeholder="e.g. Jun-2025"
            />
          </div>

          <div className="md:col-span-2">
            <Label>Add Attachments (Annexure)</Label>
            <Input type="file" multiple onChange={handleFileChange} />
            {files.length > 0 && (
              <div className="text-sm text-gray-600 mt-2">
                {files.length} file(s) selected
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving}
            className="bg-gradient-to-r from-blue-500 to-green-500"
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        {/* Document viewer */}
        <DocumentViewer
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          title={`Files for #${issue.serialNumber} – ${issue.process} / ${issue.entityCovered}`}
          files={allFiles}
        />
      </DialogContent>
    </Dialog>
  );
};
