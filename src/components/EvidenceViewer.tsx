
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, File, FileText, Calendar, User } from 'lucide-react';
import { Evidence } from '@/types/audit';

interface EvidenceViewerProps {
  open: boolean;
  onClose: () => void;
  evidence: Evidence[];
  title?: string;
}

export const EvidenceViewer: React.FC<EvidenceViewerProps> = ({
  open,
  onClose,
  evidence,
  title = "Evidence Files"
}) => {
  const downloadFile = (evidenceItem: Evidence) => {
    if (evidenceItem.content) {
      // Text evidence
      const blob = new Blob([evidenceItem.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${evidenceItem.fileName}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else if (evidenceItem.base64Data) {
      // File evidence
      const link = document.createElement('a');
      link.href = evidenceItem.base64Data;
      link.download = evidenceItem.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('text/') || fileType === 'text/plain') {
      return <FileText className="h-8 w-8 text-blue-500" />;
    }
    return <File className="h-8 w-8 text-gray-500" />;
  };

  const isImage = (fileType: string) => {
    return fileType.startsWith('image/');
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {evidence.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No evidence files available.
            </div>
          ) : (
            evidence.map((evidenceItem) => (
              <div key={evidenceItem.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    {getFileIcon(evidenceItem.fileType)}
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">{evidenceItem.fileName}</h3>
                      <div className="flex items-center space-x-4 text-sm text-gray-500 mt-1">
                        <div className="flex items-center space-x-1">
                          <Calendar className="h-3 w-3" />
                          <span>{new Date(evidenceItem.uploadedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <User className="h-3 w-3" />
                          <span>{evidenceItem.uploadedBy}</span>
                        </div>
                        <Badge variant="outline">{formatFileSize(evidenceItem.fileSize)}</Badge>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadFile(evidenceItem)}
                    className="flex items-center space-x-1"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download</span>
                  </Button>
                </div>

                {evidenceItem.content && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">
                      {evidenceItem.content}
                    </p>
                  </div>
                )}

                {evidenceItem.base64Data && isImage(evidenceItem.fileType) && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <img
                      src={evidenceItem.base64Data}
                      alt={evidenceItem.fileName}
                      className="max-w-full h-auto rounded"
                      style={{ maxHeight: '300px' }}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
