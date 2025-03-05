import { processBatches } from './job';

// processBatches().then(results => {
//   console.log('Batch process results:', results);
// }).catch(error => {
//   console.error('Error running batch processes:', error);
// });
async function runJob() {
  const recordCount = 200; // מספר הרשומות לקרוא
  const startRow = 401; // מספר השורה להתחיל ממנה

  try {
    const results = await processBatches(recordCount, startRow);
    console.log("Batch processing results:", results);
  } catch (error) {
    console.error("Error in batch processing:", error);
  }
}

runJob();