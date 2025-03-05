import { processBatches } from "./job";

// async function runJob() {
//   const recordCount = 200; // מספר הרשומות לקרוא
//   const startRow = 401; // מספר השורה להתחיל ממנה

//   try {
//     const results = await processBatches(recordCount, startRow);
//     console.log("Batch processing results:", results);
//   } catch (error) {
//     console.error("Error in batch processing:", error);
//   }
// }

// runJob();

async function runJobWithInput(recordCount: number, startRow: number) {
  try {
    const results = await processBatches(recordCount, startRow);
    console.log("Batch processing results:", results);
  } catch (error) {
    console.error("Error in batch processing:", error);
  }
}

export { runJobWithInput };
