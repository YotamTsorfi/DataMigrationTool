import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface BatchDashboardProps {
  batchResults: any[];
}

const BatchDashboard: React.FC<BatchDashboardProps> = ({ batchResults }) => {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={batchResults}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="BatchID" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="SuccessCount" stroke="#82ca9d" />
        <Line type="monotone" dataKey="FailureCount" stroke="#ff7300" />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default BatchDashboard;
