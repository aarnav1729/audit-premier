// root/src/components/CreateAuditModal.tsx
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuditStorage } from "@/hooks/useAuditStorage";
import { toast } from "@/hooks/use-toast";

interface CreateAuditModalProps {
  open: boolean;
  onClose: () => void;
}

const API_BASE_URL = "http://localhost:7723/api";

const FISCAL_YEARS = ["2022-23", "2023-24", "2024-25", "2025-26"];
const PROCESSES = [
  "Procure to Pay",
  "Inventory Management",
  "Order to Cash",
  "Production Planning and Quality Control",
  "HR & Payroll",
  "Compliance Monitoring Mechanism",
  "Financial Statement Close Procedures",
  "Bank & Treasury",
  "Fixed Asset Management",
  "Information Technology General Controls",
  "Project Management Review",
  "SAP Security Controls Review",
  "Environment, Health and Safety (EHS)",
  "Specific Expense Management Review",
];
const ENTITIES = ["PEL", "PSPT", "PEPPL", "PEIPL", "PEGEPL"];
const RISK_LEVELS = ["high", "medium", "low"] as const;
const STATUSES = ["Received", "Partially Received"] as const;

export const CreateAuditModal: React.FC<CreateAuditModalProps> = ({
  open,
  onClose,
}) => {
  const { addAuditIssue } = useAuditStorage();
  const [isLoading, setIsLoading] = useState(false);
  const [timeline, setTimeline] = useState<Date>();
  const [samePerson, setSamePerson] = useState(true);

  const [formData, setFormData] = useState({
    fiscalYear: "",
    date: new Date().toISOString().split("T")[0],
    process: "",
    entities: [] as string[],
    observation: "",
    riskLevel: "medium" as (typeof RISK_LEVELS)[number],
    recommendation: "",
    managementComment: "",
    // if samePerson: use personResponsible; else use byEntityResponsibles
    personResponsibleList: [""], // NEW: for "same person" mode
    byEntityResponsibles: {} as Record<string, string[]>,
    approver: [""],
    cxoResponsible: [""],
    cxoCoOwner: [] as string[],
    showCxoCoOwner: false,
    currentStatus: "To Be Received" as (typeof STATUSES)[number],
    riskAnnexureText: "",
    riskAnnexureFile: null as File | null,
    actionRequired: "",
    coverageStartMonth: "",
    coverageEndMonth: "",
  });

  const toggleEntity = (ent: string) => {
    setFormData((fd) => {
      const exists = fd.entities.includes(ent);
      const entities = exists
        ? fd.entities.filter((e) => e !== ent)
        : [...fd.entities, ent];
      const byEntityResponsibles = { ...fd.byEntityResponsibles };

      if (!exists) {
        // initialize with one empty input
        byEntityResponsibles[ent] = byEntityResponsibles[ent] ?? [""];
      } else {
        // cleanup when removed
        delete byEntityResponsibles[ent];
      }

      return { ...fd, entities, byEntityResponsibles };
    });
  };

  const personList = (formData.personResponsible || '')
  .split(/[;,]\s*/)
  .filter(Boolean)
  .concat(formData.personResponsible ? [] : ['']); // start with one empty input when blank

const updatePersonAt = (idx: number, val: string) => {
  const arr = [...personList];
  arr[idx] = val;
  setFormData(fd => ({ ...fd, personResponsible: arr.filter(Boolean).join('; ') }));
};


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.entities.length === 0) {
      toast({ title: "Select at least one Entity", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      // for each entity, build one FormData and POST
      await Promise.all(
        formData.entities.map(async (ent) => {
          const payload = new FormData();
          payload.append("fiscalYear", formData.fiscalYear);
          payload.append("date", formData.date);
          payload.append("process", formData.process);
          payload.append("entityCovered", ent);
          payload.append("observation", formData.observation);
          payload.append("riskLevel", formData.riskLevel);
          payload.append("recommendation", formData.recommendation);
          payload.append("managementComment", formData.managementComment);
          // personResponsible:
          const pr = samePerson
            ? formData.personResponsibleList
                .map((s) => s.trim())
                .filter(Boolean)
                .join(",")
            : (formData.byEntityResponsibles[ent] ?? [])
                .map((s) => s.trim())
                .filter(Boolean)
                .join(",");

          payload.append("personResponsible", pr);
          formData.approver.forEach((a) => payload.append("approver", a));
          formData.cxoResponsible.forEach((c) =>
            payload.append("cxoResponsible", c)
          );
          formData.cxoCoOwner.forEach((coOwnerEmail) => {
            payload.append("cxoCoOwner[]", coOwnerEmail);
          });

          if (timeline)
            payload.append("timeline", timeline.toISOString().split("T")[0]);
          payload.append("currentStatus", formData.currentStatus);
          payload.append("risk", formData.riskAnnexureText);
          if (formData.riskAnnexureFile) {
            payload.append("annexure", formData.riskAnnexureFile);
          }
          payload.append("actionRequired", formData.actionRequired);
          if (formData.coverageStartMonth)
            payload.append("coverageStartMonth", formData.coverageStartMonth);
          if (formData.coverageEndMonth)
            payload.append("coverageEndMonth", formData.coverageEndMonth);

          const res = await fetch(`${API_BASE_URL}/audit-issues`, {
            method: "POST",
            body: payload,
          });
          if (!res.ok) throw new Error(`Entity ${ent} failed (${res.status})`);
          const created = await res.json();
          addAuditIssue(created); // mirror in local storage
        })
      );

      toast({ title: "All issues created successfully" });
      onClose();
      // reset
      setFormData({
        fiscalYear: "",
        date: new Date().toISOString().split("T")[0],
        process: "",
        entities: [],
        observation: "",
        riskLevel: "medium",
        recommendation: "",
        managementComment: "",
        personResponsibleList: [''],
        byEntityResponsibles: {},
        approver: [""],
        cxoResponsible: [""],
        currentStatus: "Partially Received",
        riskAnnexureText: "",
        riskAnnexureFile: null,
        actionRequired: "",
        coverageStartMonth: "",
        coverageEndMonth: "",
        cxoCoOwner: [] as string[],
        showCxoCoOwner: false,
      });
      setTimeline(undefined);
      setSamePerson(true);
    } catch (err) {
      console.error(err);
      toast({ title: "Error creating issues", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Create New Audit Issue
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* fiscalYear, date, process */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Fiscal Year */}
            <div className="space-y-2">
              <Label>Fiscal Year *</Label>
              <Select
                value={formData.fiscalYear}
                onValueChange={(v) =>
                  setFormData((fd) => ({ ...fd, fiscalYear: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select fiscal year" />
                </SelectTrigger>
                <SelectContent>
                  {FISCAL_YEARS.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Date */}
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={formData.date}
                onChange={(e) =>
                  setFormData((fd) => ({ ...fd, date: e.target.value }))
                }
                required
              />
            </div>
            {/* Process */}
            <div className="space-y-2">
              <Label>Process *</Label>
              <Select
                value={formData.process}
                onValueChange={(v) =>
                  setFormData((fd) => ({ ...fd, process: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select process" />
                </SelectTrigger>
                <SelectContent>
                  {PROCESSES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Optional Coverage Period */}
          <div className="space-y-2">
            <Label className="font-semibold text-base">
              Audit Coverage (optional)
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Month</Label>
                <Input
                  type="month"
                  value={formData.coverageStartMonth || ""}
                  onChange={(e) =>
                    setFormData((fd) => ({
                      ...fd,
                      coverageStartMonth: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>End Month</Label>
                <Input
                  type="month"
                  value={formData.coverageEndMonth || ""}
                  onChange={(e) =>
                    setFormData((fd) => ({
                      ...fd,
                      coverageEndMonth: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Entity Covered checkboxes */}
          <div className="space-y-2">
            <Label>Entity Covered *</Label>
            <div className="flex flex-wrap gap-4">
              {ENTITIES.map((ent) => (
                <label key={ent} className="inline-flex items-center space-x-2">
                  <Checkbox
                    checked={formData.entities.includes(ent)}
                    onCheckedChange={() => toggleEntity(ent)}
                  />
                  <span>{ent}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Responsible toggle */}
          <div className="flex items-center space-x-4">
            <Checkbox
              checked={samePerson}
              onCheckedChange={(v) => setSamePerson(Boolean(v))}
            />
            <Label>Same person responsible for all entities?</Label>
          </div>

          {samePerson ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Person Responsible (Email) *</Label>
                <button
                  type="button"
                  className="text-blue-500 text-sm hover:underline"
                  onClick={() =>
                    setFormData((fd) => ({
                      ...fd,
                      personResponsibleList: [...fd.personResponsibleList, ""],
                    }))
                  }
                >
                  + Add another
                </button>
              </div>

              {formData.personResponsibleList.map((email, i) => (
                <div key={i} className="flex items-center gap-2 mt-1">
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                      const next = [...formData.personResponsibleList];
                      next[i] = e.target.value;
                      setFormData((fd) => ({
                        ...fd,
                        personResponsibleList: next,
                      }));
                    }}
                    placeholder="person@example.com"
                  />
                  {i > 0 && (
                    <button
                      type="button"
                      className="text-red-500 hover:underline"
                      onClick={() => {
                        const next = formData.personResponsibleList.filter(
                          (_, idx) => idx !== i
                        );
                        setFormData((fd) => ({
                          ...fd,
                          personResponsibleList: next.length ? next : [""],
                        }));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {formData.entities.map((ent) => (
                <div key={ent} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Person Responsible for {ent} *</Label>
                    <button
                      type="button"
                      className="text-blue-500 text-sm hover:underline"
                      onClick={() =>
                        setFormData((fd) => ({
                          ...fd,
                          byEntityResponsibles: {
                            ...fd.byEntityResponsibles,
                            [ent]: [
                              ...(fd.byEntityResponsibles[ent] ?? [""]),
                              "",
                            ],
                          },
                        }))
                      }
                    >
                      + Add another
                    </button>
                  </div>

                  {(formData.byEntityResponsibles[ent] ?? [""]).map(
                    (email, i) => (
                      <div key={i} className="flex items-center gap-2 mt-1">
                        <Input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => {
                            const arr = [
                              ...(formData.byEntityResponsibles[ent] ?? [""]),
                            ];
                            arr[i] = e.target.value;
                            setFormData((fd) => ({
                              ...fd,
                              byEntityResponsibles: {
                                ...fd.byEntityResponsibles,
                                [ent]: arr,
                              },
                            }));
                          }}
                          placeholder="person@example.com"
                        />
                        {i > 0 && (
                          <button
                            type="button"
                            className="text-red-500 hover:underline"
                            onClick={() => {
                              const arr = (
                                formData.byEntityResponsibles[ent] ?? [""]
                              ).filter((_, idx) => idx !== i);
                              setFormData((fd) => ({
                                ...fd,
                                byEntityResponsibles: {
                                  ...fd.byEntityResponsibles,
                                  [ent]: arr.length ? arr : [""],
                                },
                              }));
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Approver & CXO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Approver */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Approver(s) (Email) *</Label>
                <button
                  type="button"
                  onClick={() =>
                    setFormData((fd) => ({
                      ...fd,
                      approver: [...fd.approver, ""],
                    }))
                  }
                  className="text-blue-500 text-sm hover:underline"
                >
                  + Add
                </button>
              </div>
              {formData.approver.map((email, index) => (
                <div key={index} className="flex items-center gap-2 mt-1">
                  <Input
                    type="email"
                    value={email}
                    required
                    onChange={(e) => {
                      const newList = [...formData.approver];
                      newList[index] = e.target.value;
                      setFormData((fd) => ({ ...fd, approver: newList }));
                    }}
                  />
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newList = formData.approver.filter(
                          (_, i) => i !== index
                        );
                        setFormData((fd) => ({ ...fd, approver: newList }));
                      }}
                      className="text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* CXO Responsible */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>CXO Responsible(s) (Email) *</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((fd) => ({
                        ...fd,
                        cxoResponsible: [...fd.cxoResponsible, ""],
                      }))
                    }
                    className="text-blue-500 text-sm hover:underline"
                  >
                    + Add
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((fd) => ({
                        ...fd,
                        showCxoCoOwner: true,
                        cxoCoOwner:
                          fd.cxoCoOwner.length === 0 ? [""] : fd.cxoCoOwner,
                      }))
                    }
                    className="text-blue-500 text-sm hover:underline"
                  >
                    + Co-owner
                  </button>
                </div>
              </div>

              {formData.cxoResponsible.map((email, index) => (
                <div key={index} className="flex items-center gap-2 mt-1">
                  <Input
                    type="email"
                    value={email}
                    required
                    onChange={(e) => {
                      const newList = [...formData.cxoResponsible];
                      newList[index] = e.target.value;
                      setFormData((fd) => ({ ...fd, cxoResponsible: newList }));
                    }}
                  />
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newList = formData.cxoResponsible.filter(
                          (_, i) => i !== index
                        );
                        setFormData((fd) => ({
                          ...fd,
                          cxoResponsible: newList,
                        }));
                      }}
                      className="text-red-500 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              {/* CXO Co-owner section */}
              {formData.showCxoCoOwner && formData.cxoCoOwner.length > 0 && (
                <div className="mt-4">
                  <Label>Co-owner(s) (Email)</Label>

                  {formData.cxoCoOwner.map((email, index) => (
                    <div key={index} className="flex items-center gap-2 mt-1">
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          const updated = [...formData.cxoCoOwner];
                          updated[index] = e.target.value;
                          setFormData((fd) => ({ ...fd, cxoCoOwner: updated }));
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = formData.cxoCoOwner.filter(
                            (_, i) => i !== index
                          );
                          setFormData((fd) => ({
                            ...fd,
                            cxoCoOwner: updated,
                            showCxoCoOwner: updated.length > 0, // hide if empty
                          }));
                        }}
                        className="text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() =>
                      setFormData((fd) => ({
                        ...fd,
                        cxoCoOwner: [...fd.cxoCoOwner, ""],
                      }))
                    }
                    className="text-blue-500 text-sm mt-2 hover:underline"
                  >
                    + Add Another Co-owner
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Observation / Recommendation */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Observation *</Label>
              <Textarea
                rows={3}
                value={formData.observation}
                onChange={(e) =>
                  setFormData((fd) => ({ ...fd, observation: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Recommendation *</Label>
              <Textarea
                rows={3}
                value={formData.recommendation}
                onChange={(e) =>
                  setFormData((fd) => ({
                    ...fd,
                    recommendation: e.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Management Comments</Label>
              <Textarea
                rows={3}
                value={formData.managementComment}
                onChange={(e) =>
                  setFormData((fd) => ({
                    ...fd,
                    managementComment: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          {/* Risk Level / Status / Timeline */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Risk Level *</Label>
              <Select
                value={formData.riskLevel}
                onValueChange={(v) =>
                  setFormData((fd) => ({ ...fd, riskLevel: v as any }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select risk level" />
                </SelectTrigger>
                <SelectContent>
                  {RISK_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      <span
                        className={cn(
                          "inline-block w-2 h-2 rounded-full mr-2",
                          l === "high"
                            ? "bg-red-500"
                            : l === "medium"
                            ? "bg-yellow-500"
                            : "bg-green-500"
                        )}
                      />
                      {l.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Current Status *</Label>
              <Select
                value={formData.currentStatus}
                onValueChange={(v) =>
                  setFormData((fd) => ({ ...fd, currentStatus: v as any }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timeline</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left",
                      !timeline && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {timeline ? format(timeline, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="p-0">
                  <Calendar
                    mode="single"
                    selected={timeline}
                    onSelect={setTimeline}
                    className="p-3"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Risk (Text) */}
          <div className="space-y-2">
            <Label>Risk</Label>
            <Textarea
              rows={2}
              value={formData.riskAnnexureText}
              onChange={(e) =>
                setFormData((fd) => ({
                  ...fd,
                  riskAnnexureText: e.target.value,
                }))
              }
            />
          </div>

          {/* Annexure Attachment */}
          <div className="space-y-2">
            <Label>Annexure (File Upload)</Label>
            <Input
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
              onChange={(e) =>
                setFormData((fd) => ({
                  ...fd,
                  riskAnnexureFile: e.target.files?.[0] || null,
                }))
              }
            />
          </div>

          {/* Action Required / IA Comments */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Action Required</Label>
              <Textarea
                rows={2}
                value={formData.actionRequired}
                onChange={(e) =>
                  setFormData((fd) => ({
                    ...fd,
                    actionRequired: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Creating…" : "Create Audit Issue"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};