import React, { useEffect, useMemo, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { Upload, MessageCircle, Eye } from "lucide-react";
import { AuditTable } from "@/components/AuditTable";
import { Analytics } from "@/components/Analytics";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { AuditIssue } from "@/types/audit";
import { useAuth } from "@/hooks/useAuth";
import { EvidenceViewer } from "@/components/EvidenceViewer";

const API_BASE_URL = `${window.location.origin}/api`;

/** Split a semicolon/comma list into lowercased tokens. */
function splitEmails(s?: string) {
  return String(s || "")
    .toLowerCase()
    .split(/[;,]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Return per-issue capability flags for the given user email. */
function getCaps(issue: AuditIssue, userEmail?: string) {
  const e = String(userEmail || "").toLowerCase();
  const caps = {
    canComment: false, // CXO and/or Approver
    canUploadEvidence: false, // Person Responsible
  };
  if (!e) return caps;
  const inApprover = splitEmails(issue.approver).includes(e);
  const inCXO = splitEmails(issue.cxoResponsible).includes(e);
  const inPR = splitEmails(issue.personResponsible).includes(e);
  caps.canComment = inCXO || inApprover; // tighten to CXO-only if needed
  caps.canUploadEvidence = inPR;
  return caps;
}

export const MyDashboard: React.FC = () => {
  const { user } = useAuth();
  const me = user?.email || "";
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filePickersRef = useRef<Record<string, HTMLInputElement | null>>({});

  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<any[]>([]);

  // Server-side filtering: fetch ONLY rows where the logged-in user
  // is in PR / Approver / CXO via ?viewer=<email>
  const loadMyIssues = async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);

      if (!me) {
        setIssues([]);
        setLoading(false);
        return;
      }

      const url = new URL(`${API_BASE_URL}/audit-issues`);
      url.searchParams.set("viewer", me.toLowerCase());
      const res = await fetch(url.toString(), { signal });
      if (!res.ok) throw new Error(`Status ${res.status}`);

      const data: AuditIssue[] = await res.json();
      // Double-guard in case the API ever misbehaves:
      const e = me.toLowerCase();
      const mine = (data || []).filter((i) => {
        return (
          splitEmails(i.personResponsible).includes(e) ||
          splitEmails(i.approver).includes(e) ||
          splitEmails(i.cxoResponsible).includes(e)
        );
      });
      setIssues(mine);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error(err);
      setError("Failed to load audit issues.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadMyIssues(controller.signal);
    return () => controller.abort();
  }, [me]);

  // 🔎 Derive ALL roles the current user holds across loaded issues
  const myRoles = useMemo(() => {
    const e = me.toLowerCase();
    const seen = new Set<string>();
    for (const i of issues) {
      if (splitEmails(i.cxoResponsible).includes(e)) seen.add("CXO");
      if (splitEmails(i.approver).includes(e)) seen.add("Approver");
      if (splitEmails(i.personResponsible).includes(e))
        seen.add("Person Responsible");
    }
    // Enforce display order: CXO, Approver, Person Responsible
    return ["CXO", "Approver", "Person Responsible"].filter((r) => seen.has(r));
  }, [issues, me]);

  const viewEvidence = (issue: AuditIssue) => {
    setSelectedEvidence(issue.evidenceReceived);
    setEvidenceModalOpen(true);
  };

  const actionColumn = (issue: AuditIssue) => {
    const caps = getCaps(issue, me);
    const locked =
      (issue as any).isLocked === 1 ||
      (issue as any).isLocked === true ||
      issue.evidenceStatus === "Accepted";

    // Determine comment role precedence: CXO > Approver
    const e = me.toLowerCase();
    const inApprover = splitEmails(issue.approver).includes(e);
    const inCXO = splitEmails(issue.cxoResponsible).includes(e);
    const commentAs: "CXO" | "Approver" | undefined = inCXO
      ? "CXO"
      : inApprover
      ? "Approver"
      : undefined;

    const submitComment = async () => {
      const text = window.prompt("Add a short comment / justification:");
      if (!text || !text.trim()) return;
      try {
        const fd = new FormData();
        fd.append("textEvidence", text.trim());
        fd.append("uploadedBy", me);
        const r = await fetch(
          `${API_BASE_URL}/audit-issues/${issue.id}/evidence`,
          {
            method: "POST",
            body: fd,
          }
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast({ title: "Comment added" });
        // refresh list so comments/evidence counts reflect
        loadMyIssues();
      } catch (e: any) {
        toast({
          title: "Failed to add comment",
          description: e.message,
          variant: "destructive",
        });
      }
    };

    const triggerUpload = () => {
      const key = String(issue.id);
      if (!filePickersRef.current[key]) return;
      filePickersRef.current[key]!.click();
    };

    const onFilesChosen: React.ChangeEventHandler<HTMLInputElement> = async (
      ev
    ) => {
      const files = Array.from(ev.currentTarget.files || []);
      ev.currentTarget.value = ""; // reset
      if (!files.length) return;
      try {
        const fd = new FormData();
        files.forEach((f) => fd.append("evidence", f, f.name));
        fd.append("uploadedBy", me);
        const r = await fetch(
          `${API_BASE_URL}/audit-issues/${issue.id}/evidence`,
          {
            method: "POST",
            body: fd,
          }
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast({ title: "Evidence uploaded" });
        loadMyIssues();
      } catch (e: any) {
        toast({
          title: "Upload failed",
          description: e.message,
          variant: "destructive",
        });
      }
    };

    return (
      <div className="flex flex-col gap-2">
        {issue.evidenceReceived.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => viewEvidence(issue)}
            className="flex items-center space-x-1"
          >
            <Eye className="h-4 w-4" />
            <span>View</span>
          </Button>
        )}
        {commentAs && (
          <Button
            size="sm"
            variant="secondary"
            onClick={submitComment}
            title={`Add Comment as ${commentAs}`}
          >
            <MessageCircle className="h-4 w-4 mr-2" />
            Comment as {commentAs}
          </Button>
        )}
        {caps.canUploadEvidence && (
          <>
            <input
              type="file"
              multiple
              className="hidden"
              ref={(el) => (filePickersRef.current[String(issue.id)] = el)}
              onChange={onFilesChosen}
              disabled={locked}
            />
            <Button
              size="sm"
              onClick={triggerUpload}
              disabled={locked}
              title={locked ? "Locked after acceptance" : "Upload Evidence"}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload Evidence
            </Button>
          </>
        )}
      </div>
    );
  };

  if (loading) return <div className="p-6 text-center">Loading…</div>;
  if (error) return <div className="p-6 text-center text-red-500">{error}</div>;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Tabs defaultValue="analytics" className="space-y-4">
        <TabsList className="grid w-fit grid-cols-2">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="my-issues">My Issues</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="space-y-4">
          {/* Force “mine” scope so only the logged-in user's issues are analyzed */}
          <Analytics
            title="My Analytics Dashboard"
            auditIssues={issues}
            mode="mine"
          />
        </TabsContent>

        <TabsContent value="my-issues" className="space-y-4">
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="text-xl font-semibold">
                Welcome back to CAM {user?.name || me}!
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AuditTable
                auditIssues={issues}
                title="My Audit Issues"
                actionColumn={actionColumn}
                viewer={me}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <EvidenceViewer
        open={evidenceModalOpen}
        onClose={() => setEvidenceModalOpen(false)}
        evidence={selectedEvidence}
        title="Evidence Files"
      />
    </div>
  );
};

export default MyDashboard;
