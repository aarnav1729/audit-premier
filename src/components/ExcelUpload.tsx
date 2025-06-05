
import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Download, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAuditStorage } from '@/hooks/useAuditStorage';
import { AuditIssue } from '@/types/audit';

export const ExcelUpload: React.FC = () => {
  const { addAuditIssue } = useAuditStorage();
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requiredColumns = [
    'S.NO', 'FY', 'Process', 'Entity covered', 'Observation', 'Risk', 
    'Recommendation', 'Management Comment', 'Person Responsible', 'Approver', 
    'CXO', 'Timeline', 'Current status', 'Evidence', 'Review comments on Evidence Shared', 
    'Risk Annexure', 'Action required', 'IA Comments'
  ];

  const downloadTemplate = () => {
    const csvContent = requiredColumns.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit_issues_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    toast({
      title: "Template Downloaded",
      description: "CSV template has been downloaded successfully.",
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        throw new Error('File must contain at least a header row and one data row');
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const dataRows = lines.slice(1);

      // Validate headers
      const missingColumns = requiredColumns.filter(col => 
        !headers.some(header => header.toLowerCase().includes(col.toLowerCase().slice(0, 5)))
      );

      if (missingColumns.length > 0) {
        throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
      }

      let successCount = 0;
      let errorCount = 0;

      for (const row of dataRows) {
        if (!row.trim()) continue;

        try {
          const values = row.split(',').map(v => v.trim().replace(/"/g, ''));
          
          const auditIssue: Omit<AuditIssue, 'id' | 'serialNumber' | 'createdAt' | 'updatedAt'> = {
            fiscalYear: values[1] || '',
            date: new Date().toISOString().split('T')[0],
            process: values[2] || '',
            entityCovered: values[3] || '',
            observation: values[4] || '',
            riskLevel: (values[5]?.toLowerCase() as 'high' | 'medium' | 'low') || 'medium',
            recommendation: values[6] || '',
            managementComment: values[7] || '',
            personResponsible: values[8] || '',
            approver: values[9] || '',
            cxoResponsible: values[10] || '',
            timeline: values[11] || '',
            currentStatus: (values[12] as 'Received' | 'To Be Received') || 'To Be Received',
            evidenceReceived: [],
            reviewComments: values[14] || '',
            riskAnnexure: values[15] || '',
            actionRequired: values[16] || '',
            iaComments: values[17] || ''
          };

          addAuditIssue(auditIssue);
          successCount++;
        } catch (error) {
          errorCount++;
          console.error('Error processing row:', row, error);
        }
      }

      toast({
        title: "Upload Complete",
        description: `Successfully imported ${successCount} audit issues. ${errorCount > 0 ? `${errorCount} rows had errors.` : ''}`,
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

    } catch (error) {
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to process the file",
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
          <p className="text-gray-600 mt-1">Bulk import audit issues from CSV/Excel files</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
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
              <p className="text-gray-600 mb-4">Upload your CSV or Excel file</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isProcessing}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="bg-gradient-to-r from-blue-500 to-green-500"
              >
                {isProcessing ? 'Processing...' : 'Choose File'}
              </Button>
            </div>
            
            <div className="flex items-start space-x-2 p-3 bg-blue-50 rounded-lg">
              <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
              <div className="text-sm text-blue-700">
                <p className="font-medium">Important Notes:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>S.NO column should be left blank (auto-generated)</li>
                  <li>Use the exact column headers as shown in the template</li>
                  <li>Supported formats: CSV, Excel (.xlsx, .xls)</li>
                  <li>Date format: YYYY-MM-DD</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Template Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Download className="h-5 w-5" />
              <span>Download Template</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600">
              Download the template file with the required format and column headers.
            </p>
            <Button 
              onClick={downloadTemplate}
              variant="outline"
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              Download CSV Template
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Required Format Table */}
      <Card>
        <CardHeader>
          <CardTitle>Required Format</CardTitle>
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
                  <TableCell className="text-gray-500 italic">(auto-generated)</TableCell>
                  <TableCell>2024-25</TableCell>
                  <TableCell>ITGC</TableCell>
                  <TableCell>PEL</TableCell>
                  <TableCell>Sample observation...</TableCell>
                  <TableCell>high</TableCell>
                  <TableCell>Sample recommendation...</TableCell>
                  <TableCell>Sample comment...</TableCell>
                  <TableCell>user@example.com</TableCell>
                  <TableCell>approver@example.com</TableCell>
                  <TableCell>cxo@example.com</TableCell>
                  <TableCell>2024-12-31</TableCell>
                  <TableCell>To Be Received</TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell>Sample annexure...</TableCell>
                  <TableCell>Sample action...</TableCell>
                  <TableCell>Sample IA comment...</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
