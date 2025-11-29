// root/src/components/AuditorsManager.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Save, X } from "lucide-react";

const API_BASE_URL = `${window.location.origin}/api`;

type AuditorRow = {
  id: string | null; // null => env/static row
  email: string;
  processes: string[]; // ["*"] => all
  source: "db" | "env" | "static";
};

type Props = { viewerEmail: string };

export const AuditorsManager: React.FC<Props> = ({ viewerEmail }) => {
  const [rows, setRows] = useState<AuditorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [procChoices, setProcChoices] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  // Add form
  const [newEmail, setNewEmail] = useState("");
  const [newAll, setNewAll] = useState(true);
  const [newProcs, setNewProcs] = useState<string[]>([]);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<AuditorRow | null>(null);
  const [editAll, setEditAll] = useState(false);
  const [editProcs, setEditProcs] = useState<string[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auditors`);
      const data = await res.json();
      setRows(data || []);
    } finally {
      setLoading(false);
    }
  };

  // derive process choices from issues (auditors will have access to fetch them)
  const loadProcesses = async () => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/audit-issues?scope=all&viewer=${encodeURIComponent(
          viewerEmail
        )}`
      );
      const issues = await res.json();
      const uniq = Array.from(
        new Set(
          (issues || [])
            .map((r: any) => String(r.process || "").trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
      setProcChoices(uniq);
    } catch {
      setProcChoices([]);
    }
  };

  useEffect(() => {
    loadData();
    loadProcesses();
  }, []);

  const displayProcesses = (p: string[]) => {
    if (!p?.length) return "—";
    if (p.includes("*")) return "All processes";
    return p.join(", ");
  };

  const resetAdd = () => {
    setNewEmail("");
    setNewAll(true);
    setNewProcs([]);
  };

  const createAuditor = async () => {
    const payload = {
      email: newEmail,
      processes: newAll ? ["*"] : newProcs,
      actor: viewerEmail,
    };
    const res = await fetch(`${API_BASE_URL}/auditors`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json();
    if (!res.ok) {
      alert(out.error || "Failed to add auditor");
      return;
    }
    setAddOpen(false);
    resetAdd();
    loadData();
  };

  const openEdit = (r: AuditorRow) => {
    setEditRow(r);
    setEditAll(r.processes.includes("*"));
    setEditProcs(r.processes.filter((x) => x !== "*"));
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editRow?.id) return;
    const payload = {
      email: editRow.email, // allow editing email if you want; here we keep as-is
      processes: editAll ? ["*"] : editProcs,
      actor: viewerEmail,
    };
    const res = await fetch(`${API_BASE_URL}/auditors/${editRow.id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json();
    if (!res.ok) {
      alert(out.error || "Failed to update auditor");
      return;
    }
    setEditOpen(false);
    setEditRow(null);
    loadData();
  };

  const deleteRow = async (r: AuditorRow) => {
    if (!r.id) return;
    if (!confirm(`Remove ${r.email} from auditors?`)) return;
    const res = await fetch(
      `${API_BASE_URL}/auditors/${encodeURIComponent(
        r.id
      )}?actor=${encodeURIComponent(viewerEmail)}`,
      { method: "DELETE", credentials: "include" }
    );
    const out = await res.json();
    if (!res.ok) {
      alert(out.error || "Failed to delete auditor");
      return;
    }
    loadData();
  };

  const selectableProcs = useMemo(() => procChoices, [procChoices]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Auditors</h2>
          <p className="text-sm text-muted-foreground">
            Control who is an auditor and which processes they cover.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add auditor
        </Button>
      </div>

      <div className="rounded-2xl border">
        <div className="grid grid-cols-12 px-4 py-2 text-sm font-medium bg-muted/50">
          <div className="col-span-5">Email</div>
          <div className="col-span-5">Processes</div>
          <div className="col-span-1 text-center">Source</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No auditors configured.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={`${r.source}:${r.id || r.email}`}
              className="grid grid-cols-12 items-center px-4 py-3 border-t"
            >
              <div className="col-span-5 break-words">{r.email}</div>
              <div className="col-span-5">
                {r.processes.includes("*") ? (
                  <Badge className="bg-blue-600">All processes</Badge>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {r.processes.map((p) => (
                      <Badge key={p} variant="secondary">
                        {p}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-span-1 text-center">
                <Badge variant={r.source === "db" ? "default" : "secondary"}>
                  {r.source}
                </Badge>
              </div>
              <div className="col-span-1">
                <div className="flex justify-end gap-2">
                  {r.source === "db" ? (
                    <>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => openEdit(r)}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="destructive"
                        onClick={() => deleteRow(r)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add auditor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                placeholder="name@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="add-all"
                  checked={newAll}
                  onCheckedChange={(v) => setNewAll(Boolean(v))}
                />
                <Label htmlFor="add-all">All processes</Label>
              </div>
              {!newAll && (
                <div className="mt-2">
                  <Label className="mb-1 block">Select processes</Label>
                  <div className="flex flex-wrap gap-2 max-h-44 overflow-auto rounded-lg border p-2">
                    {selectableProcs.length === 0 && (
                      <span className="text-sm text-muted-foreground">
                        No processes found
                      </span>
                    )}
                    {selectableProcs.map((p) => {
                      const checked = newProcs.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() =>
                            setNewProcs((prev) =>
                              checked
                                ? prev.filter((x) => x !== p)
                                : [...prev, p]
                            )
                          }
                          className={`px-2 py-1 rounded-full text-xs border ${
                            checked
                              ? "bg-primary text-primary-foreground"
                              : "bg-background"
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button onClick={createAuditor} disabled={!newEmail.trim()}>
                <Save className="h-4 w-4 mr-1" />
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit auditor</DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={editRow.email} disabled />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="edit-all"
                    checked={editAll}
                    onCheckedChange={(v) => setEditAll(Boolean(v))}
                  />
                  <Label htmlFor="edit-all">All processes</Label>
                </div>
                {!editAll && (
                  <div className="mt-2">
                    <Label className="mb-1 block">Select processes</Label>
                    <div className="flex flex-wrap gap-2 max-h-44 overflow-auto rounded-lg border p-2">
                      {selectableProcs.map((p) => {
                        const checked = editProcs.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() =>
                              setEditProcs((prev) =>
                                checked
                                  ? prev.filter((x) => x !== p)
                                  : [...prev, p]
                              )
                            }
                            className={`px-2 py-1 rounded-full text-xs border ${
                              checked
                                ? "bg-primary text-primary-foreground"
                                : "bg-background"
                            }`}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditOpen(false)}>
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button onClick={saveEdit}>
                  <Save className="h-4 w-4 mr-1" />
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
