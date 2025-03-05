import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

interface BatchDashboardProps {
  batchResults: any[];
}

const COLORS = ["#0088FE", "#FF8042"];

const BatchDashboard: React.FC<BatchDashboardProps> = ({ batchResults }) => {
  const data = [
    {
      name: "Success",
      value: batchResults.reduce((acc, result) => acc + result.SuccessCount, 0),
    },
    {
      name: "Failure",
      value: batchResults.reduce((acc, result) => acc + result.FailureCount, 0),
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={400}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          outerRadius={150}
          fill="#8884d8"
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default BatchDashboard;
