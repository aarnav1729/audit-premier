
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { AuditIssue } from '@/types/audit';
import { TrendingUp, AlertTriangle, CheckCircle, Clock, Users } from 'lucide-react';

interface AnalyticsProps {
  auditIssues: AuditIssue[];
  title?: string;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

export const Analytics: React.FC<AnalyticsProps> = ({ auditIssues, title = "Analytics Dashboard" }) => {
  // Calculate various analytics
  const totalIssues = auditIssues.length;
  const highRiskIssues = auditIssues.filter(issue => issue.riskLevel === 'high').length;
  const completedIssues = auditIssues.filter(issue => issue.currentStatus === 'Received').length;
  const pendingIssues = totalIssues - completedIssues;
  const completionRate = totalIssues > 0 ? (completedIssues / totalIssues) * 100 : 0;

  // Status distribution
  const statusData = [
    { name: 'Received', value: completedIssues, color: '#10B981' },
    { name: 'To Be Received', value: pendingIssues, color: '#F59E0B' }
  ];

  // Risk level distribution
  const riskData = [
    { name: 'High', value: auditIssues.filter(issue => issue.riskLevel === 'high').length, color: '#EF4444' },
    { name: 'Medium', value: auditIssues.filter(issue => issue.riskLevel === 'medium').length, color: '#F59E0B' },
    { name: 'Low', value: auditIssues.filter(issue => issue.riskLevel === 'low').length, color: '#10B981' }
  ];

  // Process distribution
  const processData = [...new Set(auditIssues.map(issue => issue.process))]
    .map(process => ({
      name: process,
      value: auditIssues.filter(issue => issue.process === process).length
    }));

  // CXO distribution
  const cxoData = [...new Set(auditIssues.map(issue => issue.cxoResponsible))]
    .map(cxo => ({
      name: cxo.split('@')[0],
      value: auditIssues.filter(issue => issue.cxoResponsible === cxo).length,
      received: auditIssues.filter(issue => issue.cxoResponsible === cxo && issue.currentStatus === 'Received').length,
      pending: auditIssues.filter(issue => issue.cxoResponsible === cxo && issue.currentStatus === 'To Be Received').length
    }));

  // Fiscal year trend
  const fiscalYearData = [...new Set(auditIssues.map(issue => issue.fiscalYear))]
    .sort()
    .map(year => ({
      year,
      total: auditIssues.filter(issue => issue.fiscalYear === year).length,
      high: auditIssues.filter(issue => issue.fiscalYear === year && issue.riskLevel === 'high').length,
      medium: auditIssues.filter(issue => issue.fiscalYear === year && issue.riskLevel === 'medium').length,
      low: auditIssues.filter(issue => issue.fiscalYear === year && issue.riskLevel === 'low').length
    }));

  // Entity distribution
  const entityData = [...new Set(auditIssues.map(issue => issue.entityCovered))]
    .map(entity => ({
      name: entity,
      value: auditIssues.filter(issue => issue.entityCovered === entity).length
    }));

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">{title}</h2>
      
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Issues</p>
                <p className="text-3xl font-bold text-gray-900">{totalIssues}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">High Risk</p>
                <p className="text-3xl font-bold text-red-600">{highRiskIssues}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Completed</p>
                <p className="text-3xl font-bold text-green-600">{completedIssues}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Pending</p>
                <p className="text-3xl font-bold text-orange-600">{pendingIssues}</p>
              </div>
              <Clock className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Completion Rate</p>
                <p className="text-3xl font-bold text-blue-600">{completionRate.toFixed(1)}%</p>
              </div>
              <Users className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Risk Level Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Risk Level Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={riskData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                >
                  {riskData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Process Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Issues by Process</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={processData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#3B82F6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* CXO Performance */}
        <Card>
          <CardHeader>
            <CardTitle>CXO Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={cxoData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="received" stackId="a" fill="#10B981" name="Received" />
                <Bar dataKey="pending" stackId="a" fill="#F59E0B" name="Pending" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Fiscal Year Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Fiscal Year Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={fiscalYearData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="total" stroke="#3B82F6" strokeWidth={2} name="Total" />
                <Line type="monotone" dataKey="high" stroke="#EF4444" strokeWidth={2} name="High Risk" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Entity Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Issues by Entity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={entityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#10B981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
