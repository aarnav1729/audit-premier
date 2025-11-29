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
// helper at top
const normalizeEmailLocal = (raw?: string) => {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  return s.includes("@") ? s : `${s}@premierenergies.com`;
};

function splitEmailsNorm(s?: string) {
  return String(s || "")
    .split(/[;,]\s*/)
    .map((x) => normalizeEmailLocal(x))
    .filter(Boolean);
}

/** Return per-issue capability flags for the given user email. */
function getCaps(issue: AuditIssue, userEmail?: string) {
  const e = normalizeEmailLocal(userEmail);
  const caps = { canComment: false, canUploadEvidence: false };
  if (!e) return caps;

  const inApprover = splitEmailsNorm(issue.approver).includes(e);
  const inCXO = splitEmailsNorm(issue.cxoResponsible).includes(e);
  const inPR = splitEmailsNorm(issue.personResponsible).includes(e);

  // 👇 Now PR also allowed to comment
  caps.canComment = inCXO || inApprover || inPR;
  caps.canUploadEvidence = inPR; // still only PR can upload
  return caps;
}

export const MyDashboard: React.FC = () => {
  const { user } = useAuth();
  const me = normalizeEmailLocal(user?.email || "");
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

  // CMD-F ANCHOR: const actionColumn = (issue: AuditIssue) => {
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
    const inPR = splitEmails(issue.personResponsible).includes(e);

    // CXO > Approver > Person Responsible
    type CommentRole = "CXO" | "Approver" | "Person Responsible";

    const commentAs: CommentRole | undefined = inCXO
      ? "CXO"
      : inApprover
      ? "Approver"
      : inPR
      ? "Person Responsible"
      : undefined;

    const submitComment = async () => {
      const text = window.prompt("Add a short comment / justification:");
      if (!text || !text.trim()) return;

      try {
        const res = await fetch(`${API_BASE_URL}/comments`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            issueId: issue.id,
            content: text.trim(),
            actor: me,
          }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          const msg = payload?.error || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        toast({ title: "Comment added" });
        // refresh list so comments / evidence counts reflect
        loadMyIssues();
      } catch (err: any) {
        toast({
          title: "Failed to add comment",
          description: err.message,
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
      ev.currentTarget.value = ""; // reset input so same file can be reselected later
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

        if (!r.ok) {
          const payload = await r.json().catch(() => null);
          const msg = payload?.error || `HTTP ${r.status}`;
          throw new Error(msg);
        }

        toast({ title: "Evidence uploaded" });
        loadMyIssues();
      } catch (err: any) {
        toast({
          title: "Upload failed",
          description: err.message,
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
            disabled={locked}
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
