import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type DocItem = {
  id?: string | number;
  name: string;
  path?: string | null;     // e.g. "uploads/abc.pdf"
  type?: string | null;     // mime type if known
  size?: number | null;
  uploadedAt?: string | null;
  content?: string | null;  // for text entries (comments/justification)
  fileName?: string | null; // for evidence records where "fileName" exists
  fileType?: string | null; // for evidence records where "fileType" exists
};

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  files: DocItem[];
};

function toAbsUrl(p?: string | null) {
  if (!p) return null;
  // Ensure single leading slash for server-static "/uploads"
  const cleaned = p.replace(/^\.*\/?/, "");
  return `${window.location.origin}/${cleaned}`;
}

function isImage(mime?: string | null, name?: string | null) {
  if (mime && mime.startsWith("image/")) return true;
  const n = (name || "").toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].some((ext) => n.endsWith(ext));
}

function isPdf(mime?: string | null, name?: string | null) {
  if (mime === "application/pdf") return true;
  const n = (name || "").toLowerCase();
  return n.endsWith(".pdf");
}

export const DocumentViewer: React.FC<Props> = ({ open, onClose, title = "Files", files }) => {
  const normalized = useMemo(() => {
    // Normalize different shapes into DocItem
    return (files || []).map((f, i) => {
      const name = f.name || f.fileName || `File ${i + 1}`;
      const type = f.type || f.fileType || null;
      return { ...f, name, type };
    });
  }, [files]);

  const [sel, setSel] = useState(0);
  const selected = normalized[sel];

  // Build URLs for download / preview
  const fileUrl = selected ? toAbsUrl(selected.path || undefined) : null;

  // For text items (comment/justification), build a data URL for download
  const textDataUrl = selected?.content
    ? `data:text/plain;charset=utf-8,${encodeURIComponent(selected.content)}`
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : void 0)}>
      <DialogContent className="w-[95vw] sm:max-w-[1000px] max-h-[85vh] overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* File list */}
            <div className="md:col-span-4 border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-sm font-medium">Files</div>
              <ul className="max-h-[55vh] overflow-auto divide-y">
                {normalized.length === 0 && (
                  <li className="px-3 py-3 text-sm text-gray-500">No files found.</li>
                )}
                {normalized.map((f, i) => {
                  const url = toAbsUrl(f.path || undefined);
                  return (
                    <li
                      key={`${f.id ?? i}-${f.name}`}
                      className={`px-3 py-3 text-sm cursor-pointer hover:bg-gray-50 ${
                        sel === i ? "bg-gray-100" : ""
                      }`}
                      onClick={() => setSel(i)}
                      title={f.name}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate">
                          <div className="font-medium truncate">{f.name}</div>
                          {f.uploadedAt && (
                            <div className="text-xs text-gray-500">
                              {new Date(f.uploadedAt).toLocaleString()}
                            </div>
                          )}
                          {!f.path && !f.content && (
                            <div className="text-xs text-red-500 mt-1">
                              No file available (name only).
                            </div>
                          )}
                        </div>
                        {url && (
                          <a
                            className="text-xs text-blue-600 underline shrink-0"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            download
                            onClick={(e) => e.stopPropagation()}
                          >
                            Download
                          </a>
                        )}
                        {!url && f.content && (
                          <a
                            className="text-xs text-blue-600 underline shrink-0"
                            href={textDataUrl || "#"}
                            download={`${(f.name || "note").replace(/\s+/g, "_")}.txt`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Download
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Preview panel */}
            <div className="md:col-span-8 border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-sm font-medium">Preview</div>
              <div className="bg-white max-h-[55vh] overflow-auto p-3">
                {!selected ? (
                  <div className="text-sm text-gray-500">Select a file to preview.</div>
                ) : selected.content ? (
                  <pre className="whitespace-pre-wrap text-sm">{selected.content}</pre>
                ) : fileUrl ? (
                  isImage(selected.type || null, selected.name || null) ? (
                    <img src={fileUrl} alt={selected.name} className="max-w-full h-auto" />
                  ) : isPdf(selected.type || null, selected.name || null) ? (
                    <iframe
                      src={fileUrl}
                      title={selected.name}
                      className="w-full h-[60vh] border-0"
                    />
                  ) : (
                    <div className="text-sm text-gray-600">
                      No inline preview for this file type.{" "}
                      <a
                        href={fileUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline"
                      >
                        Click to download
                      </a>
                      .
                    </div>
                  )
                ) : (
                  <div className="text-sm text-gray-500">
                    This item has no path or content to preview.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 p-3 border-t bg-white">
                {fileUrl && (
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="text-sm"
                  >
                    <Button variant="outline">Download</Button>
                  </a>
                )}
                {!fileUrl && textDataUrl && (
                  <a
                    href={textDataUrl}
                    download={`${(selected.name || "note").replace(/\s+/g, "_")}.txt`}
                    className="text-sm"
                  >
                    <Button variant="outline">Download</Button>
                  </a>
                )}
                <Button onClick={onClose} className="bg-gradient-to-r from-blue-500 to-green-500">
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
