
import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Download, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAuditStorage } from '@/hooks/useAuditStorage';
import { AuditIssue } from '@/types/audit';
import * as XLSX from 'xlsx';

export const ExcelUpload: React.FC = () => {
  const { addAuditIssue } = useAuditStorage();
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requiredColumns = [
    'S.NO', 'FY', 'Process', 'Entity covered', 'Observation', 'Risk', 
    'Recommendation', 'Management Comment', 'Person Responsible', 'Approver', 
    'CXO', 'Timeline', 'Current status', 'Evidence', 'Review comments on Evidence Shared', 
    'Risk', 'Annexure', 'Action required', 'Management comments', 'IA Comments'
  ];

  const downloadTemplate = () => {
    const csvContent = requiredColumns.join('\t') + '\n';
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

  // Enhanced CSV parser that handles quoted fields with line breaks
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === '\t' && !inQuotes) {
        // Tab separator outside quotes
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
    
    result.push(current.trim());
    return result;
  };

  const parseExcelFile = async (file: File): Promise<{ headers: string[], dataRows: string[][] }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Convert to JSON array
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          
          if (jsonData.length < 2) {
            throw new Error('File must contain at least a header row and one data row');
          }

          const headers = (jsonData[0] as string[]).map(h => String(h).trim());
          const dataRows = jsonData.slice(1).map(row => 
            (row as any[]).map(cell => String(cell || '').trim())
          );

          console.log('Excel parsed headers:', headers);
          console.log('Excel parsed data rows:', dataRows.length);

          resolve({ headers, dataRows });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read Excel file'));
      reader.readAsArrayBuffer(file);
    });
  };

  const parseCSVFile = async (file: File): Promise<{ headers: string[], dataRows: string[][] }> => {
    const text = await file.text();
    
    // Split by lines but handle multiline quoted fields
    const rawLines = text.split('\n');
    const processedLines: string[] = [];
    let currentLine = '';
    let inQuotes = false;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      currentLine += (currentLine ? '\n' : '') + line;
      
      // Count quotes to determine if we're inside a quoted field
      const quoteCount = (currentLine.match(/"/g) || []).length;
      inQuotes = quoteCount % 2 === 1;
      
      if (!inQuotes && currentLine.trim()) {
        processedLines.push(currentLine);
        currentLine = '';
      }
    }
    
    // Add any remaining line
    if (currentLine.trim()) {
      processedLines.push(currentLine);
    }

    const lines = processedLines.filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error('File must contain at least a header row and one data row');
    }

    const headers = parseCSVLine(lines[0]);
    const dataRows = lines.slice(1).map(line => parseCSVLine(line));

    console.log('CSV parsed headers:', headers);
    console.log('CSV parsed data rows:', dataRows.length);

    return { headers, dataRows };
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);

    try {
      let headers: string[] = [];
      let dataRows: string[][] = [];

      // Determine file type and parse accordingly
      const fileExtension = file.name.toLowerCase().split('.').pop();
      
      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        const result = await parseExcelFile(file);
        headers = result.headers;
        dataRows = result.dataRows;
      } else if (fileExtension === 'csv') {
        const result = await parseCSVFile(file);
        headers = result.headers;
        dataRows = result.dataRows;
      } else {
        throw new Error('Unsupported file format. Please upload CSV or Excel files only.');
      }

      // Validate headers - check for key columns
      const keyColumns = ['FY', 'Process', 'Entity covered', 'Observation', 'Risk'];
      const missingColumns = keyColumns.filter(col => 
        !headers.some(header => header.toLowerCase().includes(col.toLowerCase()))
      );

      if (missingColumns.length > 0) {
        throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
      }

      let successCount = 0;
      let errorCount = 0;

      for (const row of dataRows) {
        if (!row.some(cell => cell.trim())) continue; // Skip empty rows

        try {
          console.log('Processing row:', row);
          
          // Map risk level to valid enum values
          const mapRiskLevel = (risk: string): 'high' | 'medium' | 'low' => {
            const riskLower = risk?.toLowerCase();
            if (riskLower === 'high') return 'high';
            if (riskLower === 'low') return 'low';
            return 'medium';
          };

          // Map current status to valid enum values
          const mapCurrentStatus = (status: string): 'Received' | 'To Be Received' => {
            const statusLower = status?.toLowerCase();
            if (statusLower.includes('received')) return 'Received';
            return 'To Be Received';
          };

          const auditIssue: Omit<AuditIssue, 'id' | 'serialNumber' | 'createdAt' | 'updatedAt'> = {
            fiscalYear: row[1] || '',
            date: new Date().toISOString().split('T')[0],
            process: row[2] || '',
            entityCovered: row[3] || '',
            observation: row[4] || '',
            riskLevel: mapRiskLevel(row[5]),
            recommendation: row[6] || '',
            managementComment: row[7] || '',
            personResponsible: row[8] || '',
            approver: row[9] || '',
            cxoResponsible: row[10] || '',
            timeline: row[11] || '',
            currentStatus: mapCurrentStatus(row[12]),
            evidenceReceived: [],
            reviewComments: row[14] || '',
            riskAnnexure: row[16] || '',
            actionRequired: row[17] || '',
            iaComments: row[19] || ''
          };

          addAuditIssue(auditIssue);
          successCount++;
          console.log('Successfully added audit issue:', auditIssue);
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
      console.error('Upload error:', error);
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
                  <li>Use tab-separated values or the exact column headers</li>
                  <li>Supported formats: CSV, Excel (.xlsx, .xls)</li>
                  <li>Date format: YYYY-MM-DD for Timeline</li>
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
                  <TableCell>high</TableCell>
                  <TableCell>Sample annexure...</TableCell>
                  <TableCell>Sample action...</TableCell>
                  <TableCell>Sample mgmt comment...</TableCell>
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
