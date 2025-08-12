// root/src/components/AuditTable.tsx

import React, { useState, useEffect, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, ArrowUpDown, Plus, Filter, RefreshCw, CheckCircle2 } from 'lucide-react';
import { AuditIssue } from '@/types/audit';
import { CreateAuditModal } from './CreateAuditModal';

const API_BASE_URL = "http://localhost:7723/api";

interface AuditTableProps {
  auditIssues?: AuditIssue[];
  showCreateButton?: boolean;
  title?: string;
  actionColumn?: (issue: AuditIssue) => React.ReactNode;
}

export const AuditTable: React.FC<AuditTableProps> = ({
  auditIssues,
  showCreateButton = false,
  title = "Audit Issues",
  actionColumn,
}) => {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<keyof AuditIssue>('serialNumber');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterRisk, setFilterRisk] = useState<string>('all');
  const [filterFiscalYear, setFilterFiscalYear] = useState<string>('all');
  const [filterProcess, setFilterProcess] = useState<string>('all');

  const [createModalOpen, setCreateModalOpen] = useState(false);

  // fetch from API
  const fetchIssues = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/audit-issues`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: AuditIssue[] = await res.json();
      setIssues(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load audit issues.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auditIssues && auditIssues.length) {
      setIssues(auditIssues);
      setLoading(false);
      return;
    }
    fetchIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escapeRegExp = (s: string) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const highlightText = (text: string, term: string) => {
    if (!term) return text;
    const safe = escapeRegExp(term);
    const re = new RegExp(`(${safe})`, 'gi');
    const parts = String(text ?? '').split(re);
    return parts.map((part, i) =>
      re.test(part) ? (
        <mark key={i} className="bg-yellow-200 text-black rounded px-0.5">
          {part}
        </mark>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    );
  };

  const compare = (a: any, b: any) => {
    // dates
    if (typeof a === 'string' && typeof b === 'string') {
      const aDate = Date.parse(a);
      const bDate = Date.parse(b);
      if (!isNaN(aDate) && !isNaN(bDate)) {
        return aDate - bDate;
      }
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    }
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' });
  };

  const handleSort = (field: keyof AuditIssue) => {
    if (field === sortField) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getRiskBadgeColor = (r: string) =>
    r === 'high' ? 'bg-red-500' :
    r === 'medium' ? 'bg-yellow-500' :
    r === 'low' ? 'bg-green-500' : 'bg-gray-500';

  const getStatusBadgeColor = (s: string) =>
    s === 'Received' ? 'bg-green-500' :
    s === 'Partially Received' ? 'bg-yellow-400' :
    s === 'Closed' ? 'bg-gray-600' :
    'bg-orange-500';

  const filteredAndSorted = useMemo(() => {
    let out = issues.filter(issue => {
      const matchSearch = !searchTerm ||
        Object.values(issue).some(v =>
          String(v ?? '').toLowerCase().includes(searchTerm.toLowerCase())
        );
      const matchStatus = filterStatus === 'all' || issue.currentStatus === filterStatus;
      const matchRisk = filterRisk === 'all' || issue.riskLevel === filterRisk;
      const matchYear = filterFiscalYear === 'all' || issue.fiscalYear === filterFiscalYear;
      const matchProc = filterProcess === 'all' || issue.process === filterProcess;
      return matchSearch && matchStatus && matchRisk && matchYear && matchProc;
    });

    out.sort((a, b) => {
      const aV = a[sortField] as any;
      const bV = b[sortField] as any;
      const base = compare(aV, bV);
      return sortDirection === 'asc' ? base : -base;
    });

    return out;
  }, [
    issues, searchTerm, sortField, sortDirection,
    filterStatus, filterRisk, filterFiscalYear, filterProcess
  ]);

  const handleManualClosure = async (issueId: string) => {
    if (!window.confirm("Are you sure you want to mark this issue as closed?")) return;

    try {
      const res = await fetch(`${API_BASE_URL}/audit-issues/${issueId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) throw new Error('Failed to close issue');
      await fetchIssues(); // refresh data
    } catch (err) {
      console.error(err);
      alert("Failed to close audit issue.");
    }
  };

  // unique lists for filters
  const fiscalYears = Array.from(new Set(issues.map(i => i.fiscalYear))).filter(Boolean);
  const processes = Array.from(new Set(issues.map(i => i.process))).filter(Boolean);

  if (loading) return <div className="p-6 text-center">Loading audit issues…</div>;
  if (error) return <div className="p-6 text-center text-red-500">{error}</div>;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <CardTitle className="text-xl font-semibold">{title}</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={fetchIssues}
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            {showCreateButton && (
              <Button
                onClick={() => setCreateModalOpen(true)}
                className="bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center mt-4">
          <div className="relative flex-1 min-w-64">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search across all fields…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <Filter className="h-4 w-4 text-gray-500" />

          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="border rounded p-2 w-44"
          >
            <option value="all">All Status</option>
            <option value="Received">Received</option>
            <option value="Partially Received">Partially Received</option>
            <option value="To Be Received">To Be Received</option>
            <option value="Closed">Closed</option>
          </select>

          <select
            value={filterRisk}
            onChange={e => setFilterRisk(e.target.value)}
            className="border rounded p-2 w-32"
          >
            <option value="all">All Risk</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={filterFiscalYear}
            onChange={e => setFilterFiscalYear(e.target.value)}
            className="border rounded p-2 w-32"
          >
            <option value="all">All Years</option>
            {fiscalYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <select
            value={filterProcess}
            onChange={e => setFilterProcess(e.target.value)}
            className="border rounded p-2 w-40"
          >
            <option value="all">All Processes</option>
            {processes.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead onClick={() => handleSort('serialNumber')} className="cursor-pointer">
                  <div className="flex items-center">
                    S.No <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead onClick={() => handleSort('fiscalYear')} className="cursor-pointer">
                  <div className="flex items-center">
                    Fiscal Year <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead onClick={() => handleSort('date')} className="cursor-pointer">
                  <div className="flex items-center">
                    Date <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead onClick={() => handleSort('process')} className="cursor-pointer">
                  <div className="flex items-center">
                    Process <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Observation</TableHead>
                <TableHead onClick={() => handleSort('riskLevel')} className="cursor-pointer">
                  <div className="flex items-center">
                    Risk Level <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead>Management Comment</TableHead>
                <TableHead>Person Responsible</TableHead>
                <TableHead>CXO Responsible</TableHead>
                <TableHead onClick={() => handleSort('currentStatus')} className="cursor-pointer">
                  <div className="flex items-center">
                    Status <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filteredAndSorted.map(issue => (
                <TableRow key={issue.id} className="hover:bg-gray-50">
                  <TableCell className="font-medium">{issue.serialNumber}</TableCell>
                  <TableCell>{highlightText(issue.fiscalYear, searchTerm)}</TableCell>
                  <TableCell>
                    {highlightText(new Date(issue.date).toLocaleDateString(), searchTerm)}
                  </TableCell>
                  <TableCell>{highlightText(issue.process, searchTerm)}</TableCell>
                  <TableCell>{highlightText(issue.entityCovered, searchTerm)}</TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate" title={issue.observation}>
                      {highlightText(issue.observation, searchTerm)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`${getRiskBadgeColor(issue.riskLevel)} text-white`}>
                      {issue.riskLevel.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate" title={issue.recommendation}>
                      {highlightText(issue.recommendation, searchTerm)}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate" title={issue.managementComment}>
                      {highlightText(issue.managementComment || '', searchTerm)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {highlightText(issue.personResponsible, searchTerm)}
                  </TableCell>
                  <TableCell>
                    {highlightText(issue.cxoResponsible, searchTerm)}
                    {issue.coOwner && (
                      <div className="text-sm text-gray-500">
                        Co-Owner: {highlightText(issue.coOwner, searchTerm)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={`${getStatusBadgeColor(issue.currentStatus)} text-white`}>
                      {issue.currentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {actionColumn
                      ? actionColumn(issue)
                      : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleManualClosure(issue.id)}
                          disabled={issue.currentStatus === 'Closed'}
                          title={issue.currentStatus === 'Closed' ? 'Already closed' : 'Mark as Closed'}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Close
                        </Button>
                      )
                    }
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredAndSorted.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No audit issues found matching your criteria.
            </div>
          )}
        </div>
      </CardContent>

      {createModalOpen && (
        <CreateAuditModal
          open={createModalOpen}
          onClose={() => {
            setCreateModalOpen(false);
            fetchIssues();
          }}
        />
      )}
    </Card>
  );
};
