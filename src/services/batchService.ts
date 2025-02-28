import path from 'path';
import fs from 'fs';
import axios, { AxiosInstance } from 'axios';
import { writeToLogFile } from '../config/logger';
import { vehiclesController } from '../controllers/vehiclesController';
import { Request, Response } from 'express';

export class BatchService {
    static async processBatchVehicles(req: Request, res: Response) {
        try {
            console.log('Starting batch vehicles processing...');
            writeToLogFile('general.log', '[INFO] Starting batch vehicles processing...');

            const vehiclesPath = path.join(__dirname, '../data/vehicles.json');
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
                body: { vehicles },
                priorityBatchAxios: req.priorityBatchAxios // Use the instance from the request
            };

            console.log(`Processing batch request with ${vehicles.length} vehicles...`);

            // Call batchCreateVehicles directly
            await vehiclesController.batchCreateVehicles(requestData as any, res, () => {});

            writeToLogFile('general.log', `[INFO] Batch processing completed successfully`);

        } catch (error) {
            let errorMessage: string;

            if (axios.isAxiosError(error)) {
                errorMessage = `${error.message} - ${JSON.stringify(error.response?.data)}`;
            } else if (error instanceof Error) {
                errorMessage = error.message;
            } else {
                errorMessage = 'An unknown error occurred';
            }

            console.error('Batch Processing Error:', errorMessage);
            writeToLogFile('general.log', `[ERROR] Batch processing failed: ${errorMessage}`);
        }
    }
}