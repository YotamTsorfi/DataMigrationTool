// index.ts

import express from 'express';
import cors from 'cors';
import { config } from './config/config';
import { writeToLogFile } from './config/logger';
import axios from 'axios';
import PerformanceMonitor from './utils/performanceMonitor';
import path from 'path';
import fs from 'fs';

import priorityRoutes from './routers/priorityRoutes';
import userRouter from './routers/userRouter';

import { connectToCarmeltonDatabase } from './database/connection';

// Initialize Express app
const app = express();

// Connect to DB
connectToCarmeltonDatabase();

const port = config.port;
const http = require("http").createServer(app);

// Middleware
app.use(cors());
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

//Routers
app.use('/priority', priorityRoutes);
app.use('/api', userRouter);

// פונקציה לבדיקת batch
async function testBatchVehicles() {

    try {
        console.log('Starting batch vehicles test...');
        writeToLogFile('general.log', '[INFO] Starting batch vehicles test...');

        const vehiclesPath = path.join(__dirname, './data/vehicles.json');
        console.log('Reading vehicles from:', vehiclesPath);
        
        if (!fs.existsSync(vehiclesPath)) {
            throw new Error(`Vehicles file not found at: ${vehiclesPath}`);
        }

        const vehiclesData = fs.readFileSync(vehiclesPath, 'utf-8');
        let vehicles;
        
        try {
            vehicles = JSON.parse(vehiclesData);
            console.log(`Successfully loaded ${vehicles.length} vehicles from file`);
        } catch (error) {
            const parseError = error instanceof Error ? error : new Error('Unknown parsing error');
            throw new Error(`Failed to parse vehicles JSON: ${parseError.message}`);
        }

        if (!Array.isArray(vehicles)) {
            throw new Error('Vehicles data must be an array');
        }

        const requestData = {
            vehicles: vehicles
        };

        console.log(`Sending batch request with ${vehicles.length} vehicles...`);

        const response = await axios.post(
            `http://localhost:${port}/priority/vehicles/batch`, 
            requestData,
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        console.log('Batch Request completed:', {
            status: response.status,
            vehiclesCount: vehicles.length,
            message: response.data.message
        });

        writeToLogFile('general.log', `[INFO] Batch test completed successfully: ${JSON.stringify({
            status: response.status,
            vehiclesCount: vehicles.length,
            message: response.data.message
        })}`);

    } catch (error) {
        let errorMessage: string;
        
        if (axios.isAxiosError(error)) {
            errorMessage = `${error.message} - ${JSON.stringify(error.response?.data)}`;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        } else {
            errorMessage = 'An unknown error occurred';
        }

        console.error('Batch Test Error:', errorMessage);
        writeToLogFile('general.log', `[ERROR] Batch test failed: ${errorMessage}`);
    }
}

// Start server
http.listen(port, '0.0.0.0', () => {
    const startupTime = Date.now();
    console.log(`App is listening at http://0.0.0.0:${port}`);
    console.log(`Logs are at ./logs under root folder.`);
    
    // רישום זמן עליית השרת
    writeToLogFile('general.log', `[INFO] Server started in ${Date.now() - startupTime}ms`);
    
    // רישום מדדי ביצועים ראשוניים של השרת
    PerformanceMonitor.logServerMetrics();

    // הרצת הטסט לאחר השהייה קצרה
    setTimeout(async () => {
        try {
            await testBatchVehicles();
        } catch (error) {
            const errorMessage = error instanceof Error 
                ? error.message 
                : 'An unknown error occurred';
                
            console.error('Failed to run batch test:', errorMessage);
            writeToLogFile('general.log', `[ERROR] Failed to run batch test: ${errorMessage}`);
        }
    }, 2000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Performing graceful shutdown...');
    writeToLogFile('general.log', '[INFO] Server shutting down...');
    
    // רישום מדדי ביצועים אחרונים
    PerformanceMonitor.logServerMetrics();
    
    http.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});